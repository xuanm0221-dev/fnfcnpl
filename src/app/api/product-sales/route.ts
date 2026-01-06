export const runtime = "nodejs";
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { NextRequest, NextResponse } from 'next/server';
import { getCategoryProductSales } from '@/lib/plforecast/snowflake';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ym = searchParams.get('ym');
  const lastDt = searchParams.get('lastDt');
  const brandCode = searchParams.get('brandCode');
  const type = searchParams.get('type') as 'tier' | 'region';
  const key = searchParams.get('key');
  const category = searchParams.get('category');

  if (!ym || !lastDt || !brandCode || !type || !key || !category) {
    return NextResponse.json({
      error: 'ym, lastDt, brandCode, type, key, category 파라미터가 필요합니다.',
      products: [],
    }, { 
      status: 400,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  }

  try {
    const products = await getCategoryProductSales(type, key, category, brandCode, ym, lastDt);
    // null 체크 및 빈 배열 기본값
    const safeProducts = Array.isArray(products) ? products : [];
    return NextResponse.json({ products: safeProducts }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('카테고리별 상품 판매 데이터 조회 오류:', error);
    return NextResponse.json({
      error: '데이터 조회 중 오류가 발생했습니다.',
      products: [], // 빈 배열 반환
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
