import snowflake from 'snowflake-sdk';
import type { BrandCode, ChannelRowData, ShopSalesDetail, TierRegionSalesRow, ChannelActuals } from './types';

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

// 브랜드별 last_dt 조회 (CSV 파일명에서 날짜 추출)
export async function getLastDates(
  ym: string,
  brandCodes: BrandCode[]
): Promise<Record<BrandCode, string>> {
  // CSV 파일에서 날짜 추출
  const { getActualsCsv } = await import('@/data/plforecast/actuals');
  
  // 해당 월의 모든 CSV 파일 날짜 중 가장 최신 날짜 찾기
  const dates: string[] = [];
  for (let day = 1; day <= 31; day++) {
    const dateStr = `${ym}-${String(day).padStart(2, '0')}`;
    const csv = getActualsCsv(ym, dateStr);
    if (csv) {
      dates.push(dateStr);
    }
  }
  
  // 가장 최신 날짜
  const latestDate = dates.length > 0 ? dates.sort().reverse()[0] : '';
  
  // 모든 브랜드에 대해 같은 날짜 반환 (CSV 파일은 월별로 하나만 존재)
  const result: Partial<Record<BrandCode, string>> = {};
  for (const code of brandCodes) {
    result[code] = latestDate;
  }
  return result as Record<BrandCode, string>;
}

// 실적 조회 결과
interface ActualResult {
  [key: string]: number | string;
}

// 전년 실적 조회 (월 전체 데이터)
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

// 전년 실적 조회 (누적 데이터)
export async function getPrevYearActualsAccum(
  prevYm: string,
  lastDt: string,
  brandCode: BrandCode,
  items: string[]
): Promise<Record<string, number>> {
  if (items.length === 0) return {};
  
  const connection = await getConnection();
  try {
    // lastDt에서 일자 추출 (예: 2026-01-08 -> 08)
    // 전년도 동일 월의 동일 일자 사용 (월의 마지막 일자 초과 시 마지막 일자로 제한)
    const dayOfMonth = parseInt(lastDt.split('-')[2], 10);
    const prevYear = parseInt(prevYm.split('-')[0], 10);
    const prevMonth = parseInt(prevYm.split('-')[1], 10);
    const lastDayOfPrevMonth = new Date(prevYear, prevMonth, 0).getDate();
    const actualDay = Math.min(dayOfMonth, lastDayOfPrevMonth);
    const prevLastDt = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;
    
    const selectClauses = items.map((item) => `COALESCE(SUM(${item}), 0) as "${item}"`).join(', ');
    const sql = `
      SELECT ${selectClauses}
      FROM sap_fnf.dw_cn_copa_d
      WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
        AND brd_cd = ?
        AND pst_dt <= ?::DATE
    `;
    const rows = await executeQuery<ActualResult>(connection, sql, [prevYm, brandCode, prevLastDt]);
    
    if (rows.length === 0) {
      return Object.fromEntries(items.map((item) => [item, 0]));
    }
    
    const result: Record<string, number> = {};
    for (const item of items) {
      result[item] = Number(rows[0][item]) || 0;
    }
    
    // 디버깅: 누적 데이터 확인
    if (items.includes('ACT_SALE_AMT') || items.includes('ACT_COGS')) {
      console.log('[getPrevYearActualsAccum] 누적 데이터 조회:', {
        prevYm,
        prevLastDt,
        brandCode,
        actSaleAmt: result['ACT_SALE_AMT'],
        actCogs: result['ACT_COGS'],
        sampleItems: Object.entries(result).slice(0, 5),
      });
    }
    
    return result;
  } finally {
    await destroyConnection(connection);
  }
}

// 누적 실적 조회 (CSV 파일에서 데이터 읽기)
export async function getAccumActuals(
  ym: string,
  lastDt: string,
  brandCode: BrandCode,
  items: string[]
): Promise<{ accum: Record<string, number>; accumDays: number }> {
  if (items.length === 0) return { accum: {}, accumDays: 0 };
  
  // lastDt에서 일자 추출 (예: "2026-01-04" -> 4)
  const accumDays = parseInt(lastDt.split('-')[2], 10) || 0;
  
  // CSV 파일에서 데이터 읽기
  const { getActualsCsv } = await import('@/data/plforecast/actuals');
  const { parseAccumActualsCsv } = await import('./parseActualsCsv');
  
  const csvContent = getActualsCsv(ym, lastDt);
  if (!csvContent) {
    // CSV 파일이 없으면 빈 데이터 반환하되, accumDays는 lastDt에서 계산
    return {
      accum: Object.fromEntries(items.map((item) => [item, 0])),
      accumDays: accumDays,
    };
  }
  
  // CSV 파싱
  const parsed = parseAccumActualsCsv(csvContent, brandCode, lastDt);
  
  // CSV에서 추출 가능한 항목 (Tag매출, 실판(V+), 실판(V-), 매출원가만)
  const csvItems = ['TAG_SALE_AMT', 'ACT_SALE_AMT', 'VAT_EXC_ACT_SALE_AMT', 'ACT_COGS'];
  
  // items에 해당하는 데이터만 반환 (CSV 항목만 값 반환, 나머지는 0)
  const accum: Record<string, number> = {};
  for (const item of items) {
    if (csvItems.includes(item)) {
      // CSV에서 추출한 항목만 parsed.accum에서 가져오기
      accum[item] = parsed.accum[item] || 0;
    } else {
      // 나머지 항목은 모두 0
      accum[item] = 0;
    }
  }
  
  return {
    accum,
    accumDays: parsed.accumDays,
  };
}

// 전년도 채널별 실판(V+) 조회
export async function getPrevYearChannelActuals(
  prevYm: string,
  brandCode: BrandCode
): Promise<{ onlineDirect: number; onlineDealer: number; offlineDirect: number; offlineDealer: number }> {
  const connection = await getConnection();
  try {
    const sql = `
      SELECT 
        CASE 
          WHEN chnl_cd = '85' THEN 'onlineDirect'
          WHEN chnl_cd = '84' AND trans_cd = '1' THEN 'onlineDealer'
          WHEN chnl_cd IN ('80', '81', '82', '83') THEN 'offlineDirect'
          WHEN chnl_cd = '84' AND trans_cd = '2' THEN 'offlineDealer'
          ELSE 'other'
        END as CHANNEL,
        COALESCE(SUM(ACT_SALE_AMT), 0) as ACT_SALE_VAT_INC
      FROM sap_fnf.dw_cn_copa_d
      WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
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
    
    interface ChannelResult {
      CHANNEL: string;
      ACT_SALE_VAT_INC: number;
    }
    
    const rows = await executeQuery<ChannelResult>(connection, sql, [prevYm, brandCode]);
    
    const result = {
      onlineDirect: 0,
      onlineDealer: 0,
      offlineDirect: 0,
      offlineDealer: 0,
    };
    
    for (const row of rows) {
      if (row.CHANNEL === 'onlineDirect') {
        result.onlineDirect = Number(row.ACT_SALE_VAT_INC) || 0;
      } else if (row.CHANNEL === 'onlineDealer') {
        result.onlineDealer = Number(row.ACT_SALE_VAT_INC) || 0;
      } else if (row.CHANNEL === 'offlineDirect') {
        result.offlineDirect = Number(row.ACT_SALE_VAT_INC) || 0;
      } else if (row.CHANNEL === 'offlineDealer') {
        result.offlineDealer = Number(row.ACT_SALE_VAT_INC) || 0;
      }
    }
    
    return result;
  } finally {
    await destroyConnection(connection);
  }
}

// 전년도 채널별 Tag매출 조회
export async function getPrevYearChannelTagSale(
  prevYm: string,
  brandCode: BrandCode
): Promise<{ onlineDirect: number; onlineDealer: number; offlineDirect: number; offlineDealer: number }> {
  const connection = await getConnection();
  try {
    const sql = `
      SELECT 
        CASE 
          WHEN chnl_cd = '85' THEN 'onlineDirect'
          WHEN chnl_cd = '84' AND trans_cd = '1' THEN 'onlineDealer'
          WHEN chnl_cd IN ('80', '81', '82', '83') THEN 'offlineDirect'
          WHEN chnl_cd = '84' AND trans_cd = '2' THEN 'offlineDealer'
          ELSE 'other'
        END as CHANNEL,
        COALESCE(SUM(TAG_SALE_AMT), 0) as TAG_SALE
      FROM sap_fnf.dw_cn_copa_d
      WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
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
    
    interface ChannelResult {
      CHANNEL: string;
      TAG_SALE: number;
    }
    
    const rows = await executeQuery<ChannelResult>(connection, sql, [prevYm, brandCode]);
    
    const result = {
      onlineDirect: 0,
      onlineDealer: 0,
      offlineDirect: 0,
      offlineDealer: 0,
    };
    
    for (const row of rows) {
      if (row.CHANNEL === 'onlineDirect') {
        result.onlineDirect = Number(row.TAG_SALE) || 0;
      } else if (row.CHANNEL === 'onlineDealer') {
        result.onlineDealer = Number(row.TAG_SALE) || 0;
      } else if (row.CHANNEL === 'offlineDirect') {
        result.offlineDirect = Number(row.TAG_SALE) || 0;
      } else if (row.CHANNEL === 'offlineDealer') {
        result.offlineDealer = Number(row.TAG_SALE) || 0;
      }
    }
    
    return result;
  } finally {
    await destroyConnection(connection);
  }
}

