export const runtime = "nodejs";
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getShopMonthlySales } from '@/lib/plforecast/snowflake';
import { getKstYesterdayDate, getKstCurrentYm } from '@/lib/plforecast/date';
import {
  getSnapshot,
  setSnapshot,
  deleteSnapshot,
  hasSnapshot,
} from '@/lib/redis/cache';
import type { ShopMonthlySalesData } from '@/lib/plforecast/types';

/**
 * 정규매장별 월별 리테일 매출 조회 API
 * GET /api/shop-monthly-sales?ym=2026-01&viewType=12months&year=2026
 *
 * DX 스냅샷 키: snapshot:dx:X (brand=X 고정)
 * 스냅샷이 있으면 스냅샷 데이터 반환, 없으면 Snowflake 조회
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

    // DX 스냅샷 키 (viewType + year/ym 조합으로 고유화)
    const snapshotKey = viewType === 'year' && year
      ? `${viewType}:${year}`
      : `${viewType}:${ym}`;
    // Redis setSnapshot에서 ym 파라미터로 key suffix 사용
    const snapYm = `dx-${snapshotKey}`;

    // 스냅샷 확인
    const snapExists = await hasSnapshot('dx', snapYm, brandCode);
    if (snapExists) {
      const snap = await getSnapshot<ShopMonthlySalesData>('dx', snapYm, brandCode);
      if (snap) {
        console.log(`[DX Snapshot] 스냅샷 데이터 반환: ${snapYm}`);
        return NextResponse.json({
          success: true,
          data: snap,
          ym,
          lastDt,
          viewType,
          year,
          fromSnapshot: true,
        });
      }
    }

    // Snowflake 조회
    const data = await getShopMonthlySales(ym, lastDt, viewType, year, brandCode);

    return NextResponse.json({
      success: true,
      data,
      ym,
      lastDt,
      viewType,
      year,
      fromSnapshot: false,
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

/**
 * DX 스냅샷 저장
 * POST /api/shop-monthly-sales
 * Body: { ym, viewType, year, data }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ym, viewType, year, data } = body as {
      ym: string;
      viewType: 'year' | '12months';
      year?: number;
      data: ShopMonthlySalesData;
    };

    if (!ym || !viewType || !data) {
      return NextResponse.json({ error: 'ym, viewType, data 필수' }, { status: 400 });
    }

    const brandCode = 'X';
    const snapshotKey = viewType === 'year' && year
      ? `${viewType}:${year}`
      : `${viewType}:${ym}`;
    const snapYm = `dx-${snapshotKey}`;

    await setSnapshot('dx', snapYm, brandCode, data);

    return NextResponse.json({ success: true, snapYm });
  } catch (error) {
    console.error('[shop-monthly-sales POST] 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * DX 스냅샷 삭제 (재계산)
 * DELETE /api/shop-monthly-sales?ym=2026-01&viewType=12months&year=2026
 */
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const ym = searchParams.get('ym') || '';
    const viewType = searchParams.get('viewType') as 'year' | '12months' || '12months';
    const yearParam = searchParams.get('year');
    const year = yearParam ? parseInt(yearParam, 10) : undefined;

    const brandCode = 'X';
    const snapshotKey = viewType === 'year' && year
      ? `${viewType}:${year}`
      : `${viewType}:${ym}`;
    const snapYm = `dx-${snapshotKey}`;

    await deleteSnapshot('dx', snapYm, brandCode);

    return NextResponse.json({ success: true, snapYm });
  } catch (error) {
    console.error('[shop-monthly-sales DELETE] 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
