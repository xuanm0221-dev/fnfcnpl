export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import {
  getRetailSalesData,
  getRetailSalesLastDt,
  getTradeZoneSalesData,
  getTierSalesData,
  getRegionSalesData,
  getShopLevelSalesData,
  getCategorySalesByMonth,
} from '@/lib/plforecast/snowflake';
import { getKstCurrentYm, getKstYesterdayDate } from '@/lib/plforecast/date';

function getRetailMonthEndDate(ym: string): string {
  const currentYm = getKstCurrentYm();
  if (ym === currentYm) return getKstYesterdayDate();
  const [year, month] = ym.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

const brandCodeToShopName: Record<string, string> = {
  M: 'MLB',
  I: 'MLB KIDS',
  X: 'DISCOVERY',
};

export type RetailSummaryType = 'tradeZone' | 'shopLevel' | 'tier' | 'region';

export interface RetailSummaryLevel2Row {
  key: string;
  cySalesAmt: number;
  pySalesAmt: number;
  yoy: number | null;
  discountRate: number | null;
  discountRateYoy: number | null;
}

export interface RetailSummaryCategoryLevel1Item {
  cyAccumAmt: number;
  pyAccumAmt: number;
  yoy: number | null;
}

export interface RetailSummaryCategoryLevel1 {
  wear: RetailSummaryCategoryLevel1Item;
  acc: RetailSummaryCategoryLevel1Item;
  yoy: number | null; // wear+acc 합계 기준 (헤더/테두리 색상용)
}

export interface RetailSummaryResponse {
  periodStart: string;
  periodEnd: string;
  mode: 'monthly' | 'ytd';
  level1: {
    cySalesAmt: number;
    pySalesAmt: number;
    yoy: number | null;
  };
  categoryLevel1: RetailSummaryCategoryLevel1 | null;
  level2: RetailSummaryLevel2Row[];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ym = searchParams.get('ym');
  const brand = searchParams.get('brand');
  const mode = searchParams.get('mode') as 'monthly' | 'ytd' | null;
  const type = searchParams.get('type') as RetailSummaryType | null;

  if (!ym || !brand || !mode || !type) {
    return NextResponse.json(
      { error: 'ym, brand, mode, type 파라미터가 필요합니다.' },
      { status: 400 }
    );
  }

  const brandCode = brand;
  const shopBrandName = brandCodeToShopName[brandCode];
  if (!shopBrandName) {
    return NextResponse.json(
      { error: `지원하지 않는 브랜드: ${brand}` },
      { status: 400 }
    );
  }

  const validTypes: RetailSummaryType[] = ['tradeZone', 'shopLevel', 'tier', 'region'];
  if (!validTypes.includes(type)) {
    return NextResponse.json(
      { error: `유효하지 않은 type: ${type}` },
      { status: 400 }
    );
  }

  if (mode !== 'monthly' && mode !== 'ytd') {
    return NextResponse.json(
      { error: 'mode는 monthly 또는 ytd 여야 합니다.' },
      { status: 400 }
    );
  }

  const range = mode;

  try {
    let retailLastDt = await getRetailSalesLastDt(brandCode, ym);
    if (!retailLastDt) {
      retailLastDt = getRetailMonthEndDate(ym);
    }

    const [retailData, typeData, categorySales] = await Promise.all([
      getRetailSalesData(ym, retailLastDt, brandCode, shopBrandName, range),
      (async () => {
        const common = [ym, retailLastDt, brandCode, shopBrandName, range] as const;
        if (type === 'tradeZone') return getTradeZoneSalesData(...common);
        if (type === 'shopLevel') return getShopLevelSalesData(...common);
        if (type === 'tier') return getTierSalesData(...common);
        return getRegionSalesData(...common);
      })(),
      getCategorySalesByMonth(brandCode, ym, retailLastDt, range),
    ]);

    const periodStart =
      range === 'ytd'
        ? `${ym.substring(0, 4)}-01-01`
        : `${ym}-01`;
    const periodEnd = retailLastDt;

    const level1 = {
      cySalesAmt: retailData.cySalesAmt,
      pySalesAmt: retailData.lyCumSalesAmt,
      yoy:
        retailData.lyCumSalesAmt > 0
          ? retailData.cySalesAmt / retailData.lyCumSalesAmt
          : null,
    };

    const ACC_CATEGORIES = ['신발', '모자', '가방', '기타'];
    const isAcc = (cat: string) => ACC_CATEGORIES.includes(cat);
    const wearCy = categorySales.filter((r) => !isAcc(r.category)).reduce((s, r) => s + (r.cyAccumAmt || 0), 0);
    const wearPy = categorySales.filter((r) => !isAcc(r.category)).reduce((s, r) => s + (r.pyAccumAmt || 0), 0);
    const accCy = categorySales.filter((r) => isAcc(r.category)).reduce((s, r) => s + (r.cyAccumAmt || 0), 0);
    const accPy = categorySales.filter((r) => isAcc(r.category)).reduce((s, r) => s + (r.pyAccumAmt || 0), 0);
    const totalCy = wearCy + accCy;
    const totalPy = wearPy + accPy;
    const categoryLevel1: RetailSummaryCategoryLevel1 | null =
      categorySales.length > 0
        ? {
            wear: {
              cyAccumAmt: wearCy,
              pyAccumAmt: wearPy,
              yoy: wearPy > 0 ? wearCy / wearPy : null,
            },
            acc: {
              cyAccumAmt: accCy,
              pyAccumAmt: accPy,
              yoy: accPy > 0 ? accCy / accPy : null,
            },
            yoy: totalPy > 0 ? totalCy / totalPy : null,
          }
        : null;

    const currentRows = typeData.current;
    const prevRows = typeData.prevYear;

    const level2: RetailSummaryLevel2Row[] = currentRows.map((row) => {
      const prev = prevRows.find((p) => p?.key === row.key);
      const pySalesAmt = prev?.prevCumSalesAmt ?? prev?.salesAmt ?? 0;
      const pyTagAmt = prev?.prevTagAmt ?? prev?.tagAmt ?? 0;

      const discountRate =
        row.tagAmt > 0 ? (1 - row.salesAmt / row.tagAmt) * 100 : null;
      const prevDiscountRate =
        pyTagAmt > 0 ? (1 - pySalesAmt / pyTagAmt) * 100 : null;
      const discountRateYoy =
        discountRate !== null && prevDiscountRate !== null
          ? discountRate - prevDiscountRate
          : null;

      const yoy = pySalesAmt > 0 ? row.salesAmt / pySalesAmt : null;

      return {
        key: row.key || 'Unknown',
        cySalesAmt: row.salesAmt,
        pySalesAmt,
        yoy,
        discountRate,
        discountRateYoy,
      };
    });

    // 브랜드 페이지와 동일한 고정 순서 적용 (tradeZone → shopLevel → tier → region)
    const tradeZoneOrder = ['H', 'F1', 'F2', 'F3', 'F4', 'O1', 'O2', 'O3'];
    const shopLevelOrder = ['S', 'A', 'B', 'C', 'Outlet', 'Pop-up'];
    const tierOrder = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'];
    const regionOrder = ['华东', '华东/华中', '华南', '华北', '东北', '西南', '西北'];
    const orderMap: Record<RetailSummaryType, string[]> = {
      tradeZone: tradeZoneOrder,
      shopLevel: shopLevelOrder,
      tier: tierOrder,
      region: regionOrder,
    };
    const order = orderMap[type];
    const sortByFixedOrder = (items: RetailSummaryLevel2Row[], ord: string[]): RetailSummaryLevel2Row[] =>
      [...items].sort((a, b) => {
        const ia = ord.indexOf(a.key);
        const ib = ord.indexOf(b.key);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return b.cySalesAmt - a.cySalesAmt;
      });

    const response: RetailSummaryResponse = {
      periodStart,
      periodEnd,
      mode,
      level1,
      categoryLevel1,
      level2: sortByFixedOrder(level2, order),
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  } catch (error) {
    console.error('[retail-summary] 에러:', error);
    return NextResponse.json(
      {
        error: '데이터 조회 중 오류가 발생했습니다.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
