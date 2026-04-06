export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getKstCurrentYm, getKstYesterdayDate } from '@/lib/plforecast/date';
import { getCachedData, setCachedData, deleteDailyCache } from '@/lib/redis/cache';
import {
  getAllRetailSalesLastDt,
  getBrandRetailChannelSummary,
  type BrandRetailChannelSummaryRow,
} from '@/lib/plforecast/snowflake';

const CACHE_KEY = 'retail_brand_summary_v2';

function getRetailMonthEndDate(ym: string): string {
  const currentYm = getKstCurrentYm();
  if (ym === currentYm) return getKstYesterdayDate();
  const [year, month] = ym.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

type BrandCode = 'M' | 'I' | 'X';

interface BrandRetailMetric {
  cySalesAmt: number;
  pySalesAmt: number;
  yoy: number | null;
}

interface BrandRetailPeriodSummary {
  monthly: BrandRetailMetric;
  ytd: BrandRetailMetric;
}

export interface RetailBrandSummaryResponse {
  monthlyPeriodStart: string;
  ytdPeriodStart: string;
  periodEnd: string;
  total: Record<BrandCode, BrandRetailPeriodSummary>;
  dealer: Record<BrandCode, BrandRetailPeriodSummary>;
  direct: Record<BrandCode, BrandRetailPeriodSummary>;
  onlineDealer: Record<BrandCode, BrandRetailPeriodSummary>;
  onlineDirect: Record<BrandCode, BrandRetailPeriodSummary>;
}

function createMetric(cySalesAmt = 0, pySalesAmt = 0): BrandRetailMetric {
  return {
    cySalesAmt,
    pySalesAmt,
    yoy: pySalesAmt > 0 ? cySalesAmt / pySalesAmt : null,
  };
}

function createChannelSummary(): Record<BrandCode, BrandRetailPeriodSummary> {
  return {
    M: { monthly: createMetric(), ytd: createMetric() },
    I: { monthly: createMetric(), ytd: createMetric() },
    X: { monthly: createMetric(), ytd: createMetric() },
  };
}

function applyRows(
  target: RetailBrandSummaryResponse,
  rows: BrandRetailChannelSummaryRow[],
  period: 'monthly' | 'ytd',
  mode: 'offline' | 'online'
) {
  rows.forEach((row) => {
    const channelBucket =
      mode === 'offline'
        ? row.channel === 'dealer'
          ? target.dealer
          : target.direct
        : row.channel === 'dealer'
          ? target.onlineDealer
          : target.onlineDirect;
    channelBucket[row.brandCode][period] = createMetric(row.cySalesAmt, row.pySalesAmt);
  });
}

function fillTotalFromBuckets(target: RetailBrandSummaryResponse) {
  const buckets: Array<Record<BrandCode, BrandRetailPeriodSummary>> = [
    target.dealer,
    target.direct,
    target.onlineDealer,
    target.onlineDirect,
  ];
  (['M', 'I', 'X'] as BrandCode[]).forEach((brand) => {
    (['monthly', 'ytd'] as const).forEach((period) => {
      let cy = 0;
      let py = 0;
      for (const b of buckets) {
        cy += b[brand][period].cySalesAmt;
        py += b[brand][period].pySalesAmt;
      }
      target.total[brand][period] = createMetric(cy, py);
    });
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ym = searchParams.get('ym');
  const isDev = process.env.NODE_ENV === 'development';

  if (!ym) {
    return NextResponse.json({ error: 'ym 파라미터가 필요합니다.' }, { status: 400 });
  }

  const cachedData = await getCachedData<RetailBrandSummaryResponse>(ym, 'all', CACHE_KEY);
  if (cachedData) {
    console.log(`[retail-brand-summary Cache HIT] ${ym}`);
    return NextResponse.json(cachedData, {
      headers: {
        'Cache-Control': isDev ? 'no-store, no-cache, must-revalidate' : 'public, max-age=3600',
        'X-Cache': 'HIT',
      },
    });
  }

  console.log(`[retail-brand-summary Cache MISS] ${ym} - Snowflake 조회 시작`);

  try {
    let retailLastDt = await getAllRetailSalesLastDt(ym);
    if (!retailLastDt) {
      retailLastDt = getRetailMonthEndDate(ym);
    }

    const [
      monthlyOffline,
      ytdOffline,
      monthlyOnline,
      ytdOnline,
    ] = await Promise.all([
      getBrandRetailChannelSummary(ym, retailLastDt, 'monthly', 'Offline'),
      getBrandRetailChannelSummary(ym, retailLastDt, 'ytd', 'Offline'),
      getBrandRetailChannelSummary(ym, retailLastDt, 'monthly', 'Online'),
      getBrandRetailChannelSummary(ym, retailLastDt, 'ytd', 'Online'),
    ]);

    const response: RetailBrandSummaryResponse = {
      monthlyPeriodStart: `${ym}-01`,
      ytdPeriodStart: `${ym.substring(0, 4)}-01-01`,
      periodEnd: retailLastDt,
      total: createChannelSummary(),
      dealer: createChannelSummary(),
      direct: createChannelSummary(),
      onlineDealer: createChannelSummary(),
      onlineDirect: createChannelSummary(),
    };

    applyRows(response, monthlyOffline, 'monthly', 'offline');
    applyRows(response, ytdOffline, 'ytd', 'offline');
    applyRows(response, monthlyOnline, 'monthly', 'online');
    applyRows(response, ytdOnline, 'ytd', 'online');
    fillTotalFromBuckets(response);

    try {
      await setCachedData(ym, 'all', response, CACHE_KEY);
      console.log(`[retail-brand-summary Cache SET] ${ym}`);
    } catch (cacheErr) {
      console.error('[retail-brand-summary Cache Error] 저장 실패:', cacheErr);
    }

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': isDev ? 'no-store, no-cache, must-revalidate' : 'public, max-age=3600',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    console.error('[retail-brand-summary] 에러:', error);
    return NextResponse.json(
      {
        error: '데이터 조회 중 오류가 발생했습니다.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ym = searchParams.get('ym');

  if (!ym) {
    return NextResponse.json({ error: 'ym 파라미터가 필요합니다.' }, { status: 400 });
  }

  try {
    await deleteDailyCache(ym, 'all', CACHE_KEY);
    console.log(`[retail-brand-summary Cache DELETE] ${ym}`);
    return NextResponse.json({ success: true, deleted: `${ym}/all/${CACHE_KEY}` });
  } catch (error) {
    console.error('[retail-brand-summary Cache DELETE] 에러:', error);
    return NextResponse.json(
      { error: '캐시 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
