export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse, PlLine, BrandCode, LineDefinition, AccountMapping, TargetRow, CardSummary, ChartData, BrandSalesData, BrandRadarData, WaterfallData, WeeklyTrendData, ChannelTableData, ChannelRowData, ChannelPlanTable, ChannelActualTable, RetailSalesTableData, RetailSalesRow, TierRegionSalesData, TierRegionSalesRow } from '@/lib/plforecast/types';
import { COST_CALCULATION_MAP } from '@/lib/plforecast/types';
import { lineDefinitions, vatExcludedItem } from '@/lib/plforecast/lineDefinitions';
import { allBrandCodes, isValidBrandCode } from '@/lib/plforecast/brand';
import { accountMappingCsv } from '@/data/plforecast/accountMapping';
import { getTargetCsv } from '@/data/plforecast/targets';
import {
  parseAccountMapping,
  parseTargetCsv,
  getItemsByLevel,
  getTargetValue,
  getTargetValueAll,
  parseChannelPlanData,
} from '@/lib/plforecast/parseCsv';
import { calcYoyRate, calcAchvRate } from '@/lib/plforecast/format';
import {
  getLastDates,
  getPrevYearActuals,
  getAccumActuals,
  getMonthDays,
  getPrevYearMonth,
  getWeeklySales,
  getWeeklyAccumSales,
  getChannelActuals,
  getPrevYearChannelActuals,
  getPrevYearChannelTagSale,
  getPrevYearChannelCogs,
  getPrevYearChannelAccum,
  getPrevYearChannelFullMonth,
  getRetailSalesData,
  getRetailSalesLastDt,
  getTierSalesData,
  getRegionSalesData,
  getClothingSalesData,
  getClothingSalesLastDt,
} from '@/lib/plforecast/snowflake';
import { getRetailPlan, isRetailSalesBrand } from '@/data/plforecast/retailPlan';
import { codeToLabel } from '@/lib/plforecast/brand';

// 계정맵핑 파싱 (캐시)
let accountMappings: AccountMapping[] | null = null;
function getAccountMappings(): AccountMapping[] {
  if (!accountMappings) {
    accountMappings = parseAccountMapping(accountMappingCsv);
  }
  return accountMappings;
}

// 모든 아이템 목록 추출
function getAllItems(mappings: AccountMapping[]): string[] {
  const itemSet = new Set<string>();
  for (const m of mappings) {
    if (m.item) {
      itemSet.add(m.item);
    }
  }
  return Array.from(itemSet);
}

// 라인 정의에서 특정 조건의 item 합산값 계산
function sumByLevel(
  data: Record<string, number>,
  mappings: AccountMapping[],
  level1?: string,
  level2?: string,
  level3?: string,
  excludeItems: string[] = []
): number {
  const items = getItemsByLevel(mappings, level1, level2, level3);
  let sum = 0;
  for (const item of items) {
    if (!excludeItems.includes(item)) {
      sum += data[item] || 0;
    }
  }
  return sum;
}

// 개별 브랜드 데이터 계산
async function calcBrandData(
  ym: string,
  brandCode: BrandCode,
  mappings: AccountMapping[],
  targets: TargetRow[],
  lastDt: string
): Promise<{
  prevYear: Record<string, number>;
  accum: Record<string, number>;
  accumDays: number;
  monthDays: number;
  targets: TargetRow[];
}> {
  const prevYm = getPrevYearMonth(ym);
  const items = getAllItems(mappings);
  const monthDays = getMonthDays(ym);

  // 병렬 조회
  const [prevYear, accumResult] = await Promise.all([
    getPrevYearActuals(prevYm, brandCode, items),
    getAccumActuals(ym, lastDt, brandCode, items),
  ]);

  return {
    prevYear,
    accum: accumResult.accum,
    accumDays: accumResult.accumDays,
    monthDays,
    targets,
  };
}

// 계산된 값들을 저장하는 컨텍스트 (영업이익 계산용)
interface CalcContext {
  vatExcForecast: number; // 실판(V-) 월말예상
  grossProfitForecast: number; // 매출총이익 월말예상
  directCostSumForecast: number; // 직접비 합계 월말예상
  opexSumForecast: number; // 영업비 합계 월말예상
  vatExcTarget: number; // 목표 실판(V-)
}

// 월말예상 계산 헬퍼 함수
function calculateForecast(accum: number | null, accumDays: number, monthDays: number): number | null {
  try {
    if (accum === null || accumDays <= 0) return null;
    if (monthDays <= 0) {
      console.warn('[calculateForecast] monthDays가 0 이하입니다:', { accumDays, monthDays });
      return null;
    }
    return (accum / accumDays) * monthDays;
  } catch (error) {
    console.error('[calculateForecast] 계산 오류:', error, { accum, accumDays, monthDays });
    return null;
  }
}

