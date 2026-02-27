export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getKstCurrentYm, getKstYesterdayDate } from '@/lib/plforecast/date';
import {
  getAllRetailSalesLastDt,
  getBrandRetailChannelSummary,
  type BrandRetailChannelSummaryRow,
} from '@/lib/plforecast/snowflake';

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
  dealer: Record<BrandCode, BrandRetailPeriodSummary>;
  direct: Record<BrandCode, BrandRetailPeriodSummary>;
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
  period: 'monthly' | 'ytd'
) {
  rows.forEach((row) => {
    const channelBucket = row.channel === 'dealer' ? target.dealer : target.direct;
    channelBucket[row.brandCode][period] = createMetric(row.cySalesAmt, row.pySalesAmt);
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ym = searchParams.get('ym');

  if (!ym) {
    return NextResponse.json({ error: 'ym 파라미터가 필요합니다.' }, { status: 400 });
  }

  try {
    let retailLastDt = await getAllRetailSalesLastDt(ym);
    if (!retailLastDt) {
      retailLastDt = getRetailMonthEndDate(ym);
    }

    const [monthlyRows, ytdRows] = await Promise.all([
      getBrandRetailChannelSummary(ym, retailLastDt, 'monthly'),
      getBrandRetailChannelSummary(ym, retailLastDt, 'ytd'),
    ]);

    const response: RetailBrandSummaryResponse = {
      monthlyPeriodStart: `${ym}-01`,
      ytdPeriodStart: `${ym.substring(0, 4)}-01-01`,
      periodEnd: retailLastDt,
      dealer: createChannelSummary(),
      direct: createChannelSummary(),
    };

    applyRows(response, monthlyRows, 'monthly');
    applyRows(response, ytdRows, 'ytd');

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
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
