export const runtime = "nodejs";
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
import { calculateAdjustedProgressRate } from '@/lib/plforecast/progressRateAdjustment';
import {
  getLastDates,
  getPrevYearActuals,
  getPrevYearActualsAccum,
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
  getTradeZoneSalesData,
  getShopLevelSalesData,
  getClothingSalesData,
  getClothingSalesLastDt,
} from '@/lib/plforecast/snowflake';
import { getRetailPlan, isRetailSalesBrand } from '@/data/plforecast/retailPlan';
import { codeToLabel } from '@/lib/plforecast/brand';
import { getKstYesterdayDate, getKstCurrentYm } from '@/lib/plforecast/date';

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
  prevYearAccum: Record<string, number>;
  accum: Record<string, number>;
  accumDays: number;
  monthDays: number;
  targets: TargetRow[];
}> {
  const prevYm = getPrevYearMonth(ym);
  const items = getAllItems(mappings);
  const monthDays = getMonthDays(ym);

  // 병렬 조회
  const [prevYear, prevYearAccum, accumResult] = await Promise.all([
    getPrevYearActuals(prevYm, brandCode, items), // 전년도 월 전체
    getPrevYearActualsAccum(prevYm, lastDt, brandCode, items), // 전년도 누적
    getAccumActuals(ym, lastDt, brandCode, items),
  ]);

  // 디버깅: 데이터 확인
  console.log('[calcBrandData] 데이터 조회 완료:', {
    brandCode,
    prevYm,
    lastDt,
    prevYearKeys: Object.keys(prevYear).length,
    prevYearAccumKeys: Object.keys(prevYearAccum).length,
    prevYearActSale: prevYear['ACT_SALE_AMT'],
    prevYearAccumActSale: prevYearAccum['ACT_SALE_AMT'],
    prevYearCogs: prevYear['ACT_COGS'],
    prevYearAccumCogs: prevYearAccum['ACT_COGS'],
  });

  return {
    prevYear,
    prevYearAccum,
    accum: accumResult.accum,
    accumDays: accumResult.accumDays,
    monthDays,
    targets,
  };
}

