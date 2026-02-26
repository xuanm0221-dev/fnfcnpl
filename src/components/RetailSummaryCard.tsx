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

  return (
    <div className={`bg-white rounded-xl border-2 shadow-sm overflow-hidden ${borderColor}`}>
      {/* 헤더: YoY와 동일한 배경 (톤 다운: 증가=emerald/teal, 감소=rose/red, null=gray) */}
      <div
        className={`px-5 py-4 border-b border-gray-100 ${
          yoy !== null && yoy !== undefined && yoy >= 1
            ? 'bg-gradient-to-br from-emerald-50/40 to-teal-50/40'
            : yoy !== null && yoy !== undefined
              ? 'bg-gradient-to-br from-rose-50/40 to-red-50/40'
              : 'bg-gray-50/50'
        }`}
      >
        {/* 1행: 제목 | 당월YTD·연간YTD 전환탭 | 매장유형 전환탭 */}
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-gray-800">
            {BRAND_TITLES[brand]}
          </h3>
          <span className="text-gray-400">|</span>
          <div className="flex rounded-full bg-gray-200 p-0.5 shadow-sm">
            <button
              onClick={() => setMode('monthly')}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                mode === 'monthly'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-800'
              }`}
            >
              당월YTD
            </button>
            <button
              onClick={() => setMode('ytd')}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                mode === 'ytd'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-800'
              }`}
            >
              연간YTD
            </button>
          </div>
          <span className="text-gray-400">|</span>
          <div className="flex gap-1">
            {(['tradeZone', 'shopLevel', 'tier', 'region'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  type === t
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
            {/* 레벨1 카드 3개: 실적 2fr, YoY 1.3fr, 의류ACC 2.7fr */}
            <div className="grid gap-4 mb-5 pb-5 border-b border-gray-200" style={{ gridTemplateColumns: '2fr 1.3fr 2.7fr' }}>
              <div className="rounded-xl p-4 border-2 border-gray-200 bg-gradient-to-br from-indigo-50 to-blue-50 border-l-4 border-l-indigo-500 shadow-sm">
                <div className="text-xs text-gray-500 mb-1">실적 (누적)</div>
                <div className="text-xl font-bold text-gray-900">
                  {formatK(data.level1.cySalesAmt)}K
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  전년 {formatK(data.level1.pySalesAmt)}K
                </div>
              </div>
              <div
                className={`rounded-xl p-4 border-2 border-gray-200 border-l-4 shadow-sm ${
                  data.level1.yoy !== null && data.level1.yoy >= 1
                    ? 'bg-gradient-to-br from-emerald-50 to-teal-50 border-l-emerald-500'
                    : data.level1.yoy !== null
                      ? 'bg-gradient-to-br from-rose-50 to-red-50 border-l-rose-500'
                      : 'bg-gray-50 border-l-gray-400'
                }`}
              >
                <div className="text-xs text-gray-500 mb-1">YoY</div>
                <div
                  className={`text-xl font-bold ${
                    data.level1.yoy !== null && data.level1.yoy >= 1
                      ? 'text-green-600'
                      : data.level1.yoy !== null
                        ? 'text-red-600'
                        : ''
                  }`}
                >
                  {data.level1.yoy !== null
                    ? `${(data.level1.yoy * 100).toFixed(1)}%`
                    : '-'}
                </div>
              </div>
              <div
                className={`rounded-xl p-4 border-2 border-gray-200 border-l-4 shadow-sm ${
                  (data.categoryLevel1?.yoy != null && (data.categoryLevel1?.yoy ?? 0) >= 1)
                    ? 'bg-gradient-to-br from-emerald-50 to-teal-50 border-l-emerald-500'
                    : data.categoryLevel1?.yoy != null
                      ? 'bg-gradient-to-br from-rose-50 to-red-50 border-l-rose-500'
                      : 'bg-gray-50 border-l-gray-400'
                }`}
              >
                {data.categoryLevel1?.wear && data.categoryLevel1?.acc ? (
                  <div className="space-y-2">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        의류: {formatK(data.categoryLevel1.wear.cyAccumAmt)}K
                        {data.categoryLevel1.wear.yoy != null && (
                          <span
                            className={`ml-1 text-xs ${
                              data.categoryLevel1.wear.yoy >= 1 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            (YoY {(data.categoryLevel1.wear.yoy * 100).toFixed(1)}%)
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        ACC: {formatK(data.categoryLevel1.acc.cyAccumAmt)}K
                        {data.categoryLevel1.acc.yoy != null && (
                          <span
                            className={`ml-1 text-xs ${
                              data.categoryLevel1.acc.yoy >= 1 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            (YoY {(data.categoryLevel1.acc.yoy * 100).toFixed(1)}%)
                          </span>
                        )}
                      </div>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 pr-4 font-semibold text-gray-700">구분</th>
                    {visibleLevel2.map((row) => {
                      const tooltipText = row.cities && row.cities.length > 0
                        ? `주요 도시: ${row.cities.join(', ')}`
                        : undefined;
                      return (
                        <th
                          key={row.key}
                          className={`text-center py-2 px-2 font-semibold text-gray-700 ${tooltipText ? 'cursor-help' : ''}`}
                          {...(tooltipText ? { title: tooltipText } : {})}
                        >
                          {row.labelKo || row.key}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <td className="py-2 pr-4 text-gray-600 font-medium bg-gray-50">실적</td>
                    {visibleLevel2.map((row) => (
                      <td key={row.key} className="text-center py-2 px-2 font-medium text-gray-900 bg-gray-50">
                        {formatK(row.cySalesAmt)}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="py-2 pr-4 text-gray-500 font-medium">전년</td>
                    {visibleLevel2.map((row) => (
                      <td key={row.key} className="text-center py-2 px-2 text-gray-400">
                        {formatK(row.pySalesAmt)}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="py-2 pr-4 text-gray-600 font-medium">YoY</td>
                    {visibleLevel2.map((row) => (
                      <td
                        key={row.key}
                        className={`text-center py-2 px-2 font-medium ${
                          row.yoy !== null && row.yoy >= 1
                            ? 'text-green-600'
                            : row.yoy !== null
                              ? 'text-red-600'
                              : 'text-gray-500'
                        }`}
                      >
                        {row.yoy != null ? `${(row.yoy * 100).toFixed(1)}%` : '-'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <td className="py-2 pr-4 text-gray-600 font-medium bg-gray-50">할인율</td>
                    {visibleLevel2.map((row) => (
                      <td key={row.key} className="text-center py-2 px-2 text-gray-700 bg-gray-50">
                        {row.discountRate != null ? `${row.discountRate.toFixed(1)}%` : '-'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 text-gray-600 font-medium">전년비</td>
                    {visibleLevel2.map((row) => (
                      <td
                        key={row.key}
                        className={`text-center py-2 px-2 ${
                          row.discountRateYoy != null
                            ? row.discountRateYoy >= 0
                              ? 'text-rose-600'
                              : 'text-blue-600'
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
