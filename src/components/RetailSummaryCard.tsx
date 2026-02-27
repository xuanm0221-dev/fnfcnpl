'use client';

import React, { useEffect, useState } from 'react';
import { formatK } from '@/lib/plforecast/format';
import type { RetailSummaryResponse, RetailSummaryType } from '@/app/api/retail-summary/route';

const TYPE_LABELS: Record<RetailSummaryType, string> = {
  tradeZone: 'Trade Zone',
  shopLevel: 'Shop Level',
  tier: 'Tier',
  region: '지역',
};

const BRAND_TITLES: Record<'M' | 'I' | 'X', string> = {
  M: 'MLB 리테일 (대리상 OFF)',
  I: 'MLB KIDS 리테일 (대리상 OFF)',
  X: 'DISCOVERY 리테일 (대리상 OFF)',
};

const BRAND_THEME: Record<'M' | 'I' | 'X', { chip: string; halo: string; title: string }> = {
  M: {
    chip: 'bg-blue-600',
    halo: 'from-blue-50/85 via-indigo-50/70 to-white',
    title: 'text-blue-900',
  },
  I: {
    chip: 'bg-emerald-600',
    halo: 'from-emerald-50/85 via-teal-50/70 to-white',
    title: 'text-emerald-900',
  },
  X: {
    chip: 'bg-orange-500',
    halo: 'from-orange-50/85 via-amber-50/70 to-white',
    title: 'text-orange-900',
  },
};

const MODE_ACTIVE_CLASS: Record<'M' | 'I' | 'X', string> = {
  M: 'bg-blue-600 text-white shadow-md shadow-blue-300/45',
  I: 'bg-emerald-600 text-white shadow-md shadow-emerald-300/45',
  X: 'bg-orange-500 text-white shadow-md shadow-orange-300/45',
};

const TYPE_ACTIVE_CLASS: Record<'M' | 'I' | 'X', string> = {
  M: 'bg-blue-900 text-white shadow-sm',
  I: 'bg-emerald-900 text-white shadow-sm',
  X: 'bg-orange-900 text-white shadow-sm',
};

function formatPeriodDisplay(periodStart: string, periodEnd: string): string {
  const start = periodStart.replace(/-/g, '/');
  const [, m, d] = periodEnd.split('-');
  return `${start}~${m}/${d}`;
}

