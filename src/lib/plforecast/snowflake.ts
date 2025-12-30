import snowflake from 'snowflake-sdk';
import type { BrandCode, ChannelRowData, ShopSalesDetail, TierRegionSalesRow } from './types';

// Snowflake 연결 설정
function getConnection(): Promise<snowflake.Connection> {
  return new Promise((resolve, reject) => {
    const connection = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT || '',
      username: process.env.SNOWFLAKE_USERNAME || '',
      password: process.env.SNOWFLAKE_PASSWORD || '',
      warehouse: process.env.SNOWFLAKE_WAREHOUSE || '',
      database: process.env.SNOWFLAKE_DATABASE || 'sap_fnf',
      schema: process.env.SNOWFLAKE_SCHEMA || 'public',
    });

    connection.connect((err, conn) => {
      if (err) {
        reject(err);
      } else {
        resolve(conn);
      }
    });
  });
}

// 쿼리 실행
function executeQuery<T>(
  connection: snowflake.Connection,
  sql: string,
  binds: (string | number)[] = []
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      binds,
      complete: (err, stmt, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve((rows || []) as T[]);
        }
      },
    });
  });
}

// 연결 종료
function destroyConnection(connection: snowflake.Connection): Promise<void> {
  return new Promise((resolve) => {
    connection.destroy((err) => {
      if (err) {
        console.error('Error destroying connection:', err);
      }
      resolve();
    });
  });
}

// 브랜드별 마지막 날짜 조회 결과
interface LastDtResult {
  BRD_CD: string;
  LAST_DT: string;
}

// 브랜드별 last_dt 조회
export async function getLastDates(
  ym: string,
  brandCodes: BrandCode[]
): Promise<Record<BrandCode, string>> {
  const connection = await getConnection();
  try {
    const sql = `
      SELECT brd_cd as BRD_CD, MAX(pst_dt)::VARCHAR as LAST_DT
      FROM sap_fnf.dw_cn_copa_d
      WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
        AND brd_cd IN (${brandCodes.map(() => '?').join(',')})
      GROUP BY brd_cd
    `;
    const rows = await executeQuery<LastDtResult>(connection, sql, [ym, ...brandCodes]);
    
    const result: Partial<Record<BrandCode, string>> = {};
    for (const row of rows) {
      result[row.BRD_CD as BrandCode] = row.LAST_DT;
    }
    return result as Record<BrandCode, string>;
  } finally {
    await destroyConnection(connection);
  }
}

// 실적 조회 결과
interface ActualResult {
  [key: string]: number | string;
}

// 전년 실적 조회
export async function getPrevYearActuals(
  prevYm: string,
  brandCode: BrandCode,
  items: string[]
): Promise<Record<string, number>> {
  if (items.length === 0) return {};
  
  const connection = await getConnection();
  try {
    const selectClauses = items.map((item) => `COALESCE(SUM(${item}), 0) as "${item}"`).join(', ');
    const sql = `
      SELECT ${selectClauses}
      FROM sap_fnf.dw_cn_copa_d
      WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
        AND brd_cd = ?
    `;
    const rows = await executeQuery<ActualResult>(connection, sql, [prevYm, brandCode]);
    
    if (rows.length === 0) {
      return Object.fromEntries(items.map((item) => [item, 0]));
    }
    
    const result: Record<string, number> = {};
    for (const item of items) {
      result[item] = Number(rows[0][item]) || 0;
    }
    return result;
  } finally {
    await destroyConnection(connection);
  }
}

// 누적 실적 조회
export async function getAccumActuals(
  ym: string,
  lastDt: string,
  brandCode: BrandCode,
  items: string[]
): Promise<{ accum: Record<string, number>; accumDays: number }> {
  if (items.length === 0) return { accum: {}, accumDays: 0 };
  
  const connection = await getConnection();
  try {
    const selectClauses = items.map((item) => `COALESCE(SUM(${item}), 0) as "${item}"`).join(', ');
    const sql = `
      SELECT ${selectClauses}, COUNT(DISTINCT pst_dt) as ACCUM_DAYS
      FROM sap_fnf.dw_cn_copa_d
      WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
        AND pst_dt <= ?
        AND brd_cd = ?
    `;
    const rows = await executeQuery<ActualResult>(connection, sql, [ym, lastDt, brandCode]);
    
    if (rows.length === 0) {
      return {
        accum: Object.fromEntries(items.map((item) => [item, 0])),
        accumDays: 0,
      };
    }
    
    const accum: Record<string, number> = {};
    for (const item of items) {
      accum[item] = Number(rows[0][item]) || 0;
    }
    return {
      accum,
      accumDays: Number(rows[0]['ACCUM_DAYS']) || 0,
    };
  } finally {
    await destroyConnection(connection);
  }
}

