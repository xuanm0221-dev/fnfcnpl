export const runtime = "nodejs";
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getShopMonthlySales } from '@/lib/plforecast/snowflake';
import { getKstYesterdayDate, getKstCurrentYm } from '@/lib/plforecast/date';

/**
 * 정규매장별 월별 리테일 매출 조회 API
 * GET /api/shop-monthly-sales?ym=2026-01&viewType=12months&year=2026
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const ym = searchParams.get('ym') || getKstCurrentYm();
    const viewType = searchParams.get('viewType') as 'year' | '12months' || '12months';
    const yearParam = searchParams.get('year');
    const year = yearParam ? parseInt(yearParam, 10) : undefined;
    
    // 기준일 계산 (기준월이 현재 월이면 전일, 아니면 해당 월의 마지막 날)
    const [y, m] = ym.split('-').map(Number);
    const currentYm = getKstCurrentYm();
    const lastDt = ym === currentYm 
      ? getKstYesterdayDate() 
      : `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
    
    // DISCOVERY 브랜드 고정
    const brandCode = 'X';
    
    // 데이터 조회
    const data = await getShopMonthlySales(ym, lastDt, viewType, year, brandCode);
    
    return NextResponse.json({
      success: true,
      data,
      ym,
      lastDt,
      viewType,
      year
    });
  } catch (error) {
    console.error('[shop-monthly-sales] API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}