export default function RetailSummaryCard({ ym, brand }: { ym: string; brand: 'M' | 'I' | 'X' }) {
  const [mode, setMode] = useState<'monthly' | 'ytd'>('monthly');
  const [type, setType] = useState<RetailSummaryType>('tradeZone');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<RetailSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ym) return;
    setLoading(true);
    setError(null);
    fetch(`/api/retail-summary?ym=${ym}&brand=${brand}&mode=${mode}&type=${type}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setError(json.error);
          setData(null);
        } else {
          setData(json);
        }
      })
      .catch((err) => {
        setError(err?.message || '조회 실패');
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [ym, brand, mode, type]);

  if (!ym) return null;

  const yoy = data?.level1?.yoy;
  const borderColor =
    yoy !== null && yoy !== undefined && yoy >= 1
      ? 'border-emerald-300/60'
      : yoy !== null && yoy !== undefined
        ? 'border-rose-300/60'
        : 'border-gray-200';
  const theme = BRAND_THEME[brand];

  return (
    <div className={`bg-white rounded-2xl border shadow-md shadow-gray-200/70 overflow-hidden transition-shadow hover:shadow-lg ${borderColor}`}>
      {/* 헤더: YoY와 동일한 배경 (톤 다운: 증가=emerald/teal, 감소=rose/red, null=gray) */}
      <div
        className={`px-5 py-4 border-b border-gray-100 bg-gradient-to-br ${theme.halo} ${
          yoy !== null && yoy !== undefined && yoy >= 1
            ? 'ring-1 ring-emerald-200/55'
            : yoy !== null && yoy !== undefined
              ? 'ring-1 ring-rose-200/55'
              : 'ring-1 ring-gray-200/65'
        }`}
      >
        {/* 1행: 제목 | 당월YTD·연간YTD 전환탭 | 매장유형 전환탭 */}
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${theme.chip}`} />
          <h3 className={`text-base font-semibold tracking-tight ${theme.title}`}>
            {BRAND_TITLES[brand]}
          </h3>
          <div className="ml-auto flex rounded-full bg-white/90 p-1 ring-1 ring-white/70 shadow-sm backdrop-blur-sm">
            <button
              onClick={() => setMode('monthly')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold tracking-tight transition-all duration-200 ${
                mode === 'monthly'
                  ? MODE_ACTIVE_CLASS[brand]
                  : 'text-gray-600 hover:bg-white hover:text-gray-800 hover:shadow-sm'
              }`}
            >
              당월YTD
            </button>
            <button
              onClick={() => setMode('ytd')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold tracking-tight transition-all duration-200 ${
                mode === 'ytd'
                  ? MODE_ACTIVE_CLASS[brand]
                  : 'text-gray-600 hover:bg-white hover:text-gray-800 hover:shadow-sm'
              }`}
            >
              연간MTD
            </button>
          </div>
          <div className="flex gap-1.5 rounded-xl bg-white/55 p-1 ring-1 ring-white/80 backdrop-blur-sm">
            {(['tradeZone', 'shopLevel', 'tier', 'region'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-tight transition-all duration-200 ${
                  type === t
                    ? TYPE_ACTIVE_CLASS[brand]
                    : 'bg-white/85 text-gray-600 ring-1 ring-gray-200 hover:bg-white hover:text-gray-800 hover:shadow-sm'
                }`}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
        {/* 2행: 조회기간 (연한회색) */}
        <div className="mt-1.5">
          {data ? (
            <span className="text-sm font-mono text-gray-400">
              ({formatPeriodDisplay(data.periodStart, data.periodEnd)})
            </span>
          ) : (
            <span className="text-sm text-gray-400">(-)</span>
          )}
        </div>
      </div>

      {/* 내용 */}
      <div className="p-5">
        {loading && (
          <div className="py-12 text-center text-gray-500 text-sm">조회 중...</div>
        )}
        {error && (
          <div className="py-8 text-center text-rose-600 text-sm">{error}</div>
        )}
        {data && !loading && !error && (
          <>
            {/* 레벨1 카드 2개: 누적실적(YoY) + 의류/ACC */}
            <div className="grid gap-4 mb-5 pb-5 border-b border-gray-200 lg:grid-cols-2">
              <div className="relative overflow-hidden rounded-2xl p-4 border border-indigo-200/80 bg-gradient-to-br from-indigo-50 via-blue-50 to-white shadow-sm">
                <div className="absolute right-3 top-3 h-10 w-10 rounded-full bg-indigo-200/35 blur-md" />
                <div className="mb-1 inline-flex items-center rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200/70">
                  누적실적 (YoY)
                </div>
                <div className="text-2xl font-bold tracking-tight text-gray-900">
                  {formatK(data.level1.cySalesAmt)}K
                  <span
                    className={`ml-1.5 text-base font-semibold ${
                      data.level1.yoy !== null && data.level1.yoy >= 1
                        ? 'text-emerald-700'
                        : data.level1.yoy !== null
                          ? 'text-rose-700'
                          : 'text-gray-500'
                    }`}
                  >
                    {data.level1.yoy !== null
                      ? `(YoY ${(data.level1.yoy * 100).toFixed(1)}%)`
                      : '(YoY -)'}
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-500">전년 {formatK(data.level1.pySalesAmt)}K</div>
              </div>
              <div
                className={`rounded-2xl p-4 border shadow-sm ${
                  (data.categoryLevel1?.yoy != null && (data.categoryLevel1?.yoy ?? 0) >= 1)
                    ? 'border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-teal-50 to-white'
                    : data.categoryLevel1?.yoy != null
                      ? 'border-rose-200/80 bg-gradient-to-br from-rose-50 via-red-50 to-white'
                      : 'border-gray-200 bg-gradient-to-br from-gray-50 to-white'
                }`}
              >
                {data.categoryLevel1?.wear && data.categoryLevel1?.acc ? (
                  <div className="space-y-2">
                    <div className="rounded-lg bg-white/80 px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-white/90">
                      의류: {formatK(data.categoryLevel1.wear.cyAccumAmt)}K
                      {data.categoryLevel1.wear.yoy != null && (
                        <span
                          className={`ml-1 text-xs ${
                            data.categoryLevel1.wear.yoy >= 1 ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          (YoY {(data.categoryLevel1.wear.yoy * 100).toFixed(1)}%)
                        </span>
                      )}
                    </div>
                    <div className="rounded-lg bg-white/80 px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-white/90">
                      ACC: {formatK(data.categoryLevel1.acc.cyAccumAmt)}K
                      {data.categoryLevel1.acc.yoy != null && (
                        <span
                          className={`ml-1 text-xs ${
                            data.categoryLevel1.acc.yoy >= 1 ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          (YoY {(data.categoryLevel1.acc.yoy * 100).toFixed(1)}%)
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <span className="text-gray-500">-</span>
                )}
              </div>
            </div>

            {/* 레벨2 표: 실적·전년 0, YoY·할인율·전년비 모두 null인 컬럼 숨김 */}
            {(() => {
              const visibleLevel2 = data.level2.filter(
                (row) =>
                  !(
                    row.cySalesAmt === 0 &&
                    row.pySalesAmt === 0 &&
                    row.yoy == null &&
                    row.discountRate == null &&
                    row.discountRateYoy == null
                  )
              );
              return (
            <div className="overflow-x-auto rounded-2xl border border-gray-200/90 bg-white shadow-sm">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 text-left py-3 pl-4 pr-4 font-semibold text-gray-700 bg-gradient-to-b from-slate-100 to-gray-50 border-b border-gray-200">구분</th>
                    {visibleLevel2.map((row) => {
                      const tooltipText = row.cities && row.cities.length > 0
                        ? `주요 도시: ${row.cities.join(', ')}`
                        : undefined;
                      return (
                        <th
                          key={row.key}
                          className={`text-center py-3 px-2 font-semibold text-gray-700 bg-gradient-to-b from-slate-100 to-gray-50 border-b border-gray-200 ${tooltipText ? 'cursor-help' : ''}`}
                          {...(tooltipText ? { title: tooltipText } : {})}
                        >
                          {row.labelKo || row.key}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-white hover:bg-slate-50/70 transition-colors">
                    <td className="sticky left-0 z-[1] py-2.5 pl-4 pr-4 text-gray-700 font-semibold bg-white border-b border-gray-100">실적</td>
                    {visibleLevel2.map((row) => (
                      <td key={row.key} className="text-center py-2.5 px-2 font-semibold text-gray-900 border-b border-gray-100">
                        {formatK(row.cySalesAmt)}
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-gray-50/55 hover:bg-gray-100/70 transition-colors">
                    <td className="sticky left-0 z-[1] py-2.5 pl-4 pr-4 text-gray-600 font-medium bg-gray-50/55 border-b border-gray-100">전년</td>
                    {visibleLevel2.map((row) => (
                      <td key={row.key} className="text-center py-2.5 px-2 text-gray-500 border-b border-gray-100">
                        {formatK(row.pySalesAmt)}
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-white hover:bg-slate-50/70 transition-colors">
                    <td className="sticky left-0 z-[1] py-2.5 pl-4 pr-4 text-gray-700 font-medium bg-white border-b border-gray-100">YoY</td>
                    {visibleLevel2.map((row) => (
                      <td
                        key={row.key}
                        className={`text-center py-2.5 px-2 font-semibold border-b border-gray-100 ${
                          row.yoy !== null && row.yoy >= 1
                            ? 'text-emerald-700'
                            : row.yoy !== null
                              ? 'text-rose-700'
                              : 'text-gray-500'
                        }`}
                      >
                        {row.yoy != null ? `${(row.yoy * 100).toFixed(1)}%` : '-'}
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-gray-50/55 hover:bg-gray-100/70 transition-colors">
                    <td className="sticky left-0 z-[1] py-2.5 pl-4 pr-4 text-gray-700 font-medium bg-gray-50/55 border-b border-gray-100">할인율</td>
                    {visibleLevel2.map((row) => (
                      <td key={row.key} className="text-center py-2.5 px-2 text-gray-700 border-b border-gray-100">
                        {row.discountRate != null ? `${row.discountRate.toFixed(1)}%` : '-'}
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-white hover:bg-slate-50/70 transition-colors">
                    <td className="sticky left-0 z-[1] py-2.5 pl-4 pr-4 text-gray-700 font-medium bg-white">전년비</td>
                    {visibleLevel2.map((row) => (
                      <td
                        key={row.key}
                        className={`text-center py-2.5 px-2 font-semibold ${
                          row.discountRateYoy != null
                            ? row.discountRateYoy >= 0
                              ? 'text-rose-700'
                              : 'text-blue-700'
                            : 'text-gray-500'
                        }`}
                      >
                        {row.discountRateYoy != null
                          ? `${row.discountRateYoy >= 0 ? '+' : ''}${row.discountRateYoy.toFixed(1)}%p`
                          : '-'}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