// 대리상지원금 전용 조회 (OUTSRC_PROC_CST + SMPL_BUY_CST - MILE_SALE_AMT)
export async function getDealerSupportActuals(
  ym: string,
  lastDt: string,
  brandCode: BrandCode
): Promise<{ prevYear: number; accum: number }> {
  const connection = await getConnection();
  try {
    // 전년동월 계산
    const [year, month] = ym.split('-').map(Number);
    const prevYm = `${year - 1}-${String(month).padStart(2, '0')}`;
    
    // 전년 실적
    const prevSql = `
      SELECT COALESCE(SUM(OUTSRC_PROC_CST), 0) + COALESCE(SUM(SMPL_BUY_CST), 0) - COALESCE(SUM(MILE_SALE_AMT), 0) as DEALER_SUPPORT
      FROM sap_fnf.dw_cn_copa_d
      WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
        AND brd_cd = ?
    `;
    const prevRows = await executeQuery<{ DEALER_SUPPORT: number }>(connection, prevSql, [prevYm, brandCode]);
    const prevYear = prevRows.length > 0 ? Number(prevRows[0].DEALER_SUPPORT) || 0 : 0;
    
    // 당월 누적
    const accumSql = `
      SELECT COALESCE(SUM(OUTSRC_PROC_CST), 0) + COALESCE(SUM(SMPL_BUY_CST), 0) - COALESCE(SUM(MILE_SALE_AMT), 0) as DEALER_SUPPORT
      FROM sap_fnf.dw_cn_copa_d
      WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
        AND pst_dt <= ?
        AND brd_cd = ?
    `;
    const accumRows = await executeQuery<{ DEALER_SUPPORT: number }>(connection, accumSql, [ym, lastDt, brandCode]);
    const accum = accumRows.length > 0 ? Number(accumRows[0].DEALER_SUPPORT) || 0 : 0;
    
    return { prevYear, accum };
  } finally {
    await destroyConnection(connection);
  }
}

