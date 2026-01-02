import { parse } from 'csv-parse/sync';
import type { BrandCode, ChannelActuals, ChannelRowData } from './types';

// CSV 컬럼명 (실제 CSV 헤더와 일치)
const COLUMN_NAMES = {
  brand: '브랜드',
  tagSale: '판매금액(TAG가) Actual',
  actSaleVatInc: '실판매액(V+) Actual',
  actSaleVatExc: '실판매액(V-) Actual',
  cogs: '실제 매출원가 Actual',
  chnlCd: '유통채널',
  transCd: '거래구분',
} as const;

/**
 * CSV에서 브랜드별 누적 실적 데이터 추출 (item별)
 * @param csvContent CSV 내용
 * @param brandCode 브랜드 코드 (M, I, X, V, W)
 * @param date 기준일 (YYYY-MM-DD, 파일명에서 추출)
 */
export function parseAccumActualsCsv(
  csvContent: string,
  brandCode: BrandCode,
  date: string
): { accum: Record<string, number>; accumDays: number } {
  // BOM 제거
  const cleanContent = csvContent.charCodeAt(0) === 0xFEFF 
    ? csvContent.slice(1) 
    : csvContent;

  let records: Array<Record<string, string>>;
  try {
    records = parse(cleanContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Array<Record<string, string>>;
  } catch (error) {
    console.error('[parseAccumActualsCsv] CSV 파싱 오류:', error);
    return { accum: {}, accumDays: 0 };
  }

  if (records.length === 0) {
    return { accum: {}, accumDays: 0 };
  }

  // item별 합계 계산
  const accum: Record<string, number> = {};
  let tagSale = 0;
  let actSaleVatInc = 0;
  let actSaleVatExc = 0;
  let cogs = 0;

  for (const record of records) {
    const brand = record[COLUMN_NAMES.brand]?.trim();
    // CSV의 브랜드 값은 브랜드 코드 (M, I, X, V, W)
    if (!brand || brand !== brandCode) continue;

    // TAG_SALE_AMT
    const tagSaleVal = record[COLUMN_NAMES.tagSale];
    if (tagSaleVal) {
      const val = parseFloat(tagSaleVal.replace(/,/g, ''));
      if (!isNaN(val)) tagSale += val;
    }

    // ACT_SALE_AMT
    const actSaleVatIncVal = record[COLUMN_NAMES.actSaleVatInc];
    if (actSaleVatIncVal) {
      const val = parseFloat(actSaleVatIncVal.replace(/,/g, ''));
      if (!isNaN(val)) actSaleVatInc += val;
    }

    // VAT_EXC_ACT_SALE_AMT
    const actSaleVatExcVal = record[COLUMN_NAMES.actSaleVatExc];
    if (actSaleVatExcVal) {
      const val = parseFloat(actSaleVatExcVal.replace(/,/g, ''));
      if (!isNaN(val)) actSaleVatExc += val;
    }

    // 매출원가 (ACT_COGS)
    const cogsVal = record[COLUMN_NAMES.cogs];
    if (cogsVal) {
      const val = parseFloat(cogsVal.replace(/,/g, ''));
      if (!isNaN(val)) cogs += val;
    }
  }

  // item별 매핑
  accum['TAG_SALE_AMT'] = tagSale;
  accum['ACT_SALE_AMT'] = actSaleVatInc;
  accum['VAT_EXC_ACT_SALE_AMT'] = actSaleVatExc;
  accum['ACT_COGS'] = cogs;
  accum['ETC_COGS'] = 0; // CSV에 없으므로 0
  
  // 평가감은 CSV에 없으므로 0으로 설정
  accum['STK_ASST_APRCT_AMT'] = 0;
  accum['STK_ASST_APRCT_RVSL_AMT'] = 0;

  // accumDays 계산 (해당 월의 1일부터 파일명 날짜까지)
  const [year, month, day] = date.split('-').map(Number);
  const accumDays = day; // 파일명이 YYYY-MM-DD이므로 해당 날짜까지의 일수

  return { accum, accumDays };
}

/**
 * CSV에서 채널별 누적 실적 데이터 추출
 * @param csvContent CSV 내용
 * @param brandCode 브랜드 코드
 */
export function parseChannelActualsCsv(
  csvContent: string,
  brandCode: BrandCode
): ChannelActuals {
  const emptyRow: ChannelRowData = { onlineDirect: null, onlineDealer: null, offlineDirect: null, offlineDealer: null, total: null };

  // BOM 제거
  const cleanContent = csvContent.charCodeAt(0) === 0xFEFF 
    ? csvContent.slice(1) 
    : csvContent;

  let records: Array<Record<string, string>>;
  try {
    records = parse(cleanContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Array<Record<string, string>>;
  } catch (error) {
    console.error('[parseChannelActualsCsv] CSV 파싱 오류:', error);
    return {
      tagSale: emptyRow,
      actSaleVatInc: emptyRow,
      actSaleVatExc: emptyRow,
      cogs: emptyRow,
    };
  }

  if (records.length === 0) {
    return {
      tagSale: emptyRow,
      actSaleVatInc: emptyRow,
      actSaleVatExc: emptyRow,
      cogs: emptyRow,
    };
  }

  // 채널별 합계
  const channelData: Record<string, { tagSale: number; actSaleVatInc: number; actSaleVatExc: number; cogs: number }> = {
    onlineDirect: { tagSale: 0, actSaleVatInc: 0, actSaleVatExc: 0, cogs: 0 },
    onlineDealer: { tagSale: 0, actSaleVatInc: 0, actSaleVatExc: 0, cogs: 0 },
    offlineDirect: { tagSale: 0, actSaleVatInc: 0, actSaleVatExc: 0, cogs: 0 },
    offlineDealer: { tagSale: 0, actSaleVatInc: 0, actSaleVatExc: 0, cogs: 0 },
  };

  for (const record of records) {
    const brand = record[COLUMN_NAMES.brand]?.trim();
    // CSV의 브랜드 값은 브랜드 코드 (M, I, X, V, W)
    if (!brand || brand !== brandCode) continue;

    const chnlCd = record[COLUMN_NAMES.chnlCd]?.trim();
    const transCd = record[COLUMN_NAMES.transCd]?.trim() || '';

    if (!chnlCd) continue;

    // 채널 분류
    let channel: 'onlineDirect' | 'onlineDealer' | 'offlineDirect' | 'offlineDealer' | null = null;
    
    if (chnlCd === '85') {
      channel = 'onlineDirect';
    } else if (chnlCd === '84' && transCd === '1') {
      channel = 'onlineDealer';
    } else if (['80', '81', '82', '83'].includes(chnlCd)) {
      channel = 'offlineDirect';
    } else if (chnlCd === '84' && transCd === '2') {
      channel = 'offlineDealer';
    }

    if (!channel) continue;

    // 값 추출 및 합산
    const tagSaleVal = record[COLUMN_NAMES.tagSale];
    if (tagSaleVal) {
      const val = parseFloat(tagSaleVal.replace(/,/g, ''));
      if (!isNaN(val)) channelData[channel].tagSale += val;
    }

    const actSaleVatIncVal = record[COLUMN_NAMES.actSaleVatInc];
    if (actSaleVatIncVal) {
      const val = parseFloat(actSaleVatIncVal.replace(/,/g, ''));
      if (!isNaN(val)) channelData[channel].actSaleVatInc += val;
    }

    const actSaleVatExcVal = record[COLUMN_NAMES.actSaleVatExc];
    if (actSaleVatExcVal) {
      const val = parseFloat(actSaleVatExcVal.replace(/,/g, ''));
      if (!isNaN(val)) channelData[channel].actSaleVatExc += val;
    }

    const cogsVal = record[COLUMN_NAMES.cogs];
    if (cogsVal) {
      const val = parseFloat(cogsVal.replace(/,/g, ''));
      if (!isNaN(val)) channelData[channel].cogs += val;
    }
  }

  // 각 항목별 채널 데이터 생성
  const tagSale: ChannelRowData = {
    onlineDirect: channelData.onlineDirect.tagSale > 0 ? channelData.onlineDirect.tagSale : null,
    onlineDealer: channelData.onlineDealer.tagSale > 0 ? channelData.onlineDealer.tagSale : null,
    offlineDirect: channelData.offlineDirect.tagSale > 0 ? channelData.offlineDirect.tagSale : null,
    offlineDealer: channelData.offlineDealer.tagSale > 0 ? channelData.offlineDealer.tagSale : null,
    total: Object.values(channelData).reduce((sum, d) => sum + d.tagSale, 0) || null,
  };

  const actSaleVatInc: ChannelRowData = {
    onlineDirect: channelData.onlineDirect.actSaleVatInc > 0 ? channelData.onlineDirect.actSaleVatInc : null,
    onlineDealer: channelData.onlineDealer.actSaleVatInc > 0 ? channelData.onlineDealer.actSaleVatInc : null,
    offlineDirect: channelData.offlineDirect.actSaleVatInc > 0 ? channelData.offlineDirect.actSaleVatInc : null,
    offlineDealer: channelData.offlineDealer.actSaleVatInc > 0 ? channelData.offlineDealer.actSaleVatInc : null,
    total: Object.values(channelData).reduce((sum, d) => sum + d.actSaleVatInc, 0) || null,
  };

  const actSaleVatExc: ChannelRowData = {
    onlineDirect: channelData.onlineDirect.actSaleVatExc > 0 ? channelData.onlineDirect.actSaleVatExc : null,
    onlineDealer: channelData.onlineDealer.actSaleVatExc > 0 ? channelData.onlineDealer.actSaleVatExc : null,
    offlineDirect: channelData.offlineDirect.actSaleVatExc > 0 ? channelData.offlineDirect.actSaleVatExc : null,
    offlineDealer: channelData.offlineDealer.actSaleVatExc > 0 ? channelData.offlineDealer.actSaleVatExc : null,
    total: Object.values(channelData).reduce((sum, d) => sum + d.actSaleVatExc, 0) || null,
  };

  const cogs: ChannelRowData = {
    onlineDirect: channelData.onlineDirect.cogs > 0 ? channelData.onlineDirect.cogs : null,
    onlineDealer: channelData.onlineDealer.cogs > 0 ? channelData.onlineDealer.cogs : null,
    offlineDirect: channelData.offlineDirect.cogs > 0 ? channelData.offlineDirect.cogs : null,
    offlineDealer: channelData.offlineDealer.cogs > 0 ? channelData.offlineDealer.cogs : null,
    total: Object.values(channelData).reduce((sum, d) => sum + d.cogs, 0) || null,
  };

  return {
    tagSale,
    actSaleVatInc,
    actSaleVatExc,
    cogs,
  };
}

