import { parse } from 'csv-parse/sync';
import type { AccountMapping, TargetRow, BrandCode, ChannelRowData, ChannelPlanTable } from './types';

// 채널 컬럼 매핑 (브랜드코드_채널명)
const CHANNEL_COLUMNS = {
  onlineDirect: '온라인직영',
  onlineDealer: '온라인대리상',
  offlineDirect: '오프라인직영',
  offlineDealer: '오프라인대리상',
} as const;

/**
 * 계정맵핑.csv 파싱
 */
export function parseAccountMapping(csvContent: string): AccountMapping[] {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;

  return records.map((row) => ({
    level1: row['level1'] || '',
    level2: row['level2'] || '',
    level3: row['level3'] || '',
    item: row['ITEM'] || '',
  }));
}

/**
 * 목표 CSV 파싱 (예상손익_YY.MM.csv)
 * 첫 번째 컬럼은 영문 라벨(무시), 이후 level1/level2/level3, M/I/X/V/W 컬럼
 */
export function parseTargetCsv(csvContent: string): TargetRow[] {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Array<Record<string, string>>;

  return records.map((row) => ({
    level1: row['level1'] || '',
    level2: row['level2'] || '',
    level3: row['level3'] || '',
    M: parseTargetValue(row[' M '] || row['M'] || ''),
    I: parseTargetValue(row['I'] || ''),
    X: parseTargetValue(row['X'] || ''),
    V: parseTargetValue(row['V'] || ''),
    W: parseTargetValue(row['W'] || ''),
  }));
}

/**
 * 목표 값 파싱 (콤마 제거, 숫자 변환)
 */
