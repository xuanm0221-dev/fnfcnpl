export const runtime = "nodejs";
import { NextRequest, NextResponse } from 'next/server';
import { getClothingItemDetails } from '@/lib/plforecast/snowflake';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const brandCode = searchParams.get('brandCode');
  const itemCd = searchParams.get('itemCd');
  const lastDt = searchParams.get('lastDt');
  const season = searchParams.get('season') || '25F'; // 기본값: 25F

  if (!brandCode || !itemCd || !lastDt) {
    return NextResponse.json({
      error: 'brandCode, itemCd, lastDt 파라미터가 필요합니다.',
      details: [],
    }, { status: 400 });
  }

  try {
    const details = await getClothingItemDetails(brandCode, itemCd, lastDt, season);
    return NextResponse.json({ details });
  } catch (error) {
    console.error('의류 아이템 상세 조회 오류:', error);
    return NextResponse.json({
      error: '데이터 조회 중 오류가 발생했습니다.',
      details: [],
    }, { status: 500 });
  }
}