// 계산된 값들을 저장하는 컨텍스트 (영업이익 계산용)
interface CalcContext {
  vatExcForecast: number; // 실판(V-) 월말예상
  actSaleVatIncForecast: number; // 실판(V+) 월말예상
  cogsSumForecast: number; // 매출원가 합계 월말예상
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

// (전년)진척률 계산 헬퍼 함수
function calculatePrevYearProgressRate(prevYear: number | null, prevYearAccum: number | null): number | null {
  if (prevYear === null || prevYearAccum === null) {
    return null;
  }
  if (prevYear === 0) {
    // 분모가 0이면 0 반환 (prevYearAccum이 null이 아니고 0일 수도 있으므로)
    return 0;
  }
  const rate = prevYearAccum / prevYear;
  return isNaN(rate) || !isFinite(rate) ? null : rate;
}

// Lines 합산 함수 (브랜드별 lines를 합산)
function mergePlLines(brandLinesList: PlLine[][]): PlLine[] {
  if (brandLinesList.length === 0) return [];
  if (brandLinesList.length === 1) return brandLinesList[0];

  // 첫 번째 브랜드의 lines를 기준으로 구조 복사
  const mergedLines: PlLine[] = brandLinesList[0].map(line => ({
    ...line,
    prevYear: 0,
    prevYearAccum: 0,
    prevYearProgressRate: null,
    target: 0,
    accum: 0,
    forecast: 0,
    yoyRate: null,
    achvRate: null,
    children: line.children ? line.children.map(child => ({
      ...child,
      prevYear: 0,
      prevYearAccum: 0,
      prevYearProgressRate: null,
      target: 0,
      accum: 0,
      forecast: 0,
      yoyRate: null,
      achvRate: null,
      children: undefined, // 2레벨까지만 처리 (필요시 확장)
    })) : undefined,
  }));

  // 모든 브랜드의 lines를 순회하며 합산
  for (const brandLines of brandLinesList) {
    for (let i = 0; i < mergedLines.length; i++) {
      const mergedLine = mergedLines[i];
      const brandLine = brandLines[i];
      
      if (!brandLine || mergedLine.id !== brandLine.id) {
        // id가 일치하지 않으면 찾기
        const found = brandLines.find(l => l.id === mergedLine.id);
        if (!found) continue;
        mergeLineValues(mergedLine, found);
      } else {
        mergeLineValues(mergedLine, brandLine);
      }
    }
  }

  // 계산 필드 재계산 (합산된 리프 노드 값 기반)
  for (const line of mergedLines) {
    // 부모 노드는 children의 합으로 재계산 (children이 있는 경우)
    if (line.children && line.children.length > 0) {
      const sumPrevYear = line.children.reduce((sum, c) => sum + (c.prevYear || 0), 0);
      const sumPrevYearAccum = line.children.reduce((sum, c) => sum + (c.prevYearAccum || 0), 0);
      const sumAccum = line.children.reduce((sum, c) => sum + (c.accum || 0), 0);
      const sumTarget = line.children.reduce((sum, c) => sum + (c.target || 0), 0);
      const sumForecast = line.children.reduce((sum, c) => sum + (c.forecast || 0), 0);
      
      // isCalculated가 false인 경우에만 합산 (실제 계정과목)
      if (!line.isCalculated) {
        line.prevYear = sumPrevYear || line.prevYear;
        line.prevYearAccum = sumPrevYearAccum || line.prevYearAccum;
        line.accum = sumAccum || line.accum;
        line.target = sumTarget || line.target;
        line.forecast = sumForecast || line.forecast;
      }
    }

    // 계산 필드 재계산
    if (line.isCalculated) {
      if (line.id === 'gross-profit') {
        // 매출총이익 = 실판(V+)/1.13 - 매출원가 합계
        const actSaleLine = mergedLines.find(l => l.id === 'act-sale-vat-inc');
        const cogsSumLine = mergedLines.find(l => l.id === 'cogs-sum');
        if (actSaleLine && cogsSumLine) {
          const vatIncPrevYear = actSaleLine.prevYear ?? 0;
          const vatIncAccum = actSaleLine.accum ?? 0;
          const vatIncPrevYearAccum = actSaleLine.prevYearAccum ?? 0;
          const cogsPrevYear = cogsSumLine.prevYear ?? 0;
          const cogsAccum = cogsSumLine.accum ?? 0;
          const cogsPrevYearAccum = cogsSumLine.prevYearAccum ?? 0;
          
          const calcPrevYear = vatIncPrevYear !== null && cogsPrevYear !== null ? (vatIncPrevYear / 1.13) - cogsPrevYear : null;
          const calcAccum = vatIncAccum !== null && cogsAccum !== null ? (vatIncAccum / 1.13) - cogsAccum : null;
          const calcPrevYearAccum = vatIncPrevYearAccum !== null && cogsPrevYearAccum !== null ? (vatIncPrevYearAccum / 1.13) - cogsPrevYearAccum : null;
          line.prevYear = calcPrevYear !== null && !isNaN(calcPrevYear) && isFinite(calcPrevYear) ? calcPrevYear : null;
          line.accum = calcAccum !== null && !isNaN(calcAccum) && isFinite(calcAccum) ? calcAccum : null;
          line.prevYearAccum = calcPrevYearAccum !== null && !isNaN(calcPrevYearAccum) && isFinite(calcPrevYearAccum) ? calcPrevYearAccum : null;
          
          // target과 forecast 재계산
          const vatIncTarget = actSaleLine.target ?? 0;
          const cogsTarget = cogsSumLine.target ?? 0;
          const calcTarget = vatIncTarget !== null && cogsTarget !== null ? (vatIncTarget / 1.13) - cogsTarget : null;
          line.target = calcTarget !== null && !isNaN(calcTarget) && isFinite(calcTarget) ? calcTarget : null;
          
          const vatIncForecast = actSaleLine.forecast ?? 0;
          const cogsForecast = cogsSumLine.forecast ?? 0;
          const calcForecast = vatIncForecast !== null && cogsForecast !== null ? (vatIncForecast / 1.13) - cogsForecast : null;
          line.forecast = calcForecast !== null && !isNaN(calcForecast) && isFinite(calcForecast) ? calcForecast : null;
        }
      } else if (line.id === 'direct-profit') {
        // 직접이익 = 매출총이익 - 직접비 합계
        const grossProfitLine = mergedLines.find(l => l.id === 'gross-profit');
        const directCostSumLine = mergedLines.find(l => l.id === 'direct-cost-sum');
        if (grossProfitLine && directCostSumLine) {
          const grossPrevYear = grossProfitLine.prevYear ?? 0;
          const grossAccum = grossProfitLine.accum ?? 0;
          const grossPrevYearAccum = grossProfitLine.prevYearAccum ?? 0;
          const directPrevYear = directCostSumLine.prevYear ?? 0;
          const directAccum = directCostSumLine.accum ?? 0;
          const directPrevYearAccum = directCostSumLine.prevYearAccum ?? 0;
          
          const calcPrevYear = grossPrevYear !== null && directPrevYear !== null ? grossPrevYear - directPrevYear : null;
          const calcAccum = grossAccum !== null && directAccum !== null ? grossAccum - directAccum : null;
          const calcPrevYearAccum = grossPrevYearAccum !== null && directPrevYearAccum !== null ? grossPrevYearAccum - directPrevYearAccum : null;
          line.prevYear = calcPrevYear !== null && !isNaN(calcPrevYear) && isFinite(calcPrevYear) ? calcPrevYear : null;
          line.accum = calcAccum !== null && !isNaN(calcAccum) && isFinite(calcAccum) ? calcAccum : null;
          line.prevYearAccum = calcPrevYearAccum !== null && !isNaN(calcPrevYearAccum) && isFinite(calcPrevYearAccum) ? calcPrevYearAccum : null;
          
          // target과 forecast 재계산
          const grossTarget = grossProfitLine.target ?? 0;
          const directTarget = directCostSumLine.target ?? 0;
          const calcTarget = grossTarget !== null && directTarget !== null ? grossTarget - directTarget : null;
          line.target = calcTarget !== null && !isNaN(calcTarget) && isFinite(calcTarget) ? calcTarget : null;
          
          const grossForecast = grossProfitLine.forecast ?? 0;
          const directForecast = directCostSumLine.forecast ?? 0;
          const calcForecast = grossForecast !== null && directForecast !== null ? grossForecast - directForecast : null;
          line.forecast = calcForecast !== null && !isNaN(calcForecast) && isFinite(calcForecast) ? calcForecast : null;
        }
      } else if (line.id === 'operating-profit') {
        // 영업이익 = 직접이익 - 영업비 합계
        const directProfitLine = mergedLines.find(l => l.id === 'direct-profit');
        const opexSumLine = mergedLines.find(l => l.id === 'opex-sum');
        if (directProfitLine && opexSumLine) {
          const directPrevYear = directProfitLine.prevYear ?? 0;
          const directAccum = directProfitLine.accum ?? 0;
          const directPrevYearAccum = directProfitLine.prevYearAccum ?? 0;
          const opexPrevYear = opexSumLine.prevYear ?? 0;
          const opexAccum = opexSumLine.accum ?? 0;
          const opexPrevYearAccum = opexSumLine.prevYearAccum ?? 0;
          
          const calcPrevYear = directPrevYear !== null && opexPrevYear !== null ? directPrevYear - opexPrevYear : null;
          const calcAccum = directAccum !== null && opexAccum !== null ? directAccum - opexAccum : null;
          const calcPrevYearAccum = directPrevYearAccum !== null && opexPrevYearAccum !== null ? directPrevYearAccum - opexPrevYearAccum : null;
          line.prevYear = calcPrevYear !== null && !isNaN(calcPrevYear) && isFinite(calcPrevYear) ? calcPrevYear : null;
          line.accum = calcAccum !== null && !isNaN(calcAccum) && isFinite(calcAccum) ? calcAccum : null;
          line.prevYearAccum = calcPrevYearAccum !== null && !isNaN(calcPrevYearAccum) && isFinite(calcPrevYearAccum) ? calcPrevYearAccum : null;
          
          // target과 forecast 재계산
          const directTarget = directProfitLine.target ?? 0;
          const opexTarget = opexSumLine.target ?? 0;
          const calcTarget = directTarget !== null && opexTarget !== null ? directTarget - opexTarget : null;
          line.target = calcTarget !== null && !isNaN(calcTarget) && isFinite(calcTarget) ? calcTarget : null;
          
          const directForecast = directProfitLine.forecast ?? 0;
          const opexForecast = opexSumLine.forecast ?? 0;
          const calcForecast = directForecast !== null && opexForecast !== null ? directForecast - opexForecast : null;
          line.forecast = calcForecast !== null && !isNaN(calcForecast) && isFinite(calcForecast) ? calcForecast : null;
        }
      } else if (line.id === 'cogs-sum' || line.id === 'direct-cost-sum' || line.id === 'opex-sum') {
        // 합계 필드: children의 합
        if (line.children && line.children.length > 0) {
          line.prevYear = line.children.reduce((sum, c) => sum + (c.prevYear ?? 0), 0);
          line.prevYearAccum = line.children.reduce((sum, c) => sum + (c.prevYearAccum ?? 0), 0);
          line.accum = line.children.reduce((sum, c) => sum + (c.accum ?? 0), 0);
          line.target = line.children.reduce((sum, c) => sum + (c.target ?? 0), 0);
          line.forecast = line.children.reduce((sum, c) => sum + (c.forecast ?? 0), 0);
        }
      }
    }

    // prevYearProgressRate 재계산
    line.prevYearProgressRate = calculatePrevYearProgressRate(line.prevYear, line.prevYearAccum ?? null);
    
    // yoyRate 재계산: (forecast/prevYear) - 1
    if (line.forecast !== null && line.prevYear !== null && line.prevYear !== 0) {
      line.yoyRate = (line.forecast / line.prevYear) - 1;
      if (isNaN(line.yoyRate) || !isFinite(line.yoyRate)) line.yoyRate = null;
    } else {
      line.yoyRate = null;
    }
    
    // achvRate 재계산: forecast/target
    if (line.forecast !== null && line.target !== null && line.target !== 0) {
      line.achvRate = line.forecast / line.target;
      if (isNaN(line.achvRate) || !isFinite(line.achvRate)) line.achvRate = null;
    } else {
      line.achvRate = null;
    }

    // children도 재계산
    if (line.children) {
      for (const child of line.children) {
        child.prevYearProgressRate = calculatePrevYearProgressRate(child.prevYear, child.prevYearAccum ?? null);
        if (child.forecast !== null && child.prevYear !== null && child.prevYear !== 0) {
          child.yoyRate = (child.forecast / child.prevYear) - 1;
          if (isNaN(child.yoyRate) || !isFinite(child.yoyRate)) child.yoyRate = null;
        } else {
          child.yoyRate = null;
        }
        if (child.forecast !== null && child.target !== null && child.target !== 0) {
          child.achvRate = child.forecast / child.target;
          if (isNaN(child.achvRate) || !isFinite(child.achvRate)) child.achvRate = null;
        } else {
          child.achvRate = null;
        }
      }
    }
  }

  return mergedLines;
}

// 개별 라인 값 합산 헬퍼 함수
function mergeLineValues(merged: PlLine, source: PlLine): void {
  // 계산 필드(isCalculated === true)는 합산하지 않음 (나중에 재계산)
  if (merged.isCalculated) {
    // children만 합산
    if (merged.children && source.children) {
      for (const mergedChild of merged.children) {
        const sourceChild = source.children.find(c => c.id === mergedChild.id);
        if (sourceChild) {
          mergeLineValues(mergedChild, sourceChild);
        }
      }
    }
    return;
  }

  // 숫자 필드 합산 (null/undefined는 0으로 처리)
  merged.prevYear = (merged.prevYear ?? 0) + (source.prevYear ?? 0);
  merged.prevYearAccum = (merged.prevYearAccum ?? 0) + (source.prevYearAccum ?? 0);
  merged.target = (merged.target ?? 0) + (source.target ?? 0);
  merged.accum = (merged.accum ?? 0) + (source.accum ?? 0);
  merged.forecast = (merged.forecast ?? 0) + (source.forecast ?? 0);

  // children도 합산 (같은 id를 가진 children 찾아서 합산)
  if (merged.children && source.children) {
    for (const mergedChild of merged.children) {
      const sourceChild = source.children.find(c => c.id === mergedChild.id);
      if (sourceChild) {
        mergeLineValues(mergedChild, sourceChild);
      }
    }
  } else if (source.children && !merged.children) {
    // merged에 children이 없는데 source에 있으면 복사
    merged.children = source.children.map(child => ({
      ...child,
      prevYearProgressRate: null,
      yoyRate: null,
      achvRate: null,
      children: undefined,
    }));
  }
}

// PlLine 빌드 (재귀)
function buildPlLine(
  def: LineDefinition,
  data: {
    prevYear: Record<string, number>;
    prevYearAccum: Record<string, number>;
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
          
          // 월말예상 계산: 모든 채널 Tag대비 원가율 기반
          const tagSaleAccum = channelData.accumChannelTagSale?.[channel] ?? null;
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
      // 매출원가 합계 = 매출원가 + 평가감(환입) + 평가감(설정)
      // 자식 합산으로 계산
      if (def.children) {
        const childLines = def.children.map((child) =>
          buildPlLine(child, data, mappings, targets, brandCode, context, channelData)
        );
        prevYear = childLines.reduce((sum, c) => sum + (c.prevYear || 0), 0);
        accum = childLines.reduce((sum, c) => sum + (c.accum || 0), 0);
        target = childLines.reduce((sum, c) => sum + (c.target || 0), 0);
        forecast = childLines.reduce((sum, c) => sum + (c.forecast || 0), 0);
        
        // 컨텍스트에 저장 (매출총이익 계산용)
        context.cogsSumForecast = forecast || 0;
        
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
      // 직접비 합계 = 급여 + 복리후생비 + 플랫폼수수료 + TP수수료 + 직접광고비 + 대리상지원금 + 물류비 + 매장임차료 + 감가상각비 + 기타
      // 기타 = 진열소모품 + 포장비 + 지급수수료 + 기타소모품 + 통신비 + 출장비 + 접대비 + 기타지급수수료
      // 자식 합산으로 계산
      if (def.children) {
        const childLines = def.children.map((child) =>
          buildPlLine(child, data, mappings, targets, brandCode, context, channelData)
        );
        prevYear = childLines.reduce((sum, c) => sum + (c.prevYear || 0), 0);
        accum = childLines.reduce((sum, c) => sum + (c.accum || 0), 0);
        target = childLines.reduce((sum, c) => sum + (c.target || 0), 0);
        forecast = childLines.reduce((sum, c) => sum + (c.forecast || 0), 0);

        // prevYearAccum 합산 (데이터 없으면 0으로 설정)
        const validPrevYearAccum = childLines.filter(c => c.prevYearAccum !== null && c.prevYearAccum !== undefined);
        if (validPrevYearAccum.length > 0) {
          prevYearAccum = validPrevYearAccum.reduce((sum, c) => sum + (c.prevYearAccum || 0), 0);
        } else {
          prevYearAccum = 0; // null 대신 0으로 설정 (데이터 없으면 0)
        }
        
        // 디버깅: direct-cost-sum prevYearAccum 계산 확인
        console.log('[direct-cost-sum] prevYearAccum 계산:', {
          childLinesCount: childLines.length,
          validPrevYearAccumCount: validPrevYearAccum.length,
          childPrevYearAccums: childLines.map(c => ({ id: c.id, label: c.label, prevYearAccum: c.prevYearAccum })),
          calculatedPrevYearAccum: prevYearAccum,
          sumByLevelResult: sumByLevel(data.prevYearAccum, mappings, '직접비', undefined, undefined, dealerSupportItems),
        });

        // (전년)진척률 계산
        prevYearProgressRate = calculatePrevYearProgressRate(prevYear, prevYearAccum);

        // 컨텍스트에 저장 (영업이익 계산용)
        context.directCostSumForecast = forecast || 0;

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

    case 'opexSum':
      // 영업비 합계 = 급여 + 복리후생비 + 광고비 + 수주회 + 지급수수료 + 임차료 + 감가상각비 + 세금과공과 + 기타
      // 기타 = 도서인쇄비 + 통신비 + 직영판매사원도급비 + 국내출장비 + 접대비 + 기타소모품 + 기타지급수수료 + 차량유지비
      // 자식 합산으로 계산
      if (def.children) {
        const childLines = def.children.map((child) =>
          buildPlLine(child, data, mappings, targets, brandCode, context, channelData)
        );
        prevYear = childLines.reduce((sum, c) => sum + (c.prevYear || 0), 0);
        accum = childLines.reduce((sum, c) => sum + (c.accum || 0), 0);
        target = childLines.reduce((sum, c) => sum + (c.target || 0), 0);
        // 영업비 월말예상 = 목표 그대로 (고정비)
        forecast = target;

        // prevYearAccum 합산 (데이터 없으면 0으로 설정)
        const validPrevYearAccum = childLines.filter(c => c.prevYearAccum !== null && c.prevYearAccum !== undefined);
        if (validPrevYearAccum.length > 0) {
          prevYearAccum = validPrevYearAccum.reduce((sum, c) => sum + (c.prevYearAccum || 0), 0);
        } else {
          prevYearAccum = 0; // null 대신 0으로 설정 (데이터 없으면 0)
        }

        // (전년)진척률 계산
        prevYearProgressRate = calculatePrevYearProgressRate(prevYear, prevYearAccum);

        // 컨텍스트에 저장 (영업이익 계산용)
        context.opexSumForecast = forecast || 0;

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

    case 'grossProfit': {
      // 매출총이익 = 실판(V+)/1.13 - 매출원가 합계
      // 매출원가 합계 = 매출원가 + 평가감(환입) + 평가감(설정)
      const vatIncPrevYear = sumByLevel(data.prevYear, mappings, '실판(V+)');
      const vatIncAccum = sumByLevel(data.accum, mappings, '실판(V+)');

      // 매출원가 합계 계산: 매출원가 + 평가감(환입) + 평가감(설정)
      const cogsPrevYear = sumByLevel(data.prevYear, mappings, '매출원가')
        + sumByLevel(data.prevYear, mappings, '평가감');
      const cogsAccum = sumByLevel(data.accum, mappings, '매출원가')
        + sumByLevel(data.accum, mappings, '평가감');

      // prevYear와 accum 계산 (NaN, Infinity 체크)
      const calculatedPrevYear = (vatIncPrevYear / 1.13) - cogsPrevYear;
      const calculatedAccum = (vatIncAccum / 1.13) - cogsAccum;
      prevYear = isNaN(calculatedPrevYear) || !isFinite(calculatedPrevYear) ? null : calculatedPrevYear;
      accum = isNaN(calculatedAccum) || !isFinite(calculatedAccum) ? null : calculatedAccum;

      // prevYearAccum 계산 (전년 누적 데이터로 계산)
      const vatIncPrevYearAccum = sumByLevel(data.prevYearAccum, mappings, '실판(V+)');
      const cogsPrevYearAccum = sumByLevel(data.prevYearAccum, mappings, '매출원가')
        + sumByLevel(data.prevYearAccum, mappings, '평가감');
      const calculatedPrevYearAccum = (vatIncPrevYearAccum / 1.13) - cogsPrevYearAccum;
      
      // 디버깅: prevYearAccum 계산 확인
      console.log('[grossProfit] prevYearAccum 계산:', {
        vatIncPrevYearAccum,
        cogsPrevYearAccum,
        calculatedPrevYearAccum,
        prevYearAccumDataKeys: Object.keys(data.prevYearAccum).length,
        prevYearAccumSample: Object.entries(data.prevYearAccum).slice(0, 5),
        prevYear: calculatedPrevYear,
        prevYearAccum: calculatedPrevYearAccum,
      });
      
      prevYearAccum = isNaN(calculatedPrevYearAccum) || !isFinite(calculatedPrevYearAccum) ? null : calculatedPrevYearAccum;

      // (전년)진척률 계산
      prevYearProgressRate = calculatePrevYearProgressRate(prevYear, prevYearAccum);

      // 목표 계산
      const vatIncTargetGP = getTarget('실판(V+)', '실판(V+)', '실판(V+)') || 0;
      const cogsTarget = (getTarget('매출원가', '매출원가', '매출원가') || 0)
        + (getTarget('평가감') || 0);
      target = (vatIncTargetGP / 1.13) - cogsTarget;

      // 월말예상 계산: 실판(V+) forecast / 1.13 - 매출원가 합계 forecast
      const calculatedForecast = (context.actSaleVatIncForecast / 1.13) - context.cogsSumForecast;
      forecast = isNaN(calculatedForecast) || !isFinite(calculatedForecast) ? null : calculatedForecast;

      // 컨텍스트에 저장 (영업이익 계산용)
      context.grossProfitForecast = forecast || 0;
      break;
    }

    case 'directProfit': {
      // 직접이익 = 매출총이익 - 직접비 합계
      // 매출총이익 = 실판(V+)/1.13 - 매출원가 합계
      // 매출원가 합계 = 매출원가 + 평가감(환입) + 평가감(설정)
      // 직접비 합계 = 급여 + 복리후생비 + 플랫폼수수료 + TP수수료 + 직접광고비 + 대리상지원금 + 물류비 + 매장임차료 + 감가상각비 + 기타
      // 전년, 누적 계산
      const vatIncDPPY = sumByLevel(data.prevYear, mappings, '실판(V+)');
      const vatIncDPAcc = sumByLevel(data.accum, mappings, '실판(V+)');
      
      // 매출원가 합계 = 매출원가 + 평가감(환입) + 평가감(설정)
      const cogsDPPY = sumByLevel(data.prevYear, mappings, '매출원가')
        + sumByLevel(data.prevYear, mappings, '평가감');
      const cogsDPAcc = sumByLevel(data.accum, mappings, '매출원가')
        + sumByLevel(data.accum, mappings, '평가감');
      
      const directDPPY = sumByLevel(data.prevYear, mappings, '직접비', undefined, undefined, dealerSupportItems);
      const directDPAcc = sumByLevel(data.accum, mappings, '직접비', undefined, undefined, dealerSupportItems);
      
      // prevYear와 accum 계산 (NaN, Infinity 체크)
      // 누적에서 직접비가 없으므로 (CSV에 없음), 직접이익 = 매출총이익
      const calculatedPrevYear = ((vatIncDPPY / 1.13) - cogsDPPY) - directDPPY;
      const calculatedAccum = (vatIncDPAcc / 1.13) - cogsDPAcc; // 직접비 없으므로 매출총이익과 동일
      prevYear = isNaN(calculatedPrevYear) || !isFinite(calculatedPrevYear) ? null : calculatedPrevYear;
      accum = isNaN(calculatedAccum) || !isFinite(calculatedAccum) ? null : calculatedAccum;
      
      // prevYearAccum 계산 (전년 누적 데이터로 계산)
      const vatIncDPPrevYearAccum = sumByLevel(data.prevYearAccum, mappings, '실판(V+)');
      const cogsDPPrevYearAccum = sumByLevel(data.prevYearAccum, mappings, '매출원가')
        + sumByLevel(data.prevYearAccum, mappings, '평가감');
      const grossProfitPrevYearAccum = (vatIncDPPrevYearAccum / 1.13) - cogsDPPrevYearAccum;
      
      // 직접비 합계 계산: sumByLevel 결과를 그대로 사용 (없으면 0 반환)
      // 디버깅: 직접비 항목 확인
      const directItems = getItemsByLevel(mappings, '직접비');
      const directItemsWithValues = directItems
        .filter(item => !dealerSupportItems.includes(item))
        .map(item => ({ item, value: data.prevYearAccum[item] || 0 }))
        .filter(({ value }) => value !== 0);
      const directCostSumPrevYearAccum = sumByLevel(data.prevYearAccum, mappings, '직접비', undefined, undefined, dealerSupportItems);
      
      // 디버깅: prevYearAccum 계산 확인
      console.log('[directProfit] prevYearAccum 계산:', {
        grossProfitPrevYearAccum,
        directCostSumPrevYearAccum,
        calculatedPrevYearAccum: grossProfitPrevYearAccum - directCostSumPrevYearAccum,
        directItemsCount: directItems.length,
        directItemsWithValues,
        directItemsInData: Object.keys(data.prevYearAccum).filter(key => directItems.includes(key)),
        allDirectItemsValues: directItems.map(item => ({ item, value: data.prevYearAccum[item], excluded: dealerSupportItems.includes(item) })),
      });
      
      const calculatedPrevYearAccum = grossProfitPrevYearAccum - directCostSumPrevYearAccum;
      prevYearAccum = isNaN(calculatedPrevYearAccum) || !isFinite(calculatedPrevYearAccum) ? null : calculatedPrevYearAccum;
      
      // (전년)진척률 계산
      prevYearProgressRate = calculatePrevYearProgressRate(prevYear, prevYearAccum);
      
      // 목표 계산
      const vatIncDPTgt = getTarget('실판(V+)', '실판(V+)', '실판(V+)') || 0;
      const cogsDPTgt = (getTarget('매출원가', '매출원가', '매출원가') || 0)
        + (getTarget('평가감') || 0);
      const directDPTgt = getTarget('직접비') || 0;
      target = ((vatIncDPTgt / 1.13) - cogsDPTgt) - directDPTgt;
      
      // 월말예상 = 매출총이익 월말예상 - 직접비 합계 월말예상
      const calculatedForecast = context.grossProfitForecast - context.directCostSumForecast;
      forecast = isNaN(calculatedForecast) || !isFinite(calculatedForecast) ? null : calculatedForecast;
      break;
    }

    case 'operatingProfit': {
      // 영업이익 = 직접이익 - 영업비 합계
      // 직접이익 = 매출총이익 - 직접비 합계
      // 매출총이익 = 실판(V+)/1.13 - 매출원가 합계
      // 매출원가 합계 = 매출원가 + 평가감(환입) + 평가감(설정)
      // 직접비 합계 = 급여 + 복리후생비 + 플랫폼수수료 + TP수수료 + 직접광고비 + 대리상지원금 + 물류비 + 매장임차료 + 감가상각비 + 기타
      // 영업비 합계 = 급여 + 복리후생비 + 광고비 + 수주회 + 지급수수료 + 임차료 + 감가상각비 + 세금과공과 + 기타
      // 전년, 누적도 동일한 로직으로 계산
      const vatIncPY = sumByLevel(data.prevYear, mappings, '실판(V+)');
      const vatIncAcc = sumByLevel(data.accum, mappings, '실판(V+)');
      
      // 매출원가 합계 = 매출원가 + 평가감(환입) + 평가감(설정)
      const cogsPY = sumByLevel(data.prevYear, mappings, '매출원가')
        + sumByLevel(data.prevYear, mappings, '평가감');
      const cogsAcc = sumByLevel(data.accum, mappings, '매출원가')
        + sumByLevel(data.accum, mappings, '평가감');
      
      const directPY = sumByLevel(data.prevYear, mappings, '직접비', undefined, undefined, dealerSupportItems);
      const directAcc = sumByLevel(data.accum, mappings, '직접비', undefined, undefined, dealerSupportItems);
      
      const opexPY = sumByLevel(data.prevYear, mappings, '영업비');
      const opexAcc = sumByLevel(data.accum, mappings, '영업비');
      
      // prevYear와 accum 계산 (NaN, Infinity 체크)
      // 누적에서 직접비, 영업비가 없으므로 (CSV에 없음), 영업이익 = 매출총이익
      const calculatedPrevYear = ((vatIncPY / 1.13) - cogsPY) - directPY - opexPY;
      const calculatedAccum = (vatIncAcc / 1.13) - cogsAcc; // 직접비, 영업비 없으므로 매출총이익과 동일
      prevYear = isNaN(calculatedPrevYear) || !isFinite(calculatedPrevYear) ? null : calculatedPrevYear;
      accum = isNaN(calculatedAccum) || !isFinite(calculatedAccum) ? null : calculatedAccum;
      
      // prevYearAccum 계산 (전년 누적 데이터로 계산)
      const vatIncOPPrevYearAccum = sumByLevel(data.prevYearAccum, mappings, '실판(V+)');
      const cogsOPPrevYearAccum = sumByLevel(data.prevYearAccum, mappings, '매출원가')
        + sumByLevel(data.prevYearAccum, mappings, '평가감');
      const grossProfitPrevYearAccum = (vatIncOPPrevYearAccum / 1.13) - cogsOPPrevYearAccum;
      
      // 직접비 합계 계산: sumByLevel 결과를 그대로 사용 (없으면 0 반환)
      const directCostSumPrevYearAccum = sumByLevel(data.prevYearAccum, mappings, '직접비', undefined, undefined, dealerSupportItems);
      const directProfitPrevYearAccum = grossProfitPrevYearAccum - directCostSumPrevYearAccum;
      
      // 영업비 합계 계산: sumByLevel 결과를 그대로 사용 (없으면 0 반환)
      const opexSumPrevYearAccum = sumByLevel(data.prevYearAccum, mappings, '영업비');
      
      // 디버깅: prevYearAccum 계산 확인
      console.log('[operatingProfit] prevYearAccum 계산:', {
        grossProfitPrevYearAccum,
        directCostSumPrevYearAccum,
        directProfitPrevYearAccum,
        opexSumPrevYearAccum,
        calculatedPrevYearAccum: directProfitPrevYearAccum - opexSumPrevYearAccum,
      });
      
      const calculatedPrevYearAccum = directProfitPrevYearAccum - opexSumPrevYearAccum;
      prevYearAccum = isNaN(calculatedPrevYearAccum) || !isFinite(calculatedPrevYearAccum) ? null : calculatedPrevYearAccum;
      
      // (전년)진척률 계산
      prevYearProgressRate = calculatePrevYearProgressRate(prevYear, prevYearAccum);
      
      // 목표
      const vatIncTgt = getTarget('실판(V+)', '실판(V+)', '실판(V+)') || 0;
      const cogsTgt = (getTarget('매출원가', '매출원가', '매출원가') || 0)
        + (getTarget('평가감') || 0);
      const directTgt = getTarget('직접비') || 0;
      const opexTgt = getTarget('영업비') || 0;
      target = ((vatIncTgt / 1.13) - cogsTgt) - directTgt - opexTgt;
      
      // 월말예상 = 직접이익 월말예상 - 영업비 합계 월말예상
      // = (매출총이익 월말예상 - 직접비 합계 월말예상) - 영업비 합계 월말예상
      const calculatedForecast = context.grossProfitForecast - context.directCostSumForecast - context.opexSumForecast;
      forecast = isNaN(calculatedForecast) || !isFinite(calculatedForecast) ? null : calculatedForecast;
      break;
    }

    default:
      // 일반 항목 (level1/level2/level3 조건으로 합산)
      if (def.level1) {
        prevYear = sumByLevel(data.prevYear, mappings, def.level1, def.level2, def.level3, dealerSupportItems);
        accum = sumByLevel(data.accum, mappings, def.level1, def.level2, def.level3, dealerSupportItems);
        prevYearAccum = sumByLevel(data.prevYearAccum, mappings, def.level1, def.level2, def.level3, dealerSupportItems);
        target = getTarget(def.level1, def.level2, def.level3);
        
        // (전년)진척률 계산
        prevYearProgressRate = calculatePrevYearProgressRate(prevYear, prevYearAccum);
        
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
    
    // Tag매출, 실판(V+), 매출원가 부모 행의 경우 자식들의 합계로 계산
    if ((def.id === 'tag-sale' || def.id === 'act-sale-vat-inc' || def.id === 'cogs' || def.id === 'cogs-sum') && children.length > 0) {
      prevYear = children.reduce((sum, c) => sum + (c.prevYear || 0), 0);
      accum = children.reduce((sum, c) => sum + (c.accum || 0), 0);
      target = children.reduce((sum, c) => sum + (c.target || 0), 0);
      forecast = children.reduce((sum, c) => sum + (c.forecast || 0), 0);
      
      // channelData가 없을 때 (전체 탭): level1으로 직접 계산
      if ((def.id === 'act-sale-vat-inc' || def.id === 'cogs') && !channelData && def.level1) {
        prevYear = sumByLevel(data.prevYear, mappings, def.level1);
        accum = sumByLevel(data.accum, mappings, def.level1);
        prevYearAccum = sumByLevel(data.prevYearAccum, mappings, def.level1);
        target = getTarget(def.level1, def.level2, def.level3);
        forecast = calculateForecast(accum, data.accumDays, data.monthDays);
        // (전년)진척률 계산
        prevYearProgressRate = calculatePrevYearProgressRate(prevYear, prevYearAccum);
      }
      
      // 실판(V+) forecast를 context에 저장 (매출총이익 계산용)
      if (def.id === 'act-sale-vat-inc') {
        context.actSaleVatIncForecast = forecast || 0;
      }
      
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
  const actSaleVatInc = findLine('act-sale-vat-inc');
  const cogsSum = findLine('cogs-sum');
  const grossProfit = findLine('gross-profit');
  const directCostSum = findLine('direct-cost-sum');
  const opexSum = findLine('opex-sum');
  const operatingProfit = findLine('operating-profit');
  
  // 직접이익 계산
  const directProfitForecast = (grossProfit?.forecast || 0) - (directCostSum?.forecast || 0);
  
  // 실판매출 = 실판(V+)/1.13
  const actSaleVatExcForecast = actSaleVatInc ? (actSaleVatInc.forecast || 0) / 1.13 : 0;
  
  const waterfall: WaterfallData[] = [
    { name: '실판매출', value: actSaleVatExcForecast, type: 'positive' },
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
// 한국 시간대(KST) 기준으로 계산
function getYesterdayDate(): string {
  return getKstYesterdayDate();
}

// 기준월 마감 시점 날짜 계산 (점당매출, 의류 판매율 공통 사용)
// - 현재 진행중인 월: 전일까지 (누적)
// - 이미 마감된 월: 해당 월의 마지막 날까지
// 한국 시간대(KST) 기준으로 계산
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
  
  // 점당매출_월환산 - 1월/2월만 설날 보정 적용
  // 보정된 전년 진척률 계산 (1/2월: 요일계수 × 설날D계수, 3~8월: 단순 진척률)
  const { progressRate: lyProgressRate, isAdjusted } = calculateAdjustedProgressRate(
    ym,
    retailLastDt,
    actuals.lyCumSalesAmt,
    actuals.lyFullSalesAmt
  );
  
  // 월환산 총액 = cy_sales / (보정된 전년 진척률)
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
      isProgressRateAdjusted: isAdjusted, // 설날 보정 적용 여부
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
    
    // Trade Zone별 데이터 조회 (매출: 상품 브랜드만 필터, 매장수: 매장 브랜드 + 해당 상품 브랜드 매출 > 0)
    const tradeZoneData = await getTradeZoneSalesData(ym, retailLastDt, brandCode, shopBrandName);
    
    // Shop Level별 데이터 조회 (매출: 상품 브랜드만 필터, 매장수: 매장 브랜드 + 해당 상품 브랜드 매출 > 0)
    const shopLevelData = await getShopLevelSalesData(ym, retailLastDt, brandCode, shopBrandName);
    
    // 안전한 배열 체크
    const safeTierCurrent = Array.isArray(tierData?.current) ? tierData.current : [];
    const safeTierPrevYear = Array.isArray(tierData?.prevYear) ? tierData.prevYear : [];
    const safeTierPrevYearFull = Array.isArray(tierData?.prevYearFull) ? tierData.prevYearFull : [];
    const safeRegionCurrent = Array.isArray(regionData?.current) ? regionData.current : [];
    const safeRegionPrevYear = Array.isArray(regionData?.prevYear) ? regionData.prevYear : [];
    const safeRegionPrevYearFull = Array.isArray(regionData?.prevYearFull) ? regionData.prevYearFull : [];
    const safeTradeZoneCurrent = Array.isArray(tradeZoneData?.current) ? tradeZoneData.current : [];
    const safeTradeZonePrevYear = Array.isArray(tradeZoneData?.prevYear) ? tradeZoneData.prevYear : [];
    const safeTradeZonePrevYearFull = Array.isArray(tradeZoneData?.prevYearFull) ? tradeZoneData.prevYearFull : [];
    const safeShopLevelCurrent = Array.isArray(shopLevelData?.current) ? shopLevelData.current : [];
    const safeShopLevelPrevYear = Array.isArray(shopLevelData?.prevYear) ? shopLevelData.prevYear : [];
    const safeShopLevelPrevYearFull = Array.isArray(shopLevelData?.prevYearFull) ? shopLevelData.prevYearFull : [];
    
    // 디버깅: 전년도 데이터 확인
    console.log('[buildTierRegionData] 전년도 데이터 확인:', {
      tierPrevYearCount: safeTierPrevYear.length,
      tierPrevYearFullCount: safeTierPrevYearFull.length,
      regionPrevYearCount: safeRegionPrevYear.length,
      regionPrevYearFullCount: safeRegionPrevYearFull.length,
      tierPrevYearKeys: safeTierPrevYear.map(r => r?.key),
      regionPrevYearKeys: safeRegionPrevYear.map(r => r?.key),
    });
    
    // DISCOVERY 브랜드: 전체 진척률 계산 (전년 데이터 없는 경우 fallback용)
    let totalProgressRate: number | null = null;
    let totalProgressRateAdjusted: boolean = false;
    if (brandCode === 'X') {
      const totalPrevCumSalesAmt = retailSalesData.lyCumSalesAmt || 0;
      const totalPrevFullSalesAmt = retailSalesData.lyFullSalesAmt || 0;
      const { progressRate, isAdjusted } = calculateAdjustedProgressRate(
        ym,
        retailLastDt,
        totalPrevCumSalesAmt,
        totalPrevFullSalesAmt
      );
      totalProgressRate = progressRate;
      totalProgressRateAdjusted = isAdjusted;
      console.log('[buildTierRegionData] DISCOVERY 전체 진척률 계산:', {
        totalPrevCumSalesAmt,
        totalPrevFullSalesAmt,
        totalProgressRate,
        isAdjusted: totalProgressRateAdjusted,
      });
    }
    
    // 티어별 - 전년 데이터 매칭 및 월환산 점당매출 계산
    const tiers: TierRegionSalesRow[] = safeTierCurrent.map((row) => {
      if (!row) return null;
      const prevRow = safeTierPrevYear.find(p => p?.key === row.key);
      const prevFullRow = safeTierPrevYearFull.find(p => p?.key === row.key);
      
      // 전년 누적 데이터 (진척률 계산용)
      const prevCumSalesAmt = prevRow?.salesAmt || 0;
      const prevCumShopCnt = prevRow?.shopCnt || 0;
      const prevCumTagAmt = prevRow?.prevTagAmt || 0;
      
      // 전년 월전체 데이터 (표시 및 YOY 비교용)
      const prevFullSalesAmt = prevFullRow?.prevFullSalesAmt || 0;
      const prevFullShopCnt = prevFullRow?.prevFullShopCnt || 0;
      const prevFullTagAmt = prevFullRow?.prevFullTagAmt || 0;
      
      // 월환산 점당매출 계산 (명절 보정 적용)
      let { progressRate: lyProgressRate, isAdjusted } = calculateAdjustedProgressRate(
        ym,
        retailLastDt,
        prevCumSalesAmt,
        prevFullSalesAmt
      );
      // DISCOVERY 브랜드: 전년 데이터가 없거나 진척률이 0이면 전체 진척률 사용
      if (brandCode === 'X' && (lyProgressRate === 0 || lyProgressRate === null) && totalProgressRate !== null && totalProgressRate > 0) {
        lyProgressRate = totalProgressRate;
        isAdjusted = totalProgressRateAdjusted;
        console.log(`[buildTierRegionData] DISCOVERY Tier ${row.key}: 전체 진척률 사용 (${lyProgressRate})`);
      }
      // 월환산 총액 = 당년 누적 / (보정된 진척률)
      const monthlyTotalAmt = lyProgressRate > 0 ? row.salesAmt / lyProgressRate : 0;
      // 실적(점당월환산) = 월환산 총액 / 당년 매장수
      const monthlyPerShop = row.shopCnt > 0 ? monthlyTotalAmt / row.shopCnt : 0;
      // 전년(점당 월전체) = 전년 전체 매출 / 전년 전체 매장수
      const prevFullPerShop = prevFullShopCnt > 0 ? prevFullSalesAmt / prevFullShopCnt : 0;
      
      // 할인율 계산
      // 당년 할인율 = (1 - 당년 실판 / 당년 Tag 가격) × 100
      const discountRate = row.tagAmt > 0 ? (1 - row.salesAmt / row.tagAmt) * 100 : null;
      // 전년 할인율 = (1 - 전년 누적 실판 / 전년 누적 Tag 가격) × 100
      const prevDiscountRate = prevCumTagAmt > 0 ? (1 - prevCumSalesAmt / prevCumTagAmt) * 100 : null;
      // 할인율 YOY = 당년 할인율 - 전년 할인율
      const discountRateYoy = discountRate !== null && prevDiscountRate !== null 
        ? discountRate - prevDiscountRate 
        : null;
      
      const result = {
        ...row,
        prevSalesAmt: prevFullSalesAmt, // 전년도 월전체 매출로 변경
        prevShopCnt: prevFullShopCnt, // 전년도 월전체 매장수로 변경
        prevSalesPerShop: prevFullPerShop, // 전년도 월전체 점당매출로 변경
        prevFullSalesAmt,
        prevFullShopCnt,
        prevCumSalesAmt: prevCumSalesAmt, // 전년 누적 매출 (월환산 계산용)
        prevCumShopCnt: prevCumShopCnt, // 전년 누적 매장수 (월환산 계산용)
        prevTagAmt: prevCumTagAmt, // 전년 누적 Tag 가격
        prevFullTagAmt, // 전년 월전체 Tag 가격
        salesPerShop: monthlyPerShop, // 월환산 점당매출로 변경
        isProgressRateAdjusted: isAdjusted, // 명절 보정 적용 여부
        discountRate,
        prevDiscountRate,
        discountRateYoy,
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
      const prevCumTagAmt = prevRow?.prevTagAmt || 0;
      
      // 전년 월전체 데이터 (표시 및 YOY 비교용)
      const prevFullSalesAmt = prevFullRow?.prevFullSalesAmt || 0;
      const prevFullShopCnt = prevFullRow?.prevFullShopCnt || 0;
      const prevFullTagAmt = prevFullRow?.prevFullTagAmt || 0;
      
      // 월환산 점당매출 계산 (명절 보정 적용)
      let { progressRate: lyProgressRate, isAdjusted } = calculateAdjustedProgressRate(
        ym,
        retailLastDt,
        prevCumSalesAmt,
        prevFullSalesAmt
      );
      // DISCOVERY 브랜드: 전년 데이터가 없거나 진척률이 0이면 전체 진척률 사용
      if (brandCode === 'X' && (lyProgressRate === 0 || lyProgressRate === null) && totalProgressRate !== null && totalProgressRate > 0) {
        lyProgressRate = totalProgressRate;
        isAdjusted = totalProgressRateAdjusted;
        console.log(`[buildTierRegionData] DISCOVERY Region ${row.key}: 전체 진척률 사용 (${lyProgressRate})`);
      }
      // 월환산 총액 = 당년 누적 / (보정된 진척률)
      const monthlyTotalAmt = lyProgressRate > 0 ? row.salesAmt / lyProgressRate : 0;
      // 실적(점당월환산) = 월환산 총액 / 당년 매장수
      const monthlyPerShop = row.shopCnt > 0 ? monthlyTotalAmt / row.shopCnt : 0;
      // 전년(점당 월전체) = 전년 전체 매출 / 전년 전체 매장수
      const prevFullPerShop = prevFullShopCnt > 0 ? prevFullSalesAmt / prevFullShopCnt : 0;
      
      // 할인율 계산
      // 당년 할인율 = (1 - 당년 실판 / 당년 Tag 가격) × 100
      const discountRate = row.tagAmt > 0 ? (1 - row.salesAmt / row.tagAmt) * 100 : null;
      // 전년 할인율 = (1 - 전년 누적 실판 / 전년 누적 Tag 가격) × 100
      const prevDiscountRate = prevCumTagAmt > 0 ? (1 - prevCumSalesAmt / prevCumTagAmt) * 100 : null;
      // 할인율 YOY = 당년 할인율 - 전년 할인율
      const discountRateYoy = discountRate !== null && prevDiscountRate !== null 
        ? discountRate - prevDiscountRate 
        : null;
      
      const result = {
        ...row,
        prevSalesAmt: prevFullSalesAmt, // 전년도 월전체 매출로 변경
        prevShopCnt: prevFullShopCnt, // 전년도 월전체 매장수로 변경
        prevSalesPerShop: prevFullPerShop, // 전년도 월전체 점당매출로 변경
        prevFullSalesAmt,
        prevFullShopCnt,
        prevCumSalesAmt: prevCumSalesAmt, // 전년 누적 매출 (월환산 계산용)
        prevCumShopCnt: prevCumShopCnt, // 전년 누적 매장수 (월환산 계산용)
        prevTagAmt: prevCumTagAmt, // 전년 누적 Tag 가격
        prevFullTagAmt, // 전년 월전체 Tag 가격
        salesPerShop: monthlyPerShop, // 월환산 점당매출로 변경
        isProgressRateAdjusted: isAdjusted, // 명절 보정 적용 여부
        discountRate,
        prevDiscountRate,
        discountRateYoy,
      };
      // 디버깅: cities 필드 확인
      if (row.cities && row.cities.length > 0) {
        console.log(`[buildTierRegionData] Region ${row.key} cities:`, row.cities);
      }
      return result;
    }).filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.key.localeCompare(b.key));
    
    // Trade Zone별 - 전년 데이터 매칭 및 월환산 점당매출 계산
    const tradeZones: TierRegionSalesRow[] = safeTradeZoneCurrent.map((row) => {
      if (!row) return null;
      const prevRow = safeTradeZonePrevYear.find(p => p?.key === row.key);
      const prevFullRow = safeTradeZonePrevYearFull.find(p => p?.key === row.key);
      
      // 전년 누적 데이터 (진척률 계산용)
      const prevCumSalesAmt = prevRow?.salesAmt || 0;
      const prevCumShopCnt = prevRow?.shopCnt || 0;
      const prevCumTagAmt = prevRow?.prevTagAmt || 0;
      
      // 전년 월전체 데이터 (표시 및 YOY 비교용)
      const prevFullSalesAmt = prevFullRow?.prevFullSalesAmt || 0;
      const prevFullShopCnt = prevFullRow?.prevFullShopCnt || 0;
      const prevFullTagAmt = prevFullRow?.prevFullTagAmt || 0;
      
      // 월환산 점당매출 계산 (명절 보정 적용)
      let { progressRate: lyProgressRate, isAdjusted } = calculateAdjustedProgressRate(
        ym,
        retailLastDt,
        prevCumSalesAmt,
        prevFullSalesAmt
      );
      // DISCOVERY 브랜드: 전년 데이터가 없거나 진척률이 0이면 전체 진척률 사용
      if (brandCode === 'X' && (lyProgressRate === 0 || lyProgressRate === null) && totalProgressRate !== null && totalProgressRate > 0) {
        lyProgressRate = totalProgressRate;
        isAdjusted = totalProgressRateAdjusted;
        console.log(`[buildTierRegionData] DISCOVERY Trade Zone ${row.key}: 전체 진척률 사용 (${lyProgressRate})`);
      }
      // 월환산 총액 = 당년 누적 / (보정된 진척률)
      const monthlyTotalAmt = lyProgressRate > 0 ? row.salesAmt / lyProgressRate : 0;
      // 실적(점당월환산) = 월환산 총액 / 당년 매장수
      const monthlyPerShop = row.shopCnt > 0 ? monthlyTotalAmt / row.shopCnt : 0;
      // 전년(점당 월전체) = 전년 전체 매출 / 전년 전체 매장수
      const prevFullPerShop = prevFullShopCnt > 0 ? prevFullSalesAmt / prevFullShopCnt : 0;
      
      // 할인율 계산
      // 당년 할인율 = (1 - 당년 실판 / 당년 Tag 가격) × 100
      const discountRate = row.tagAmt > 0 ? (1 - row.salesAmt / row.tagAmt) * 100 : null;
      // 전년 할인율 = (1 - 전년 누적 실판 / 전년 누적 Tag 가격) × 100
      const prevDiscountRate = prevCumTagAmt > 0 ? (1 - prevCumSalesAmt / prevCumTagAmt) * 100 : null;
      // 할인율 YOY = 당년 할인율 - 전년 할인율
      const discountRateYoy = discountRate !== null && prevDiscountRate !== null 
        ? discountRate - prevDiscountRate 
        : null;
      
      const result = {
        ...row,
        prevSalesAmt: prevFullSalesAmt, // 전년도 월전체 매출로 변경
        prevShopCnt: prevFullShopCnt, // 전년도 월전체 매장수로 변경
        prevSalesPerShop: prevFullPerShop, // 전년도 월전체 점당매출로 변경
        prevFullSalesAmt,
        prevFullShopCnt,
        prevCumSalesAmt: prevCumSalesAmt, // 전년 누적 매출 (월환산 계산용)
        prevCumShopCnt: prevCumShopCnt, // 전년 누적 매장수 (월환산 계산용)
        prevTagAmt: prevCumTagAmt, // 전년 누적 Tag 가격
        prevFullTagAmt, // 전년 월전체 Tag 가격
        salesPerShop: monthlyPerShop, // 월환산 점당매출로 변경
        isProgressRateAdjusted: isAdjusted, // 명절 보정 적용 여부
        discountRate,
        prevDiscountRate,
        discountRateYoy,
      };
      return result;
    }).filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.key.localeCompare(b.key));
    
    // Shop Level별 - 전년 데이터 매칭 및 월환산 점당매출 계산
    const shopLevels: TierRegionSalesRow[] = safeShopLevelCurrent.map((row) => {
      if (!row) return null;
      const prevRow = safeShopLevelPrevYear.find(p => p?.key === row.key);
      const prevFullRow = safeShopLevelPrevYearFull.find(p => p?.key === row.key);
      
      // 전년 누적 데이터 (진척률 계산용)
      const prevCumSalesAmt = prevRow?.salesAmt || 0;
      const prevCumShopCnt = prevRow?.shopCnt || 0;
      const prevCumTagAmt = prevRow?.prevTagAmt || 0;
      
      // 전년 월전체 데이터 (표시 및 YOY 비교용)
      const prevFullSalesAmt = prevFullRow?.prevFullSalesAmt || 0;
      const prevFullShopCnt = prevFullRow?.prevFullShopCnt || 0;
      const prevFullTagAmt = prevFullRow?.prevFullTagAmt || 0;
      
      // 월환산 점당매출 계산 (명절 보정 적용)
      let { progressRate: lyProgressRate, isAdjusted } = calculateAdjustedProgressRate(
        ym,
        retailLastDt,
        prevCumSalesAmt,
        prevFullSalesAmt
      );
      // DISCOVERY 브랜드: 전년 데이터가 없거나 진척률이 0이면 전체 진척률 사용
      if (brandCode === 'X' && (lyProgressRate === 0 || lyProgressRate === null) && totalProgressRate !== null && totalProgressRate > 0) {
        lyProgressRate = totalProgressRate;
        isAdjusted = totalProgressRateAdjusted;
        console.log(`[buildTierRegionData] DISCOVERY Shop Level ${row.key}: 전체 진척률 사용 (${lyProgressRate})`);
      }
      // 월환산 총액 = 당년 누적 / (보정된 진척률)
      const monthlyTotalAmt = lyProgressRate > 0 ? row.salesAmt / lyProgressRate : 0;
      // 실적(점당월환산) = 월환산 총액 / 당년 매장수
      const monthlyPerShop = row.shopCnt > 0 ? monthlyTotalAmt / row.shopCnt : 0;
      // 전년(점당 월전체) = 전년 전체 매출 / 전년 전체 매장수
      const prevFullPerShop = prevFullShopCnt > 0 ? prevFullSalesAmt / prevFullShopCnt : 0;
      
      // 할인율 계산
      // 당년 할인율 = (1 - 당년 실판 / 당년 Tag 가격) × 100
      const discountRate = row.tagAmt > 0 ? (1 - row.salesAmt / row.tagAmt) * 100 : null;
      // 전년 할인율 = (1 - 전년 누적 실판 / 전년 누적 Tag 가격) × 100
      const prevDiscountRate = prevCumTagAmt > 0 ? (1 - prevCumSalesAmt / prevCumTagAmt) * 100 : null;
      // 할인율 YOY = 당년 할인율 - 전년 할인율
      const discountRateYoy = discountRate !== null && prevDiscountRate !== null 
        ? discountRate - prevDiscountRate 
        : null;
      
      const result = {
        ...row,
        prevSalesAmt: prevFullSalesAmt, // 전년도 월전체 매출로 변경
        prevShopCnt: prevFullShopCnt, // 전년도 월전체 매장수로 변경
        prevSalesPerShop: prevFullPerShop, // 전년도 월전체 점당매출로 변경
        prevFullSalesAmt,
        prevFullShopCnt,
        prevCumSalesAmt: prevCumSalesAmt, // 전년 누적 매출 (월환산 계산용)
        prevCumShopCnt: prevCumShopCnt, // 전년 누적 매장수 (월환산 계산용)
        prevTagAmt: prevCumTagAmt, // 전년 누적 Tag 가격
        prevFullTagAmt, // 전년 월전체 Tag 가격
        salesPerShop: monthlyPerShop, // 월환산 점당매출로 변경
        isProgressRateAdjusted: isAdjusted, // 명절 보정 적용 여부
        discountRate,
        prevDiscountRate,
        discountRateYoy,
      };
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
      tradeZones,
      shopLevels,
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
      }, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
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
      
      // calcBrandData 호출 시 실제 마감일(codeDt)만 사용 (누적 조회는 실제 마감일 기준)
      if (codeDt) {
        const bData = await calcBrandData(ym, code, mappings, targets, codeDt);
        brandDataList.push(bData);
      }
    }
    
    // 브랜드별 개별 lines 생성 (차트용 및 전체 탭 합산용)
    const brandLinesList: PlLine[][] = [];
    if (brand === 'all' && lastDt) {
      const prevYm = getPrevYearMonth(ym);
      
      // 각 브랜드별로 channelData 조회 및 완전한 lines 생성
      for (const code of brandCodes) {
        const bDataIdx = brandCodes.indexOf(code);
        const bData = brandDataList[bDataIdx];
        if (bData) {
          // 각 브랜드별 channelData 조회 (병렬 처리)
          const [prevYearChannel, channelActuals, prevYearChannelTagSale, prevYearChannelCogs, prevYearChannelAccum, prevYearChannelFullMonth] = await Promise.all([
            getPrevYearChannelActuals(prevYm, code),
            getChannelActuals(ym, lastDt, code),
            getPrevYearChannelTagSale(prevYm, code),
            getPrevYearChannelCogs(prevYm, code),
            getPrevYearChannelAccum(prevYm, lastDt, code),
            getPrevYearChannelFullMonth(prevYm, code),
          ]);
          
          // 목표 데이터는 parseChannelPlanData 사용
          const channelPlan = parseChannelPlanData(targetCsv, code);
          
          const bChannelData = {
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
          
          const bContext: CalcContext = {
            vatExcForecast: 0,
            actSaleVatIncForecast: 0,
            cogsSumForecast: 0,
            grossProfitForecast: 0,
            directCostSumForecast: 0,
            opexSumForecast: 0,
            vatExcTarget: 0,
          };
          const bMerged = {
            prevYear: bData.prevYear,
            prevYearAccum: bData.prevYearAccum,
            accum: bData.accum,
            accumDays: bData.accumDays,
            monthDays,
          };
          // channelData를 포함하여 완전한 lines 생성
          const bLines = lineDefinitions.map((def) =>
            buildPlLine(def, bMerged, mappings, targets, code, bContext, bChannelData)
          );
          brandLinesList.push(bLines);
          brandDataMap.set(code, { lines: bLines, prevYear: bData.prevYear, accum: bData.accum });
        }
      }
    } else if (brand === 'all') {
      // lastDt가 없는 경우 기존 로직 사용
      for (const code of brandCodes) {
        const bDataIdx = brandCodes.indexOf(code);
        const bData = brandDataList[bDataIdx];
        if (bData) {
          const bContext: CalcContext = {
            vatExcForecast: 0,
            actSaleVatIncForecast: 0,
            cogsSumForecast: 0,
            grossProfitForecast: 0,
            directCostSumForecast: 0,
            opexSumForecast: 0,
            vatExcTarget: 0,
          };
          const bMerged = {
            prevYear: bData.prevYear,
            prevYearAccum: bData.prevYearAccum,
            accum: bData.accum,
            accumDays: bData.accumDays,
            monthDays,
          };
          const bLines = lineDefinitions.map((def) =>
            buildPlLine(def, bMerged, mappings, targets, code, bContext)
          );
          brandLinesList.push(bLines);
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
      }, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      });
    }

    // 브랜드별 또는 전체 데이터 합산
    let mergedData: {
      prevYear: Record<string, number>;
      prevYearAccum: Record<string, number>;
      accum: Record<string, number>;
      accumDays: number;
      monthDays: number;
    };

    if (brand === 'all') {
      // 전체: 모든 브랜드 합산
      const merged: Record<string, number> = {};
      const mergedPrevYearAccum: Record<string, number> = {};
      const mergedAccum: Record<string, number> = {};

      for (const bd of brandDataList) {
        for (const [item, val] of Object.entries(bd.prevYear)) {
          merged[item] = (merged[item] || 0) + val;
        }
        for (const [item, val] of Object.entries(bd.prevYearAccum)) {
          mergedPrevYearAccum[item] = (mergedPrevYearAccum[item] || 0) + val;
        }
        for (const [item, val] of Object.entries(bd.accum)) {
          mergedAccum[item] = (mergedAccum[item] || 0) + val;
        }
      }

      mergedData = {
        prevYear: merged,
        prevYearAccum: mergedPrevYearAccum,
        accum: mergedAccum,
        accumDays,
        monthDays,
      };
    } else {
      // 개별 브랜드
      const bd = brandDataList[0];
      mergedData = {
        prevYear: bd.prevYear,
        prevYearAccum: bd.prevYearAccum,
        accum: bd.accum,
        accumDays: bd.accumDays,
        monthDays,
      };
    }

    // 계산 컨텍스트 초기화
    const context: CalcContext = {
      vatExcForecast: 0,
      actSaleVatIncForecast: 0,
      cogsSumForecast: 0,
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
    let lines: PlLine[];
    if (brand === 'all' && brandLinesList.length > 0) {
      // 전체 탭: 브랜드별 lines 합산
      lines = mergePlLines(brandLinesList);
    } else {
      // 개별 브랜드: 기존 로직 사용
      lines = lineDefinitions.map((def) =>
        buildPlLine(def, mergedData, mappings, targets, brand as BrandCode, context, channelData)
      );
    }

    // 카드 요약 데이터 계산 (lines가 비어있지 않을 때만)
    const summary = lines && lines.length > 0 ? buildCardSummary(lines, mergedData, context) : undefined;

    // 차트 데이터 (전체 페이지만, 브랜드별 필터링 지원)
    let charts: ChartData | undefined;
    if (brand === 'all' && brandDataMap.size > 0) {
      charts = await buildChartData(ym, lastDt, brandDataMap, lines, brandCodes);
    } else if (brand !== 'all') {
      // 브랜드별 차트 데이터도 생성 (주차별 매출 추이용)
      // brandDataMap이 비어있어도 주차별 매출 데이터는 조회 가능
      const singleBrandCode = brand as BrandCode;
      // 빈 brandDataMap을 전달하되, 주차별 매출 데이터만 조회
      const emptyBrandDataMap = new Map<BrandCode, { lines: PlLine[]; prevYear: Record<string, number>; accum: Record<string, number> }>();
      charts = await buildChartData(ym, lastDt, emptyBrandDataMap, lines, [singleBrandCode]);
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
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
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
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  }
}

// 현재 월 (YYYY-MM)
// 한국 시간대(KST) 기준으로 계산
function getCurrentYm(): string {
  return getKstCurrentYm();
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