function parseTargetValue(value: string): number | null {
  if (!value || value.trim() === '' || value.trim() === '-') {
    return null;
  }
  // 콤마, 따옴표 제거
  const cleaned = value.replace(/[",]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * 계정맵핑에서 level1/level2/level3 조건에 맞는 item 목록 반환
 */
export function getItemsByLevel(
  mappings: AccountMapping[],
  level1?: string,
  level2?: string,
  level3?: string
): string[] {
  return mappings
    .filter((m) => {
      if (level1 && m.level1 !== level1) return false;
      if (level2 && m.level2 !== level2) return false;
      if (level3 && m.level3 !== level3) return false;
      return true;
    })
    .map((m) => m.item);
}

/**
 * 목표 CSV에서 특정 level1/level2/level3에 해당하는 목표값 조회
 */
export function getTargetValue(
  targets: TargetRow[],
  brandCode: BrandCode,
  level1?: string,
  level2?: string,
  level3?: string
): number | null {
  const matched = targets.filter((t) => {
    if (level1 && t.level1 !== level1) return false;
    if (level2 && t.level2 !== level2) return false;
    if (level3 && t.level3 !== level3) return false;
    return true;
  });

  if (matched.length === 0) return null;

  // 여러 행이 매칭되면 합산
  let sum = 0;
  let hasValue = false;
  for (const row of matched) {
    const val = row[brandCode];
    if (val !== null) {
      sum += val;
      hasValue = true;
    }
  }
  return hasValue ? sum : null;
}

/**
 * 전체(all) 브랜드의 목표값 조회 (5개 브랜드 합산)
 */
export function getTargetValueAll(
  targets: TargetRow[],
  level1?: string,
  level2?: string,
  level3?: string
): number | null {
  const brandCodes: BrandCode[] = ['M', 'I', 'X', 'V', 'W'];
  let sum = 0;
  let hasValue = false;

  for (const code of brandCodes) {
    const val = getTargetValue(targets, code, level1, level2, level3);
    if (val !== null) {
      sum += val;
      hasValue = true;
    }
  }

  return hasValue ? sum : null;
}

// 내부용 parseTargetValue (기존 함수와 동일하지만 export하지 않음)
function parseTargetValueInternal(value: string | undefined): number | null {
  if (!value || value.trim() === '' || value.trim() === '-') {
    return null;
  }
  const cleaned = value.replace(/[",]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * 채널별 계획 데이터 파싱 (브랜드별 페이지용)
 */
export function parseChannelPlanData(
  csvContent: string | null | undefined,
  brandCode: BrandCode
): ChannelPlanTable {
  // null 또는 빈 문자열 체크 - 빈 데이터 반환 (모든 값이 null)
  if (!csvContent || csvContent.trim() === '') {
    const emptyRow: ChannelRowData = { 
      onlineDirect: null, 
      onlineDealer: null, 
      offlineDirect: null, 
      offlineDealer: null, 
      total: null 
    };
    return {
      tagSale: emptyRow,
      actSaleVatInc: emptyRow,
      actSaleVatIncRate: emptyRow,
      actSaleVatExc: emptyRow,
      cogs: emptyRow,
      cogsRate: emptyRow,
      tagCogsRate: emptyRow,
      grossProfit: emptyRow,
      grossProfitRate: emptyRow,
    };
  }
  
  // BOM 제거
  const cleanContent = csvContent.charCodeAt(0) === 0xFEFF 
    ? csvContent.slice(1) 
    : csvContent;
  
  const records = parse(cleanContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Array<Record<string, string>>;

  // 브랜드 코드에 해당하는 채널 컬럼명 생성
  const getColName = (channel: keyof typeof CHANNEL_COLUMNS) => 
    `${brandCode}_${CHANNEL_COLUMNS[channel]}`;

  // 행 데이터 추출 헬퍼
  const getRowData = (level1: string): ChannelRowData => {
    const row = records.find((r) => r['level1'] === level1);
    if (!row) {
      return { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null };
    }
    
    const onlineDirect = parseTargetValueInternal(row[getColName('onlineDirect')]);
    const onlineDealer = parseTargetValueInternal(row[getColName('onlineDealer')]);
    const offlineDirect = parseTargetValueInternal(row[getColName('offlineDirect')]);
    const offlineDealer = parseTargetValueInternal(row[getColName('offlineDealer')]);
    
    // 총합계는 브랜드 전체 컬럼 사용
    const total = parseTargetValueInternal(row[` ${brandCode} `] || row[brandCode]);
    
    return { onlineDirect, onlineDealer, offlineDirect, offlineDealer, total };
  };

  // 매출원가 합산 (매출원가 + 평가감)
  const getCogsRowData = (): ChannelRowData => {
    const cogsRow = records.find((r) => r['level1'] === '매출원가');
    const evalGainRows = records.filter((r) => r['level1'] === '평가감');
    
    const sumValues = (rows: Array<Record<string, string>>, colName: string): number | null => {
      let sum = 0;
      let hasValue = false;
      for (const row of rows) {
        const val = parseTargetValueInternal(row[colName]);
        if (val !== null) {
          sum += val;
          hasValue = true;
        }
      }
      return hasValue ? sum : null;
    };
    
    const onlineDirect = sumValues([cogsRow, ...evalGainRows].filter(Boolean) as Array<Record<string, string>>, getColName('onlineDirect'));
    const onlineDealer = sumValues([cogsRow, ...evalGainRows].filter(Boolean) as Array<Record<string, string>>, getColName('onlineDealer'));
    const offlineDirect = sumValues([cogsRow, ...evalGainRows].filter(Boolean) as Array<Record<string, string>>, getColName('offlineDirect'));
    const offlineDealer = sumValues([cogsRow, ...evalGainRows].filter(Boolean) as Array<Record<string, string>>, getColName('offlineDealer'));
    const total = sumValues([cogsRow, ...evalGainRows].filter(Boolean) as Array<Record<string, string>>, ` ${brandCode} `) 
      ?? sumValues([cogsRow, ...evalGainRows].filter(Boolean) as Array<Record<string, string>>, brandCode);
    
    return { onlineDirect, onlineDealer, offlineDirect, offlineDealer, total };
  };

  // 기본 데이터 추출
  const tagSale = getRowData('Tag매출');
  const actSaleVatInc = getRowData('실판(V+)');
  const actSaleVatExc = getRowData('실판(V-)');
  const cogs = getCogsRowData();

  // 할인율 계산: 1 - 실판(V+)/Tag매출
  const calcDiscountRate = (vatInc: number | null, tag: number | null): number | null => {
    if (vatInc === null || tag === null || tag === 0) return null;
    return 1 - (vatInc / tag);
  };

  const actSaleVatIncRate: ChannelRowData = {
    onlineDirect: calcDiscountRate(actSaleVatInc.onlineDirect, tagSale.onlineDirect),
    onlineDealer: calcDiscountRate(actSaleVatInc.onlineDealer, tagSale.onlineDealer),
    offlineDirect: calcDiscountRate(actSaleVatInc.offlineDirect, tagSale.offlineDirect),
    offlineDealer: calcDiscountRate(actSaleVatInc.offlineDealer, tagSale.offlineDealer),
    total: calcDiscountRate(actSaleVatInc.total, tagSale.total),
  };

  // 원가율 계산: 매출원가/실판(V-)
  const calcCogsRate = (cogsVal: number | null, vatExc: number | null): number | null => {
    if (cogsVal === null || vatExc === null || vatExc === 0) return null;
    return cogsVal / vatExc;
  };

  const cogsRate: ChannelRowData = {
    onlineDirect: calcCogsRate(cogs.onlineDirect, actSaleVatExc.onlineDirect),
    onlineDealer: calcCogsRate(cogs.onlineDealer, actSaleVatExc.onlineDealer),
    offlineDirect: calcCogsRate(cogs.offlineDirect, actSaleVatExc.offlineDirect),
    offlineDealer: calcCogsRate(cogs.offlineDealer, actSaleVatExc.offlineDealer),
    total: calcCogsRate(cogs.total, actSaleVatExc.total),
  };

  // Tag 대비 원가율 계산: 매출원가 × 1.13 / Tag매출
  const calcTagCogsRate = (cogsVal: number | null, tag: number | null): number | null => {
    if (cogsVal === null || tag === null || tag === 0) return null;
    return (cogsVal * 1.13) / tag;
  };

  const tagCogsRate: ChannelRowData = {
    onlineDirect: calcTagCogsRate(cogs.onlineDirect, tagSale.onlineDirect),
    onlineDealer: calcTagCogsRate(cogs.onlineDealer, tagSale.onlineDealer),
    offlineDirect: calcTagCogsRate(cogs.offlineDirect, tagSale.offlineDirect),
    offlineDealer: calcTagCogsRate(cogs.offlineDealer, tagSale.offlineDealer),
    total: calcTagCogsRate(cogs.total, tagSale.total),
  };

  // 매출총이익 계산: 실판(V-) - 매출원가
  const calcGrossProfit = (vatExc: number | null, cogsVal: number | null): number | null => {
    if (vatExc === null || cogsVal === null) return null;
    return vatExc - cogsVal;
  };

  const grossProfit: ChannelRowData = {
    onlineDirect: calcGrossProfit(actSaleVatExc.onlineDirect, cogs.onlineDirect),
    onlineDealer: calcGrossProfit(actSaleVatExc.onlineDealer, cogs.onlineDealer),
    offlineDirect: calcGrossProfit(actSaleVatExc.offlineDirect, cogs.offlineDirect),
    offlineDealer: calcGrossProfit(actSaleVatExc.offlineDealer, cogs.offlineDealer),
    total: calcGrossProfit(actSaleVatExc.total, cogs.total),
  };

  // 이익율 계산: 매출총이익/실판(V-)
  const calcProfitRate = (profit: number | null, vatExc: number | null): number | null => {
    if (profit === null || vatExc === null || vatExc === 0) return null;
    return profit / vatExc;
  };

  const grossProfitRate: ChannelRowData = {
    onlineDirect: calcProfitRate(grossProfit.onlineDirect, actSaleVatExc.onlineDirect),
    onlineDealer: calcProfitRate(grossProfit.onlineDealer, actSaleVatExc.onlineDealer),
    offlineDirect: calcProfitRate(grossProfit.offlineDirect, actSaleVatExc.offlineDirect),
    offlineDealer: calcProfitRate(grossProfit.offlineDealer, actSaleVatExc.offlineDealer),
    total: calcProfitRate(grossProfit.total, actSaleVatExc.total),
  };

  return {
    tagSale,
    actSaleVatInc,
    actSaleVatIncRate,
    actSaleVatExc,
    cogs,
    cogsRate,
    tagCogsRate,
    grossProfit,
    grossProfitRate,
  };
}

