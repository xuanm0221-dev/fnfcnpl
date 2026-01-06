export const runtime = "nodejs";
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { NextRequest, NextResponse } from 'next/server';
import { getCategorySalesData } from '@/lib/plforecast/snowflake';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ym = searchParams.get('ym');
  const lastDt = searchParams.get('lastDt');
  const brandCode = searchParams.get('brandCode');
  const type = searchParams.get('type') as 'tier' | 'region';
  const key = searchParams.get('key');

  if (!ym || !lastDt || !brandCode || !type || !key) {
    return NextResponse.json({
      error: 'ym, lastDt, brandCode, type, key 파라미터가 필요합니다.',
      categories: [],
    }, { 
      status: 400,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  }

  // 요청 파라미터 로깅
  console.log('[category-sales] 요청 파라미터:', { type, key, brandCode, ym, lastDt });

  try {
    const categories = await getCategorySalesData(type, key, brandCode, ym, lastDt);
    // null 체크 및 빈 배열 기본값
    const safeCategories = Array.isArray(categories) ? categories : [];
    console.log('[category-sales] 응답 데이터:', { 
      count: safeCategories.length, 
      categories: safeCategories.map(c => ({ category: c?.category, cySalesAmt: c?.cySalesAmt }))
    });
    return NextResponse.json({ categories: safeCategories }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('[category-sales] 카테고리 판매 데이터 조회 오류:', error);
    console.error('[category-sales] 에러 상세:', error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name
    } : error);
    return NextResponse.json({
      error: '데이터 조회 중 오류가 발생했습니다.',
      errorDetail: error instanceof Error ? error.message : String(error),
      categories: [], // 빈 배열 반환
    }, { 
      status: 500,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  }
}