// PlLine 빌드 (재귀)
function buildPlLine(
  def: LineDefinition,
  data: {
    prevYear: Record<string, number>;
    accum: Record<string, number>;
    accumDays: number;
    monthDays: number;
  },
  mappings: AccountMapping[],
  targets: TargetRow[],
  brandCode: BrandCode | 'all',
  context: CalcContext,
  channelData?: {
    prevYearChannel?: { onlineDirect: number; onlineDealer: number; offlineDirect: number; offlineDealer: number };
    targetChannel?: ChannelRowData;
    accumChannel?: ChannelRowData;
    targetChannelVatExc?: ChannelRowData;
    accumChannelVatExc?: ChannelRowData;
    prevYearChannelTagSale?: { onlineDirect: number; onlineDealer: number; offlineDirect: number; offlineDealer: number };
    targetChannelTagSale?: ChannelRowData;
    accumChannelTagSale?: ChannelRowData;
    prevYearChannelCogs?: { onlineDirect: number; onlineDealer: number; offlineDirect: number; offlineDealer: number };
    targetChannelCogs?: ChannelRowData;
    accumChannelCogs?: ChannelRowData;
    prevYearChannelAccum?: { tagSale: ChannelRowData; actSaleVatInc: ChannelRowData; actSaleVatExc: ChannelRowData; cogs: ChannelRowData };
    prevYearChannelFullMonth?: { tagSale: ChannelRowData; actSaleVatInc: ChannelRowData; actSaleVatExc: ChannelRowData; cogs: ChannelRowData };
  }
): PlLine {
  const getTarget = brandCode === 'all'
    ? (l1?: string, l2?: string, l3?: string) => getTargetValueAll(targets, l1, l2, l3)
    : (l1?: string, l2?: string, l3?: string) => getTargetValue(targets, brandCode, l1, l2, l3);

  let prevYear: number | null = null;
  let prevYearAccum: number | null = null;
  let prevYearProgressRate: number | null = null;
  let accum: number | null = null;
  let target: number | null = null;
  let forecast: number | null = null;

  // 대리상지원금에서 제외할 item들
  const dealerSupportItems = ['OUTSRC_PROC_CST', 'SMPL_BUY_CST', 'MILE_SALE_AMT'];

  // 타입별 계산
  switch (def.type) {
    case 'channelVatInc':
      // 채널별 실판(V+)
      if (channelData) {
        // id 형식: 'act-sale-vat-inc-online-direct'
        const channelMap: Record<string, 'onlineDirect' | 'onlineDealer' | 'offlineDirect' | 'offlineDealer'> = {
          'act-sale-vat-inc-online-direct': 'onlineDirect',
          'act-sale-vat-inc-online-dealer': 'onlineDealer',
          'act-sale-vat-inc-offline-direct': 'offlineDirect',
          'act-sale-vat-inc-offline-dealer': 'offlineDealer',
        };
        const channel = channelMap[def.id];
        
        if (channel) {
          prevYear = channelData.prevYearChannel?.[channel] || 0;
          prevYearAccum = channelData.prevYearChannelAccum?.actSaleVatInc[channel] ?? null;
          const prevYearFullMonth = channelData.prevYearChannelFullMonth?.actSaleVatInc[channel] ?? null;
          accum = channelData.accumChannel?.[channel] ?? null;
          target = channelData.targetChannel?.[channel] ?? null;
          
          // 전년 진척률 계산
          if (prevYearFullMonth !== null && prevYearFullMonth !== 0 && prevYearAccum !== null) {
            prevYearProgressRate = prevYearAccum / prevYearFullMonth;
          } else {
            prevYearProgressRate = null;
          }
          
          // 월말예상 계산
          if (channel === 'onlineDealer' || channel === 'offlineDealer') {
            // 대리상: 목표 그대로
            forecast = target;
          } else {
            // 직영: 전년 진척률 기반
            if (prevYearProgressRate !== null && prevYearProgressRate !== 0 && accum !== null) {
              forecast = accum / prevYearProgressRate;
            } else {
              forecast = null;
            }
          }
        }
      }
      break;

    case 'channelTagSale':
      // 채널별 Tag매출
      if (channelData) {
        // id 형식: 'tag-sale-online-direct'
        const channelMap: Record<string, 'onlineDirect' | 'onlineDealer' | 'offlineDirect' | 'offlineDealer'> = {
          'tag-sale-online-direct': 'onlineDirect',
          'tag-sale-online-dealer': 'onlineDealer',
          'tag-sale-offline-direct': 'offlineDirect',
          'tag-sale-offline-dealer': 'offlineDealer',
        };
        const channel = channelMap[def.id];
        
        if (channel) {
          prevYear = channelData.prevYearChannelTagSale?.[channel] || 0;
          prevYearAccum = channelData.prevYearChannelAccum?.tagSale[channel] ?? null;
          const prevYearFullMonth = channelData.prevYearChannelFullMonth?.tagSale[channel] ?? null;
          accum = channelData.accumChannelTagSale?.[channel] ?? null;
          target = channelData.targetChannelTagSale?.[channel] ?? null;
          
          // 전년 진척률 계산
          if (prevYearFullMonth !== null && prevYearFullMonth !== 0 && prevYearAccum !== null) {
            prevYearProgressRate = prevYearAccum / prevYearFullMonth;
          } else {
            prevYearProgressRate = null;
          }
          
          // 월말예상 계산
          if (channel === 'onlineDealer' || channel === 'offlineDealer') {
            // 대리상: 목표 그대로
            forecast = target;
          } else {
            // 직영: 전년 진척률 기반
            if (prevYearProgressRate !== null && prevYearProgressRate !== 0 && accum !== null) {
              forecast = accum / prevYearProgressRate;
            } else {
              forecast = null;
            }
          }
        }
      }
      break;

    case 'channelCogs':
      // 채널별 매출원가
      if (channelData) {
        // id 형식: 'cogs-online-direct'
        const channelMap: Record<string, 'onlineDirect' | 'onlineDealer' | 'offlineDirect' | 'offlineDealer'> = {
          'cogs-online-direct': 'onlineDirect',
          'cogs-online-dealer': 'onlineDealer',
          'cogs-offline-direct': 'offlineDirect',
          'cogs-offline-dealer': 'offlineDealer',
        };
        const channel = channelMap[def.id];
        
        if (channel) {
          prevYear = channelData.prevYearChannelCogs?.[channel] || 0;
          prevYearAccum = channelData.prevYearChannelAccum?.cogs[channel] ?? null;
          const prevYearFullMonth = channelData.prevYearChannelFullMonth?.cogs[channel] ?? null;
          accum = channelData.accumChannelCogs?.[channel] ?? null;
          target = channelData.targetChannelCogs?.[channel] ?? null;
          
          // 전년 진척률 계산
          if (prevYearFullMonth !== null && prevYearFullMonth !== 0 && prevYearAccum !== null) {
            prevYearProgressRate = prevYearAccum / prevYearFullMonth;
          } else {
            prevYearProgressRate = null;
          }
          
          // 월말예상 계산
          if (channel === 'onlineDealer' || channel === 'offlineDealer') {
            // 대리상: 목표 그대로
            forecast = target;
          } else {
            // 직영: Tag대비 원가율 기반
            const tagSaleAccum = channelData.accumChannelTagSale?.[channel] ?? null;
            const tagSaleTarget = channelData.targetChannelTagSale?.[channel] ?? null;
            const tagSalePrevYearAccum = channelData.prevYearChannelAccum?.tagSale[channel] ?? null;
            const tagSalePrevYearFullMonth = channelData.prevYearChannelFullMonth?.tagSale[channel] ?? null;
            
            // Tag매출 월말예상 계산
            let tagSaleForecast: number | null = null;
            if (tagSalePrevYearFullMonth !== null && tagSalePrevYearFullMonth !== 0 && tagSalePrevYearAccum !== null) {
              const tagSaleProgressRate = tagSalePrevYearAccum / tagSalePrevYearFullMonth;
              if (tagSaleProgressRate !== 0 && tagSaleAccum !== null) {
                tagSaleForecast = tagSaleAccum / tagSaleProgressRate;
              }
            }
            
            // Tag매출 누적이 0이거나 월말예상이 null이면 null
            if (tagSaleAccum === null || tagSaleAccum === 0 || tagSaleForecast === null || accum === null) {
              forecast = null;
            } else {
              // Tag대비 원가율 = (매출원가 누적 × 1.13) / Tag매출 누적
              const tagCogsRate = (accum * 1.13) / tagSaleAccum;
              // 월말예상 매출원가 = (Tag대비 원가율 × Tag매출 월말예상) / 1.13
              forecast = (tagCogsRate * tagSaleForecast) / 1.13;
            }
          }
        }
      }
      break;

    case 'vatExcluded':
      // VAT 제외 실판
      prevYear = data.prevYear[vatExcludedItem] || 0;
      accum = data.accum[vatExcludedItem] || 0;
      target = getTarget('실판(V-)', '실판(V-)', '실판(V-)');
      forecast = calculateForecast(accum, data.accumDays, data.monthDays);
      
      // 컨텍스트에 저장 (직접비 계산에 사용)
      if (forecast !== null) {
        context.vatExcForecast = forecast;
      }
      if (target !== null) {
        context.vatExcTarget = target;
      }
      break;

    case 'cogsSum':
      // 매출원가 합계 (자식 합산)
      if (def.children) {
        const childLines = def.children.map((child) =>
          buildPlLine(child, data, mappings, targets, brandCode, context, channelData)
        );
        prevYear = childLines.reduce((sum, c) => sum + (c.prevYear || 0), 0);
        accum = childLines.reduce((sum, c) => sum + (c.accum || 0), 0);
        target = childLines.reduce((sum, c) => sum + (c.target || 0), 0);
        forecast = childLines.reduce((sum, c) => sum + (c.forecast || 0), 0);
        
        // prevYearAccum과 prevYearProgressRate 합산
        const validPrevYearAccum = childLines.filter(c => c.prevYearAccum !== null && c.prevYearAccum !== undefined);
        if (validPrevYearAccum.length > 0) {
          prevYearAccum = validPrevYearAccum.reduce((sum, c) => sum + (c.prevYearAccum || 0), 0);
        } else {
          prevYearAccum = null;
        }
        
        const prevYearFullMonthSum = childLines.reduce((sum, c) => {
          if (c.prevYearAccum != null && c.prevYearProgressRate != null && c.prevYearProgressRate !== 0) {
            return sum + (c.prevYearAccum / c.prevYearProgressRate);
          }
          return sum;
        }, 0);
        if (prevYearFullMonthSum !== 0 && prevYearAccum !== null) {
          prevYearProgressRate = prevYearAccum / prevYearFullMonthSum;
        } else {
          prevYearProgressRate = null;
        }

        return {
          id: def.id,
          label: def.label,
          level: def.level,
          isParent: def.isParent,
          isCalculated: def.isCalculated,
          prevYear,
          prevYearAccum,
          prevYearProgressRate,
          target,
          accum,
          forecast,
          yoyRate: calcYoyRate(forecast, prevYear),
          achvRate: calcAchvRate(forecast, target),
          defaultExpanded: def.defaultExpanded,
          children: childLines,
        };
      }
      break;

    case 'directCostSum':
      // 직접비 합계 (자식 합산, 매출 연동 계산)
      if (def.children) {
        const childLines = def.children.map((child) =>
          buildPlLine(child, data, mappings, targets, brandCode, context, channelData)
        );
        prevYear = childLines.reduce((sum, c) => sum + (c.prevYear || 0), 0);
        accum = childLines.reduce((sum, c) => sum + (c.accum || 0), 0);
        target = childLines.reduce((sum, c) => sum + (c.target || 0), 0);
        forecast = childLines.reduce((sum, c) => sum + (c.forecast || 0), 0);

        // 컨텍스트에 저장 (영업이익 계산용)
        context.directCostSumForecast = forecast || 0;

        return {
          id: def.id,
          label: def.label,
          level: def.level,
          isParent: def.isParent,
          isCalculated: def.isCalculated,
          prevYear,
          target,
          accum,
          forecast,
          yoyRate: calcYoyRate(forecast, prevYear),
          achvRate: calcAchvRate(forecast, target),
          defaultExpanded: def.defaultExpanded,
          children: childLines,
        };
      }
      break;

    case 'opexSum':
      // 영업비 합계 (자식 합산, 목표 그대로 사용)
      if (def.children) {
        const childLines = def.children.map((child) =>
          buildPlLine(child, data, mappings, targets, brandCode, context, channelData)
        );
        prevYear = childLines.reduce((sum, c) => sum + (c.prevYear || 0), 0);
        accum = childLines.reduce((sum, c) => sum + (c.accum || 0), 0);
        target = childLines.reduce((sum, c) => sum + (c.target || 0), 0);
        // 영업비 월말예상 = 목표 그대로 (고정비)
        forecast = target;

        // 컨텍스트에 저장 (영업이익 계산용)
        context.opexSumForecast = forecast || 0;

        return {
          id: def.id,
          label: def.label,
          level: def.level,
          isParent: def.isParent,
          isCalculated: def.isCalculated,
          prevYear,
          target,
          accum,
          forecast,
          yoyRate: calcYoyRate(forecast, prevYear),
          achvRate: calcAchvRate(forecast, target),
          defaultExpanded: def.defaultExpanded,
          children: childLines,
        };
      }
      break;

    case 'grossProfit':
      // 매출총이익 = 실판(V-) - 매출원가합계
      const vatExcPrevYear = data.prevYear[vatExcludedItem] || 0;
      const vatExcAccum = data.accum[vatExcludedItem] || 0;

      // 매출원가 합계 계산
      const cogsPrevYear = sumByLevel(data.prevYear, mappings, '매출원가')
        + sumByLevel(data.prevYear, mappings, '평가감');
      const cogsAccum = sumByLevel(data.accum, mappings, '매출원가')
        + sumByLevel(data.accum, mappings, '평가감');

      prevYear = vatExcPrevYear - cogsPrevYear;
      accum = vatExcAccum - cogsAccum;

      // 목표 계산
      const vatExcTargetGP = getTarget('실판(V-)', '실판(V-)', '실판(V-)') || 0;
      const cogsTarget = (getTarget('매출원가', '매출원가', '매출원가') || 0)
        + (getTarget('평가감') || 0);
      target = vatExcTargetGP - cogsTarget;

      const vatExcForecastGP = calculateForecast(vatExcAccum, data.accumDays, data.monthDays) || 0;
      const cogsForecast = calculateForecast(cogsAccum, data.accumDays, data.monthDays) || 0;
      forecast = vatExcForecastGP - cogsForecast;

      // 컨텍스트에 저장 (영업이익 계산용)
      context.grossProfitForecast = forecast;
      break;

    case 'directProfit':
      // 직접이익 = 매출총이익 - 직접비합계
      // 전년, 누적 계산
      const vatExcDPPY = data.prevYear[vatExcludedItem] || 0;
      const vatExcDPAcc = data.accum[vatExcludedItem] || 0;
      
      const cogsDPPY = sumByLevel(data.prevYear, mappings, '매출원가')
        + sumByLevel(data.prevYear, mappings, '평가감');
      const cogsDPAcc = sumByLevel(data.accum, mappings, '매출원가')
        + sumByLevel(data.accum, mappings, '평가감');
      
      const directDPPY = sumByLevel(data.prevYear, mappings, '직접비', undefined, undefined, dealerSupportItems);
      const directDPAcc = sumByLevel(data.accum, mappings, '직접비', undefined, undefined, dealerSupportItems);
      
      prevYear = (vatExcDPPY - cogsDPPY) - directDPPY;
      accum = (vatExcDPAcc - cogsDPAcc) - directDPAcc;
      
      // 목표 계산
      const vatExcDPTgt = getTarget('실판(V-)', '실판(V-)', '실판(V-)') || 0;
      const cogsDPTgt = (getTarget('매출원가', '매출원가', '매출원가') || 0)
        + (getTarget('평가감') || 0);
      const directDPTgt = getTarget('직접비') || 0;
      target = (vatExcDPTgt - cogsDPTgt) - directDPTgt;
      
      // 월말예상 = 매출총이익 월말예상 - 직접비 월말예상
      forecast = context.grossProfitForecast - context.directCostSumForecast;
      break;

    case 'operatingProfit':
      // 영업이익 = 매출총이익 - 직접비합계 - 영업비합계
      // 전년, 누적도 동일한 로직으로 계산
      const vatExcPY = data.prevYear[vatExcludedItem] || 0;
      const vatExcAcc = data.accum[vatExcludedItem] || 0;
      
      const cogsPY = sumByLevel(data.prevYear, mappings, '매출원가')
        + sumByLevel(data.prevYear, mappings, '평가감');
      const cogsAcc = sumByLevel(data.accum, mappings, '매출원가')
        + sumByLevel(data.accum, mappings, '평가감');
      
      const directPY = sumByLevel(data.prevYear, mappings, '직접비', undefined, undefined, dealerSupportItems);
      const directAcc = sumByLevel(data.accum, mappings, '직접비', undefined, undefined, dealerSupportItems);
      
      const opexPY = sumByLevel(data.prevYear, mappings, '영업비');
      const opexAcc = sumByLevel(data.accum, mappings, '영업비');
      
      prevYear = (vatExcPY - cogsPY) - directPY - opexPY;
      accum = (vatExcAcc - cogsAcc) - directAcc - opexAcc;
      
      // 목표
      const vatExcTgt = getTarget('실판(V-)', '실판(V-)', '실판(V-)') || 0;
      const cogsTgt = (getTarget('매출원가', '매출원가', '매출원가') || 0)
        + (getTarget('평가감') || 0);
      const directTgt = getTarget('직접비') || 0;
      const opexTgt = getTarget('영업비') || 0;
      target = (vatExcTgt - cogsTgt) - directTgt - opexTgt;
      
      // 월말예상 = 매출총이익 월말예상 - 직접비 월말예상 - 영업비 월말예상
      forecast = context.grossProfitForecast - context.directCostSumForecast - context.opexSumForecast;
      break;

    default:
      // 일반 항목 (level1/level2/level3 조건으로 합산)
      if (def.level1) {
        prevYear = sumByLevel(data.prevYear, mappings, def.level1, def.level2, def.level3, dealerSupportItems);
        accum = sumByLevel(data.accum, mappings, def.level1, def.level2, def.level3, dealerSupportItems);
        target = getTarget(def.level1, def.level2, def.level3);
        
        // 직접비/영업비: level3 기준으로 고정비/변동비 판단
        if (def.costCategory === 'direct' || def.costCategory === 'opex') {
          const level3Key = def.level3 || def.level2 || '';
          const calcInfo = COST_CALCULATION_MAP[level3Key];
          
          // 영업비는 모두 고정비 (매핑에 없으면 고정비로 처리)
          if (def.costCategory === 'opex' || !calcInfo || calcInfo.type === 'fixed') {
            // 고정비: 목표 그대로
            forecast = target;
          } else if (calcInfo.type === 'variable' && calcInfo.channel && channelData) {
            // 변동비: 목표 비용 ÷ 목표 실판(V-) × 월말예상 실판(V-)
            const channel = calcInfo.channel;
            const targetVatExc = channel === 'total' 
              ? (channelData.targetChannelVatExc?.total || null)
              : (channelData.targetChannelVatExc?.[channel] || null);
            const accumVatExc = channel === 'total'
              ? (channelData.accumChannelVatExc?.total || null)
              : (channelData.accumChannelVatExc?.[channel] || null);
            
            // 월말예상 실판(V-) = 누적 / 누적일수 × 월일수
            const forecastVatExc = calculateForecast(accumVatExc, data.accumDays, data.monthDays);
            
            if (target !== null && targetVatExc !== null && targetVatExc !== 0 && forecastVatExc !== null) {
              forecast = (target / targetVatExc) * forecastVatExc;
            } else if (target !== null && targetVatExc === 0 && forecastVatExc !== null) {
              // 목표 실판(V-)이 0인 경우 처리
              forecast = null;
            } else {
              forecast = null;
            }
          } else {
            // 변동비인데 채널 데이터가 없거나 채널 정보가 없으면 null
            forecast = null;
          }
        }
        // 기타: 일할 계산
        else {
          forecast = calculateForecast(accum, data.accumDays, data.monthDays);
        }
      }
      break;
  }

  // 자식이 있으면 재귀 빌드
  let children: PlLine[] | undefined;
  if (def.children && def.type !== 'cogsSum' && def.type !== 'directCostSum' && def.type !== 'opexSum') {
    children = def.children.map((child) =>
      buildPlLine(child, data, mappings, targets, brandCode, context, channelData)
    );
    
    // Tag매출, 실판(V+), 매출원가 합계 부모 행의 경우 자식들의 합계로 계산
    if ((def.id === 'tag-sale' || def.id === 'act-sale-vat-inc' || def.id === 'cogs-sum') && children.length > 0) {
      prevYear = children.reduce((sum, c) => sum + (c.prevYear || 0), 0);
      accum = children.reduce((sum, c) => sum + (c.accum || 0), 0);
      target = children.reduce((sum, c) => sum + (c.target || 0), 0);
      forecast = children.reduce((sum, c) => sum + (c.forecast || 0), 0);
      
      // prevYearAccum과 prevYearProgressRate도 합산
      const validPrevYearAccum = children.filter(c => c.prevYearAccum !== null && c.prevYearAccum !== undefined);
      if (validPrevYearAccum.length > 0) {
        prevYearAccum = validPrevYearAccum.reduce((sum, c) => sum + (c.prevYearAccum || 0), 0);
      } else {
        prevYearAccum = null;
      }
      
      const validPrevYearProgressRate = children.filter(c => c.prevYearProgressRate !== null && c.prevYearProgressRate !== undefined);
      if (validPrevYearProgressRate.length > 0) {
        // 진척률은 평균이 아니라 합산된 prevYearAccum과 prevYearFullMonth로 계산
        const prevYearFullMonthSum = children.reduce((sum, c) => {
          if (c.prevYearAccum != null && c.prevYearProgressRate != null && c.prevYearProgressRate !== 0) {
            return sum + (c.prevYearAccum / c.prevYearProgressRate);
          }
          return sum;
        }, 0);
        if (prevYearFullMonthSum !== 0 && prevYearAccum !== null) {
          prevYearProgressRate = prevYearAccum / prevYearFullMonthSum;
        } else {
          prevYearProgressRate = null;
        }
      } else {
        prevYearProgressRate = null;
      }
    }
  }

  return {
    id: def.id,
    label: def.label,
    level: def.level,
    isParent: def.isParent,
    isCalculated: def.isCalculated,
    prevYear,
    prevYearAccum,
    prevYearProgressRate,
    target,
    accum,
    forecast,
    yoyRate: calcYoyRate(forecast, prevYear),
    achvRate: calcAchvRate(forecast, target),
    defaultExpanded: def.defaultExpanded,
    children,
  };
}