// 당월일수 계산 (달력일수)
export function getMonthDays(ym: string): number {
  const [year, month] = ym.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

// 전년동월 계산
export function getPrevYearMonth(ym: string): string {
  const [year, month] = ym.split('-').map(Number);
  return `${year - 1}-${String(month).padStart(2, '0')}`;
}

// 마감일 기준 주차별 날짜 범위 계산 (일요일~토요일)
function calcWeekRanges(lastDt: string): { weekNum: number; startDt: string; endDt: string }[] {
  const last = new Date(lastDt);
  const dayOfWeek = last.getDay(); // 0=일요일, 6=토요일
  
  // 마감일이 포함된 주의 일요일 찾기
  const currentWeekSunday = new Date(last);
  currentWeekSunday.setDate(last.getDate() - dayOfWeek);
  
  const ranges: { weekNum: number; startDt: string; endDt: string }[] = [];
  
  for (let i = 0; i < 4; i++) {
    const startDt = new Date(currentWeekSunday);
    startDt.setDate(currentWeekSunday.getDate() - (i * 7));
    
    const endDt = new Date(startDt);
    endDt.setDate(startDt.getDate() + 6);
    
    // 마감일보다 미래인 경우 마감일로 제한
    const actualEnd = endDt > last ? last : endDt;
    
    ranges.push({
      weekNum: i + 1,
      startDt: startDt.toISOString().split('T')[0],
      endDt: actualEnd.toISOString().split('T')[0],
    });
  }
  
  // 날짜 오름차순으로 정렬 (오래된 주부터)
  return ranges.reverse();
}

// 마감일 기준 최근 4주 주간 매출 조회 (일요일~토요일)
interface WeeklySalesResult {
  CUR_SALE: number;
  PREV_SALE: number;
}

export async function getWeeklySales(
  lastDt: string,
  brandCodes: BrandCode[]
): Promise<{ weekNum: number; startDt: string; endDt: string; curSale: number; prevSale: number }[]> {
  const connection = await getConnection();
  try {
    const weekRanges = calcWeekRanges(lastDt);
    const results: { weekNum: number; startDt: string; endDt: string; curSale: number; prevSale: number }[] = [];
    
    for (const week of weekRanges) {
      const sql = `
        SELECT 
          COALESCE(SUM(CASE WHEN pst_dt BETWEEN ?::DATE AND ?::DATE THEN ACT_SALE_AMT ELSE 0 END), 0) as CUR_SALE,
          COALESCE(SUM(CASE WHEN pst_dt BETWEEN DATEADD(year, -1, ?::DATE) AND DATEADD(year, -1, ?::DATE) THEN ACT_SALE_AMT ELSE 0 END), 0) as PREV_SALE
        FROM sap_fnf.dw_cn_copa_d
        WHERE (
          (pst_dt BETWEEN ?::DATE AND ?::DATE)
          OR (pst_dt BETWEEN DATEADD(year, -1, ?::DATE) AND DATEADD(year, -1, ?::DATE))
        )
        AND brd_cd IN (${brandCodes.map(() => '?').join(',')})
      `;
      
      const binds = [
        week.startDt, week.endDt,
        week.startDt, week.endDt,
        week.startDt, week.endDt,
        week.startDt, week.endDt,
        ...brandCodes
      ];
      
      const rows = await executeQuery<WeeklySalesResult>(connection, sql, binds);
      
      results.push({
        weekNum: week.weekNum,
        startDt: week.startDt,
        endDt: week.endDt,
        curSale: rows.length > 0 ? Number(rows[0].CUR_SALE) || 0 : 0,
        prevSale: rows.length > 0 ? Number(rows[0].PREV_SALE) || 0 : 0,
      });
    }
    
    return results;
  } finally {
    await destroyConnection(connection);
  }
}

// 마감일 기준 최근 4주 누적 매출 조회
interface WeeklyAccumResult {
  CUR_ACCUM: number;
  PREV_ACCUM: number;
}

export async function getWeeklyAccumSales(
  lastDt: string,
  brandCodes: BrandCode[]
): Promise<{ weekNum: number; startDt: string; endDt: string; curAccum: number; prevAccum: number }[]> {
  const connection = await getConnection();
  try {
    const weekRanges = calcWeekRanges(lastDt);
    // 누적: 첫째 주 시작일부터 각 주의 끝까지
    const firstStartDt = weekRanges[0].startDt;
    const results: { weekNum: number; startDt: string; endDt: string; curAccum: number; prevAccum: number }[] = [];
    
    for (let i = 0; i < weekRanges.length; i++) {
      const week = weekRanges[i];
      
      const sql = `
        SELECT 
          COALESCE(SUM(CASE WHEN pst_dt BETWEEN ?::DATE AND ?::DATE THEN ACT_SALE_AMT ELSE 0 END), 0) as CUR_ACCUM,
          COALESCE(SUM(CASE WHEN pst_dt BETWEEN DATEADD(year, -1, ?::DATE) AND DATEADD(year, -1, ?::DATE) THEN ACT_SALE_AMT ELSE 0 END), 0) as PREV_ACCUM
        FROM sap_fnf.dw_cn_copa_d
        WHERE (
          (pst_dt BETWEEN ?::DATE AND ?::DATE)
          OR (pst_dt BETWEEN DATEADD(year, -1, ?::DATE) AND DATEADD(year, -1, ?::DATE))
        )
        AND brd_cd IN (${brandCodes.map(() => '?').join(',')})
      `;
      
      const binds = [
        firstStartDt, week.endDt,
        firstStartDt, week.endDt,
        firstStartDt, week.endDt,
        firstStartDt, week.endDt,
        ...brandCodes
      ];
      
      const rows = await executeQuery<WeeklyAccumResult>(connection, sql, binds);
      
      results.push({
        weekNum: i + 1,
        startDt: firstStartDt,
        endDt: week.endDt,
        curAccum: rows.length > 0 ? Number(rows[0].CUR_ACCUM) || 0 : 0,
        prevAccum: rows.length > 0 ? Number(rows[0].PREV_ACCUM) || 0 : 0,
      });
    }
    
    return results;
  } finally {
    await destroyConnection(connection);
  }
}

// 일별 누적 매출 조회 (누적 탭용)
interface DailyAccumResult {
  PST_DT: string;
  CUR_ACCUM: number;
  PREV_ACCUM: number;
}

export async function getDailySalesAccum(
  ym: string,
  lastDt: string,
  brandCodes: BrandCode[]
): Promise<{ date: string; curAccum: number; prevAccum: number }[]> {
  const connection = await getConnection();
  try {
    const prevYm = getPrevYearMonth(ym);
    
    const sql = `
      WITH cur_daily AS (
        SELECT 
          pst_dt,
          SUM(SUM(ACT_SALE_AMT)) OVER (ORDER BY pst_dt) as accum
        FROM sap_fnf.dw_cn_copa_d
        WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
          AND pst_dt <= ?
          AND brd_cd IN (${brandCodes.map(() => '?').join(',')})
        GROUP BY pst_dt
      ),
      prev_daily AS (
        SELECT 
          DATEADD(year, 1, pst_dt) as pst_dt,
          SUM(SUM(ACT_SALE_AMT)) OVER (ORDER BY pst_dt) as accum
        FROM sap_fnf.dw_cn_copa_d
        WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
          AND brd_cd IN (${brandCodes.map(() => '?').join(',')})
        GROUP BY pst_dt
      )
      SELECT 
        c.pst_dt::VARCHAR as PST_DT,
        c.accum as CUR_ACCUM,
        COALESCE(p.accum, 0) as PREV_ACCUM
      FROM cur_daily c
      LEFT JOIN prev_daily p ON c.pst_dt = p.pst_dt
      ORDER BY c.pst_dt
    `;
    
    const binds = [
      ym, lastDt, ...brandCodes,
      prevYm, ...brandCodes
    ];
    
    const rows = await executeQuery<DailyAccumResult>(connection, sql, binds);
    
    return rows.map((row) => ({
      date: row.PST_DT,
      curAccum: Number(row.CUR_ACCUM) || 0,
      prevAccum: Number(row.PREV_ACCUM) || 0,
    }));
  } finally {
    await destroyConnection(connection);
  }
}

// 점당매출 조회 결과
interface RetailSalesResult {
  CY_SALES_AMT: number;
  CY_SHOP_CNT: number;
  LY_CUM_SALES_AMT: number;
  LY_CUM_SHOP_CNT: number;
  LY_FULL_SALES_AMT: number;
  LY_FULL_SHOP_CNT: number;
}

// 점당매출 데이터
export interface RetailSalesActuals {
  cySalesAmt: number;      // 당해 누적 매출
  cyShopCnt: number;       // 당해 누적 매장수
  lyCumSalesAmt: number;   // 전년 누적 매출 (기준일까지)
  lyCumShopCnt: number;    // 전년 누적 매장수 (기준일까지)
  lyFullSalesAmt: number;  // 전년 월전체 매출
  lyFullShopCnt: number;   // 전년 월전체 매장수
}

/**
 * 대리상 오프라인 점당매출 데이터 조회
 * - 매출: 대리상 오프라인 매장 + 상품 브랜드 필터 (매장 브랜드 무관)
 * - 매장수: 대리상 오프라인 매장 + 상품 브랜드 필터 + 매장 브랜드 필터
 * - 매장 필터: anlys_shop_type_nm IN ('FO','FP'), fr_or_cls='FR', anlys_onoff_cls_nm='Offline'
 */
export async function getRetailSalesData(
  ym: string,
  lastDt: string,
  brandCode: string,
  shopBrandName: string
): Promise<RetailSalesActuals> {
  const connection = await getConnection();
  try {
    // 날짜 계산
    const [year, month] = ym.split('-').map(Number);
    const prevYear = year - 1;
    const prevYm = `${prevYear}-${String(month).padStart(2, '0')}`;
    const lastDay = lastDt.split('-')[2]; // 기준일의 일자
    const prevYearLastDt = `${prevYear}-${String(month).padStart(2, '0')}-${lastDay}`;
    const prevYearMonthEnd = new Date(prevYear, month, 0).getDate(); // 전년 월말
    const prevYearFullDt = `${prevYear}-${String(month).padStart(2, '0')}-${String(prevYearMonthEnd).padStart(2, '0')}`;
    
    const sql = `
      WITH valid_shops AS (
        -- 대리상 오프라인 정규매장 (brd_nm 포함, 매출은 전체, 매장수는 brd_nm 필터)
        SELECT DISTINCT d.shop_id, d.brd_nm
        FROM CHN.dw_shop_wh_detail d
        JOIN FNF.CHN.MST_SHOP_ALL s ON d.shop_id = s.shop_id
        WHERE d.anlys_shop_type_nm IN ('FO', 'FP')
          AND d.fr_or_cls = 'FR'
          AND s.anlys_onoff_cls_nm = 'Offline'
        QUALIFY ROW_NUMBER() OVER (PARTITION BY d.shop_id ORDER BY d.open_dt DESC NULLS LAST) = 1
      ),
      -- 당해 누적 (기준월 1일~기준일) - valid_shops에 있는 매장만, 판매액 > 0
      cy_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      cy_sales AS (
        SELECT 
          COALESCE(SUM(css.shop_sales_amt), 0) as sales_amt,
          COUNT(DISTINCT CASE WHEN css.brd_nm = ? THEN css.shop_id END) as shop_cnt
        FROM cy_shop_sales css
      ),
      -- 전년 누적 (전년 기준월 1일~전년 기준일) - valid_shops에 있는 매장만, 판매액 > 0
      ly_cum_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      ly_cum_sales AS (
        SELECT 
          COALESCE(SUM(lcs.shop_sales_amt), 0) as sales_amt,
          COUNT(DISTINCT CASE WHEN lcs.brd_nm = ? THEN lcs.shop_id END) as shop_cnt
        FROM ly_cum_shop_sales lcs
      ),
      -- 전년 월전체 (전년 기준월 1일~전년 월말) - valid_shops에 있는 매장만, 판매액 > 0
      ly_full_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      ly_full_sales AS (
        SELECT 
          COALESCE(SUM(lfs.shop_sales_amt), 0) as sales_amt,
          COUNT(DISTINCT CASE WHEN lfs.brd_nm = ? THEN lfs.shop_id END) as shop_cnt
        FROM ly_full_shop_sales lfs
      )
      SELECT 
        cy.sales_amt as CY_SALES_AMT,
        cy.shop_cnt as CY_SHOP_CNT,
        ly_cum.sales_amt as LY_CUM_SALES_AMT,
        ly_cum.shop_cnt as LY_CUM_SHOP_CNT,
        ly_full.sales_amt as LY_FULL_SALES_AMT,
        ly_full.shop_cnt as LY_FULL_SHOP_CNT
      FROM cy_sales cy
      CROSS JOIN ly_cum_sales ly_cum
      CROSS JOIN ly_full_sales ly_full
    `;
    
    const binds = [
      lastDt, lastDt, brandCode, shopBrandName,        // cy_sales
      prevYearLastDt, prevYearLastDt, brandCode, shopBrandName,  // ly_cum_sales
      prevYearFullDt, prevYearFullDt, brandCode, shopBrandName,  // ly_full_sales
    ];
    
    const rows = await executeQuery<RetailSalesResult>(connection, sql, binds);
    
    if (rows.length === 0) {
      return {
        cySalesAmt: 0,
        cyShopCnt: 0,
        lyCumSalesAmt: 0,
        lyCumShopCnt: 0,
        lyFullSalesAmt: 0,
        lyFullShopCnt: 0,
      };
    }
    
    return {
      cySalesAmt: Number(rows[0].CY_SALES_AMT) || 0,
      cyShopCnt: Number(rows[0].CY_SHOP_CNT) || 0,
      lyCumSalesAmt: Number(rows[0].LY_CUM_SALES_AMT) || 0,
      lyCumShopCnt: Number(rows[0].LY_CUM_SHOP_CNT) || 0,
      lyFullSalesAmt: Number(rows[0].LY_FULL_SALES_AMT) || 0,
      lyFullShopCnt: Number(rows[0].LY_FULL_SHOP_CNT) || 0,
    };
  } finally {
    await destroyConnection(connection);
  }
}

// 매장별 상세 조회 결과
interface ShopSalesDetailResult {
  SHOP_ID: string;
  SHOP_NAME: string;
  SALES_AMT: number;
  FR_OR_CLS: string;
}

/**
 * 매장별 판매매출 상세 조회 (모달용)
 * - 대리상 오프라인 정규매장만 (매장 브랜드 무관)
 * - 판매매출 내림차순 정렬
 * - year: 'current' = 당년, 'prev' = 전년
 */
export async function getShopSalesDetails(
  ym: string,
  lastDt: string,
  brandCode: string,
  year: 'current' | 'prev' = 'current'
): Promise<ShopSalesDetail[]> {
  const connection = await getConnection();
  try {
    // 전년 날짜 계산
    let queryDt = lastDt;
    let queryBrandCode = brandCode;
    
    if (year === 'prev') {
      const [yearNum, month, day] = lastDt.split('-').map(Number);
      queryDt = `${yearNum - 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    
    const sql = `
      WITH valid_shops AS (
        -- 대리상 오프라인 정규매장 필터 (매장 브랜드 무관)
        SELECT DISTINCT d.shop_id, m.shop_nm_cn, d.fr_or_cls
        FROM CHN.dw_shop_wh_detail d
        JOIN FNF.CHN.MST_SHOP_ALL m ON d.shop_id = m.shop_id
        WHERE d.anlys_shop_type_nm IN ('FO', 'FP')
          AND d.fr_or_cls = 'FR'
          AND m.anlys_onoff_cls_nm = 'Offline'
        QUALIFY ROW_NUMBER() OVER (PARTITION BY d.shop_id ORDER BY d.open_dt DESC NULLS LAST) = 1
      ),
      shop_sales AS (
        SELECT 
          sale.shop_id,
          COALESCE(SUM(sale.sale_amt), 0) as sales_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id
        HAVING SUM(sale.sale_amt) > 0
      )
      SELECT 
        ss.shop_id as SHOP_ID,
        vs.shop_nm_cn as SHOP_NAME,
        ss.sales_amt as SALES_AMT,
        vs.fr_or_cls as FR_OR_CLS
      FROM shop_sales ss
      INNER JOIN valid_shops vs ON ss.shop_id = vs.shop_id
      ORDER BY ss.sales_amt DESC
    `;
    
    const binds = [queryDt, queryDt, queryBrandCode];
    
    const rows = await executeQuery<ShopSalesDetailResult>(connection, sql, binds);
    
    return rows.map((row) => ({
      shopId: row.SHOP_ID || '',
      shopName: row.SHOP_NAME || '',
      salesAmt: Number(row.SALES_AMT) || 0,
      frOrCls: row.FR_OR_CLS || '',
    }));
  } finally {
    await destroyConnection(connection);
  }
}

// 티어별/지역별 조회 결과
interface TierRegionResult {
  GROUP_KEY: string;
  SALES_AMT: number;
  SHOP_CNT: number;
}

// 지역 한국어 번역
const regionKoMap: Record<string, string> = {
  '西北': '서북',
  '华东': '화동',
  '华南': '화남',
  '华北': '화북',
  '华中': '화중',
  '东北': '동북',
  '西南': '서남',
};

/**
 * 티어별 점당매출 조회
 */
export async function getTierSalesData(
  ym: string,
  lastDt: string,
  brandCode: string,
  shopBrandName: string
): Promise<{ current: TierRegionSalesRow[]; prevYear: TierRegionSalesRow[] }> {
  const connection = await getConnection();
  try {
    // 날짜 계산
    const [year, month] = ym.split('-').map(Number);
    const prevYear = year - 1;
    const lastDay = lastDt.split('-')[2];
    const prevYearLastDt = `${prevYear}-${String(month).padStart(2, '0')}-${lastDay}`;
    
    const sql = `
      WITH valid_shops AS (
        -- 대리상 오프라인 정규매장 (brd_nm 포함)
        SELECT DISTINCT d.shop_id, d.city_tier_nm, d.brd_nm
        FROM CHN.dw_shop_wh_detail d
        JOIN FNF.CHN.MST_SHOP_ALL m ON d.shop_id = m.shop_id
        WHERE d.anlys_shop_type_nm IN ('FO', 'FP')
          AND d.fr_or_cls = 'FR'
          AND m.anlys_onoff_cls_nm = 'Offline'
        QUALIFY ROW_NUMBER() OVER (PARTITION BY d.shop_id ORDER BY d.open_dt DESC NULLS LAST) = 1
      ),
      -- 당해 티어별 매출 (판매액 > 0인 매장만)
      cy_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      cy_tier AS (
        SELECT 
          vs.city_tier_nm as GROUP_KEY,
          COALESCE(SUM(css.shop_sales_amt), 0) as SALES_AMT,
          COUNT(DISTINCT CASE WHEN css.brd_nm = ? THEN css.shop_id END) as SHOP_CNT
        FROM cy_shop_sales css
        INNER JOIN valid_shops vs ON css.shop_id = vs.shop_id
        GROUP BY vs.city_tier_nm
      ),
      -- 전년 티어별 매출 (판매액 > 0인 매장만)
      ly_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      ly_tier AS (
        SELECT 
          vs.city_tier_nm as GROUP_KEY,
          COALESCE(SUM(lss.shop_sales_amt), 0) as SALES_AMT,
          COUNT(DISTINCT CASE WHEN lss.brd_nm = ? THEN lss.shop_id END) as SHOP_CNT
        FROM ly_shop_sales lss
        INNER JOIN valid_shops vs ON lss.shop_id = vs.shop_id
        GROUP BY vs.city_tier_nm
      )
      SELECT 'CY' as PERIOD, GROUP_KEY, SALES_AMT, SHOP_CNT FROM cy_tier
      UNION ALL
      SELECT 'LY' as PERIOD, GROUP_KEY, SALES_AMT, SHOP_CNT FROM ly_tier
    `;
    
    const binds = [
      lastDt, lastDt, brandCode, shopBrandName,
      prevYearLastDt, prevYearLastDt, brandCode, shopBrandName,
    ];
    
    const rows = await executeQuery<TierRegionResult & { PERIOD: string }>(connection, sql, binds);
    
    const currentRows = rows.filter(r => r.PERIOD === 'CY');
    const prevRows = rows.filter(r => r.PERIOD === 'LY');
    
    const toRow = (r: TierRegionResult): TierRegionSalesRow => ({
      key: r.GROUP_KEY || 'Unknown',
      salesAmt: Number(r.SALES_AMT) || 0,
      shopCnt: Number(r.SHOP_CNT) || 0,
      salesPerShop: r.SHOP_CNT > 0 ? r.SALES_AMT / r.SHOP_CNT : 0,
      prevSalesAmt: 0,
      prevShopCnt: 0,
      prevSalesPerShop: 0,
    });
    
    return {
      current: currentRows.map(toRow),
      prevYear: prevRows.map(toRow),
    };
  } finally {
    await destroyConnection(connection);
  }
}

/**
 * 지역별 점당매출 조회
 */
export async function getRegionSalesData(
  ym: string,
  lastDt: string,
  brandCode: string,
  shopBrandName: string
): Promise<{ current: TierRegionSalesRow[]; prevYear: TierRegionSalesRow[] }> {
  const connection = await getConnection();
  try {
    // 날짜 계산
    const [year, month] = ym.split('-').map(Number);
    const prevYear = year - 1;
    const lastDay = lastDt.split('-')[2];
    const prevYearLastDt = `${prevYear}-${String(month).padStart(2, '0')}-${lastDay}`;
    
    const sql = `
      WITH valid_shops AS (
        -- 대리상 오프라인 정규매장 (brd_nm 포함)
        SELECT DISTINCT d.shop_id, d.sale_region_nm, d.brd_nm
        FROM CHN.dw_shop_wh_detail d
        JOIN FNF.CHN.MST_SHOP_ALL m ON d.shop_id = m.shop_id
        WHERE d.anlys_shop_type_nm IN ('FO', 'FP')
          AND d.fr_or_cls = 'FR'
          AND m.anlys_onoff_cls_nm = 'Offline'
        QUALIFY ROW_NUMBER() OVER (PARTITION BY d.shop_id ORDER BY d.open_dt DESC NULLS LAST) = 1
      ),
      -- 당해 지역별 매출 (판매액 > 0인 매장만)
      cy_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      cy_region AS (
        SELECT 
          vs.sale_region_nm as GROUP_KEY,
          COALESCE(SUM(css.shop_sales_amt), 0) as SALES_AMT,
          COUNT(DISTINCT CASE WHEN css.brd_nm = ? THEN css.shop_id END) as SHOP_CNT
        FROM cy_shop_sales css
        INNER JOIN valid_shops vs ON css.shop_id = vs.shop_id
        GROUP BY vs.sale_region_nm
      ),
      -- 전년 지역별 매출 (판매액 > 0인 매장만)
      ly_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      ly_region AS (
        SELECT 
          vs.sale_region_nm as GROUP_KEY,
          COALESCE(SUM(lss.shop_sales_amt), 0) as SALES_AMT,
          COUNT(DISTINCT CASE WHEN lss.brd_nm = ? THEN lss.shop_id END) as SHOP_CNT
        FROM ly_shop_sales lss
        INNER JOIN valid_shops vs ON lss.shop_id = vs.shop_id
        GROUP BY vs.sale_region_nm
      )
      SELECT 'CY' as PERIOD, GROUP_KEY, SALES_AMT, SHOP_CNT FROM cy_region
      UNION ALL
      SELECT 'LY' as PERIOD, GROUP_KEY, SALES_AMT, SHOP_CNT FROM ly_region
    `;
    
    const binds = [
      lastDt, lastDt, brandCode, shopBrandName,
      prevYearLastDt, prevYearLastDt, brandCode, shopBrandName,
    ];
    
    const rows = await executeQuery<TierRegionResult & { PERIOD: string }>(connection, sql, binds);
    
    const currentRows = rows.filter(r => r.PERIOD === 'CY');
    const prevRows = rows.filter(r => r.PERIOD === 'LY');
    
    const toRow = (r: TierRegionResult): TierRegionSalesRow => ({
      key: r.GROUP_KEY || 'Unknown',
      labelKo: regionKoMap[r.GROUP_KEY] || r.GROUP_KEY,
      salesAmt: Number(r.SALES_AMT) || 0,
      shopCnt: Number(r.SHOP_CNT) || 0,
      salesPerShop: r.SHOP_CNT > 0 ? r.SALES_AMT / r.SHOP_CNT : 0,
      prevSalesAmt: 0,
      prevShopCnt: 0,
      prevSalesPerShop: 0,
    });
    
    return {
      current: currentRows.map(toRow),
      prevYear: prevRows.map(toRow),
    };
  } finally {
    await destroyConnection(connection);
  }
}

// 채널별 실적 조회 결과
interface ChannelActualResult {
  CHANNEL: string;
  TAG_SALE: number;
  ACT_SALE_VAT_INC: number;
  ACT_SALE_VAT_EXC: number;
  COGS: number;
}

// 채널별 실적 데이터
export interface ChannelActuals {
  tagSale: ChannelRowData;
  actSaleVatInc: ChannelRowData;
  actSaleVatExc: ChannelRowData;
  cogs: ChannelRowData;
}

/**
 * 채널별 누적 실적 조회 (브랜드별 페이지용)
 * - 온라인 직영: chnl_cd=85
 * - 온라인 대리상: chnl_cd=84 AND trans_cd=1
 * - 오프라인 직영: chnl_cd IN (80,81,82,83)
 * - 오프라인 대리상: chnl_cd=84 AND trans_cd=2
 */
export async function getChannelActuals(
  ym: string,
  lastDt: string,
  brandCode: BrandCode
): Promise<ChannelActuals> {
  const connection = await getConnection();
  try {
    // 매출원가 = ACT_COGS + ETC_COGS + 평가감(STK_ASST_APRCT_AMT + STK_ASST_APRCT_RVSL_AMT)
    const sql = `
      SELECT 
        CASE 
          WHEN chnl_cd = '85' THEN 'onlineDirect'
          WHEN chnl_cd = '84' AND trans_cd = '1' THEN 'onlineDealer'
          WHEN chnl_cd IN ('80', '81', '82', '83') THEN 'offlineDirect'
          WHEN chnl_cd = '84' AND trans_cd = '2' THEN 'offlineDealer'
          ELSE 'other'
        END as CHANNEL,
        COALESCE(SUM(TAG_SALE_AMT), 0) as TAG_SALE,
        COALESCE(SUM(ACT_SALE_AMT), 0) as ACT_SALE_VAT_INC,
        COALESCE(SUM(VAT_EXC_ACT_SALE_AMT), 0) as ACT_SALE_VAT_EXC,
        COALESCE(SUM(ACT_COGS), 0) + COALESCE(SUM(ETC_COGS), 0) + COALESCE(SUM(STK_ASST_APRCT_AMT), 0) + COALESCE(SUM(STK_ASST_APRCT_RVSL_AMT), 0) as COGS
      FROM sap_fnf.dw_cn_copa_d
      WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
        AND pst_dt <= ?
        AND brd_cd = ?
      GROUP BY 
        CASE 
          WHEN chnl_cd = '85' THEN 'onlineDirect'
          WHEN chnl_cd = '84' AND trans_cd = '1' THEN 'onlineDealer'
          WHEN chnl_cd IN ('80', '81', '82', '83') THEN 'offlineDirect'
          WHEN chnl_cd = '84' AND trans_cd = '2' THEN 'offlineDealer'
          ELSE 'other'
        END
    `;
    
    const rows = await executeQuery<ChannelActualResult>(connection, sql, [ym, lastDt, brandCode]);
    
    // 결과 매핑
    const result: ChannelActuals = {
      tagSale: { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null },
      actSaleVatInc: { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null },
      actSaleVatExc: { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null },
      cogs: { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null },
    };
    
    let totalTagSale = 0;
    let totalActSaleVatInc = 0;
    let totalActSaleVatExc = 0;
    let totalCogs = 0;
    
    for (const row of rows) {
      const channel = row.CHANNEL as keyof ChannelRowData;
      if (channel === 'onlineDirect' || channel === 'onlineDealer' || channel === 'offlineDirect' || channel === 'offlineDealer') {
        result.tagSale[channel] = Number(row.TAG_SALE) || 0;
        result.actSaleVatInc[channel] = Number(row.ACT_SALE_VAT_INC) || 0;
        result.actSaleVatExc[channel] = Number(row.ACT_SALE_VAT_EXC) || 0;
        result.cogs[channel] = Number(row.COGS) || 0;
        
        totalTagSale += Number(row.TAG_SALE) || 0;
        totalActSaleVatInc += Number(row.ACT_SALE_VAT_INC) || 0;
        totalActSaleVatExc += Number(row.ACT_SALE_VAT_EXC) || 0;
        totalCogs += Number(row.COGS) || 0;
      }
    }
    
    // 합계 설정
    result.tagSale.total = totalTagSale;
    result.actSaleVatInc.total = totalActSaleVatInc;
    result.actSaleVatExc.total = totalActSaleVatExc;
    result.cogs.total = totalCogs;
    
    return result;
  } finally {
    await destroyConnection(connection);
  }
}

