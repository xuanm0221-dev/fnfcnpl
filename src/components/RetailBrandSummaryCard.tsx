'use client';

import React, { useEffect, useState } from 'react';
import { formatK } from '@/lib/plforecast/format';
import type { RetailBrandSummaryResponse } from '@/app/api/retail-brand-summary/route';

type BrandCode = 'M' | 'I' | 'X';
type ChannelType = 'dealer' | 'direct';

const BRAND_LABELS: Record<BrandCode, string> = {
  M: 'MLB',
  I: 'MLB KIDS',
  X: 'DISCOVERY',
};

const SECTION_META: Array<{ key: ChannelType; title: string; accent: string }> = [
  { key: 'dealer', title: '대리상', accent: 'text-violet-700' },
  { key: 'direct', title: '직영', accent: 'text-cyan-700' },
];

function formatPeriodDisplay(periodStart: string, periodEnd: string): string {
  const start = periodStart.replace(/-/g, '/');
  const [, month, day] = periodEnd.split('-');
  return `${start}~${month}/${day}`;
}

function formatYoy(yoy: number | null): string {
  if (yoy === null) return 'YoY -';
  return `${(yoy * 100).toFixed(1)}%`;
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
              <span>당월YTD {formatPeriodDisplay(currentData.monthlyPeriodStart, currentData.periodEnd)}</span>
              <span className="mx-2 text-slate-300">|</span>
              <span>연간MTD {formatPeriodDisplay(currentData.ytdPeriodStart, currentData.periodEnd)}</span>
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
          <div className="space-y-4">
            {SECTION_META.map((section) => {
              const sectionData = currentData[section.key];

              return (
                <div key={section.key} className="rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className={`w-28 px-4 py-3 text-left font-semibold ${section.accent}`}>
                            {section.title}
                          </th>
                          <th className="px-3 py-3 text-right font-semibold text-slate-600">당월YTD</th>
                          <th className="px-3 py-3 text-right font-semibold text-slate-600">YoY</th>
                          <th className="px-4 py-3 text-right font-semibold text-slate-600">연간MTD</th>
                          <th className="px-4 py-3 text-right font-semibold text-slate-600">YoY</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(['M', 'I', 'X'] as BrandCode[]).map((brand, index) => {
                          const monthly = sectionData[brand].monthly;
                          const ytd = sectionData[brand].ytd;
                          return (
                            <tr
                              key={brand}
                              className={index < 2 ? 'border-b border-slate-100' : ''}
                            >
                              <td className="px-4 py-3 font-semibold text-slate-900">{BRAND_LABELS[brand]}</td>
                              <td className="px-3 py-3 text-right">
                                <div className="font-semibold text-slate-900">{formatK(monthly.cySalesAmt)}K</div>
                              </td>
                              <td
                                className={`px-3 py-3 text-right font-semibold ${
                                  monthly.yoy === null
                                    ? 'text-slate-400'
                                    : monthly.yoy >= 1
                                      ? 'text-emerald-700'
                                      : 'text-rose-700'
                                }`}
                              >
                                {formatYoy(monthly.yoy)}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="font-semibold text-slate-900">{formatK(ytd.cySalesAmt)}K</div>
                              </td>
                              <td
                                className={`px-4 py-3 text-right font-semibold ${
                                  ytd.yoy === null
                                    ? 'text-slate-400'
                                    : ytd.yoy >= 1
                                      ? 'text-emerald-700'
                                      : 'text-rose-700'
                                }`}
                              >
                                {formatYoy(ytd.yoy)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