// 카드 요약 데이터 빌드
function buildCardSummary(
  lines: PlLine[],
  data: {
    prevYear: Record<string, number>;
    accum: Record<string, number>;
    accumDays: number;
    monthDays: number;
  },
  context: CalcContext
): CardSummary {
  // lines에서 필요한 데이터 추출
  const findLine = (id: string) => lines.find((l) => l.id === id);
  
  const tagSale = findLine('tag-sale');
  const actSaleVatInc = findLine('act-sale-vat-inc'); // 실판(V+)
  const actSaleVatExc = findLine('act-sale-vat-exc'); // 실판(V-)
  const grossProfit = findLine('gross-profit');
  const directCostSum = findLine('direct-cost-sum');
  const opexSum = findLine('opex-sum');
  const operatingProfit = findLine('operating-profit');

  // 직접이익 = 매출총이익 - 직접비
  const directProfitAccum = (grossProfit?.accum || 0) - (directCostSum?.accum || 0);
  const directProfitForecast = (grossProfit?.forecast || 0) - (directCostSum?.forecast || 0);
  const directProfitPrevYear = (grossProfit?.prevYear || 0) - (directCostSum?.prevYear || 0);
  const directProfitTarget = (grossProfit?.target || 0) - (directCostSum?.target || 0);

  // 카드1: 실판매출(할인율) - 실판(V+) 사용
  // 할인율 = 1 - 실판(V+)/Tag매출
  const actSaleAccum = actSaleVatInc?.accum || 0;
  const actSaleForecast = actSaleVatInc?.forecast || 0;
  const actSalePrevYear = actSaleVatInc?.prevYear || 0;
  const tagSaleAccum = tagSale?.accum || 0;
  const tagSaleForecast = tagSale?.forecast || 0;

  const discountRateAccum = tagSaleAccum > 0 ? 1 - (actSaleAccum / tagSaleAccum) : null;
  const discountRateForecast = tagSaleForecast > 0 ? 1 - (actSaleForecast / tagSaleForecast) : null;

  // 실판(V-) 기준 이익율
  const vatExcAccum = actSaleVatExc?.accum || 0;
  const vatExcForecast = actSaleVatExc?.forecast || 0;

  // 직접이익 이익율
  const directProfitRateAccum = vatExcAccum > 0 ? directProfitAccum / vatExcAccum : null;
  const directProfitRateForecast = vatExcForecast > 0 ? directProfitForecast / vatExcForecast : null;

  // 영업이익 이익율
  const opProfitAccum = operatingProfit?.accum || 0;
  const opProfitForecast = operatingProfit?.forecast || 0;
  const opProfitRateAccum = vatExcAccum > 0 ? opProfitAccum / vatExcAccum : null;
  const opProfitRateForecast = vatExcForecast > 0 ? opProfitForecast / vatExcForecast : null;

  // 직접이익 진척률 = 누적/목표
  const directProfitProgressAccum = directProfitTarget !== 0 ? directProfitAccum / directProfitTarget : null;
  const directProfitProgressForecast = directProfitTarget !== 0 ? directProfitForecast / directProfitTarget : null;

  return {
    // 카드1: 실판매출(할인율)
    actSale: {
      accumValue: actSaleAccum,
      accumRate: discountRateAccum,
      forecastValue: actSaleForecast,
      forecastRate: discountRateForecast,
      targetRate: actSaleVatInc?.achvRate ?? null,
      yoyRate: actSaleVatInc?.yoyRate ?? null,
    },
    // 카드2: 직접이익(이익율)
    directProfit: {
      accumValue: directProfitAccum,
      accumRate: directProfitRateAccum,
      forecastValue: directProfitForecast,
      forecastRate: directProfitRateForecast,
      targetRate: directProfitTarget !== 0 ? directProfitForecast / directProfitTarget : null,
      yoyRate: directProfitPrevYear !== 0 ? (directProfitForecast / directProfitPrevYear) - 1 : null,
    },
    // 카드3: 영업이익(이익율)
    operatingProfit: {
      accumValue: opProfitAccum,
      accumRate: opProfitRateAccum,
      forecastValue: opProfitForecast,
      forecastRate: opProfitRateForecast,
      targetRate: operatingProfit?.achvRate ?? null,
      yoyRate: operatingProfit?.yoyRate ?? null,
    },
    // 카드4: 직접이익 진척률
    directProfitProgress: {
      accumRate: directProfitProgressAccum,
      forecastRate: directProfitProgressForecast,
    },
  };
}

