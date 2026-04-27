export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getKstCurrentYm, getKstYesterdayDate } from '@/lib/plforecast/date';
import {
  getAllRetailSalesLastDt,
  getBrandRetailUnassignedShops,
  type BrandRetailUnassignedShopRow,
} from '@/lib/plforecast/snowflake';

function getRetailMonthEndDate(ym: string): string {
  const currentYm = getKstCurrentYm();
  if (ym === currentYm) return getKstYesterdayDate();
  const [year, month] = ym.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

export interface RetailBrandUnassignedResponse {
  ym: string;
  range: 'monthly' | 'ytd';
  brand: 'M' | 'I' | 'X' | 'all';
  periodEnd: string;
  rows: BrandRetailUnassignedShopRow[];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ym = searchParams.get('ym');
  const rangeParam = (searchParams.get('range') ?? 'monthly') as 'monthly' | 'ytd';
  const brandParam = (searchParams.get('brand') ?? 'all') as 'M' | 'I' | 'X' | 'all';

  if (!ym) {
    return NextResponse.json({ error: 'ym 파라미터가 필요합니다.' }, { status: 400 });
  }
  if (rangeParam !== 'monthly' && rangeParam !== 'ytd') {
    return NextResponse.json({ error: 'range는 monthly 또는 ytd 입니다.' }, { status: 400 });
  }

  try {
    let retailLastDt = await getAllRetailSalesLastDt(ym);
    if (!retailLastDt) {
      retailLastDt = getRetailMonthEndDate(ym);
    }

    const rows = await getBrandRetailUnassignedShops(
      ym,
      retailLastDt,
      rangeParam,
      brandParam === 'all' ? undefined : brandParam
    );

    const body: RetailBrandUnassignedResponse = {
      ym,
      range: rangeParam,
      brand: brandParam,
      periodEnd: retailLastDt,
      rows,
    };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[retail-brand-summary/unassigned] 에러:', error);
    return NextResponse.json(
      {
        error: '데이터 조회 중 오류가 발생했습니다.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
