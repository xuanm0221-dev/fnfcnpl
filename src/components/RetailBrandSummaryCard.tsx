'use client';

import React, { useEffect, useState } from 'react';
import { formatK } from '@/lib/plforecast/format';
import type { RetailBrandSummaryResponse } from '@/app/api/retail-brand-summary/route';
import type { RetailBrandUnassignedResponse } from '@/app/api/retail-brand-summary/unassigned/route';

type BrandCode = 'M' | 'I' | 'X';

const BRAND_LABELS: Record<BrandCode, string> = {
  M: 'MLB',
  I: 'MLB KIDS',
  X: 'DISCOVERY',
};

type ChannelDataKey = 'dealer' | 'direct' | 'onlineDealer' | 'onlineDirect' | 'unassigned';

const CHANNEL_ROWS: Array<{ dataKey: ChannelDataKey; title: string; accent: string; clickable?: boolean }> = [
  { dataKey: 'dealer', title: 'OFF대리상', accent: 'text-violet-700' },
  { dataKey: 'direct', title: 'OFF직영', accent: 'text-cyan-700' },
  { dataKey: 'onlineDealer', title: 'ON대리상', accent: 'text-violet-600' },
  { dataKey: 'onlineDirect', title: 'ON직영', accent: 'text-cyan-600' },
  { dataKey: 'unassigned', title: '미지정', accent: 'text-amber-700', clickable: true },
];

const ROWS_PER_BRAND = 1 + CHANNEL_ROWS.length;

const REASON_LABELS: Record<string, string> = {
  NOT_IN_MASTER: '마스터 미등록',
  ONOFF_CLS_OTHER: '온오프 분류 기타',
  BRAND_MISMATCH: '브랜드 불일치',
};

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

interface UnassignedModalState {
  brand: BrandCode;
  range: 'monthly' | 'ytd';
}

