'use client';

import React, { useEffect, useState } from 'react';
import { formatK } from '@/lib/plforecast/format';
import type { RetailBrandSummaryResponse } from '@/app/api/retail-brand-summary/route';

type BrandCode = 'M' | 'I' | 'X';

const BRAND_LABELS: Record<BrandCode, string> = {
  M: 'MLB',
  I: 'MLB KIDS',
  X: 'DISCOVERY',
};

type ChannelDataKey = 'dealer' | 'direct' | 'onlineDealer' | 'onlineDirect';

const CHANNEL_ROWS: Array<{ dataKey: ChannelDataKey; title: string; accent: string }> = [
  { dataKey: 'dealer', title: 'OFF대리상', accent: 'text-violet-700' },
  { dataKey: 'direct', title: 'OFF직영', accent: 'text-cyan-700' },
  { dataKey: 'onlineDealer', title: 'ON대리상', accent: 'text-violet-600' },
  { dataKey: 'onlineDirect', title: 'ON직영', accent: 'text-cyan-600' },
];

const ROWS_PER_BRAND = 1 + CHANNEL_ROWS.length;

function formatPeriodDisplay(periodStart: string, periodEnd: string): string {
  const start = periodStart.replace(/-/g, '/');
  const [, month, day] = periodEnd.split('-');
  return `${start}~${month}/${day}`;
}

function formatYoy(yoy: number | null): string {
  if (yoy === null) return 'YoY -';
  return `${(yoy * 100).toFixed(1)}%`;
}

function yoyClass(yoy: number | null): string {
  if (yoy === null) return 'text-slate-400';
  return yoy >= 1 ? 'text-emerald-700' : 'text-rose-700';
}

export default function RetailBrandSummaryCard({ ym }: { ym: string }) {
  const [loadedYm, setLoadedYm] = useState<string | null>(null);
  const [data, setData] = useState<RetailBrandSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ym) return;
    let cancelled = false;

    fetch(`/api/retail-brand-summary?ym=${ym}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setData(null);
          setLoadedYm(ym);
          return;
        }
        setData(json);
        setError(null);
        setLoadedYm(ym);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || '조회 실패');
        setData(null);
        setLoadedYm(ym);
      });

    return () => {
      cancelled = true;
    };
  }, [ym]);

  if (!ym) return null;

  const isCurrentResponse = loadedYm === ym;
  const loading = !isCurrentResponse;
  const currentData = isCurrentResponse ? data : null;
  const currentError = isCurrentResponse ? error : null;

  const brands = ['M', 'I', 'X'] as BrandCode[];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-md shadow-gray-200/70 overflow-hidden transition-shadow hover:shadow-lg">
      <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-br from-slate-50 via-cyan-50/70 to-white">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-cyan-600" />
          <h3 className="text-base font-semibold tracking-tight text-slate-900">
            브랜드별 리테일(POP,WHS포함)
          </h3>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          {currentData ? (
            <>
              <span>당월MTD {formatPeriodDisplay(currentData.monthlyPeriodStart, currentData.periodEnd)}</span>
              <span className="mx-2 text-slate-300">|</span>
              <span>연간YTD {formatPeriodDisplay(currentData.ytdPeriodStart, currentData.periodEnd)}</span>
            </>
          ) : (
            <span>기간 확인 중</span>
          )}
        </div>
      </div>

      <div className="p-4">
        {loading && <div className="py-14 text-center text-sm text-slate-500">조회 중...</div>}
        {currentError && !loading && <div className="py-10 text-center text-sm text-rose-600">{currentError}</div>}
        {currentData && !loading && !currentError && (
          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b-2 border-slate-400">
                    <th className="w-24 px-3 py-3 text-left font-semibold text-slate-700">브랜드</th>
                    <th className="w-28 px-3 py-3 text-left font-semibold text-slate-700">채널</th>
                    <th className="px-3 py-3 text-right font-semibold text-slate-600">당월MTD</th>
                    <th className="px-3 py-3 text-right font-semibold text-slate-600">YoY</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">연간YTD</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">YoY</th>
                  </tr>
                </thead>
                <tbody>
                  {brands.flatMap((brand, brandIndex) => {
                    const isLastBrand = brandIndex === brands.length - 1;
                    const totalBucket = currentData.total[brand];
                    const tm = totalBucket.monthly;
                    const ty = totalBucket.ytd;

                    const totalRow = (
                      <tr key={`${brand}-total`} className="border-b border-slate-200/80 bg-slate-100">
                        <td
                          rowSpan={ROWS_PER_BRAND}
                          className="px-3 py-3 font-semibold text-slate-900 align-middle bg-slate-100 border-r border-slate-200/80"
                        >
                          {BRAND_LABELS[brand]}
                        </td>
                        <td className="px-3 py-3 font-semibold whitespace-nowrap text-slate-800 bg-slate-100">
                          합계
                        </td>
                        <td className="px-3 py-3 text-right bg-slate-100">
                          <div className="font-semibold text-slate-900">{formatK(tm.cySalesAmt)}K</div>
                        </td>
                        <td className={`px-3 py-3 text-right font-semibold bg-slate-100 ${yoyClass(tm.yoy)}`}>
                          {formatYoy(tm.yoy)}
                        </td>
                        <td className="px-4 py-3 text-right bg-slate-100">
                          <div className="font-semibold text-slate-900">{formatK(ty.cySalesAmt)}K</div>
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold bg-slate-100 ${yoyClass(ty.yoy)}`}>
                          {formatYoy(ty.yoy)}
                        </td>
                      </tr>
                    );

                    const channelRows = CHANNEL_ROWS.map((ch, chIndex) => {
                      const bucket = currentData[ch.dataKey][brand];
                      const monthly = bucket.monthly;
                      const ytd = bucket.ytd;
                      const isLastChannel = chIndex === CHANNEL_ROWS.length - 1;
                      const rowSep =
                        isLastChannel && !isLastBrand ? 'border-b-2 border-slate-200' : 'border-b border-slate-100';

                      return (
                        <tr key={`${brand}-${ch.dataKey}`} className={`bg-white ${rowSep}`}>
                          <td className={`px-3 py-3 font-medium whitespace-nowrap ${ch.accent}`}>{ch.title}</td>
                          <td className="px-3 py-3 text-right">
                            <div className="font-semibold text-slate-900">{formatK(monthly.cySalesAmt)}K</div>
                          </td>
                          <td className={`px-3 py-3 text-right font-semibold ${yoyClass(monthly.yoy)}`}>
                            {formatYoy(monthly.yoy)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="font-semibold text-slate-900">{formatK(ytd.cySalesAmt)}K</div>
                          </td>
                          <td className={`px-4 py-3 text-right font-semibold ${yoyClass(ytd.yoy)}`}>
                            {formatYoy(ytd.yoy)}
                          </td>
                        </tr>
                      );
                    });

                    return [totalRow, ...channelRows];
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
