export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  getSnapshot,
  setSnapshot,
  deleteSnapshot,
  hasSnapshot,
  type SnapshotType,
} from '@/lib/redis/cache';

/**
 * GET /api/snapshot?type=retail&ym=2026-02&brand=M
 * 스냅샷 존재 여부 및 데이터 조회
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as SnapshotType | null;
    const ym = searchParams.get('ym') || '';
    const brand = searchParams.get('brand') || undefined;

    if (!type || !ym) {
      return NextResponse.json({ error: 'type, ym 파라미터 필요' }, { status: 400 });
    }

    const exists = await hasSnapshot(type, ym, brand);
    let data = null;
    if (exists) {
      data = await getSnapshot(type, ym, brand);
    }

    return NextResponse.json({ exists, data });
  } catch (error) {
    console.error('[snapshot GET] 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/snapshot
 * 스냅샷 저장 (클라이언트가 이미 보유한 데이터를 전달)
 *
 * Body: { type, ym, brand, data }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, ym, brand, data } = body as {
      type: SnapshotType;
      ym: string;
      brand?: string;
      data: unknown;
    };

    if (!type || !ym || data === undefined) {
      return NextResponse.json({ error: 'type, ym, data 필수' }, { status: 400 });
    }

    await setSnapshot(type, ym, brand, data);

    return NextResponse.json({ success: true, type, ym, brand });
  } catch (error) {
    console.error('[snapshot POST] 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/snapshot?type=retail&ym=2026-02&brand=M
 * 스냅샷 삭제 (재계산 트리거)
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as SnapshotType | null;
    const ym = searchParams.get('ym') || '';
    const brand = searchParams.get('brand') || undefined;

    if (!type || !ym) {
      return NextResponse.json({ error: 'type, ym 파라미터 필요' }, { status: 400 });
    }

    await deleteSnapshot(type, ym, brand);

    return NextResponse.json({ success: true, type, ym, brand });
  } catch (error) {
    console.error('[snapshot DELETE] 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