// 차트 데이터 빌드 (전체 페이지용)
async function buildChartData(
  ym: string,
  lastDt: string,
  brandDataMap: Map<BrandCode, { lines: PlLine[]; prevYear: Record<string, number>; accum: Record<string, number> }>,
  allLines: PlLine[],
  brandCodes: BrandCode[]
): Promise<ChartData> {
  // 1. 브랜드별 매출/영업이익
  const brandSales: BrandSalesData[] = [];
  const brandRadar: BrandRadarData[] = [];
  
  for (const code of brandCodes) {
    const data = brandDataMap.get(code);
    if (data) {
      const actSale = data.lines.find(l => l.id === 'act-sale-vat-inc');
      const opProfit = data.lines.find(l => l.id === 'operating-profit');
      
      brandSales.push({
        brand: codeToLabel(code),
        brandCode: code,
        sales: actSale?.forecast || 0,
        operatingProfit: opProfit?.forecast || 0,
      });
      
      brandRadar.push({
        brand: codeToLabel(code),
        target: (actSale?.achvRate || 0) * 100,
        prevYear: ((actSale?.yoyRate || 0) + 1) * 100,
      });
    }
  }
  
  // 2. Waterfall 차트 데이터 (7단계)
  const findLine = (id: string) => allLines.find(l => l.id === id);
  const actSaleVatExc = findLine('act-sale-vat-exc');
  const cogsSum = findLine('cogs-sum');
  const grossProfit = findLine('gross-profit');
  const directCostSum = findLine('direct-cost-sum');
  const opexSum = findLine('opex-sum');
  const operatingProfit = findLine('operating-profit');
  
  // 직접이익 계산
  const directProfitForecast = (grossProfit?.forecast || 0) - (directCostSum?.forecast || 0);
  
  const waterfall: WaterfallData[] = [
    { name: '실판매출', value: actSaleVatExc?.forecast || 0, type: 'positive' },
    { name: '매출원가', value: -(cogsSum?.forecast || 0), type: 'negative' },
    { name: '매출총이익', value: grossProfit?.forecast || 0, type: 'subtotal' },
    { name: '직접비', value: -(directCostSum?.forecast || 0), type: 'negative' },
    { name: '직접이익', value: directProfitForecast, type: 'subtotal' },
    { name: '영업비', value: -(opexSum?.forecast || 0), type: 'negative' },
    { name: '영업이익', value: operatingProfit?.forecast || 0, type: 'total' },
  ];
  
  // 3. 주차별/누적 추이 데이터 (최근 4주)
  let weeklyTrend: WeeklyTrendData[] = [];
  let weeklyAccumTrend: WeeklyTrendData[] = [];
  
  try {
    // 주차별 매출 (각 주의 매출)
    console.log('Fetching weekly sales for lastDt:', lastDt);
    const weeklyData = await getWeeklySales(lastDt, brandCodes);
    console.log('Weekly data result:', JSON.stringify(weeklyData));
    weeklyTrend = weeklyData.map(d => {
      const startLabel = d.startDt.substring(5, 10).replace('-', '/');
      const endLabel = d.endDt.substring(5, 10).replace('-', '/');
      return {
        label: `${startLabel}~${endLabel}`,
        curValue: d.curSale,
        prevValue: d.prevSale,
      };
    });
    
    // 누적 매출 (4주 누적)
    const accumData = await getWeeklyAccumSales(lastDt, brandCodes);
    console.log('Accum data result:', JSON.stringify(accumData));
    weeklyAccumTrend = accumData.map(d => {
      const startLabel = d.startDt.substring(5, 10).replace('-', '/');
      const endLabel = d.endDt.substring(5, 10).replace('-', '/');
      return {
        label: `${startLabel}~${endLabel}`,
        curValue: d.curAccum,
        prevValue: d.prevAccum,
      };
    });
  } catch (err) {
    console.error('Error fetching trend data:', err);
  }
  
  return {
    brandSales,
    brandRadar,
    waterfall,
    weeklyTrend,
    weeklyAccumTrend,
  };
}

