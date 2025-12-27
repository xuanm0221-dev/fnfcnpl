import snowflake from 'snowflake-sdk';
import type { BrandCode } from './types';

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

// 주차별 누적 매출 조회 (일요일 기준)
interface WeeklyResult {
  WEEK_END: string;
  CUR_ACCUM: number;
  PREV_ACCUM: number;
}

export async function getWeeklySalesAccum(
  ym: string,
  lastDt: string,
  brandCodes: BrandCode[]
): Promise<{ weekEnd: string; curAccum: number; prevAccum: number }[]> {
  const connection = await getConnection();
  try {
    const prevYm = getPrevYearMonth(ym);
    
    // 일요일 기준 주차별 누적 (당월)
    const sql = `
      WITH sundays AS (
        SELECT DISTINCT 
          NEXT_DAY(pst_dt, 'SU') as week_end
        FROM sap_fnf.dw_cn_copa_d
        WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
          AND pst_dt <= ?
          AND brd_cd IN (${brandCodes.map(() => '?').join(',')})
      ),
      cur_data AS (
        SELECT 
          NEXT_DAY(pst_dt, 'SU') as week_end,
          SUM(VAT_INC_ACT_SALE_AMT) as sale_amt
        FROM sap_fnf.dw_cn_copa_d
        WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
          AND pst_dt <= ?
          AND brd_cd IN (${brandCodes.map(() => '?').join(',')})
        GROUP BY NEXT_DAY(pst_dt, 'SU')
      ),
      prev_data AS (
        SELECT 
          NEXT_DAY(DATEADD(year, 1, pst_dt), 'SU') as week_end,
          SUM(VAT_INC_ACT_SALE_AMT) as sale_amt
        FROM sap_fnf.dw_cn_copa_d
        WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
          AND brd_cd IN (${brandCodes.map(() => '?').join(',')})
        GROUP BY NEXT_DAY(DATEADD(year, 1, pst_dt), 'SU')
      )
      SELECT 
        s.week_end::VARCHAR as WEEK_END,
        COALESCE(SUM(c.sale_amt) OVER (ORDER BY s.week_end), 0) as CUR_ACCUM,
        COALESCE(SUM(p.sale_amt) OVER (ORDER BY s.week_end), 0) as PREV_ACCUM
      FROM sundays s
      LEFT JOIN cur_data c ON s.week_end = c.week_end
      LEFT JOIN prev_data p ON s.week_end = p.week_end
      ORDER BY s.week_end
    `;
    
    const binds = [
      ym, lastDt, ...brandCodes,
      ym, lastDt, ...brandCodes,
      prevYm, ...brandCodes
    ];
    
    const rows = await executeQuery<WeeklyResult>(connection, sql, binds);
    
    return rows.map((row) => ({
      weekEnd: row.WEEK_END,
      curAccum: Number(row.CUR_ACCUM) || 0,
      prevAccum: Number(row.PREV_ACCUM) || 0,
    }));
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
          SUM(SUM(VAT_INC_ACT_SALE_AMT)) OVER (ORDER BY pst_dt) as accum
        FROM sap_fnf.dw_cn_copa_d
        WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
          AND pst_dt <= ?
          AND brd_cd IN (${brandCodes.map(() => '?').join(',')})
        GROUP BY pst_dt
      ),
      prev_daily AS (
        SELECT 
          DATEADD(year, 1, pst_dt) as pst_dt,
          SUM(SUM(VAT_INC_ACT_SALE_AMT)) OVER (ORDER BY pst_dt) as accum
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