// 전년도 채널별 매출원가 조회
export async function getPrevYearChannelCogs(
  prevYm: string,
  brandCode: BrandCode
): Promise<{ onlineDirect: number; onlineDealer: number; offlineDirect: number; offlineDealer: number }> {
  const connection = await getConnection();
  try {
    const sql = `
      SELECT 
        CASE 
          WHEN chnl_cd = '85' THEN 'onlineDirect'
          WHEN chnl_cd = '84' AND trans_cd = '1' THEN 'onlineDealer'
          WHEN chnl_cd IN ('80', '81', '82', '83') THEN 'offlineDirect'
          WHEN chnl_cd = '84' AND trans_cd = '2' THEN 'offlineDealer'
          ELSE 'other'
        END as CHANNEL,
        COALESCE(SUM(ACT_COGS), 0) as ACT_COGS
      FROM sap_fnf.dw_cn_copa_d
      WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
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
    
    interface ChannelResult {
      CHANNEL: string;
      ACT_COGS: number;
    }
    
    const rows = await executeQuery<ChannelResult>(connection, sql, [prevYm, brandCode]);
    
    const result = {
      onlineDirect: 0,
      onlineDealer: 0,
      offlineDirect: 0,
      offlineDealer: 0,
    };
    
    for (const row of rows) {
      if (row.CHANNEL === 'onlineDirect') {
        result.onlineDirect = Number(row.ACT_COGS) || 0;
      } else if (row.CHANNEL === 'onlineDealer') {
        result.onlineDealer = Number(row.ACT_COGS) || 0;
      } else if (row.CHANNEL === 'offlineDirect') {
        result.offlineDirect = Number(row.ACT_COGS) || 0;
      } else if (row.CHANNEL === 'offlineDealer') {
        result.offlineDealer = Number(row.ACT_COGS) || 0;
      }
    }
    
    return result;
  } finally {
    await destroyConnection(connection);
  }
}

// 전년도 채널별 D일까지 누적 조회 (Tag매출, 실판(V+), 실판(V-), 매출원가)
export async function getPrevYearChannelAccum(
  prevYm: string,
  lastDt: string,
  brandCode: BrandCode
): Promise<{ tagSale: ChannelRowData; actSaleVatInc: ChannelRowData; actSaleVatExc: ChannelRowData; cogs: ChannelRowData }> {
  const connection = await getConnection();
  try {
    // lastDt에서 일자 추출 (예: 2026-01-04 -> 04)
    // 전년도 동일 월의 동일 일자 사용 (월의 마지막 일자 초과 시 마지막 일자로 제한)
    const dayOfMonth = parseInt(lastDt.split('-')[2], 10);
    const prevYear = parseInt(prevYm.split('-')[0], 10);
    const prevMonth = parseInt(prevYm.split('-')[1], 10);
    const lastDayOfPrevMonth = new Date(prevYear, prevMonth, 0).getDate();
    const actualDay = Math.min(dayOfMonth, lastDayOfPrevMonth);
    const prevLastDt = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;
    
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
        COALESCE(SUM(ACT_COGS), 0) as ACT_COGS
      FROM sap_fnf.dw_cn_copa_d
      WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
        AND brd_cd = ?
        AND pst_dt <= ?::DATE
      GROUP BY 
        CASE 
          WHEN chnl_cd = '85' THEN 'onlineDirect'
          WHEN chnl_cd = '84' AND trans_cd = '1' THEN 'onlineDealer'
          WHEN chnl_cd IN ('80', '81', '82', '83') THEN 'offlineDirect'
          WHEN chnl_cd = '84' AND trans_cd = '2' THEN 'offlineDealer'
          ELSE 'other'
        END
    `;
    
    interface ChannelResult {
      CHANNEL: string;
      TAG_SALE: number;
      ACT_SALE_VAT_INC: number;
      ACT_SALE_VAT_EXC: number;
      ACT_COGS: number;
    }
    
    const rows = await executeQuery<ChannelResult>(connection, sql, [prevYm, brandCode, prevLastDt]);
    
    const tagSale: ChannelRowData = { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null };
    const actSaleVatInc: ChannelRowData = { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null };
    const actSaleVatExc: ChannelRowData = { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null };
    const cogs: ChannelRowData = { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null };
    
    for (const row of rows) {
      const tagValue = Number(row.TAG_SALE) || 0;
      const vatIncValue = Number(row.ACT_SALE_VAT_INC) || 0;
      const vatExcValue = Number(row.ACT_SALE_VAT_EXC) || 0;
      const cogsValue = Number(row.ACT_COGS) || 0;
      
      if (row.CHANNEL === 'onlineDirect') {
        tagSale.onlineDirect = tagValue;
        actSaleVatInc.onlineDirect = vatIncValue;
        actSaleVatExc.onlineDirect = vatExcValue;
        cogs.onlineDirect = cogsValue;
      } else if (row.CHANNEL === 'onlineDealer') {
        tagSale.onlineDealer = tagValue;
        actSaleVatInc.onlineDealer = vatIncValue;
        actSaleVatExc.onlineDealer = vatExcValue;
        cogs.onlineDealer = cogsValue;
      } else if (row.CHANNEL === 'offlineDirect') {
        tagSale.offlineDirect = tagValue;
        actSaleVatInc.offlineDirect = vatIncValue;
        actSaleVatExc.offlineDirect = vatExcValue;
        cogs.offlineDirect = cogsValue;
      } else if (row.CHANNEL === 'offlineDealer') {
        tagSale.offlineDealer = tagValue;
        actSaleVatInc.offlineDealer = vatIncValue;
        actSaleVatExc.offlineDealer = vatExcValue;
        cogs.offlineDealer = cogsValue;
      }
    }
    
    // total 계산
    tagSale.total = (tagSale.onlineDirect ?? 0) + (tagSale.onlineDealer ?? 0) + (tagSale.offlineDirect ?? 0) + (tagSale.offlineDealer ?? 0);
    actSaleVatInc.total = (actSaleVatInc.onlineDirect ?? 0) + (actSaleVatInc.onlineDealer ?? 0) + (actSaleVatInc.offlineDirect ?? 0) + (actSaleVatInc.offlineDealer ?? 0);
    actSaleVatExc.total = (actSaleVatExc.onlineDirect ?? 0) + (actSaleVatExc.onlineDealer ?? 0) + (actSaleVatExc.offlineDirect ?? 0) + (actSaleVatExc.offlineDealer ?? 0);
    cogs.total = (cogs.onlineDirect ?? 0) + (cogs.onlineDealer ?? 0) + (cogs.offlineDirect ?? 0) + (cogs.offlineDealer ?? 0);
    
    return { tagSale, actSaleVatInc, actSaleVatExc, cogs };
  } finally {
    await destroyConnection(connection);
  }
}

// 전년도 채널별 월전체 합계 조회 (Tag매출, 실판(V+), 실판(V-), 매출원가)
export async function getPrevYearChannelFullMonth(
  prevYm: string,
  brandCode: BrandCode
): Promise<{ tagSale: ChannelRowData; actSaleVatInc: ChannelRowData; actSaleVatExc: ChannelRowData; cogs: ChannelRowData }> {
  const connection = await getConnection();
  try {
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
        COALESCE(SUM(ACT_COGS), 0) as ACT_COGS
      FROM sap_fnf.dw_cn_copa_d
      WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
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
    
    interface ChannelResult {
      CHANNEL: string;
      TAG_SALE: number;
      ACT_SALE_VAT_INC: number;
      ACT_SALE_VAT_EXC: number;
      ACT_COGS: number;
    }
    
    const rows = await executeQuery<ChannelResult>(connection, sql, [prevYm, brandCode]);
    
    const tagSale: ChannelRowData = { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null };
    const actSaleVatInc: ChannelRowData = { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null };
    const actSaleVatExc: ChannelRowData = { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null };
    const cogs: ChannelRowData = { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null };
    
    for (const row of rows) {
      const tagValue = Number(row.TAG_SALE) || 0;
      const vatIncValue = Number(row.ACT_SALE_VAT_INC) || 0;
      const vatExcValue = Number(row.ACT_SALE_VAT_EXC) || 0;
      const cogsValue = Number(row.ACT_COGS) || 0;
      
      if (row.CHANNEL === 'onlineDirect') {
        tagSale.onlineDirect = tagValue;
        actSaleVatInc.onlineDirect = vatIncValue;
        actSaleVatExc.onlineDirect = vatExcValue;
        cogs.onlineDirect = cogsValue;
      } else if (row.CHANNEL === 'onlineDealer') {
        tagSale.onlineDealer = tagValue;
        actSaleVatInc.onlineDealer = vatIncValue;
        actSaleVatExc.onlineDealer = vatExcValue;
        cogs.onlineDealer = cogsValue;
      } else if (row.CHANNEL === 'offlineDirect') {
        tagSale.offlineDirect = tagValue;
        actSaleVatInc.offlineDirect = vatIncValue;
        actSaleVatExc.offlineDirect = vatExcValue;
        cogs.offlineDirect = cogsValue;
      } else if (row.CHANNEL === 'offlineDealer') {
        tagSale.offlineDealer = tagValue;
        actSaleVatInc.offlineDealer = vatIncValue;
        actSaleVatExc.offlineDealer = vatExcValue;
        cogs.offlineDealer = cogsValue;
      }
    }
    
    // total 계산
    tagSale.total = (tagSale.onlineDirect ?? 0) + (tagSale.onlineDealer ?? 0) + (tagSale.offlineDirect ?? 0) + (tagSale.offlineDealer ?? 0);
    actSaleVatInc.total = (actSaleVatInc.onlineDirect ?? 0) + (actSaleVatInc.onlineDealer ?? 0) + (actSaleVatInc.offlineDirect ?? 0) + (actSaleVatInc.offlineDealer ?? 0);
    actSaleVatExc.total = (actSaleVatExc.onlineDirect ?? 0) + (actSaleVatExc.onlineDealer ?? 0) + (actSaleVatExc.offlineDirect ?? 0) + (actSaleVatExc.offlineDealer ?? 0);
    cogs.total = (cogs.onlineDirect ?? 0) + (cogs.onlineDealer ?? 0) + (cogs.offlineDirect ?? 0) + (cogs.offlineDealer ?? 0);
    
    return { tagSale, actSaleVatInc, actSaleVatExc, cogs };
  } finally {
    await destroyConnection(connection);
  }
}