// 채널별 테이블 데이터 빌드 (브랜드별 페이지용)
async function buildChannelTableData(
  ym: string,
  lastDt: string,
  brandCode: BrandCode,
  targetCsv: string | null
): Promise<ChannelTableData> {
  // 1. 계획 데이터 (CSV) - null이면 모든 값이 null인 plan 반환
  const plan: ChannelPlanTable = parseChannelPlanData(targetCsv, brandCode);
  
  // 2. 실적 데이터 (Snowflake)
  const actuals = await getChannelActuals(ym, lastDt, brandCode);
  
  // 3. 진척률 계산 헬퍼
  const calcProgressRate = (actual: number | null, target: number | null): number | null => {
    if (actual === null || target === null || target === 0) return null;
    return actual / target;
  };
  
  // 4. 할인율 계산: 1 - 실판(V+)/Tag매출
  const calcDiscountRate = (vatInc: number | null, tag: number | null): number | null => {
    if (vatInc === null || tag === null || tag === 0) return null;
    return 1 - (vatInc / tag);
  };
  
  // 5. 원가율 계산: 매출원가/실판(V-)
  const calcCogsRate = (cogsVal: number | null, vatExc: number | null): number | null => {
    if (cogsVal === null || vatExc === null || vatExc === 0) return null;
    return cogsVal / vatExc;
  };
  
  // 6. Tag 대비 원가율 차이 계산: 누적 원가율 - 계획 원가율
  const calcTagCogsRateDiff = (actualRate: number | null, planRate: number | null): number | null => {
    if (actualRate === null || planRate === null) return null;
    return actualRate - planRate;
  };
  
  // 7. 매출총이익 계산: 실판(V-) - 매출원가
  const calcGrossProfit = (vatExc: number | null, cogsVal: number | null): number | null => {
    if (vatExc === null || cogsVal === null) return null;
    return vatExc - cogsVal;
  };
  
  // 8. 이익율 계산: 매출총이익/실판(V-)
  const calcProfitRate = (profit: number | null, vatExc: number | null): number | null => {
    if (profit === null || vatExc === null || vatExc === 0) return null;
    return profit / vatExc;
  };
  
  // 채널별 계산값 생성
  const channels: Array<'onlineDirect' | 'onlineDealer' | 'offlineDirect' | 'offlineDealer' | 'total'> = 
    ['onlineDirect', 'onlineDealer', 'offlineDirect', 'offlineDealer', 'total'];
  
  // 실적 할인율
  const actSaleVatIncRate: ChannelRowData = {
    onlineDirect: calcDiscountRate(actuals.actSaleVatInc.onlineDirect, actuals.tagSale.onlineDirect),
    onlineDealer: calcDiscountRate(actuals.actSaleVatInc.onlineDealer, actuals.tagSale.onlineDealer),
    offlineDirect: calcDiscountRate(actuals.actSaleVatInc.offlineDirect, actuals.tagSale.offlineDirect),
    offlineDealer: calcDiscountRate(actuals.actSaleVatInc.offlineDealer, actuals.tagSale.offlineDealer),
    total: calcDiscountRate(actuals.actSaleVatInc.total, actuals.tagSale.total),
  };
  
  // 실적 원가율
  const actualCogsRate: ChannelRowData = {
    onlineDirect: calcCogsRate(actuals.cogs.onlineDirect, actuals.actSaleVatExc.onlineDirect),
    onlineDealer: calcCogsRate(actuals.cogs.onlineDealer, actuals.actSaleVatExc.onlineDealer),
    offlineDirect: calcCogsRate(actuals.cogs.offlineDirect, actuals.actSaleVatExc.offlineDirect),
    offlineDealer: calcCogsRate(actuals.cogs.offlineDealer, actuals.actSaleVatExc.offlineDealer),
    total: calcCogsRate(actuals.cogs.total, actuals.actSaleVatExc.total),
  };
  
  // 실적 Tag 대비 원가율 (매출원가 × 1.13 / Tag매출)
  const calcActualTagCogsRate = (cogsVal: number | null, tag: number | null): number | null => {
    if (cogsVal === null || tag === null || tag === 0) return null;
    return (cogsVal * 1.13) / tag;
  };
  
  const actualTagCogsRate: ChannelRowData = {
    onlineDirect: calcActualTagCogsRate(actuals.cogs.onlineDirect, actuals.tagSale.onlineDirect),
    onlineDealer: calcActualTagCogsRate(actuals.cogs.onlineDealer, actuals.tagSale.onlineDealer),
    offlineDirect: calcActualTagCogsRate(actuals.cogs.offlineDirect, actuals.tagSale.offlineDirect),
    offlineDealer: calcActualTagCogsRate(actuals.cogs.offlineDealer, actuals.tagSale.offlineDealer),
    total: calcActualTagCogsRate(actuals.cogs.total, actuals.tagSale.total),
  };
  
  // 실적 매출총이익
  const actualGrossProfit: ChannelRowData = {
    onlineDirect: calcGrossProfit(actuals.actSaleVatExc.onlineDirect, actuals.cogs.onlineDirect),
    onlineDealer: calcGrossProfit(actuals.actSaleVatExc.onlineDealer, actuals.cogs.onlineDealer),
    offlineDirect: calcGrossProfit(actuals.actSaleVatExc.offlineDirect, actuals.cogs.offlineDirect),
    offlineDealer: calcGrossProfit(actuals.actSaleVatExc.offlineDealer, actuals.cogs.offlineDealer),
    total: calcGrossProfit(actuals.actSaleVatExc.total, actuals.cogs.total),
  };
  
  // 실적 이익율
  const actualGrossProfitRate: ChannelRowData = {
    onlineDirect: calcProfitRate(actualGrossProfit.onlineDirect, actuals.actSaleVatExc.onlineDirect),
    onlineDealer: calcProfitRate(actualGrossProfit.onlineDealer, actuals.actSaleVatExc.onlineDealer),
    offlineDirect: calcProfitRate(actualGrossProfit.offlineDirect, actuals.actSaleVatExc.offlineDirect),
    offlineDealer: calcProfitRate(actualGrossProfit.offlineDealer, actuals.actSaleVatExc.offlineDealer),
    total: calcProfitRate(actualGrossProfit.total, actuals.actSaleVatExc.total),
  };
  
  // 실적 테이블 구성
  const actual: ChannelActualTable = {
    tagSale: {
      ...actuals.tagSale,
      progressRate: calcProgressRate(actuals.tagSale.total, plan.tagSale.total),
    },
    actSaleVatInc: {
      ...actuals.actSaleVatInc,
      progressRate: calcProgressRate(actuals.actSaleVatInc.total, plan.actSaleVatInc.total),
    },
    actSaleVatIncRate: {
      ...actSaleVatIncRate,
      progressRate: calcProgressRate(actSaleVatIncRate.total, plan.actSaleVatIncRate.total),
    },
    actSaleVatExc: {
      ...actuals.actSaleVatExc,
      progressRate: calcProgressRate(actuals.actSaleVatExc.total, plan.actSaleVatExc.total),
    },
    cogs: {
      ...actuals.cogs,
      progressRate: calcProgressRate(actuals.cogs.total, plan.cogs.total),
    },
    cogsRate: {
      ...actualCogsRate,
      progressRate: calcProgressRate(actualCogsRate.total, plan.cogsRate.total),
    },
    tagCogsRate: {
      ...actualTagCogsRate,
      progressRate: calcTagCogsRateDiff(actualTagCogsRate.total, plan.tagCogsRate.total), // 차이
    },
    grossProfit: {
      ...actualGrossProfit,
      progressRate: calcProgressRate(actualGrossProfit.total, plan.grossProfit.total),
    },
    grossProfitRate: {
      ...actualGrossProfitRate,
      progressRate: calcProgressRate(actualGrossProfitRate.total, plan.grossProfitRate.total),
    },
  };
  
  return { plan, actual };
}

// 브랜드 코드 -> 매장 브랜드명 매핑
const brandCodeToShopName: Record<string, string> = {
  'M': 'MLB',
  'I': 'MLB KIDS',
  'X': 'DISCOVERY',
};

