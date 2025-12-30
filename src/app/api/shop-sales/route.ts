export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import type { ShopSalesDetail } from '@/lib/plforecast/types';
import { getShopSalesDetails } from '@/lib/plforecast/snowflake';

interface ShopSalesResponse {
  ym: string;
  brand: string;
  lastDt: string;
  shops: ShopSalesDetail[];
  error?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse<ShopSalesResponse>> {
  try {
    const { searchParams } = new URL(request.url);
    const ym = searchParams.get('ym') || '';
    const brand = searchParams.get('brand') || '';
    const lastDt = searchParams.get('lastDt') || '';
    const year = (searchParams.get('year') || 'current') as 'current' | 'prev';

    if (!ym || !brand || !lastDt) {
      return NextResponse.json({
        ym,
        brand,
        lastDt,
        shops: [],
        error: '필수 파라미터가 없습니다 (ym, brand, lastDt)',
      });
    }

    // M, I, X 브랜드만 지원
    if (!['M', 'I', 'X'].includes(brand)) {
      return NextResponse.json({
        ym,
        brand,
        lastDt,
        shops: [],
        error: `지원하지 않는 브랜드입니다: ${brand}`,
      });
    }

    const shops = await getShopSalesDetails(ym, lastDt, brand, year);

    return NextResponse.json({
      ym,
      brand,
      lastDt,
      shops,
    });
  } catch (error) {
    console.error('Shop Sales API Error:', error);
    return NextResponse.json({
      ym: '',
      brand: '',
      lastDt: '',
      shops: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