function UnassignedModal({
  ym,
  state,
  onClose,
}: {
  ym: string;
  state: UnassignedModalState;
  onClose: () => void;
}) {
  const [data, setData] = useState<RetailBrandUnassignedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/retail-brand-summary/unassigned?ym=${ym}&brand=${state.brand}&range=${state.range}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
        } else {
          setData(json);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || '조회 실패');
      });
    return () => {
      cancelled = true;
    };
  }, [ym, state.brand, state.range]);

  const periodLabel = state.range === 'monthly' ? '당월MTD' : '연간YTD';
  const totalCy = data?.rows.reduce((acc, r) => acc + r.cySalesAmt, 0) ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              미지정 매장 상세 — {BRAND_LABELS[state.brand]} ({periodLabel})
            </h3>
            <div className="mt-1 text-xs text-slate-500">
              필터에서 제외된 매장 합계 (CY 기준): {formatK(totalCy)}K
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md text-slate-600 hover:bg-slate-200"
          >
            닫기
          </button>
        </div>

        <div className="overflow-auto flex-1">
          {!data && !error && (
            <div className="py-10 text-center text-sm text-slate-500">조회 중...</div>
          )}
          {error && (
            <div className="py-10 text-center text-sm text-rose-600">{error}</div>
          )}
          {data && data.rows.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-500">미지정 매장이 없습니다.</div>
          )}
          {data && data.rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Shop ID</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">매장명</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">매장 brd_nm</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">분류</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">제외 사유</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-700">CY 매출</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-700">PY 매출</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={`${row.shopId}-${row.brdCd}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs text-slate-700">{row.shopId}</td>
                    <td className="px-3 py-2 text-slate-800">{row.shopName ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{row.shopBrdNm ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{row.onOffCls ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className="inline-block px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800">
                        {REASON_LABELS[row.reason] ?? row.reason}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatK(row.cySalesAmt)}K</td>
                    <td className="px-3 py-2 text-right text-slate-600">{formatK(row.pySalesAmt)}K</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RetailBrandSummaryCard({ ym }: { ym: string }) {
  const [loadedYm, setLoadedYm] = useState<string | null>(null);
  const [data, setData] = useState<RetailBrandSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalState, setModalState] = useState<UnassignedModalState | null>(null);
  const [valueMode, setValueMode] = useState<'sale' | 'tag'>('sale');

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
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-cyan-600" />
            <h3 className="text-base font-semibold tracking-tight text-slate-900">
              브랜드별 리테일(POP,WHS포함)
            </h3>
          </div>
          {/* Tag / 실판 토글 */}
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs font-semibold">
            <button
              onClick={() => setValueMode('tag')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                valueMode === 'tag'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Tag
            </button>
            <button
              onClick={() => setValueMode('sale')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                valueMode === 'sale'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              실판
            </button>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          {currentData ? (
            <>
              <span>당월MTD {formatPeriodDisplay(currentData.monthlyPeriodStart, currentData.periodEnd)}</span>
              <span className="mx-2 text-slate-300">|</span>
              <span>연간YTD {formatPeriodDisplay(currentData.ytdPeriodStart, currentData.periodEnd)}</span>
              <span className="mx-2 text-slate-300">|</span>
              <span>기준: <strong>{valueMode === 'tag' ? 'Tag매출' : '실판매출(V+)'}</strong></span>
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

                    // Tag / 실판 모드별 값 헬퍼
                    const pickCy = (m: { cySalesAmt: number; cyTagAmt: number }) =>
                      valueMode === 'tag' ? m.cyTagAmt : m.cySalesAmt;
                    const pickYoy = (m: { yoy: number | null; tagYoy: number | null }) =>
                      valueMode === 'tag' ? m.tagYoy : m.yoy;

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
                          <div className="font-semibold text-slate-900">{formatK(pickCy(tm))}K</div>
                        </td>
                        <td className={`px-3 py-3 text-right font-semibold bg-slate-100 ${yoyClass(pickYoy(tm))}`}>
                          {formatYoy(pickYoy(tm))}
                        </td>
                        <td className="px-4 py-3 text-right bg-slate-100">
                          <div className="font-semibold text-slate-900">{formatK(pickCy(ty))}K</div>
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold bg-slate-100 ${yoyClass(pickYoy(ty))}`}>
                          {formatYoy(pickYoy(ty))}
                        </td>
                      </tr>
                    );

                    const channelRows = CHANNEL_ROWS.map((ch, chIndex) => {
                      const bucketGroup = currentData[ch.dataKey];
                      const bucket = bucketGroup?.[brand];
                      const emptyMetric = { cySalesAmt: 0, pySalesAmt: 0, yoy: null, cyTagAmt: 0, pyTagAmt: 0, tagYoy: null };
                      const monthly = bucket?.monthly ?? emptyMetric;
                      const ytd = bucket?.ytd ?? emptyMetric;
                      const monthlyCy = pickCy(monthly);
                      const ytdCy = pickCy(ytd);
                      const isLastChannel = chIndex === CHANNEL_ROWS.length - 1;
                      const rowSep =
                        isLastChannel && !isLastBrand ? 'border-b-2 border-slate-200' : 'border-b border-slate-100';
                      const isUnassigned = ch.dataKey === 'unassigned';
                      const monthlyClickable = isUnassigned && monthlyCy > 0;
                      const ytdClickable = isUnassigned && ytdCy > 0;

                      return (
                        <tr key={`${brand}-${ch.dataKey}`} className={`bg-white ${rowSep}`}>
                          <td className={`px-3 py-3 font-medium whitespace-nowrap ${ch.accent}`}>{ch.title}</td>
                          <td className="px-3 py-3 text-right">
                            {monthlyClickable ? (
                              <button
                                onClick={() => setModalState({ brand, range: 'monthly' })}
                                className="font-semibold text-amber-700 hover:underline"
                                title="미지정 매장 보기"
                              >
                                {formatK(monthlyCy)}K
                              </button>
                            ) : (
                              <div className="font-semibold text-slate-900">{formatK(monthlyCy)}K</div>
                            )}
                          </td>
                          <td className={`px-3 py-3 text-right font-semibold ${isUnassigned ? 'text-slate-400' : yoyClass(pickYoy(monthly))}`}>
                            {isUnassigned ? '-' : formatYoy(pickYoy(monthly))}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {ytdClickable ? (
                              <button
                                onClick={() => setModalState({ brand, range: 'ytd' })}
                                className="font-semibold text-amber-700 hover:underline"
                                title="미지정 매장 보기"
                              >
                                {formatK(ytdCy)}K
                              </button>
                            ) : (
                              <div className="font-semibold text-slate-900">{formatK(ytdCy)}K</div>
                            )}
                          </td>
                          <td className={`px-4 py-3 text-right font-semibold ${isUnassigned ? 'text-slate-400' : yoyClass(pickYoy(ytd))}`}>
                            {isUnassigned ? '-' : formatYoy(pickYoy(ytd))}
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

      {modalState && currentData && (
        <UnassignedModal
          ym={ym}
          state={modalState}
          onClose={() => setModalState(null)}
        />
      )}
    </div>
  );
}
