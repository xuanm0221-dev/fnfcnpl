export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse, PlLine, BrandCode, LineDefinition, AccountMapping, TargetRow } from '@/lib/plforecast/types';
import { lineDefinitions, vatExcludedItem } from '@/lib/plforecast/lineDefinitions';
import { allBrandCodes, isValidBrandCode, codeToLabel } from '@/lib/plforecast/brand';
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
} from '@/lib/plforecast/snowflake';

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

// 월말예상 계산
function calcForecast(
  accum: number,
  accumDays: number,
  monthDays: number,
  costCategory?: 'direct' | 'opex'
): number {
  if (accumDays === 0) return 0;
  
  // 직접비: (누적/누적일수) × 당월일수
  if (costCategory === 'direct') {
    return (accum / accumDays) * monthDays;
  }
  
  // 영업비: 목표 그대로 (월 고정비이므로)
  // 실제로는 누적 그대로 사용하거나 목표를 사용해야 함
  // 여기서는 일단 직접비와 동일하게 계산
  if (costCategory === 'opex') {
    return (accum / accumDays) * monthDays;
  }
  
  // 기본: (누적/누적일수) × 당월일수
  return (accum / accumDays) * monthDays;
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
  brandCode: BrandCode | 'all'
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
      break;

    case 'dealerSupport':
      // 대리상지원금 (특수 계산)
      prevYear = data.dealerSupportPrevYear;
      accum = data.dealerSupportAccum;
      target = getTarget(def.level1, def.level2, def.level3);
      forecast = data.accumDays > 0 ? calcForecast(accum, data.accumDays, data.monthDays, def.costCategory) : null;
      break;

    case 'cogsSum':
    case 'directCostSum':
    case 'opexSum':
      // 자식 합계 (children이 있으면 자식 합산)
      if (def.children) {
        const childLines = def.children.map((child) =>
          buildPlLine(child, data, mappings, targets, brandCode)
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
      const vatExcTarget = getTarget('실판(V-)', '실판(V-)', '실판(V-)') || 0;
      const cogsTarget = (getTarget('매출원가', '매출원가', '매출원가') || 0)
        + (getTarget('평가감') || 0);
      target = vatExcTarget - cogsTarget;

      const vatExcForecast = data.accumDays > 0 ? (vatExcAccum / data.accumDays) * data.monthDays : 0;
      const cogsForecast = data.accumDays > 0 ? (cogsAccum / data.accumDays) * data.monthDays : 0;
      forecast = vatExcForecast - cogsForecast;
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
        forecast = data.accumDays > 0 ? calcForecast(accum, data.accumDays, data.monthDays, def.costCategory) : null;
      }
      break;
  }

  // 자식이 있으면 재귀 빌드
  let children: PlLine[] | undefined;
  if (def.children && def.type !== 'cogsSum' && def.type !== 'directCostSum' && def.type !== 'opexSum') {
    children = def.children.map((child) =>
      buildPlLine(child, data, mappings, targets, brandCode)
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

    // PlLine 빌드
    const lines: PlLine[] = lineDefinitions.map((def) =>
      buildPlLine(def, mergedData, mappings, targets, brand === 'all' ? 'all' : (brand as BrandCode))
    );

    return NextResponse.json({
      ym,
      brand,
      lastDt,
      accumDays,
      monthDays,
      lines,
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