// 대리상지원금 전용 조회 (OUTSRC_PROC_CST + SMPL_BUY_CST - MILE_SALE_AMT)
// 주의: 누적(accum)은 CSV에서 데이터가 없으므로 항상 0 반환
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
    
    // 전년 실적 (Snowflake에서 조회)
    const prevSql = `
      SELECT COALESCE(SUM(OUTSRC_PROC_CST), 0) + COALESCE(SUM(SMPL_BUY_CST), 0) - COALESCE(SUM(MILE_SALE_AMT), 0) as DEALER_SUPPORT
      FROM sap_fnf.dw_cn_copa_d
      WHERE TO_CHAR(pst_dt, 'YYYY-MM') = ?
        AND brd_cd = ?
    `;
    const prevRows = await executeQuery<{ DEALER_SUPPORT: number }>(connection, prevSql, [prevYm, brandCode]);
    const prevYear = prevRows.length > 0 ? Number(prevRows[0].DEALER_SUPPORT) || 0 : 0;
    
    // 당월 누적: CSV에 직접비/영업비 데이터가 없으므로 항상 0
    const accum = 0;
    
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
          COALESCE(SUM(CASE WHEN sale_dt BETWEEN ?::DATE AND ?::DATE THEN sale_amt ELSE 0 END), 0) as CUR_SALE,
          COALESCE(SUM(CASE WHEN sale_dt BETWEEN DATEADD(year, -1, ?::DATE) AND DATEADD(year, -1, ?::DATE) THEN sale_amt ELSE 0 END), 0) as PREV_SALE
        FROM chn.dw_sale
        WHERE (
          (sale_dt BETWEEN ?::DATE AND ?::DATE)
          OR (sale_dt BETWEEN DATEADD(year, -1, ?::DATE) AND DATEADD(year, -1, ?::DATE))
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
          COALESCE(SUM(CASE WHEN sale_dt BETWEEN ?::DATE AND ?::DATE THEN sale_amt ELSE 0 END), 0) as CUR_ACCUM,
          COALESCE(SUM(CASE WHEN sale_dt BETWEEN DATEADD(year, -1, ?::DATE) AND DATEADD(year, -1, ?::DATE) THEN sale_amt ELSE 0 END), 0) as PREV_ACCUM
        FROM chn.dw_sale
        WHERE (
          (sale_dt BETWEEN ?::DATE AND ?::DATE)
          OR (sale_dt BETWEEN DATEADD(year, -1, ?::DATE) AND DATEADD(year, -1, ?::DATE))
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
 * 점당매출 최신 날짜 조회
 * - Snowflake에서 실제 데이터가 있는 최신 날짜를 조회
 */
export async function getRetailSalesLastDt(
  brandCode: string,
  ym: string
): Promise<string> {
  const connection = await getConnection();
  try {
    const [year, month] = ym.split('-').map(Number);
    const sql = `
      SELECT MAX(s.sale_dt) AS LAST_DT
      FROM CHN.dw_sale s
      INNER JOIN (
        SELECT DISTINCT d.shop_id
        FROM CHN.dw_shop_wh_detail d
        JOIN FNF.CHN.MST_SHOP_ALL m ON d.shop_id = m.shop_id
        WHERE d.anlys_shop_type_nm IN ('FO', 'FP')
          AND d.fr_or_cls = 'FR'
          AND m.anlys_onoff_cls_nm = 'Offline'
        QUALIFY ROW_NUMBER() OVER (PARTITION BY d.shop_id ORDER BY d.open_dt DESC NULLS LAST) = 1
      ) vs ON s.shop_id = vs.shop_id
      WHERE s.brd_cd = ?
        AND s.sale_dt >= DATE_TRUNC('MONTH', DATE '${year}-${String(month).padStart(2, '0')}-01')
        AND s.sale_dt < DATE_TRUNC('MONTH', DATE '${year}-${String(month).padStart(2, '0')}-01') + INTERVAL '1 MONTH'
    `;
    
    const rows = await executeQuery<{ LAST_DT: string }>(connection, sql, [brandCode]);
    
    if (rows.length === 0 || !rows[0]?.LAST_DT) {
      return '';
    }
    
    const lastDt = rows[0].LAST_DT;
    // 날짜 형식 변환 (YYYY-MM-DD)
    if (typeof lastDt === 'string') {
      return lastDt.split('T')[0]; // ISO 형식에서 날짜만 추출
    }
    return '';
  } catch (error) {
    console.error('[getRetailSalesLastDt] 에러 발생:', error);
    return '';
  } finally {
    await destroyConnection(connection);
  }
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
  TAG_AMT: number;
  SHOP_CNT: number;
  CITIES?: string;
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

// 도시명 한국어 번역 (주요 도시)
const cityKoMap: Record<string, string> = {
  '上海': '상하이',
  '北京': '베이징',
  '广州': '광저우',
  '深圳': '선전',
  '杭州': '항저우',
  '成都': '청두',
  '重庆': '충칭',
  '武汉': '우한',
  '西安': '시안',
  '苏州': '쑤저우',
  '南京': '난징',
  '天津': '톈진',
  '长沙': '창사',
  '郑州': '정저우',
  '青岛': '칭다오',
  '大连': '다롄',
  '沈阳': '선양',
  '宁波': '닝보',
  '无锡': '우시',
  '佛山': '포산',
  '东莞': '둥관',
  '济南': '지난',
  '合肥': '허페이',
  '福州': '푸저우',
  '厦门': '샤먼',
  '昆明': '쿤밍',
  '哈尔滨': '하얼빈',
  '长春': '창춘',
  '石家庄': '석가장',
  '太原': '타이위안',
  '南昌': '난창',
  '贵阳': '구이양',
  '兰州': '란저우',
  '乌鲁木齐': '우루무치',
  '银川': '인촨',
};

/**
 * 티어별 점당매출 조회
 */
export async function getTierSalesData(
  ym: string,
  lastDt: string,
  brandCode: string,
  shopBrandName: string
): Promise<{ current: TierRegionSalesRow[]; prevYear: TierRegionSalesRow[]; prevYearFull: TierRegionSalesRow[] }> {
  const connection = await getConnection();
  try {
    // 날짜 계산
    const [year, month] = ym.split('-').map(Number);
    const prevYear = year - 1;
    const lastDay = lastDt.split('-')[2];
    const prevYearLastDt = `${prevYear}-${String(month).padStart(2, '0')}-${lastDay}`;
    const prevYearMonthEnd = new Date(prevYear, month, 0).getDate(); // 전년 월말
    const prevYearFullDt = `${prevYear}-${String(month).padStart(2, '0')}-${String(prevYearMonthEnd).padStart(2, '0')}`;
    
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
          SUM(sale.sale_amt) as shop_sales_amt,
          SUM(sale.tag_amt) as shop_tag_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      -- 티어별 도시 정보 (매장수 기준 상위 4개)
      tier_cities AS (
        SELECT 
          vs.city_tier_nm,
          m.city_nm,
          COUNT(DISTINCT CASE WHEN css.brd_nm = ? THEN css.shop_id END) as shop_cnt
        FROM cy_shop_sales css
        INNER JOIN valid_shops vs ON css.shop_id = vs.shop_id
        JOIN FNF.CHN.MST_SHOP_ALL m ON css.shop_id = m.shop_id
        WHERE m.city_nm IS NOT NULL AND TRIM(m.city_nm) != ''
        GROUP BY vs.city_tier_nm, m.city_nm
      ),
      tier_top_cities AS (
        SELECT 
          city_tier_nm,
          LISTAGG(city_nm, ', ') WITHIN GROUP (ORDER BY shop_cnt DESC) as cities
        FROM (
          SELECT city_tier_nm, city_nm, shop_cnt,
                 ROW_NUMBER() OVER (PARTITION BY city_tier_nm ORDER BY shop_cnt DESC) as rn
          FROM tier_cities
        )
        WHERE rn <= 4
        GROUP BY city_tier_nm
      ),
      cy_tier AS (
        SELECT 
          vs.city_tier_nm as GROUP_KEY,
          COALESCE(SUM(css.shop_sales_amt), 0) as SALES_AMT,
          COALESCE(SUM(css.shop_tag_amt), 0) as TAG_AMT,
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
          SUM(sale.sale_amt) as shop_sales_amt,
          SUM(sale.tag_amt) as shop_tag_amt
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
          COALESCE(SUM(lss.shop_tag_amt), 0) as TAG_AMT,
          COUNT(DISTINCT CASE WHEN lss.brd_nm = ? THEN lss.shop_id END) as SHOP_CNT
        FROM ly_shop_sales lss
        INNER JOIN valid_shops vs ON lss.shop_id = vs.shop_id
        GROUP BY vs.city_tier_nm
      ),
      -- 전년 월전체 티어별 매출 (판매액 > 0인 매장만)
      ly_full_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt,
          SUM(sale.tag_amt) as shop_tag_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      ly_full_tier AS (
        SELECT 
          vs.city_tier_nm as GROUP_KEY,
          COALESCE(SUM(lfs.shop_sales_amt), 0) as SALES_AMT,
          COALESCE(SUM(lfs.shop_tag_amt), 0) as TAG_AMT,
          COUNT(DISTINCT CASE WHEN lfs.brd_nm = ? THEN lfs.shop_id END) as SHOP_CNT
        FROM ly_full_shop_sales lfs
        INNER JOIN valid_shops vs ON lfs.shop_id = vs.shop_id
        GROUP BY vs.city_tier_nm
      )
      SELECT 
        'CY' as PERIOD, 
        t.GROUP_KEY, 
        t.SALES_AMT, 
        t.TAG_AMT,
        t.SHOP_CNT,
        COALESCE(tc.cities, '') as CITIES
      FROM cy_tier t
      LEFT JOIN tier_top_cities tc ON t.GROUP_KEY = tc.city_tier_nm
      UNION ALL
      SELECT 
        'LY' as PERIOD, 
        GROUP_KEY, 
        SALES_AMT, 
        TAG_AMT,
        SHOP_CNT,
        '' as CITIES
      FROM ly_tier
      UNION ALL
      SELECT 
        'LY_FULL' as PERIOD, 
        GROUP_KEY, 
        SALES_AMT, 
        TAG_AMT,
        SHOP_CNT,
        '' as CITIES
      FROM ly_full_tier
    `;
    
    const binds = [
      lastDt, lastDt, brandCode, shopBrandName, shopBrandName,
      prevYearLastDt, prevYearLastDt, brandCode, shopBrandName,
      prevYearFullDt, prevYearFullDt, brandCode, shopBrandName,
    ];
    
    const rows = await executeQuery<TierRegionResult & { PERIOD: string }>(connection, sql, binds);
    
    const currentRows = rows.filter(r => r.PERIOD === 'CY');
    const prevRows = rows.filter(r => r.PERIOD === 'LY');
    const prevFullRows = rows.filter(r => r.PERIOD === 'LY_FULL');
    
    // 도시명 배열로 변환 및 한국어 번역 적용
    const parseCities = (citiesStr: string | undefined): string[] => {
      if (!citiesStr || citiesStr.trim() === '') return [];
      return citiesStr.split(', ').map(city => city.trim()).filter(city => city);
    };
    
    const formatCityName = (cityCn: string): string => {
      // "市" 제거 후 번역 시도
      const cityWithoutSuffix = cityCn.replace(/市$/, '');
      const cityKo = cityKoMap[cityWithoutSuffix] || cityKoMap[cityCn];
      const displayName = cityKo ? `${cityKo}(${cityWithoutSuffix})` : cityCn;
      return displayName;
    };
    
    const toRow = (r: TierRegionResult, isCurrent: boolean, isFull: boolean = false): TierRegionSalesRow => {
      const cities = isCurrent && r.CITIES 
        ? parseCities(r.CITIES).map(formatCityName)
        : [];
      
      // 전년도 데이터인 경우 실제 데이터를 사용, 당해 데이터인 경우 전년도는 0 (나중에 buildTierRegionData에서 매칭)
      if (isCurrent) {
        return {
          key: r.GROUP_KEY || 'Unknown',
          cities: cities.length > 0 ? cities : undefined,
          salesAmt: Number(r.SALES_AMT) || 0,
          shopCnt: Number(r.SHOP_CNT) || 0,
          salesPerShop: r.SHOP_CNT > 0 ? r.SALES_AMT / r.SHOP_CNT : 0,
          prevSalesAmt: 0,
          prevShopCnt: 0,
          prevSalesPerShop: 0,
          prevFullSalesAmt: 0,
          prevFullShopCnt: 0,
          prevCumSalesAmt: 0,
          prevCumShopCnt: 0,
          tagAmt: Number(r.TAG_AMT) || 0,
          prevTagAmt: 0,
          prevFullTagAmt: 0,
          discountRate: null,
          prevDiscountRate: null,
          discountRateYoy: null,
        };
      } else {
        // 전년도 데이터: 실제 전년도 값 사용
        return {
          key: r.GROUP_KEY || 'Unknown',
          cities: undefined, // 전년도는 도시 정보 없음
          salesAmt: Number(r.SALES_AMT) || 0,
          shopCnt: Number(r.SHOP_CNT) || 0,
          salesPerShop: r.SHOP_CNT > 0 ? r.SALES_AMT / r.SHOP_CNT : 0,
          prevSalesAmt: 0,
          prevShopCnt: 0,
          prevSalesPerShop: 0,
          prevFullSalesAmt: isFull ? Number(r.SALES_AMT) || 0 : 0,
          prevFullShopCnt: isFull ? Number(r.SHOP_CNT) || 0 : 0,
          prevCumSalesAmt: !isFull ? Number(r.SALES_AMT) || 0 : 0, // 전년 누적 매출
          prevCumShopCnt: !isFull ? Number(r.SHOP_CNT) || 0 : 0, // 전년 누적 매장수
          tagAmt: 0,
          prevTagAmt: !isFull ? Number(r.TAG_AMT) || 0 : 0, // 전년 누적 Tag 가격
          prevFullTagAmt: isFull ? Number(r.TAG_AMT) || 0 : 0, // 전년 월전체 Tag 가격
          discountRate: null,
          prevDiscountRate: null,
          discountRateYoy: null,
        };
      }
    };
    
    return {
      current: currentRows.map(r => toRow(r, true)),
      prevYear: prevRows.map(r => toRow(r, false, false)),
      prevYearFull: prevFullRows.map(r => toRow(r, false, true)),
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
): Promise<{ current: TierRegionSalesRow[]; prevYear: TierRegionSalesRow[]; prevYearFull: TierRegionSalesRow[] }> {
  const connection = await getConnection();
  try {
    // 날짜 계산
    const [year, month] = ym.split('-').map(Number);
    const prevYear = year - 1;
    const lastDay = lastDt.split('-')[2];
    const prevYearLastDt = `${prevYear}-${String(month).padStart(2, '0')}-${lastDay}`;
    const prevYearMonthEnd = new Date(prevYear, month, 0).getDate(); // 전년 월말
    const prevYearFullDt = `${prevYear}-${String(month).padStart(2, '0')}-${String(prevYearMonthEnd).padStart(2, '0')}`;
    
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
          SUM(sale.sale_amt) as shop_sales_amt,
          SUM(sale.tag_amt) as shop_tag_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      -- 지역별 도시 정보 (매장수 기준 상위 4개)
      region_cities AS (
        SELECT 
          COALESCE(vs.sale_region_nm, '기타') as sale_region_nm,
          m.city_nm,
          COUNT(DISTINCT CASE WHEN css.brd_nm = ? THEN css.shop_id END) as shop_cnt
        FROM cy_shop_sales css
        INNER JOIN valid_shops vs ON css.shop_id = vs.shop_id
        JOIN FNF.CHN.MST_SHOP_ALL m ON css.shop_id = m.shop_id
        WHERE m.city_nm IS NOT NULL AND TRIM(m.city_nm) != ''
        GROUP BY COALESCE(vs.sale_region_nm, '기타'), m.city_nm
      ),
      region_top_cities AS (
        SELECT 
          sale_region_nm,
          LISTAGG(city_nm, ', ') WITHIN GROUP (ORDER BY shop_cnt DESC) as cities
        FROM (
          SELECT sale_region_nm, city_nm, shop_cnt,
                 ROW_NUMBER() OVER (PARTITION BY sale_region_nm ORDER BY shop_cnt DESC) as rn
          FROM region_cities
        )
        WHERE rn <= 4
        GROUP BY sale_region_nm
      ),
      cy_region AS (
        SELECT 
          COALESCE(vs.sale_region_nm, '기타') as GROUP_KEY,
          COALESCE(SUM(css.shop_sales_amt), 0) as SALES_AMT,
          COALESCE(SUM(css.shop_tag_amt), 0) as TAG_AMT,
          COUNT(DISTINCT CASE WHEN css.brd_nm = ? THEN css.shop_id END) as SHOP_CNT
        FROM cy_shop_sales css
        INNER JOIN valid_shops vs ON css.shop_id = vs.shop_id
        GROUP BY COALESCE(vs.sale_region_nm, '기타')
      ),
      -- 전년 지역별 매출 (판매액 > 0인 매장만)
      ly_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt,
          SUM(sale.tag_amt) as shop_tag_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      ly_region AS (
        SELECT 
          COALESCE(vs.sale_region_nm, '기타') as GROUP_KEY,
          COALESCE(SUM(lss.shop_sales_amt), 0) as SALES_AMT,
          COALESCE(SUM(lss.shop_tag_amt), 0) as TAG_AMT,
          COUNT(DISTINCT CASE WHEN lss.brd_nm = ? THEN lss.shop_id END) as SHOP_CNT
        FROM ly_shop_sales lss
        INNER JOIN valid_shops vs ON lss.shop_id = vs.shop_id
        GROUP BY COALESCE(vs.sale_region_nm, '기타')
      ),
      -- 전년 월전체 지역별 매출 (판매액 > 0인 매장만)
      ly_full_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt,
          SUM(sale.tag_amt) as shop_tag_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      ly_full_region AS (
        SELECT 
          COALESCE(vs.sale_region_nm, '기타') as GROUP_KEY,
          COALESCE(SUM(lfs.shop_sales_amt), 0) as SALES_AMT,
          COALESCE(SUM(lfs.shop_tag_amt), 0) as TAG_AMT,
          COUNT(DISTINCT CASE WHEN lfs.brd_nm = ? THEN lfs.shop_id END) as SHOP_CNT
        FROM ly_full_shop_sales lfs
        INNER JOIN valid_shops vs ON lfs.shop_id = vs.shop_id
        GROUP BY COALESCE(vs.sale_region_nm, '기타')
      )
      SELECT 
        'CY' as PERIOD, 
        r.GROUP_KEY, 
        r.SALES_AMT, 
        r.TAG_AMT,
        r.SHOP_CNT,
        COALESCE(rc.cities, '') as CITIES
      FROM cy_region r
      LEFT JOIN region_top_cities rc ON r.GROUP_KEY = rc.sale_region_nm
      UNION ALL
      SELECT 
        'LY' as PERIOD, 
        GROUP_KEY, 
        SALES_AMT, 
        TAG_AMT,
        SHOP_CNT,
        '' as CITIES
      FROM ly_region
      UNION ALL
      SELECT 
        'LY_FULL' as PERIOD, 
        GROUP_KEY, 
        SALES_AMT, 
        TAG_AMT,
        SHOP_CNT,
        '' as CITIES
      FROM ly_full_region
    `;
    
    const binds = [
      lastDt, lastDt, brandCode, shopBrandName, shopBrandName,
      prevYearLastDt, prevYearLastDt, brandCode, shopBrandName,
      prevYearFullDt, prevYearFullDt, brandCode, shopBrandName,
    ];
    
    const rows = await executeQuery<TierRegionResult & { PERIOD: string }>(connection, sql, binds);
    
    const currentRows = rows.filter(r => r.PERIOD === 'CY');
    const prevRows = rows.filter(r => r.PERIOD === 'LY');
    const prevFullRows = rows.filter(r => r.PERIOD === 'LY_FULL');
    
    // 도시명 배열로 변환 및 한국어 번역 적용
    const parseCities = (citiesStr: string | undefined): string[] => {
      if (!citiesStr || citiesStr.trim() === '') return [];
      return citiesStr.split(', ').map(city => city.trim()).filter(city => city);
    };
    
    const formatCityName = (cityCn: string): string => {
      // "市" 제거 후 번역 시도
      const cityWithoutSuffix = cityCn.replace(/市$/, '');
      const cityKo = cityKoMap[cityWithoutSuffix] || cityKoMap[cityCn];
      const displayName = cityKo ? `${cityKo}(${cityWithoutSuffix})` : cityCn;
      return displayName;
    };
    
    const toRow = (r: TierRegionResult, isCurrent: boolean, isFull: boolean = false): TierRegionSalesRow => {
      const cities = isCurrent && r.CITIES 
        ? parseCities(r.CITIES).map(formatCityName)
        : [];
      
      // 전년도 데이터인 경우 실제 데이터를 사용, 당해 데이터인 경우 전년도는 0 (나중에 buildTierRegionData에서 매칭)
      if (isCurrent) {
        return {
          key: r.GROUP_KEY || 'Unknown',
          labelKo: regionKoMap[r.GROUP_KEY] || r.GROUP_KEY,
          cities: cities.length > 0 ? cities : undefined,
          salesAmt: Number(r.SALES_AMT) || 0,
          shopCnt: Number(r.SHOP_CNT) || 0,
          salesPerShop: r.SHOP_CNT > 0 ? r.SALES_AMT / r.SHOP_CNT : 0,
          prevSalesAmt: 0,
          prevShopCnt: 0,
          prevSalesPerShop: 0,
          prevFullSalesAmt: 0,
          prevFullShopCnt: 0,
          prevCumSalesAmt: 0,
          prevCumShopCnt: 0,
          tagAmt: Number(r.TAG_AMT) || 0,
          prevTagAmt: 0,
          prevFullTagAmt: 0,
          discountRate: null,
          prevDiscountRate: null,
          discountRateYoy: null,
        };
      } else {
        // 전년도 데이터: 실제 전년도 값 사용
        return {
          key: r.GROUP_KEY || 'Unknown',
          labelKo: regionKoMap[r.GROUP_KEY] || r.GROUP_KEY,
          cities: undefined, // 전년도는 도시 정보 없음
          salesAmt: Number(r.SALES_AMT) || 0,
          shopCnt: Number(r.SHOP_CNT) || 0,
          salesPerShop: r.SHOP_CNT > 0 ? r.SALES_AMT / r.SHOP_CNT : 0,
          prevSalesAmt: 0,
          prevShopCnt: 0,
          prevSalesPerShop: 0,
          prevFullSalesAmt: isFull ? Number(r.SALES_AMT) || 0 : 0,
          prevFullShopCnt: isFull ? Number(r.SHOP_CNT) || 0 : 0,
          prevCumSalesAmt: !isFull ? Number(r.SALES_AMT) || 0 : 0, // 전년 누적 매출
          prevCumShopCnt: !isFull ? Number(r.SHOP_CNT) || 0 : 0, // 전년 누적 매장수
          tagAmt: 0,
          prevTagAmt: !isFull ? Number(r.TAG_AMT) || 0 : 0, // 전년 누적 Tag 가격
          prevFullTagAmt: isFull ? Number(r.TAG_AMT) || 0 : 0, // 전년 월전체 Tag 가격
          discountRate: null,
          prevDiscountRate: null,
          discountRateYoy: null,
        };
      }
    };
    
    return {
      current: currentRows.map(r => toRow(r, true)),
      prevYear: prevRows.map(r => toRow(r, false, false)),
      prevYearFull: prevFullRows.map(r => toRow(r, false, true)),
    };
  } finally {
    await destroyConnection(connection);
  }
}

/**
 * Trade Zone별 점당매출 조회
 */
export async function getTradeZoneSalesData(
  ym: string,
  lastDt: string,
  brandCode: string,
  shopBrandName: string
): Promise<{ current: TierRegionSalesRow[]; prevYear: TierRegionSalesRow[]; prevYearFull: TierRegionSalesRow[] }> {
  const connection = await getConnection();
  try {
    // 날짜 계산
    const [year, month] = ym.split('-').map(Number);
    const prevYear = year - 1;
    const lastDay = lastDt.split('-')[2];
    const prevYearLastDt = `${prevYear}-${String(month).padStart(2, '0')}-${lastDay}`;
    const prevYearMonthEnd = new Date(prevYear, month, 0).getDate(); // 전년 월말
    const prevYearFullDt = `${prevYear}-${String(month).padStart(2, '0')}-${String(prevYearMonthEnd).padStart(2, '0')}`;
    
    const sql = `
      WITH valid_shops AS (
        -- 대리상 오프라인 정규매장 (brd_nm 포함)
        SELECT DISTINCT d.shop_id, d.trade_zone_nm, d.brd_nm
        FROM CHN.dw_shop_wh_detail d
        JOIN FNF.CHN.MST_SHOP_ALL m ON d.shop_id = m.shop_id
        WHERE d.anlys_shop_type_nm IN ('FO', 'FP')
          AND d.fr_or_cls = 'FR'
          AND m.anlys_onoff_cls_nm = 'Offline'
        QUALIFY ROW_NUMBER() OVER (PARTITION BY d.shop_id ORDER BY d.open_dt DESC NULLS LAST) = 1
      ),
      -- 당해 Trade Zone별 매출 (판매액 > 0인 매장만)
      cy_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt,
          SUM(sale.tag_amt) as shop_tag_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      cy_trade_zone AS (
        SELECT 
          COALESCE(vs.trade_zone_nm, '기타') as GROUP_KEY,
          COALESCE(SUM(css.shop_sales_amt), 0) as SALES_AMT,
          COALESCE(SUM(css.shop_tag_amt), 0) as TAG_AMT,
          COUNT(DISTINCT CASE WHEN css.brd_nm = ? THEN css.shop_id END) as SHOP_CNT
        FROM cy_shop_sales css
        INNER JOIN valid_shops vs ON css.shop_id = vs.shop_id
        GROUP BY COALESCE(vs.trade_zone_nm, '기타')
      ),
      -- 전년 Trade Zone별 매출 (판매액 > 0인 매장만)
      ly_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt,
          SUM(sale.tag_amt) as shop_tag_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      ly_trade_zone AS (
        SELECT 
          COALESCE(vs.trade_zone_nm, '기타') as GROUP_KEY,
          COALESCE(SUM(lss.shop_sales_amt), 0) as SALES_AMT,
          COALESCE(SUM(lss.shop_tag_amt), 0) as TAG_AMT,
          COUNT(DISTINCT CASE WHEN lss.brd_nm = ? THEN lss.shop_id END) as SHOP_CNT
        FROM ly_shop_sales lss
        INNER JOIN valid_shops vs ON lss.shop_id = vs.shop_id
        GROUP BY COALESCE(vs.trade_zone_nm, '기타')
      ),
      -- 전년 월전체 Trade Zone별 매출 (판매액 > 0인 매장만)
      ly_full_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt,
          SUM(sale.tag_amt) as shop_tag_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      ly_full_trade_zone AS (
        SELECT 
          COALESCE(vs.trade_zone_nm, '기타') as GROUP_KEY,
          COALESCE(SUM(lfs.shop_sales_amt), 0) as SALES_AMT,
          COALESCE(SUM(lfs.shop_tag_amt), 0) as TAG_AMT,
          COUNT(DISTINCT CASE WHEN lfs.brd_nm = ? THEN lfs.shop_id END) as SHOP_CNT
        FROM ly_full_shop_sales lfs
        INNER JOIN valid_shops vs ON lfs.shop_id = vs.shop_id
        GROUP BY COALESCE(vs.trade_zone_nm, '기타')
      )
      SELECT 
        'CY' as PERIOD, 
        GROUP_KEY, 
        SALES_AMT, 
        TAG_AMT,
        SHOP_CNT,
        '' as CITIES
      FROM cy_trade_zone
      UNION ALL
      SELECT 
        'LY' as PERIOD, 
        GROUP_KEY, 
        SALES_AMT, 
        TAG_AMT,
        SHOP_CNT,
        '' as CITIES
      FROM ly_trade_zone
      UNION ALL
      SELECT 
        'LY_FULL' as PERIOD, 
        GROUP_KEY, 
        SALES_AMT, 
        TAG_AMT,
        SHOP_CNT,
        '' as CITIES
      FROM ly_full_trade_zone
    `;
    
    const binds = [
      lastDt, lastDt, brandCode, shopBrandName,
      prevYearLastDt, prevYearLastDt, brandCode, shopBrandName,
      prevYearFullDt, prevYearFullDt, brandCode, shopBrandName,
    ];
    
    const rows = await executeQuery<TierRegionResult & { PERIOD: string }>(connection, sql, binds);
    
    const currentRows = rows.filter(r => r.PERIOD === 'CY');
    const prevRows = rows.filter(r => r.PERIOD === 'LY');
    const prevFullRows = rows.filter(r => r.PERIOD === 'LY_FULL');
    
    const toRow = (r: TierRegionResult, isCurrent: boolean, isFull: boolean = false): TierRegionSalesRow => {
      // 전년도 데이터인 경우 실제 데이터를 사용, 당해 데이터인 경우 전년도는 0 (나중에 buildTierRegionData에서 매칭)
      if (isCurrent) {
        return {
          key: r.GROUP_KEY || 'Unknown',
          cities: undefined, // Trade Zone은 도시 정보 없음
          salesAmt: Number(r.SALES_AMT) || 0,
          shopCnt: Number(r.SHOP_CNT) || 0,
          salesPerShop: r.SHOP_CNT > 0 ? r.SALES_AMT / r.SHOP_CNT : 0,
          prevSalesAmt: 0,
          prevShopCnt: 0,
          prevSalesPerShop: 0,
          prevFullSalesAmt: 0,
          prevFullShopCnt: 0,
          prevCumSalesAmt: 0,
          prevCumShopCnt: 0,
          tagAmt: Number(r.TAG_AMT) || 0,
          prevTagAmt: 0,
          prevFullTagAmt: 0,
          discountRate: null,
          prevDiscountRate: null,
          discountRateYoy: null,
        };
      } else {
        // 전년도 데이터: 실제 전년도 값 사용
        return {
          key: r.GROUP_KEY || 'Unknown',
          cities: undefined, // Trade Zone은 도시 정보 없음
          salesAmt: Number(r.SALES_AMT) || 0,
          shopCnt: Number(r.SHOP_CNT) || 0,
          salesPerShop: r.SHOP_CNT > 0 ? r.SALES_AMT / r.SHOP_CNT : 0,
          prevSalesAmt: 0,
          prevShopCnt: 0,
          prevSalesPerShop: 0,
          prevFullSalesAmt: isFull ? Number(r.SALES_AMT) || 0 : 0,
          prevFullShopCnt: isFull ? Number(r.SHOP_CNT) || 0 : 0,
          prevCumSalesAmt: !isFull ? Number(r.SALES_AMT) || 0 : 0, // 전년 누적 매출
          prevCumShopCnt: !isFull ? Number(r.SHOP_CNT) || 0 : 0, // 전년 누적 매장수
          tagAmt: 0,
          prevTagAmt: !isFull ? Number(r.TAG_AMT) || 0 : 0, // 전년 누적 Tag 가격
          prevFullTagAmt: isFull ? Number(r.TAG_AMT) || 0 : 0, // 전년 월전체 Tag 가격
          discountRate: null,
          prevDiscountRate: null,
          discountRateYoy: null,
        };
      }
    };
    
    return {
      current: currentRows.map(r => toRow(r, true)),
      prevYear: prevRows.map(r => toRow(r, false, false)),
      prevYearFull: prevFullRows.map(r => toRow(r, false, true)),
    };
  } finally {
    await destroyConnection(connection);
  }
}

/**
 * Shop Level별 점당매출 조회
 */
export async function getShopLevelSalesData(
  ym: string,
  lastDt: string,
  brandCode: string,
  shopBrandName: string
): Promise<{ current: TierRegionSalesRow[]; prevYear: TierRegionSalesRow[]; prevYearFull: TierRegionSalesRow[] }> {
  const connection = await getConnection();
  try {
    // 날짜 계산
    const [year, month] = ym.split('-').map(Number);
    const prevYear = year - 1;
    const lastDay = lastDt.split('-')[2];
    const prevYearLastDt = `${prevYear}-${String(month).padStart(2, '0')}-${lastDay}`;
    const prevYearMonthEnd = new Date(prevYear, month, 0).getDate(); // 전년 월말
    const prevYearFullDt = `${prevYear}-${String(month).padStart(2, '0')}-${String(prevYearMonthEnd).padStart(2, '0')}`;
    
    const sql = `
      WITH valid_shops AS (
        -- 대리상 오프라인 정규매장 (brd_nm 포함)
        SELECT DISTINCT d.shop_id, d.shop_level_nm, d.brd_nm
        FROM CHN.dw_shop_wh_detail d
        JOIN FNF.CHN.MST_SHOP_ALL m ON d.shop_id = m.shop_id
        WHERE d.anlys_shop_type_nm IN ('FO', 'FP')
          AND d.fr_or_cls = 'FR'
          AND m.anlys_onoff_cls_nm = 'Offline'
        QUALIFY ROW_NUMBER() OVER (PARTITION BY d.shop_id ORDER BY d.open_dt DESC NULLS LAST) = 1
      ),
      -- 당해 Shop Level별 매출 (판매액 > 0인 매장만)
      cy_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt,
          SUM(sale.tag_amt) as shop_tag_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      cy_shop_level AS (
        SELECT 
          COALESCE(vs.shop_level_nm, '기타') as GROUP_KEY,
          COALESCE(SUM(css.shop_sales_amt), 0) as SALES_AMT,
          COALESCE(SUM(css.shop_tag_amt), 0) as TAG_AMT,
          COUNT(DISTINCT CASE WHEN css.brd_nm = ? THEN css.shop_id END) as SHOP_CNT
        FROM cy_shop_sales css
        INNER JOIN valid_shops vs ON css.shop_id = vs.shop_id
        GROUP BY COALESCE(vs.shop_level_nm, '기타')
      ),
      -- 전년 Shop Level별 매출 (판매액 > 0인 매장만)
      ly_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt,
          SUM(sale.tag_amt) as shop_tag_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      ly_shop_level AS (
        SELECT 
          COALESCE(vs.shop_level_nm, '기타') as GROUP_KEY,
          COALESCE(SUM(lss.shop_sales_amt), 0) as SALES_AMT,
          COALESCE(SUM(lss.shop_tag_amt), 0) as TAG_AMT,
          COUNT(DISTINCT CASE WHEN lss.brd_nm = ? THEN lss.shop_id END) as SHOP_CNT
        FROM ly_shop_sales lss
        INNER JOIN valid_shops vs ON lss.shop_id = vs.shop_id
        GROUP BY COALESCE(vs.shop_level_nm, '기타')
      ),
      -- 전년 월전체 Shop Level별 매출 (판매액 > 0인 매장만)
      ly_full_shop_sales AS (
        SELECT 
          sale.shop_id,
          vs.brd_nm,
          SUM(sale.sale_amt) as shop_sales_amt,
          SUM(sale.tag_amt) as shop_tag_amt
        FROM CHN.dw_sale sale
        INNER JOIN valid_shops vs ON sale.shop_id = vs.shop_id
        WHERE sale.sale_dt BETWEEN DATE_TRUNC('MONTH', ?::DATE) AND ?::DATE
          AND sale.brd_cd = ?
        GROUP BY sale.shop_id, vs.brd_nm
        HAVING SUM(sale.sale_amt) > 0
      ),
      ly_full_shop_level AS (
        SELECT 
          COALESCE(vs.shop_level_nm, '기타') as GROUP_KEY,
          COALESCE(SUM(lfs.shop_sales_amt), 0) as SALES_AMT,
          COALESCE(SUM(lfs.shop_tag_amt), 0) as TAG_AMT,
          COUNT(DISTINCT CASE WHEN lfs.brd_nm = ? THEN lfs.shop_id END) as SHOP_CNT
        FROM ly_full_shop_sales lfs
        INNER JOIN valid_shops vs ON lfs.shop_id = vs.shop_id
        GROUP BY COALESCE(vs.shop_level_nm, '기타')
      )
      SELECT 
        'CY' as PERIOD, 
        GROUP_KEY, 
        SALES_AMT, 
        TAG_AMT,
        SHOP_CNT,
        '' as CITIES
      FROM cy_shop_level
      UNION ALL
      SELECT 
        'LY' as PERIOD, 
        GROUP_KEY, 
        SALES_AMT, 
        TAG_AMT,
        SHOP_CNT,
        '' as CITIES
      FROM ly_shop_level
      UNION ALL
      SELECT 
        'LY_FULL' as PERIOD, 
        GROUP_KEY, 
        SALES_AMT, 
        TAG_AMT,
        SHOP_CNT,
        '' as CITIES
      FROM ly_full_shop_level
    `;
    
    const binds = [
      lastDt, lastDt, brandCode, shopBrandName,
      prevYearLastDt, prevYearLastDt, brandCode, shopBrandName,
      prevYearFullDt, prevYearFullDt, brandCode, shopBrandName,
    ];
    
    const rows = await executeQuery<TierRegionResult & { PERIOD: string }>(connection, sql, binds);
    
    const currentRows = rows.filter(r => r.PERIOD === 'CY');
    const prevRows = rows.filter(r => r.PERIOD === 'LY');
    const prevFullRows = rows.filter(r => r.PERIOD === 'LY_FULL');
    
    const toRow = (r: TierRegionResult, isCurrent: boolean, isFull: boolean = false): TierRegionSalesRow => {
      // 전년도 데이터인 경우 실제 데이터를 사용, 당해 데이터인 경우 전년도는 0 (나중에 buildTierRegionData에서 매칭)
      if (isCurrent) {
        return {
          key: r.GROUP_KEY || 'Unknown',
          cities: undefined, // Shop Level은 도시 정보 없음
          salesAmt: Number(r.SALES_AMT) || 0,
          shopCnt: Number(r.SHOP_CNT) || 0,
          salesPerShop: r.SHOP_CNT > 0 ? r.SALES_AMT / r.SHOP_CNT : 0,
          prevSalesAmt: 0,
          prevShopCnt: 0,
          prevSalesPerShop: 0,
          prevFullSalesAmt: 0,
          prevFullShopCnt: 0,
          prevCumSalesAmt: 0,
          prevCumShopCnt: 0,
          tagAmt: Number(r.TAG_AMT) || 0,
          prevTagAmt: 0,
          prevFullTagAmt: 0,
          discountRate: null,
          prevDiscountRate: null,
          discountRateYoy: null,
        };
      } else {
        // 전년도 데이터: 실제 전년도 값 사용
        return {
          key: r.GROUP_KEY || 'Unknown',
          cities: undefined, // Shop Level은 도시 정보 없음
          salesAmt: Number(r.SALES_AMT) || 0,
          shopCnt: Number(r.SHOP_CNT) || 0,
          salesPerShop: r.SHOP_CNT > 0 ? r.SALES_AMT / r.SHOP_CNT : 0,
          prevSalesAmt: 0,
          prevShopCnt: 0,
          prevSalesPerShop: 0,
          prevFullSalesAmt: isFull ? Number(r.SALES_AMT) || 0 : 0,
          prevFullShopCnt: isFull ? Number(r.SHOP_CNT) || 0 : 0,
          prevCumSalesAmt: !isFull ? Number(r.SALES_AMT) || 0 : 0, // 전년 누적 매출
          prevCumShopCnt: !isFull ? Number(r.SHOP_CNT) || 0 : 0, // 전년 누적 매장수
          tagAmt: 0,
          prevTagAmt: !isFull ? Number(r.TAG_AMT) || 0 : 0, // 전년 누적 Tag 가격
          prevFullTagAmt: isFull ? Number(r.TAG_AMT) || 0 : 0, // 전년 월전체 Tag 가격
          discountRate: null,
          prevDiscountRate: null,
          discountRateYoy: null,
        };
      }
    };
    
    return {
      current: currentRows.map(r => toRow(r, true)),
      prevYear: prevRows.map(r => toRow(r, false, false)),
      prevYearFull: prevFullRows.map(r => toRow(r, false, true)),
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
  // CSV 파일에서 데이터 읽기
  const { getActualsCsv } = await import('@/data/plforecast/actuals');
  const { parseChannelActualsCsv } = await import('./parseActualsCsv');
  
  const csvContent = getActualsCsv(ym, lastDt);
  if (!csvContent) {
    // CSV 파일이 없으면 빈 데이터 반환
    const emptyRow: ChannelRowData = { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null };
    return {
      tagSale: emptyRow,
      actSaleVatInc: emptyRow,
      actSaleVatExc: emptyRow,
      cogs: emptyRow,
    };
  }
  
  // CSV 파싱
  return parseChannelActualsCsv(csvContent, brandCode);
}

// ============================================================
// 카테고리별 판매 데이터 조회 (트리맵용)
// ============================================================

interface CategorySalesDbRow {
  CATEGORY_KEY: string;
  CY_SALES_AMT: number;
  PY_SALES_AMT: number;
  CY_TAG_AMT: number;
  PY_TAG_AMT: number;
}

/**
 * 카테고리별 판매 데이터 조회 (7개 카테고리)
 */
export async function getCategorySalesData(
  type: 'tier' | 'region',
  key: string,
  brdCd: string,
  ym: string,
  lastDt: string
): Promise<{ category: string; cySalesAmt: number; pySalesAmt: number; yoy: number | null; discountRate: number | null; prevDiscountRate: number | null; discountRateYoy: number | null }[]> {
  const connection = await getConnection();
  
  try {
    const year = parseInt(lastDt.substring(0, 4));
    const month = lastDt.substring(5, 7);
    const day = lastDt.substring(8, 10);
    const cyStartDt = `${year}-${month}-01`;
    const cyEndDt = lastDt;
    const pyStartDt = `${year - 1}-${month}-01`;
    const pyEndDt = `${year - 1}-${month}-${day}`;
    
    // 기준연도 추출 (예: 2025-12 → '25')
    const baseYear = ym.substring(0, 4);
    const baseYearShort = baseYear.substring(2, 4); // '25'
    const nextYearShort = String(parseInt(baseYearShort) + 1).padStart(2, '0'); // '26'
    const prevYearShort = String(parseInt(baseYearShort) - 1).padStart(2, '0'); // '24'
    
    const regionOrTierFilter = type === 'tier' ? 'd.city_tier_nm' : 'd.sale_region_nm';
    
    // 디버깅: 파라미터 값 로깅
    console.log('[getCategorySalesData] 파라미터:', {
      type,
      key,
      brdCd,
      ym,
      lastDt,
      baseYearShort,
      nextYearShort,
      cyStartDt,
      cyEndDt,
      pyStartDt,
      pyEndDt
    });
    
    // 디버깅: valid_shops의 key_value 확인 (일시적으로 비활성화 - 메인 쿼리 우선)
    // try {
    //   const debugSql = `
    //     WITH valid_shops AS (
    //       SELECT DISTINCT d.shop_id, TRIM(${regionOrTierFilter}) AS key_value
    //       FROM CHN.dw_shop_wh_detail d
    //       JOIN FNF.CHN.MST_SHOP_ALL m ON d.shop_id = m.shop_id
    //       WHERE d.fr_or_cls = 'FR'
    //         AND d.anlys_shop_type_nm IN ('FO', 'FP')
    //         AND m.anlys_onoff_cls_nm = 'Offline'
    //       QUALIFY ROW_NUMBER() OVER (PARTITION BY d.shop_id ORDER BY d.open_dt DESC NULLS LAST) = 1
    //     )
    //     SELECT DISTINCT key_value, COUNT(DISTINCT shop_id) AS shop_cnt
    //     FROM valid_shops
    //     WHERE key_value IS NOT NULL
    //     GROUP BY key_value
    //     ORDER BY key_value
    //   `;
    //   const debugRows = await executeQuery<{ KEY_VALUE: string; SHOP_CNT: number }>(connection, debugSql, []);
    //   console.log('[getCategorySalesData] valid_shops key_value 목록:', debugRows.map(r => ({ key: r.KEY_VALUE, shopCnt: r.SHOP_CNT })));
    // } catch (debugErr) {
    //   console.warn('[getCategorySalesData] 디버깅 쿼리 오류 (무시):', debugErr instanceof Error ? debugErr.message : debugErr);
    // }
    
    const sql = `
      WITH valid_shops AS (
        SELECT DISTINCT d.shop_id, TRIM(${regionOrTierFilter}) AS key_value
        FROM CHN.dw_shop_wh_detail d
        JOIN FNF.CHN.MST_SHOP_ALL m ON d.shop_id = m.shop_id
        WHERE d.fr_or_cls = 'FR'
          AND d.anlys_shop_type_nm IN ('FO', 'FP')
          AND m.anlys_onoff_cls_nm = 'Offline'
        QUALIFY ROW_NUMBER() OVER (PARTITION BY d.shop_id ORDER BY d.open_dt DESC NULLS LAST) = 1
      )
      SELECT 
        CASE
          -- 조인 실패 시 처리
          WHEN scs.prdt_scs_cd IS NULL THEN 'others'
          -- 악세사리: sale_dt 조건 없이 기존대로 유지
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'ACC' AND UPPER(scs.prdt_kind_nm_en) = 'SHOES' THEN 'Shoes'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'ACC' AND UPPER(scs.prdt_kind_nm_en) = 'HEADWEAR' THEN 'Headwear'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'ACC' AND UPPER(scs.prdt_kind_nm_en) = 'BAG' THEN 'Bag'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'ACC' AND UPPER(scs.prdt_kind_nm_en) NOT IN ('SHOES', 'HEADWEAR', 'BAG') THEN 'Acc_etc'
          -- 의류: sale_dt 기준으로 당해/전년 구분
          -- S 시즌: 기존 로직 (연도 비교)
          -- 당해 데이터 - S 시즌: 25=당시즌, 26=차시즌
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}'
            AND RIGHT(s.sesn, 1) = 'S'
            AND LEFT(s.sesn, 2) = '${nextYearShort}' THEN 'wear_next_cy'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}'
            AND RIGHT(s.sesn, 1) = 'S'
            AND LEFT(s.sesn, 2) = '${baseYearShort}' THEN 'wear_current_cy'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}'
            AND RIGHT(s.sesn, 1) = 'S'
            AND LEFT(s.sesn, 2) NOT IN ('${baseYearShort}', '${nextYearShort}') THEN 'wear_past_cy'
          -- 당해 데이터 - F/N 시즌 (1-2월): 25=당시즌, 26=차시즌
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}'
            AND RIGHT(s.sesn, 1) IN ('F', 'N')
            AND CAST('${month}' AS INTEGER) <= 2
            AND LEFT(s.sesn, 2) = '${nextYearShort}' THEN 'wear_next_cy'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}'
            AND RIGHT(s.sesn, 1) IN ('F', 'N')
            AND CAST('${month}' AS INTEGER) <= 2
            AND LEFT(s.sesn, 2) = '${prevYearShort}' THEN 'wear_current_cy'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}'
            AND RIGHT(s.sesn, 1) IN ('F', 'N')
            AND CAST('${month}' AS INTEGER) <= 2
            AND LEFT(s.sesn, 2) NOT IN ('${prevYearShort}', '${nextYearShort}') THEN 'wear_past_cy'
          -- 당해 데이터 - F/N 시즌 (3월 이상): 26=당시즌, 27=차시즌
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}'
            AND RIGHT(s.sesn, 1) IN ('F', 'N')
            AND CAST('${month}' AS INTEGER) >= 3
            AND LEFT(s.sesn, 2) = '${nextYearShort}' THEN 'wear_next_cy'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}'
            AND RIGHT(s.sesn, 1) IN ('F', 'N')
            AND CAST('${month}' AS INTEGER) >= 3
            AND LEFT(s.sesn, 2) = '${baseYearShort}' THEN 'wear_current_cy'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}'
            AND RIGHT(s.sesn, 1) IN ('F', 'N')
            AND CAST('${month}' AS INTEGER) >= 3
            AND LEFT(s.sesn, 2) NOT IN ('${baseYearShort}', '${nextYearShort}') THEN 'wear_past_cy'
          -- 전년 데이터 - S 시즌: 24=당시즌, 25=차시즌
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}'
            AND RIGHT(s.sesn, 1) = 'S'
            AND LEFT(s.sesn, 2) = '${baseYearShort}' THEN 'wear_next_py'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}'
            AND RIGHT(s.sesn, 1) = 'S'
            AND LEFT(s.sesn, 2) = '${prevYearShort}' THEN 'wear_current_py'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}'
            AND RIGHT(s.sesn, 1) = 'S'
            AND LEFT(s.sesn, 2) NOT IN ('${prevYearShort}', '${baseYearShort}') THEN 'wear_past_py'
          -- 전년 데이터 - F/N 시즌 (1-2월): 24=당시즌, 25=차시즌
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}'
            AND RIGHT(s.sesn, 1) IN ('F', 'N')
            AND CAST('${month}' AS INTEGER) <= 2
            AND LEFT(s.sesn, 2) = '${baseYearShort}' THEN 'wear_next_py'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}'
            AND RIGHT(s.sesn, 1) IN ('F', 'N')
            AND CAST('${month}' AS INTEGER) <= 2
            AND LEFT(s.sesn, 2) = '${prevYearShort}' THEN 'wear_current_py'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}'
            AND RIGHT(s.sesn, 1) IN ('F', 'N')
            AND CAST('${month}' AS INTEGER) <= 2
            AND LEFT(s.sesn, 2) NOT IN ('${prevYearShort}', '${baseYearShort}') THEN 'wear_past_py'
          -- 전년 데이터 - F/N 시즌 (3월 이상): 25=당시즌, 26=차시즌
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}'
            AND RIGHT(s.sesn, 1) IN ('F', 'N')
            AND CAST('${month}' AS INTEGER) >= 3
            AND LEFT(s.sesn, 2) = '${baseYearShort}' THEN 'wear_next_py'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}'
            AND RIGHT(s.sesn, 1) IN ('F', 'N')
            AND CAST('${month}' AS INTEGER) >= 3
            AND LEFT(s.sesn, 2) = '${prevYearShort}' THEN 'wear_current_py'
          WHEN UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
            AND s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}'
            AND RIGHT(s.sesn, 1) IN ('F', 'N')
            AND CAST('${month}' AS INTEGER) >= 3
            AND LEFT(s.sesn, 2) NOT IN ('${prevYearShort}', '${baseYearShort}') THEN 'wear_past_py'
          ELSE 'others'
        END AS CATEGORY_KEY,
        SUM(CASE WHEN s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}' THEN s.sale_amt ELSE 0 END) AS CY_SALES_AMT,
        SUM(CASE WHEN s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}' THEN s.sale_amt ELSE 0 END) AS PY_SALES_AMT,
        SUM(CASE WHEN s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}' THEN s.tag_amt ELSE 0 END) AS CY_TAG_AMT,
        SUM(CASE WHEN s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}' THEN s.tag_amt ELSE 0 END) AS PY_TAG_AMT
      FROM CHN.dw_sale s
      INNER JOIN valid_shops vs ON s.shop_id = vs.shop_id
      LEFT JOIN FNF.CHN.MST_PRDT_SCS scs ON s.prdt_scs_cd = scs.prdt_scs_cd
      WHERE s.brd_cd = ?
        AND TRIM(vs.key_value) = TRIM(?)
        AND (
          (s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}')
          OR (s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}')
        )
      GROUP BY CATEGORY_KEY
      HAVING CATEGORY_KEY != 'others'
      ORDER BY CY_SALES_AMT DESC
    `;
    
    const trimmedKey = key.trim();
    console.log('[getCategorySalesData] 쿼리 실행:', { brdCd, key: trimmedKey });
    
    let rows: any[];
    try {
      rows = await executeQuery<any>(connection, sql, [brdCd, trimmedKey]);
      // null 체크
      if (!Array.isArray(rows)) {
        console.warn('[getCategorySalesData] rows가 배열이 아닙니다:', rows);
        return [];
      }
      console.log('[getCategorySalesData] 쿼리 결과:', { rowCount: rows.length, rows: rows.map(r => ({ categoryKey: r?.CATEGORY_KEY, cySalesAmt: r?.CY_SALES_AMT, pySalesAmt: r?.PY_SALES_AMT })) });
    } catch (queryErr) {
      console.error('[getCategorySalesData] 메인 쿼리 실행 오류:', queryErr);
      console.error('[getCategorySalesData] SQL 쿼리:', sql.substring(0, 500) + '...');
      console.error('[getCategorySalesData] 파라미터:', [brdCd, trimmedKey]);
      return []; // 에러 시 빈 배열 반환
    }
    
    // 카테고리별로 당해/전년 데이터 합산
    const categoryMap: Record<string, { category: string; cySalesAmt: number; pySalesAmt: number; cyTagAmt: number; pyTagAmt: number }> = {};
    
    rows.forEach(row => {
      if (!row) return;
      const categoryKey = row.CATEGORY_KEY;
      if (!categoryKey) return;
      
      let category = '';
      
      if (categoryKey.startsWith('wear_next_')) {
        category = 'wear_next';
      } else if (categoryKey.startsWith('wear_current_')) {
        category = 'wear_current';
      } else if (categoryKey.startsWith('wear_past_')) {
        category = 'wear_past';
      } else {
        category = categoryKey;
      }
      
      if (!categoryMap[category]) {
        categoryMap[category] = { category, cySalesAmt: 0, pySalesAmt: 0, cyTagAmt: 0, pyTagAmt: 0 };
      }
      
      categoryMap[category].cySalesAmt += Number(row.CY_SALES_AMT) || 0;
      categoryMap[category].pySalesAmt += Number(row.PY_SALES_AMT) || 0;
      categoryMap[category].cyTagAmt += Number(row.CY_TAG_AMT) || 0;
      categoryMap[category].pyTagAmt += Number(row.PY_TAG_AMT) || 0;
    });
    
    const categoryNameMap: Record<string, string> = {
      'wear_current': '의류 당시즌',
      'wear_next': '의류 차시즌',
      'wear_past': '의류 과시즌',
    };
    
    const result = Object.values(categoryMap).map(item => {
      if (!item) return null;
      const cySalesAmt = item.cySalesAmt || 0;
      const pySalesAmt = item.pySalesAmt || 0;
      const cyTagAmt = item.cyTagAmt || 0;
      const pyTagAmt = item.pyTagAmt || 0;
      const yoy = pySalesAmt > 0 ? cySalesAmt / pySalesAmt : null;
      
      // 할인율 계산
      // 당년 할인율 = (1 - 당년 실판누적 / 당년 Tag 누적) × 100
      const discountRate = cyTagAmt > 0 ? (1 - cySalesAmt / cyTagAmt) * 100 : null;
      // 전년 할인율 = (1 - 전년 실판누적 / 전년 Tag 누적) × 100
      const prevDiscountRate = pyTagAmt > 0 ? (1 - pySalesAmt / pyTagAmt) * 100 : null;
      // 할인율 YOY = 당년 할인율 - 전년 할인율
      const discountRateYoy = discountRate !== null && prevDiscountRate !== null 
        ? discountRate - prevDiscountRate 
        : null;
      
      return {
        category: categoryNameMap[item.category] || item.category,
        cySalesAmt,
        pySalesAmt,
        cyTagAmt,
        pyTagAmt,
        discountRate,
        prevDiscountRate,
        discountRateYoy,
        yoy
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
    
    console.log('[getCategorySalesData] 최종 결과:', { 
      count: result.length, 
      result: result.map(r => ({ category: r.category, cySalesAmt: r.cySalesAmt, pySalesAmt: r.pySalesAmt }))
    });
    
    return result;
  } finally {
    await destroyConnection(connection);
  }
}

interface ProductSalesDbRow {
  PRDT_SCS_CD: string;
  PRDT_NM: string;
  CY_SALES_AMT: number;
  PY_SALES_AMT: number;
}

/**
 * 카테고리별 상품 판매 데이터 조회
 */
export async function getCategoryProductSales(
  type: 'tier' | 'region',
  key: string,
  category: string,
  brdCd: string,
  ym: string,
  lastDt: string
): Promise<{ prdtCd: string; prdtNm: string; cySalesAmt: number; pySalesAmt: number; yoy: number | null }[]> {
  const connection = await getConnection();
  
  try {
    const year = parseInt(lastDt.substring(0, 4));
    const month = lastDt.substring(5, 7);
    const day = lastDt.substring(8, 10);
    const cyStartDt = `${year}-${month}-01`;
    const cyEndDt = lastDt;
    const pyStartDt = `${year - 1}-${month}-01`;
    const pyEndDt = `${year - 1}-${month}-${day}`;
    
    // 기준연도 추출 (예: 2025-12 → '25')
    const baseYear = ym.substring(0, 4);
    const baseYearShort = baseYear.substring(2, 4); // '25'
    const nextYearShort = String(parseInt(baseYearShort) + 1).padStart(2, '0'); // '26'
    const prevYearShort = String(parseInt(baseYearShort) - 1).padStart(2, '0'); // '24'
    
    const regionOrTierFilter = type === 'tier' ? 'd.city_tier_nm' : 'd.sale_region_nm';
    
    let categoryFilter = '';
    if (category === 'Shoes') {
      categoryFilter = "UPPER(scs.parent_prdt_kind_nm_en) = 'ACC' AND UPPER(scs.prdt_kind_nm_en) = 'SHOES'";
    } else if (category === 'Headwear') {
      categoryFilter = "UPPER(scs.parent_prdt_kind_nm_en) = 'ACC' AND UPPER(scs.prdt_kind_nm_en) = 'HEADWEAR'";
    } else if (category === 'Bag') {
      categoryFilter = "UPPER(scs.parent_prdt_kind_nm_en) = 'ACC' AND UPPER(scs.prdt_kind_nm_en) = 'BAG'";
    } else if (category === 'Acc_etc') {
      categoryFilter = "UPPER(scs.parent_prdt_kind_nm_en) = 'ACC' AND UPPER(scs.prdt_kind_nm_en) NOT IN ('SHOES', 'HEADWEAR', 'BAG')";
    } else if (category.includes('차시즌') || category.includes('wear_next')) {
      // 차시즌: 당해 데이터는 26, 전년 데이터는 25
      categoryFilter = `(
        (UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
          AND s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}'
          AND LEFT(s.sesn, 2) = '${nextYearShort}')
        OR
        (UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
          AND s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}'
          AND LEFT(s.sesn, 2) = '${baseYearShort}')
      )`;
    } else if (category.includes('당시즌') || category.includes('wear_current')) {
      // 당시즌: 당해 데이터는 25, 전년 데이터는 24
      categoryFilter = `(
        (UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
          AND s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}'
          AND LEFT(s.sesn, 2) = '${baseYearShort}')
        OR
        (UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
          AND s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}'
          AND LEFT(s.sesn, 2) = '${prevYearShort}')
      )`;
    } else if (category.includes('과시즌') || category.includes('wear_past')) {
      // 과시즌: 당해 데이터는 25,26 제외, 전년 데이터는 24,25 제외
      categoryFilter = `(
        (UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
          AND s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}'
          AND LEFT(s.sesn, 2) NOT IN ('${baseYearShort}', '${nextYearShort}'))
        OR
        (UPPER(scs.parent_prdt_kind_nm_en) = 'WEAR' 
          AND s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}'
          AND LEFT(s.sesn, 2) NOT IN ('${prevYearShort}', '${baseYearShort}'))
      )`;
    }
    
    const sql = `
      WITH valid_shops AS (
        SELECT DISTINCT d.shop_id, TRIM(${regionOrTierFilter}) AS key_value
        FROM CHN.dw_shop_wh_detail d
        JOIN FNF.CHN.MST_SHOP_ALL m ON d.shop_id = m.shop_id
        WHERE d.fr_or_cls = 'FR'
          AND d.anlys_shop_type_nm IN ('FO', 'FP')
          AND m.anlys_onoff_cls_nm = 'Offline'
        QUALIFY ROW_NUMBER() OVER (PARTITION BY d.shop_id ORDER BY d.open_dt DESC NULLS LAST) = 1
      )
      SELECT 
        s.prdt_scs_cd AS PRDT_SCS_CD,
        COALESCE(p.prdt_nm_kr, s.prdt_scs_cd) AS PRDT_NM,
        SUM(CASE WHEN s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}' THEN s.sale_amt ELSE 0 END) AS CY_SALES_AMT,
        SUM(CASE WHEN s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}' THEN s.sale_amt ELSE 0 END) AS PY_SALES_AMT
      FROM CHN.dw_sale s
      INNER JOIN valid_shops vs ON s.shop_id = vs.shop_id
      LEFT JOIN FNF.CHN.MST_PRDT_SCS scs ON s.prdt_scs_cd = scs.prdt_scs_cd
      LEFT JOIN CHN.MST_PRDT p ON s.prdt_cd = p.prdt_cd
      WHERE s.brd_cd = ?
        AND TRIM(vs.key_value) = TRIM(?)
        AND (${categoryFilter})
        AND (
          (s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}')
          OR (s.sale_dt >= DATE '${pyStartDt}' AND s.sale_dt <= DATE '${pyEndDt}')
        )
      GROUP BY s.prdt_scs_cd, p.prdt_nm_kr
      HAVING SUM(CASE WHEN s.sale_dt >= DATE '${cyStartDt}' AND s.sale_dt <= DATE '${cyEndDt}' THEN s.sale_amt ELSE 0 END) > 0
      ORDER BY CY_SALES_AMT DESC
      LIMIT 100
    `;
    
    const trimmedKey = key.trim();
    const rows = await executeQuery<ProductSalesDbRow>(connection, sql, [brdCd, trimmedKey]);
    
    // null 체크
    if (!Array.isArray(rows)) {
      console.warn('[getCategoryProductSales] rows가 배열이 아닙니다:', rows);
      return [];
    }
    
    return rows.map(row => {
      if (!row) return null;
      const cySalesAmt = Number(row.CY_SALES_AMT) || 0;
      const pySalesAmt = Number(row.PY_SALES_AMT) || 0;
      const yoy = pySalesAmt > 0 ? cySalesAmt / pySalesAmt : null;
      
      return {
        prdtCd: row.PRDT_SCS_CD || '',
        prdtNm: row.PRDT_NM || '',
        cySalesAmt,
        pySalesAmt,
        yoy
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
  } catch (error) {
    console.error('[getCategoryProductSales] 에러 발생:', error);
    return []; // 에러 시 빈 배열 반환
  } finally {
    await destroyConnection(connection);
  }
}

// ============================================================
// 의류 판매율 데이터 조회
// ============================================================

interface ClothingSalesDbRow {
  ITEM_CD: string;
  ITEM_NM: string;
  CY_PO_QTY: number;
  CY_PO_AMT: number;
  CY_SALES_AMT: number;
  PY_PO_QTY: number;
  PY_PO_AMT: number;
  PY_SALES_AMT: number;
}

/**
 * 의류 판매율 최신 날짜 조회
 * - Snowflake에서 실제 데이터가 있는 최신 날짜를 조회
 */
export async function getClothingSalesLastDt(
  brdCd: string,
  ym: string,
  cySeason?: string,
  pySeason?: string
): Promise<string> {
  const connection = await getConnection();
  try {
    const [year, month] = ym.split('-').map(Number);
    // 시즌 파라미터가 없으면 기본값 사용 (25F, 24F)
    const seasons = cySeason && pySeason ? [cySeason, pySeason] : ['25F', '24F'];
    const sql = `
      SELECT MAX(s.sale_dt) AS LAST_DT
      FROM chn.dw_sale s
      JOIN chn.mst_prdt prdt ON s.prdt_cd = prdt.prdt_cd
      WHERE s.brd_cd = ?
        AND prdt.parent_prdt_kind_cd = 'L'
        AND s.sesn IN (?, ?)
        AND s.sale_dt >= DATE_TRUNC('MONTH', DATE '${year}-${String(month).padStart(2, '0')}-01')
        AND s.sale_dt < DATE_TRUNC('MONTH', DATE '${year}-${String(month).padStart(2, '0')}-01') + INTERVAL '1 MONTH'
    `;
    
    const rows = await executeQuery<{ LAST_DT: string }>(connection, sql, [brdCd, seasons[0], seasons[1]]);
    
    if (rows.length === 0 || !rows[0]?.LAST_DT) {
      return '';
    }
    
    const lastDt = rows[0].LAST_DT;
    // 날짜 형식 변환 (YYYY-MM-DD)
    if (typeof lastDt === 'string') {
      return lastDt.split('T')[0]; // ISO 형식에서 날짜만 추출
    }
    return '';
  } catch (error) {
    console.error('[getClothingSalesLastDt] 에러 발생:', error);
    return '';
  } finally {
    await destroyConnection(connection);
  }
}

/**
 * 브랜드별 의류 판매율 조회 (item 단위)
 * @param cySeason 당해 시즌 (예: '25F')
 * @param pySeason 전년 시즌 (예: '24F')
 */
export async function getClothingSalesData(
  brdCd: string,
  lastDt: string,
  cySeason: string = '25F',
  pySeason: string = '24F'
): Promise<{
  itemCd: string;
  itemNm: string;
  cyRate: number | null;
  pyRate: number | null;
  yoy: number | null;
  cySalesAmt: number;
  pySalesAmt: number;
  cyPoQty: number;
  pyPoQty: number;
}[]> {
  const connection = await getConnection();
  
  try {
    const year = parseInt(lastDt.substring(0, 4));
    const month = lastDt.substring(5, 7);
    const day = lastDt.substring(8, 10);
    const pyLastDt = `${year - 1}-${month}-${day}`;
    
    const sql = `
      WITH po_data AS (
        SELECT 
          ord.item AS item_cd,
          ord.sesn AS sesn_year,
          SUM(ord.ord_qty) AS po_qty,
          SUM(ord.ord_qty * COALESCE(prdt.tag_price_rmb, 0)) AS po_amt
        FROM prcs.dw_ord ord
        LEFT JOIN chn.mst_prdt prdt ON ord.prdt_cd = prdt.prdt_cd
        WHERE ord.po_cntry = '5'
          AND ord.brd_cd = ?
          AND ord.sesn IN (?, ?)
          AND prdt.parent_prdt_kind_cd = 'L'
        GROUP BY ord.item, sesn_year
      ),
      sales_data AS (
        SELECT 
          prdt.item_cd,
          s.sesn AS sesn_year,
          SUM(s.tag_amt) AS sales_amt
        FROM chn.dw_sale s
        JOIN chn.mst_prdt prdt ON s.prdt_cd = prdt.prdt_cd
        WHERE s.brd_cd = ?
          AND s.sesn IN (?, ?)
          AND prdt.parent_prdt_kind_cd = 'L'
          AND (
            (s.sesn = ? AND s.sale_dt <= DATE '${lastDt}')
            OR (s.sesn = ? AND s.sale_dt <= DATE '${pyLastDt}')
          )
        GROUP BY prdt.item_cd, sesn_year
      ),
      item_list AS (
        SELECT DISTINCT item_cd FROM po_data
        UNION
        SELECT DISTINCT item_cd FROM sales_data
      )
      SELECT 
        il.item_cd AS ITEM_CD,
        COALESCE(itm.item_nm, il.item_cd) AS ITEM_NM,
        SUM(CASE WHEN po.sesn_year = ? THEN po.po_qty ELSE 0 END) AS CY_PO_QTY,
        SUM(CASE WHEN po.sesn_year = ? THEN po.po_amt ELSE 0 END) AS CY_PO_AMT,
        SUM(CASE WHEN s.sesn_year = ? THEN s.sales_amt ELSE 0 END) AS CY_SALES_AMT,
        SUM(CASE WHEN po.sesn_year = ? THEN po.po_qty ELSE 0 END) AS PY_PO_QTY,
        SUM(CASE WHEN po.sesn_year = ? THEN po.po_amt ELSE 0 END) AS PY_PO_AMT,
        SUM(CASE WHEN s.sesn_year = ? THEN s.sales_amt ELSE 0 END) AS PY_SALES_AMT
      FROM item_list il
      LEFT JOIN po_data po ON il.item_cd = po.item_cd
      LEFT JOIN sales_data s ON il.item_cd = s.item_cd
      LEFT JOIN prcs.dw_item itm ON il.item_cd = itm.item
      GROUP BY il.item_cd, itm.item_nm
      HAVING SUM(CASE WHEN po.sesn_year = ? THEN po.po_amt ELSE 0 END) > 0 
          OR SUM(CASE WHEN po.sesn_year = ? THEN po.po_amt ELSE 0 END) > 0
          OR SUM(CASE WHEN s.sesn_year = ? THEN s.sales_amt ELSE 0 END) > 0
          OR SUM(CASE WHEN s.sesn_year = ? THEN s.sales_amt ELSE 0 END) > 0
      ORDER BY CY_SALES_AMT DESC
    `;
    
    const rows = await executeQuery<ClothingSalesDbRow>(connection, sql, [
      brdCd, cySeason, pySeason, // po_data
      brdCd, cySeason, pySeason, cySeason, pySeason, // sales_data
      cySeason, cySeason, cySeason, // SELECT CY
      pySeason, pySeason, pySeason, // SELECT PY
      cySeason, pySeason, cySeason, pySeason // HAVING
    ]);
    
    // null 또는 undefined 체크
    if (!rows || !Array.isArray(rows)) {
      console.warn('[getClothingSalesData] rows가 null이거나 배열이 아닙니다:', rows);
      return [];
    }
    
    return rows.map(row => {
      const cyPoAmt = Number(row.CY_PO_AMT) || 0;
      const cySalesAmt = Number(row.CY_SALES_AMT) || 0;
      const pyPoAmt = Number(row.PY_PO_AMT) || 0;
      const pySalesAmt = Number(row.PY_SALES_AMT) || 0;
      const cyPoQty = Number(row.CY_PO_QTY) || 0;
      const pyPoQty = Number(row.PY_PO_QTY) || 0;
      
      const cyRate = cyPoAmt > 0 ? (cySalesAmt / cyPoAmt) * 100 : null;
      const pyRate = pyPoAmt > 0 ? (pySalesAmt / pyPoAmt) * 100 : null;
      const yoy = pyRate && pyRate > 0 ? (cyRate || 0) / pyRate : null;
      
      return {
        itemCd: row.ITEM_CD || '',
        itemNm: row.ITEM_NM || row.ITEM_CD || '',
        cyRate,
        pyRate,
        yoy, // 판매율 YOY
        cySalesAmt,
        pySalesAmt,
        cyPoQty,
        pyPoQty
      };
    });
  } catch (error) {
    console.error('[getClothingSalesData] 에러 발생:', error);
    // 에러 발생 시 빈 배열 반환
    return [];
  } finally {
    await destroyConnection(connection);
  }
}

interface ClothingItemDetailDbRow {
  PRDT_CD: string;
  PRDT_NM: string;
  CY_RATE: number | null;
  CY_SALES_QTY: number;
  CY_STOCK_QTY: number | null;
  PO_QTY: number;
}

/**
 * 의류 아이템별 상품 상세 조회
 * @param season 조회할 시즌 (예: '25F')
 */
export async function getClothingItemDetails(
  brdCd: string,
  itemCd: string,
  lastDt: string,
  season: string = '25F'
): Promise<{
  prdtCd: string;
  prdtNm: string;
  cyRate: number | null;
  cySalesQty: number;
  cyStockQty: number | null;
  poQty: number;
}[]> {
  const connection = await getConnection();
  
  try {
    const sql = `
      SELECT 
        sd.prdt_cd AS PRDT_CD,
        COALESCE(p.prdt_nm_kr, sd.prdt_cd) AS PRDT_NM,
        CASE 
          WHEN po.po_amt > 0 AND po.po_amt IS NOT NULL THEN (sd.sales_amt / po.po_amt) * 100
          ELSE NULL
        END AS CY_RATE,
        sd.sales_qty AS CY_SALES_QTY,
        st.stock_qty_expected AS CY_STOCK_QTY,
        COALESCE(po.po_qty, 0) AS PO_QTY
      FROM (
        SELECT 
          s.prdt_cd,
          SUM(s.qty) AS sales_qty,
          SUM(s.tag_amt) AS sales_amt
        FROM chn.dw_sale s
        INNER JOIN chn.mst_prdt prdt ON s.prdt_cd = prdt.prdt_cd
        WHERE s.brd_cd = ?
          AND prdt.item_cd = ?
          AND s.sesn = ?
          AND prdt.parent_prdt_kind_cd = 'L'
          AND s.sale_dt <= DATE '${lastDt}'
        GROUP BY s.prdt_cd
        HAVING SUM(s.qty) > 0
      ) sd
      LEFT JOIN (
        SELECT 
          ord.prdt_cd,
          SUM(ord.ord_qty) AS po_qty,
          SUM(ord.ord_qty * COALESCE(prdt.tag_price_rmb, 0)) AS po_amt
        FROM prcs.dw_ord ord
        INNER JOIN chn.mst_prdt prdt ON ord.prdt_cd = prdt.prdt_cd
        WHERE ord.po_cntry = '5'
          AND ord.brd_cd = ?
          AND ord.item = ?
          AND ord.sesn = ?
          AND prdt.parent_prdt_kind_cd = 'L'
        GROUP BY ord.prdt_cd
      ) po ON sd.prdt_cd = po.prdt_cd
      LEFT JOIN (
        SELECT 
          st.prdt_cd,
          SUM(st.stock_qty_expected) AS stock_qty_expected
        FROM CHN.dw_stock_d st
        WHERE st.dt = DATE '${lastDt}'
        GROUP BY st.prdt_cd
      ) st ON sd.prdt_cd = st.prdt_cd
      LEFT JOIN chn.mst_prdt p ON sd.prdt_cd = p.prdt_cd
      ORDER BY sd.sales_amt DESC
      LIMIT 1000
    `;
    
    const rows = await executeQuery<ClothingItemDetailDbRow>(connection, sql, [brdCd, itemCd, season, brdCd, itemCd, season]);
    
    return rows.map(row => ({
      prdtCd: row.PRDT_CD || '',
      prdtNm: row.PRDT_NM || row.PRDT_CD || '',
      cyRate: row.CY_RATE !== null ? Number(row.CY_RATE) : null,
      cySalesQty: Number(row.CY_SALES_QTY) || 0,
      cyStockQty: row.CY_STOCK_QTY !== null ? Number(row.CY_STOCK_QTY) : null,
      poQty: Number(row.PO_QTY) || 0
    }));
  } finally {
    await destroyConnection(connection);
  }
}

