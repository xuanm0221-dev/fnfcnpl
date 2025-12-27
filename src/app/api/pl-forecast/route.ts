export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse, PlLine, BrandCode, LineDefinition, AccountMapping, TargetRow, CardSummary, ChartData, BrandSalesData, BrandRadarData, WaterfallData, WeeklyTrendData } from '@/lib/plforecast/types';
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
} from '@/lib/plforecast/parseCsv';
import { calcYoyRate, calcAchvRate } from '@/lib/plforecast/format';
import {
  getLastDates,
  getPrevYearActuals,
  getAccumActuals,
  getDealerSupportActuals,
  getMonthDays,
  getPrevYearMonth,
  getWeeklySales,
  getWeeklyAccumSales,
} from '@/lib/plforecast/snowflake';
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
  dealerSupportPrevYear: number;
  dealerSupportAccum: number;
  targets: TargetRow[];
}> {
  const prevYm = getPrevYearMonth(ym);
  const items = getAllItems(mappings);
  const monthDays = getMonthDays(ym);

  // 병렬 조회
  const [prevYear, accumResult, dealerSupport] = await Promise.all([
    getPrevYearActuals(prevYm, brandCode, items),
    getAccumActuals(ym, lastDt, brandCode, items),
    getDealerSupportActuals(ym, lastDt, brandCode),
  ]);

  return {
    prevYear,
    accum: accumResult.accum,
    accumDays: accumResult.accumDays,
    monthDays,
    dealerSupportPrevYear: dealerSupport.prevYear,
    dealerSupportAccum: dealerSupport.accum,
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

// PlLine 빌드 (재귀)
function buildPlLine(
  def: LineDefinition,
  data: {
    prevYear: Record<string, number>;
    accum: Record<string, number>;
    accumDays: number;
    monthDays: number;
    dealerSupportPrevYear: number;
    dealerSupportAccum: number;
  },
  mappings: AccountMapping[],
  targets: TargetRow[],
  brandCode: BrandCode | 'all',
  context: CalcContext
): PlLine {
  const getTarget = brandCode === 'all'
    ? (l1?: string, l2?: string, l3?: string) => getTargetValueAll(targets, l1, l2, l3)
    : (l1?: string, l2?: string, l3?: string) => getTargetValue(targets, brandCode, l1, l2, l3);

  let prevYear: number | null = null;
  let accum: number | null = null;
  let target: number | null = null;
  let forecast: number | null = null;

  // 대리상지원금에서 제외할 item들
  const dealerSupportItems = ['OUTSRC_PROC_CST', 'SMPL_BUY_CST', 'MILE_SALE_AMT'];

  // 타입별 계산
  switch (def.type) {
    case 'vatExcluded':
      // VAT 제외 실판
      prevYear = data.prevYear[vatExcludedItem] || 0;
      accum = data.accum[vatExcludedItem] || 0;
      target = getTarget('실판(V-)', '실판(V-)', '실판(V-)');
      forecast = data.accumDays > 0 ? (accum / data.accumDays) * data.monthDays : null;
      
      // 컨텍스트에 저장 (직접비 계산에 사용)
      if (forecast !== null) {
        context.vatExcForecast = forecast;
      }
      if (target !== null) {
        context.vatExcTarget = target;
      }
      break;

    case 'dealerSupport':
      // 대리상지원금 (특수 계산) - 직접비이므로 매출 연동
      prevYear = data.dealerSupportPrevYear;
      accum = data.dealerSupportAccum;
      target = getTarget(def.level1, def.level2, def.level3);
      
      // 직접비: 목표직접비 / 목표실판(V-) × 월말예상실판(V-)
      if (target !== null && context.vatExcTarget > 0 && context.vatExcForecast > 0) {
        forecast = (target / context.vatExcTarget) * context.vatExcForecast;
      } else {
        forecast = null;
      }
      break;

    case 'cogsSum':
      // 매출원가 합계 (자식 합산)
      if (def.children) {
        const childLines = def.children.map((child) =>
          buildPlLine(child, data, mappings, targets, brandCode, context)
        );
        prevYear = childLines.reduce((sum, c) => sum + (c.prevYear || 0), 0);
        accum = childLines.reduce((sum, c) => sum + (c.accum || 0), 0);
        target = childLines.reduce((sum, c) => sum + (c.target || 0), 0);
        forecast = childLines.reduce((sum, c) => sum + (c.forecast || 0), 0);

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

    case 'directCostSum':
      // 직접비 합계 (자식 합산, 매출 연동 계산)
      if (def.children) {
        const childLines = def.children.map((child) =>
          buildPlLine(child, data, mappings, targets, brandCode, context)
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
          buildPlLine(child, data, mappings, targets, brandCode, context)
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

      const vatExcForecastGP = data.accumDays > 0 ? (vatExcAccum / data.accumDays) * data.monthDays : 0;
      const cogsForecast = data.accumDays > 0 ? (cogsAccum / data.accumDays) * data.monthDays : 0;
      forecast = vatExcForecastGP - cogsForecast;

      // 컨텍스트에 저장 (영업이익 계산용)
      context.grossProfitForecast = forecast;
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
      
      const directPY = sumByLevel(data.prevYear, mappings, '직접비', undefined, undefined, dealerSupportItems)
        + data.dealerSupportPrevYear;
      const directAcc = sumByLevel(data.accum, mappings, '직접비', undefined, undefined, dealerSupportItems)
        + data.dealerSupportAccum;
      
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
        const excludeItems = def.type === 'dealerSupport' ? [] : dealerSupportItems;
        prevYear = sumByLevel(data.prevYear, mappings, def.level1, def.level2, def.level3, 
          def.level2 === '대리상지원금' ? [] : excludeItems);
        accum = sumByLevel(data.accum, mappings, def.level1, def.level2, def.level3,
          def.level2 === '대리상지원금' ? [] : excludeItems);
        target = getTarget(def.level1, def.level2, def.level3);
        
        // 직접비: 목표직접비 / 목표실판(V-) × 월말예상실판(V-)
        if (def.costCategory === 'direct') {
          if (target !== null && context.vatExcTarget > 0 && context.vatExcForecast > 0) {
            forecast = (target / context.vatExcTarget) * context.vatExcForecast;
          } else {
            forecast = null;
          }
        }
        // 영업비: 목표 그대로 (고정비)
        else if (def.costCategory === 'opex') {
          forecast = target;
        }
        // 기타: 일할 계산
        else {
          forecast = data.accumDays > 0 ? (accum / data.accumDays) * data.monthDays : null;
        }
      }
      break;
  }

  // 자식이 있으면 재귀 빌드
  let children: PlLine[] | undefined;
  if (def.children && def.type !== 'cogsSum' && def.type !== 'directCostSum' && def.type !== 'opexSum') {
    children = def.children.map((child) =>
      buildPlLine(child, data, mappings, targets, brandCode, context)
    );
  }

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
    const weeklyData = await getWeeklySales(lastDt, brandCodes);
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

export async function GET(request: NextRequest): Promise<NextResponse<ApiResponse>> {
  try {
    const { searchParams } = new URL(request.url);
    const ym = searchParams.get('ym') || getCurrentYm();
    const brand = searchParams.get('brand') || 'all';

    // 목표 CSV 로드
    const targetCsv = getTargetCsv(ym);
    if (!targetCsv) {
      return NextResponse.json({
        ym,
        brand,
        lastDt: '',
        accumDays: 0,
        monthDays: getMonthDays(ym),
        lines: [],
        error: `목표 데이터가 없습니다: ${ym}`,
      });
    }

    const mappings = getAccountMappings();
    const targets = parseTargetCsv(targetCsv);
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
      });
    }

    // 마지막 날짜 조회
    const lastDates = await getLastDates(ym, brandCodes);
    
    // 첫 번째 브랜드의 lastDt 사용 (전체의 경우 가장 늦은 날짜)
    let lastDt = '';
    let accumDays = 0;
    
    // 각 브랜드별 데이터 조회
    const brandDataList: Awaited<ReturnType<typeof calcBrandData>>[] = [];
    const brandDataMap = new Map<BrandCode, { lines: PlLine[]; prevYear: Record<string, number>; accum: Record<string, number> }>();
    
    for (const code of brandCodes) {
      const codeDt = lastDates[code] || '';
      if (!lastDt || codeDt > lastDt) {
        lastDt = codeDt;
      }
      
      if (codeDt) {
        const bData = await calcBrandData(ym, code, mappings, targets, codeDt);
        brandDataList.push(bData);
        if (bData.accumDays > accumDays) {
          accumDays = bData.accumDays;
        }
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
            dealerSupportPrevYear: bData.dealerSupportPrevYear,
            dealerSupportAccum: bData.dealerSupportAccum,
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
      dealerSupportPrevYear: number;
      dealerSupportAccum: number;
    };

    if (brand === 'all') {
      // 전체: 모든 브랜드 합산
      const merged: Record<string, number> = {};
      const mergedAccum: Record<string, number> = {};
      let totalDealerPY = 0;
      let totalDealerAccum = 0;

      for (const bd of brandDataList) {
        for (const [item, val] of Object.entries(bd.prevYear)) {
          merged[item] = (merged[item] || 0) + val;
        }
        for (const [item, val] of Object.entries(bd.accum)) {
          mergedAccum[item] = (mergedAccum[item] || 0) + val;
        }
        totalDealerPY += bd.dealerSupportPrevYear;
        totalDealerAccum += bd.dealerSupportAccum;
      }

      mergedData = {
        prevYear: merged,
        accum: mergedAccum,
        accumDays,
        monthDays,
        dealerSupportPrevYear: totalDealerPY,
        dealerSupportAccum: totalDealerAccum,
      };
    } else {
      // 개별 브랜드
      const bd = brandDataList[0];
      mergedData = {
        prevYear: bd.prevYear,
        accum: bd.accum,
        accumDays: bd.accumDays,
        monthDays,
        dealerSupportPrevYear: bd.dealerSupportPrevYear,
        dealerSupportAccum: bd.dealerSupportAccum,
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

    // PlLine 빌드
    const lines: PlLine[] = lineDefinitions.map((def) =>
      buildPlLine(def, mergedData, mappings, targets, brand === 'all' ? 'all' : (brand as BrandCode), context)
    );

    // 카드 요약 데이터 계산
    const summary = buildCardSummary(lines, mergedData, context);

    // 차트 데이터 (전체 페이지만)
    let charts: ChartData | undefined;
    if (brand === 'all' && brandDataMap.size > 0) {
      charts = await buildChartData(ym, lastDt, brandDataMap, lines, brandCodes);
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