// 전일 날짜 계산 (점당매출용 - 자동 업데이트 기준)
function getYesterdayDate(): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, '0');
  const day = String(yesterday.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

// 기준월 마감 시점 날짜 계산 (점당매출, 의류 판매율 공통 사용)
// - 현재 진행중인 월: 전일까지 (누적)
// - 이미 마감된 월: 해당 월의 마지막 날까지
function getMonthEndDate(ym: string): string {
  const currentYm = getCurrentYm();
  
  // 현재 진행중인 월이면 전일까지
  if (ym === currentYm) {
    return getYesterdayDate();
  }
  
  // 이미 마감된 월이면 해당 월의 마지막 날까지
  const year = parseInt(ym.substring(0, 4));
  const month = parseInt(ym.substring(5, 7));
  const lastDay = getMonthDays(ym);
  
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

// 점당매출 테이블 데이터 빌드 (MLB, MLB KIDS, DISCOVERY만)
// 주의: 점당매출은 Snowflake에서 실제 최신 날짜를 조회하여 사용 (CSV와 독립적)
async function buildRetailSalesTable(
  ym: string,
  brandCode: BrandCode
): Promise<{ data: RetailSalesTableData; retailLastDt: string } | null> {
  // M, I, X만 처리
  if (!isRetailSalesBrand(brandCode)) return null;
  
  const shopBrandName = brandCodeToShopName[brandCode];
  if (!shopBrandName) return null;
  
  // Snowflake에서 실제 최신 날짜 조회 (CSV와 독립적)
  let retailLastDt = await getRetailSalesLastDt(brandCode, ym);
  // 조회 실패 시 fallback: 월말만 사용 (CSV 날짜 사용 안 함)
  if (!retailLastDt) {
    retailLastDt = getMonthEndDate(ym);
  }
  
  // 1. 계획 데이터 로드
  const plan = getRetailPlan(ym, brandCode);
  
  // 2. Snowflake에서 실적 데이터 조회 (전일 기준)
  // 매출: 매장 브랜드 무관, 매장수: 매장 브랜드 필터
  const actuals = await getRetailSalesData(ym, retailLastDt, brandCode, shopBrandName);
  
  // 3. 파생값 계산
  const planSalesAmt = plan?.salesAmt ?? null;
  const planShopCnt = plan?.shopCnt ?? null;
  
  // 리테일 매출액(1K)
  const cySalesK = actuals.cySalesAmt / 1000;
  const lyCumSalesK = actuals.lyCumSalesAmt / 1000;
  const planSalesK = planSalesAmt !== null ? planSalesAmt / 1000 : null;
  
  const salesK: RetailSalesRow = {
    actual: cySalesK,
    progressRate: planSalesK !== null && planSalesK > 0 ? cySalesK / planSalesK : null,
    yoy: lyCumSalesK > 0 ? cySalesK / lyCumSalesK : null,
    plan: planSalesK,
    prevYear: lyCumSalesK,
  };
  
  // 매장수
  const shopCount: RetailSalesRow = {
    actual: actuals.cyShopCnt,
    progressRate: planShopCnt !== null && planShopCnt > 0 ? actuals.cyShopCnt / planShopCnt : null,
    yoy: actuals.lyCumShopCnt > 0 ? actuals.cyShopCnt / actuals.lyCumShopCnt : null,
    plan: planShopCnt,
    prevYear: actuals.lyCumShopCnt,
  };
  
  // 점당매출 (단위: 위안)
  const cyPerShop = actuals.cyShopCnt > 0 ? actuals.cySalesAmt / actuals.cyShopCnt : 0;
  const lyPerShop = actuals.lyCumShopCnt > 0 ? actuals.lyCumSalesAmt / actuals.lyCumShopCnt : 0;
  const planPerShop = planSalesAmt !== null && planShopCnt !== null && planShopCnt > 0 
    ? planSalesAmt / planShopCnt : null;
  
  const salesPerShop: RetailSalesRow = {
    actual: cyPerShop,
    progressRate: planPerShop !== null && planPerShop > 0 ? cyPerShop / planPerShop : null,
    yoy: lyPerShop > 0 ? cyPerShop / lyPerShop : null,
    plan: planPerShop,
    prevYear: lyPerShop,
  };
  
  // 점당매출_월환산
  // 전년 진척률 = ly_cum / ly_full
  const lyProgressRate = actuals.lyFullSalesAmt > 0 
    ? actuals.lyCumSalesAmt / actuals.lyFullSalesAmt : 0;
  // 월환산 총액 = cy_sales / (전년 진척률)
  const monthlyTotalAmt = lyProgressRate > 0 ? actuals.cySalesAmt / lyProgressRate : 0;
  // 실적(점당월환산) = 월환산 총액 / cy_shop_cnt
  const monthlyPerShop = actuals.cyShopCnt > 0 ? monthlyTotalAmt / actuals.cyShopCnt : 0;
  // 전년(점당 월전체) = ly_full / ly_full_shop_cnt
  const lyFullPerShop = actuals.lyFullShopCnt > 0 
    ? actuals.lyFullSalesAmt / actuals.lyFullShopCnt : 0;
  
  const salesPerShopMonthly: RetailSalesRow = {
    actual: monthlyPerShop,
    progressRate: planPerShop !== null && planPerShop > 0 ? monthlyPerShop / planPerShop : null,
    yoy: lyFullPerShop > 0 ? monthlyPerShop / lyFullPerShop : null,
    plan: planPerShop,
    prevYear: lyFullPerShop,
  };
  
  return {
    data: {
      salesK,
      shopCount,
      salesPerShop,
      salesPerShopMonthly,
    },
    retailLastDt,
  };
}

// 티어별/지역별 점당매출 데이터 빌드
async function buildTierRegionData(
  ym: string,
  retailLastDt: string,
  brandCode: BrandCode
): Promise<TierRegionSalesData | null> {
  if (!isRetailSalesBrand(brandCode)) return null;
  
  const shopBrandName = brandCodeToShopName[brandCode];
  if (!shopBrandName) return null;
  
  try {
    // 대리상 오프라인 점당매출 데이터 조회 (전년 합계 데이터용)
    const retailSalesData = await getRetailSalesData(ym, retailLastDt, brandCode, shopBrandName);
    
    // 티어별 데이터 조회 (매출: 상품 브랜드만 필터, 매장수: 매장 브랜드 + 해당 상품 브랜드 매출 > 0)
    const tierData = await getTierSalesData(ym, retailLastDt, brandCode, shopBrandName);
    
    // 지역별 데이터 조회 (매출: 상품 브랜드만 필터, 매장수: 매장 브랜드 + 해당 상품 브랜드 매출 > 0)
    const regionData = await getRegionSalesData(ym, retailLastDt, brandCode, shopBrandName);
    
    // 안전한 배열 체크
    const safeTierCurrent = Array.isArray(tierData?.current) ? tierData.current : [];
    const safeTierPrevYear = Array.isArray(tierData?.prevYear) ? tierData.prevYear : [];
    const safeTierPrevYearFull = Array.isArray(tierData?.prevYearFull) ? tierData.prevYearFull : [];
    const safeRegionCurrent = Array.isArray(regionData?.current) ? regionData.current : [];
    const safeRegionPrevYear = Array.isArray(regionData?.prevYear) ? regionData.prevYear : [];
    const safeRegionPrevYearFull = Array.isArray(regionData?.prevYearFull) ? regionData.prevYearFull : [];
    
    // 디버깅: 전년도 데이터 확인
    console.log('[buildTierRegionData] 전년도 데이터 확인:', {
      tierPrevYearCount: safeTierPrevYear.length,
      tierPrevYearFullCount: safeTierPrevYearFull.length,
      regionPrevYearCount: safeRegionPrevYear.length,
      regionPrevYearFullCount: safeRegionPrevYearFull.length,
      tierPrevYearKeys: safeTierPrevYear.map(r => r?.key),
      regionPrevYearKeys: safeRegionPrevYear.map(r => r?.key),
    });
    
    // 티어별 - 전년 데이터 매칭 및 월환산 점당매출 계산
    const tiers: TierRegionSalesRow[] = safeTierCurrent.map((row) => {
      if (!row) return null;
      const prevRow = safeTierPrevYear.find(p => p?.key === row.key);
      const prevFullRow = safeTierPrevYearFull.find(p => p?.key === row.key);
      
      // 전년 누적 데이터 (진척률 계산용)
      const prevCumSalesAmt = prevRow?.salesAmt || 0;
      const prevCumShopCnt = prevRow?.shopCnt || 0;
      
      // 전년 월전체 데이터 (표시 및 YOY 비교용)
      const prevFullSalesAmt = prevFullRow?.prevFullSalesAmt || 0;
      const prevFullShopCnt = prevFullRow?.prevFullShopCnt || 0;
      
      // 월환산 점당매출 계산
      // 전년 진척률 = 전년 누적 / 전년 전체
      const lyProgressRate = prevFullSalesAmt > 0 ? prevCumSalesAmt / prevFullSalesAmt : 0;
      // 월환산 총액 = 당년 누적 / (전년 진척률)
      const monthlyTotalAmt = lyProgressRate > 0 ? row.salesAmt / lyProgressRate : 0;
      // 실적(점당월환산) = 월환산 총액 / 당년 매장수
      const monthlyPerShop = row.shopCnt > 0 ? monthlyTotalAmt / row.shopCnt : 0;
      // 전년(점당 월전체) = 전년 전체 매출 / 전년 전체 매장수
      const prevFullPerShop = prevFullShopCnt > 0 ? prevFullSalesAmt / prevFullShopCnt : 0;
      
      const result = {
        ...row,
        prevSalesAmt: prevFullSalesAmt, // 전년도 월전체 매출로 변경
        prevShopCnt: prevFullShopCnt, // 전년도 월전체 매장수로 변경
        prevSalesPerShop: prevFullPerShop, // 전년도 월전체 점당매출로 변경
        prevFullSalesAmt,
        prevFullShopCnt,
        prevCumSalesAmt: prevCumSalesAmt, // 전년 누적 매출 (월환산 계산용)
        prevCumShopCnt: prevCumShopCnt, // 전년 누적 매장수 (월환산 계산용)
        salesPerShop: monthlyPerShop, // 월환산 점당매출로 변경
      };
      // 디버깅: cities 필드 및 전년도 데이터 확인
      if (row.cities && row.cities.length > 0) {
        console.log(`[buildTierRegionData] Tier ${row.key} cities:`, row.cities);
      }
      if (!prevFullRow) {
        console.log(`[buildTierRegionData] Tier ${row.key} 전년도 월전체 데이터 없음`);
      } else {
        console.log(`[buildTierRegionData] Tier ${row.key} 전년도 월전체 매칭 성공:`, {
          prevFullSalesAmt: prevFullRow.prevFullSalesAmt,
          prevFullShopCnt: prevFullRow.prevFullShopCnt,
          prevFullPerShop,
        });
      }
      return result;
    }).filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.key.localeCompare(b.key)); // T0, T1, T2... 순서
    
    // 지역별 - 전년 데이터 매칭 및 월환산 점당매출 계산
    const regions: TierRegionSalesRow[] = safeRegionCurrent.map((row) => {
      if (!row) return null;
      const prevRow = safeRegionPrevYear.find(p => p?.key === row.key);
      const prevFullRow = safeRegionPrevYearFull.find(p => p?.key === row.key);
      
      // 전년 누적 데이터 (진척률 계산용)
      const prevCumSalesAmt = prevRow?.salesAmt || 0;
      const prevCumShopCnt = prevRow?.shopCnt || 0;
      
      // 전년 월전체 데이터 (표시 및 YOY 비교용)
      const prevFullSalesAmt = prevFullRow?.prevFullSalesAmt || 0;
      const prevFullShopCnt = prevFullRow?.prevFullShopCnt || 0;
      
      // 월환산 점당매출 계산
      // 전년 진척률 = 전년 누적 / 전년 전체
      const lyProgressRate = prevFullSalesAmt > 0 ? prevCumSalesAmt / prevFullSalesAmt : 0;
      // 월환산 총액 = 당년 누적 / (전년 진척률)
      const monthlyTotalAmt = lyProgressRate > 0 ? row.salesAmt / lyProgressRate : 0;
      // 실적(점당월환산) = 월환산 총액 / 당년 매장수
      const monthlyPerShop = row.shopCnt > 0 ? monthlyTotalAmt / row.shopCnt : 0;
      // 전년(점당 월전체) = 전년 전체 매출 / 전년 전체 매장수
      const prevFullPerShop = prevFullShopCnt > 0 ? prevFullSalesAmt / prevFullShopCnt : 0;
      
      const result = {
        ...row,
        prevSalesAmt: prevFullSalesAmt, // 전년도 월전체 매출로 변경
        prevShopCnt: prevFullShopCnt, // 전년도 월전체 매장수로 변경
        prevSalesPerShop: prevFullPerShop, // 전년도 월전체 점당매출로 변경
        prevFullSalesAmt,
        prevFullShopCnt,
        prevCumSalesAmt: prevCumSalesAmt, // 전년 누적 매출 (월환산 계산용)
        prevCumShopCnt: prevCumShopCnt, // 전년 누적 매장수 (월환산 계산용)
        salesPerShop: monthlyPerShop, // 월환산 점당매출로 변경
      };
      // 디버깅: cities 필드 확인
      if (row.cities && row.cities.length > 0) {
        console.log(`[buildTierRegionData] Region ${row.key} cities:`, row.cities);
      }
      return result;
    }).filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.key.localeCompare(b.key));
    
    // 전년 합계 데이터 계산 (대리상 오프라인 점당매출과 일치)
    const prevTotalSalesAmt = retailSalesData.lyFullSalesAmt; // 전년 월전체 매출
    const prevTotalShopCnt = retailSalesData.lyFullShopCnt;   // 전년 월전체 매장수
    const prevTotalSalesPerShop = prevTotalShopCnt > 0 
      ? prevTotalSalesAmt / prevTotalShopCnt 
      : 0; // 전년 월전체 점당매출
    const prevTotalCumSalesAmt = retailSalesData.lyCumSalesAmt; // 전년 누적 매출
    const prevTotalCumShopCnt = retailSalesData.lyCumShopCnt;  // 전년 누적 매장수
    
    return { 
      tiers, 
      regions,
      prevTotalSalesAmt,
      prevTotalShopCnt,
      prevTotalSalesPerShop,
      prevTotalCumSalesAmt,
      prevTotalCumShopCnt,
    };
  } catch (error) {
    console.error('[buildTierRegionData] 에러 발생:', error);
    return null;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse<ApiResponse>> {
  try {
    const { searchParams } = new URL(request.url);
    const ym = searchParams.get('ym') || getCurrentYm();
    const brand = searchParams.get('brand') || 'all';
    // 의류 판매율 시즌 파라미터
    const cySeason = searchParams.get('cySeason') || getDefaultClothingSeason(ym);
    const pySeason = searchParams.get('pySeason') || getPreviousClothingSeason(cySeason);

    // 목표 CSV 로드
    const targetCsv = getTargetCsv(ym);
    const mappings = getAccountMappings();
    
    // 디버깅: Vercel에서 targets 파싱 확인
    let targets: TargetRow[] = [];
    if (targetCsv) {
      try {
        targets = parseTargetCsv(targetCsv);
        console.log(`[DEBUG] targets parsed for ${ym}:`, {
          targetCsvLength: targetCsv.length,
          targetsCount: targets.length,
          firstTarget: targets[0] || null,
          sampleTarget: targets.find(t => t.level1 === 'Tag매출') || null,
        });
      } catch (error) {
        console.error(`[ERROR] Failed to parse target CSV for ${ym}:`, error);
        targets = [];
      }
    } else {
      console.log(`[DEBUG] No target CSV found for ${ym}`);
    }
    
    const monthDays = getMonthDays(ym);
    
    // 목표 CSV가 없거나 1~11월인 경우 해당 월의 마지막 날 계산
    const year = parseInt(ym.substring(0, 4));
    const month = parseInt(ym.substring(5, 7));
    const shouldUseMonthEnd = !targetCsv || (month >= 1 && month <= 11);
    const lastDayOfMonth = shouldUseMonthEnd ? new Date(year, month, 0).getDate() : 0;
    const lastDtOfMonth = shouldUseMonthEnd 
      ? `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`
      : '';

    // 브랜드 코드 목록 결정
    const brandCodes: BrandCode[] = brand === 'all' ? allBrandCodes : [brand as BrandCode];
    if (brand !== 'all' && !isValidBrandCode(brand)) {
      return NextResponse.json({
        ym,
        brand,
        lastDt: '',
        accumDays: 0,
        monthDays,
        lines: [],
        error: `유효하지 않은 브랜드: ${brand}`,
      });
    }

    // 마지막 날짜 조회
    const lastDates = await getLastDates(ym, brandCodes);
    
    // 첫 번째 브랜드의 lastDt 사용 (전체의 경우 가장 늦은 날짜) - 실제 데이터가 있는 마지막 날짜
    let lastDt = '';
    let accumDays = 0;
    
    // 각 브랜드별 데이터 조회
    const brandDataList: Awaited<ReturnType<typeof calcBrandData>>[] = [];
    const brandDataMap = new Map<BrandCode, { lines: PlLine[]; prevYear: Record<string, number>; accum: Record<string, number> }>();
    
    for (const code of brandCodes) {
      const codeDt = lastDates[code] || '';
      
      // 마감일 표시는 실제 데이터가 있는 마지막 날짜 사용
      if (!lastDt || codeDt > lastDt) {
        lastDt = codeDt;
      }
      
      // accumDays는 실제 마감일(codeDt) 기준으로 계산
      if (codeDt) {
        const actualAccumDays = parseInt(codeDt.split('-')[2], 10) || 0;
        if (actualAccumDays > accumDays) {
          accumDays = actualAccumDays;
        }
      }
      
      // 데이터 조회 시에는 목표가 없거나 1~11월이면 월의 마지막 날까지 조회
      // codeDt가 없어도 shouldUseMonthEnd이고 lastDtOfMonth가 있으면 사용 (목표 없어도 실제 데이터 조회)
      let queryDt = codeDt || (shouldUseMonthEnd ? lastDtOfMonth : '');
      if (shouldUseMonthEnd && queryDt && lastDtOfMonth && queryDt < lastDtOfMonth) {
        queryDt = lastDtOfMonth;
      }
      
      if (queryDt) {
        const bData = await calcBrandData(ym, code, mappings, targets, queryDt);
        brandDataList.push(bData);
      }
    }
    
    // 브랜드별 개별 lines 생성 (차트용)
    if (brand === 'all') {
      for (const code of brandCodes) {
        const bDataIdx = brandCodes.indexOf(code);
        const bData = brandDataList[bDataIdx];
        if (bData) {
          const bContext: CalcContext = {
            vatExcForecast: 0,
            grossProfitForecast: 0,
            directCostSumForecast: 0,
            opexSumForecast: 0,
            vatExcTarget: 0,
          };
          const bMerged = {
            prevYear: bData.prevYear,
            accum: bData.accum,
            accumDays: bData.accumDays,
            monthDays,
          };
          const bLines = lineDefinitions.map((def) =>
            buildPlLine(def, bMerged, mappings, targets, code, bContext)
          );
          brandDataMap.set(code, { lines: bLines, prevYear: bData.prevYear, accum: bData.accum });
        }
      }
    }

    // 데이터가 없는 경우
    if (brandDataList.length === 0) {
      return NextResponse.json({
        ym,
        brand,
        lastDt: '',
        accumDays: 0,
        monthDays,
        lines: [],
        error: '실적 데이터가 없습니다.',
      });
    }

    // 브랜드별 또는 전체 데이터 합산
    let mergedData: {
      prevYear: Record<string, number>;
      accum: Record<string, number>;
      accumDays: number;
      monthDays: number;
    };

    if (brand === 'all') {
      // 전체: 모든 브랜드 합산
      const merged: Record<string, number> = {};
      const mergedAccum: Record<string, number> = {};

      for (const bd of brandDataList) {
        for (const [item, val] of Object.entries(bd.prevYear)) {
          merged[item] = (merged[item] || 0) + val;
        }
        for (const [item, val] of Object.entries(bd.accum)) {
          mergedAccum[item] = (mergedAccum[item] || 0) + val;
        }
      }

      mergedData = {
        prevYear: merged,
        accum: mergedAccum,
        accumDays,
        monthDays,
      };
    } else {
      // 개별 브랜드
      const bd = brandDataList[0];
      mergedData = {
        prevYear: bd.prevYear,
        accum: bd.accum,
        accumDays: bd.accumDays,
        monthDays,
      };
    }

    // 계산 컨텍스트 초기화
    const context: CalcContext = {
      vatExcForecast: 0,
      grossProfitForecast: 0,
      directCostSumForecast: 0,
      opexSumForecast: 0,
      vatExcTarget: 0,
    };

    // 채널별 데이터 조회 (개별 브랜드일 때만)
    let channelData: {
      prevYearChannel?: { onlineDirect: number; onlineDealer: number; offlineDirect: number; offlineDealer: number };
      targetChannel?: ChannelRowData;
      accumChannel?: ChannelRowData;
      targetChannelVatExc?: ChannelRowData;
      accumChannelVatExc?: ChannelRowData;
      prevYearChannelTagSale?: { onlineDirect: number; onlineDealer: number; offlineDirect: number; offlineDealer: number };
      targetChannelTagSale?: ChannelRowData;
      accumChannelTagSale?: ChannelRowData;
      prevYearChannelCogs?: { onlineDirect: number; onlineDealer: number; offlineDirect: number; offlineDealer: number };
      targetChannelCogs?: ChannelRowData;
      accumChannelCogs?: ChannelRowData;
      prevYearChannelAccum?: { tagSale: ChannelRowData; actSaleVatInc: ChannelRowData; actSaleVatExc: ChannelRowData; cogs: ChannelRowData };
      prevYearChannelFullMonth?: { tagSale: ChannelRowData; actSaleVatInc: ChannelRowData; actSaleVatExc: ChannelRowData; cogs: ChannelRowData };
    } | undefined;
    
    if (brand !== 'all' && lastDt) {
      const prevYm = getPrevYearMonth(ym);
      const brandCode = brand as BrandCode;
      
      // 채널별 데이터 병렬 조회
      const [prevYearChannel, channelActuals, prevYearChannelTagSale, prevYearChannelCogs, prevYearChannelAccum, prevYearChannelFullMonth] = await Promise.all([
        getPrevYearChannelActuals(prevYm, brandCode),
        getChannelActuals(ym, lastDt, brandCode),
        getPrevYearChannelTagSale(prevYm, brandCode),
        getPrevYearChannelCogs(prevYm, brandCode),
        getPrevYearChannelAccum(prevYm, lastDt, brandCode),
        getPrevYearChannelFullMonth(prevYm, brandCode),
      ]);
      
      // 목표 데이터는 parseChannelPlanData 사용
      const channelPlan = parseChannelPlanData(targetCsv, brandCode);
      
      channelData = {
        prevYearChannel,
        targetChannel: channelPlan.actSaleVatInc,
        accumChannel: channelActuals.actSaleVatInc,
        targetChannelVatExc: channelPlan.actSaleVatExc,
        accumChannelVatExc: channelActuals.actSaleVatExc,
        prevYearChannelTagSale,
        targetChannelTagSale: channelPlan.tagSale,
        accumChannelTagSale: channelActuals.tagSale,
        prevYearChannelCogs,
        targetChannelCogs: channelPlan.cogs,
        accumChannelCogs: channelActuals.cogs,
        prevYearChannelAccum,
        prevYearChannelFullMonth,
      };
    }

    // PlLine 빌드
    const lines: PlLine[] = lineDefinitions.map((def) =>
      buildPlLine(def, mergedData, mappings, targets, brand === 'all' ? 'all' : (brand as BrandCode), context, channelData)
    );

    // 카드 요약 데이터 계산 (lines가 비어있지 않을 때만)
    const summary = lines && lines.length > 0 ? buildCardSummary(lines, mergedData, context) : undefined;

    // 차트 데이터 (전체 페이지만)
    let charts: ChartData | undefined;
    if (brand === 'all' && brandDataMap.size > 0) {
      charts = await buildChartData(ym, lastDt, brandDataMap, lines, brandCodes);
    }
    
    // 채널별 테이블 데이터 (브랜드별 페이지만)
    let channelTable: ChannelTableData | undefined;
    if (brand !== 'all' && lastDt) {
      channelTable = await buildChannelTableData(ym, lastDt, brand as BrandCode, targetCsv);
    }
    
    // 점당매출 테이블 데이터 (MLB, MLB KIDS, DISCOVERY만)
    // 주의: 점당매출은 Snowflake에서 직접 최신 날짜를 조회 (CSV와 독립적)
    let retailSalesTable: RetailSalesTableData | undefined;
    let retailLastDt: string | undefined;
    let tierRegionData: TierRegionSalesData | undefined;
    
    if (brand !== 'all' && isRetailSalesBrand(brand)) {
      const retailResult = await buildRetailSalesTable(ym, brand as BrandCode);
      if (retailResult) {
        retailSalesTable = retailResult.data;
        retailLastDt = retailResult.retailLastDt;
        
        // 티어별/지역별 데이터도 함께 조회
        const tierRegion = await buildTierRegionData(ym, retailResult.retailLastDt, brand as BrandCode);
        if (tierRegion) {
          tierRegionData = tierRegion;
        }
      }
    }
    
    // 의류 판매율 데이터 (MLB, MLB KIDS, DISCOVERY, DUVETICA, SUPRA만)
    const clothingBrands = ['M', 'I', 'X', 'V', 'W'];
    let clothingSales: { items: any[]; total: any } | undefined;
    let clothingLastDt: string | undefined;
    
    if (brand !== 'all' && clothingBrands.includes(brand)) {
      try {
        // Snowflake에서 실제 최신 날짜 조회 (CSV와 독립적)
        clothingLastDt = await getClothingSalesLastDt(brand, ym, cySeason, pySeason);
        // 조회 실패 시 fallback: 월말만 사용 (CSV 날짜 사용 안 함)
        if (!clothingLastDt) {
          clothingLastDt = getMonthEndDate(ym);
        }
        console.log('[DEBUG] 의류 판매율 조회 시작:', { brand, clothingLastDt, cySeason, pySeason });
        const clothingData = await getClothingSalesData(brand, clothingLastDt, cySeason, pySeason);
        console.log('[DEBUG] 의류 판매율 조회 완료:', {
          dataLength: clothingData?.length,
          hasData: clothingData && Array.isArray(clothingData) && clothingData.length > 0,
          firstItem: clothingData?.[0]
        });
        
        // null/undefined 체크 및 배열 체크 강화
        if (clothingData && Array.isArray(clothingData) && clothingData.length > 0) {
          // 전체 합계 계산
          let totalCyPoAmt = 0;
          let totalCySalesAmt = 0;
          let totalPyPoAmt = 0;
          let totalPySalesAmt = 0;
          let totalCyPoQty = 0;
          let totalPyPoQty = 0;
          
          clothingData.forEach(item => {
            totalCySalesAmt += item.cySalesAmt || 0;
            totalPySalesAmt += item.pySalesAmt || 0;
            totalCyPoQty += item.cyPoQty || 0;
            totalPyPoQty += item.pyPoQty || 0;
          });
          
          const totalCyRate = clothingData.length > 0 
            ? clothingData.reduce((sum, item) => sum + (item.cyRate || 0), 0) / clothingData.length 
            : 0;
          const totalPyRate = clothingData.length > 0
            ? clothingData.reduce((sum, item) => sum + (item.pyRate || 0), 0) / clothingData.length
            : 0;
          const totalYoy = totalPyRate && totalPyRate > 0 ? totalCyRate / totalPyRate : null;
          
          clothingSales = {
            items: clothingData,
            total: {
              itemCd: 'TOTAL',
              itemNm: '의류전체',
              cyRate: totalCyRate,
              pyRate: totalPyRate,
              yoy: totalYoy,
              cySalesAmt: totalCySalesAmt,
              pySalesAmt: totalPySalesAmt,
              cyPoQty: totalCyPoQty,
              pyPoQty: totalPyPoQty,
            },
          };
        } else {
          console.log('[DEBUG] 의류 판매율 데이터가 없거나 빈 배열입니다:', {
            isNull: clothingData === null,
            isUndefined: clothingData === undefined,
            isArray: Array.isArray(clothingData),
            length: clothingData?.length
          });
        }
      } catch (error) {
        console.error('의류 판매율 조회 오류:', error);
        // 에러 발생 시에도 clothingSales는 undefined로 유지 (에러를 API 응답에 포함하지 않음)
      }
    }

    return NextResponse.json({
      ym,
      brand,
      lastDt,
      accumDays,
      monthDays,
      lines,
      summary,
      charts,
      channelTable,
      retailSalesTable,
      retailLastDt,
      tierRegionData,
      clothingSales,
      clothingLastDt,
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({
      ym: '',
      brand: '',
      lastDt: '',
      accumDays: 0,
      monthDays: 0,
      lines: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// 현재 월 (YYYY-MM)
function getCurrentYm(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// 의류 판매율 기본 시즌 계산 (현재 월 기준)
function getDefaultClothingSeason(ym: string): string {
  const month = parseInt(ym.substring(5, 7));
  const year = parseInt(ym.substring(0, 4));
  // 1-6월: 전년도 F시즌, 7-12월: 당해년도 S시즌
  if (month >= 1 && month <= 6) {
    const prevYear = year - 1;
    return `${prevYear.toString().substring(2)}F`;
  } else {
    return `${year.toString().substring(2)}S`;
  }
}

// 전년 시즌 계산
function getPreviousClothingSeason(currentSeason: string): string {
  const year = parseInt(currentSeason.substring(0, 2));
  const season = currentSeason.substring(2);
  const prevYear = year - 1;
  return `${prevYear.toString().padStart(2, '0')}${season}`;
}
