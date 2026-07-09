'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ApiResponse, PlLine, ChartData, BrandCode } from '@/lib/plforecast/types';
import { brandTabs, codeToLabel } from '@/lib/plforecast/brand';
import { formatK, formatPercent, formatPercentNoDecimal, formatDateShort } from '@/lib/plforecast/format';
import { getKstCurrentYm } from '@/lib/plforecast/date';
import RetailSummaryCard from '@/components/RetailSummaryCard';
import RetailBrandSummaryCard from '@/components/RetailBrandSummaryCard';
import AiAnalysisModal from '@/components/AiAnalysisModal';
import KpiCard from '@/components/ui/KpiCard';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  LineChart,
  Line,
  ReferenceLine,
  Cell,
  ComposedChart,
} from 'recharts';

// 현재 월 계산 (YYYY-MM)
// 한국 시간대(KST) 기준으로 계산
function getCurrentYm(): string {
  return getKstCurrentYm();
}

// K 단위 포맷 (차트용)
function formatKChart(value: number): string {
  return `${(value / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}K`;
}

// Waterfall 차트용 데이터 변환
function prepareWaterfallData(data: ChartData['waterfall']) {
  let cumulative = 0;
  return data.map((item, index) => {
    const start = item.type === 'positive' ? 0 : 
                  item.type === 'subtotal' || item.type === 'total' ? 0 : 
                  cumulative;
    
    if (item.type === 'positive') {
      cumulative = item.value;
    } else if (item.type === 'negative') {
      cumulative = cumulative + item.value; // value is negative
    } else {
      cumulative = item.value;
    }
    
    return {
      name: item.name,
      value: item.value,
      type: item.type,
      start,
      end: item.type === 'subtotal' || item.type === 'total' ? item.value : cumulative,
      displayValue: item.type === 'negative' ? item.value : cumulative,
    };
  });
}

// Waterfall 바 색상
function getWaterfallColor(type: string): string {
  switch (type) {
    case 'positive': return '#10b981'; // emerald
    case 'negative': return '#f43f5e'; // rose
    case 'subtotal': return '#8b5cf6'; // violet
    case 'total': return '#0ea5e9'; // sky
    default: return '#6b7280';
  }
}

export default function PlForecastPage() {
  const router = useRouter();
  // 초기값은 2026-07 (기본 조회월)
  const [ym, setYm] = useState(() => {
    if (typeof window === 'undefined') return '2026-07';
    const p = new URLSearchParams(window.location.search);
    return p.get('ym') || '2026-07';
  });
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showAccum, setShowAccum] = useState(false);
  const [trendTab, setTrendTab] = useState<'weekly' | 'daily'>('weekly');
  const [chartBrand, setChartBrand] = useState<BrandCode | 'all'>('all');
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [chartDataLoading, setChartDataLoading] = useState(false);

  // ── 주차별 스냅샷 상태 ──
  const [weeklySnapped, setWeeklySnapped] = useState(false);
  const [weeklySnapLoading, setWeeklySnapLoading] = useState(false);
  const [weeklyDropOpen, setWeeklyDropOpen] = useState(false);

  // ── AI 분석 모달 상태 ──
  const [showAiModal, setShowAiModal] = useState(false);

  // ── 캐시 재생성 상태 ──
  const [cacheRefreshing, setCacheRefreshing] = useState(false);

  // 캐시 재생성: Redis의 ym 캐시 삭제 후 페이지 강제 새로고침
  const handleRefreshCache = async () => {
    if (cacheRefreshing) return;
    setCacheRefreshing(true);
    try {
      await Promise.all([
        fetch(`/api/pl-forecast?ym=${ym}`, { method: 'DELETE' }).catch(() => null),
        fetch(`/api/retail-brand-summary?ym=${ym}`, { method: 'DELETE' }).catch(() => null),
      ]);
      // CDN/브라우저 캐시 우회: 페이지 URL에 cache buster 추가하여 새로고침
      const url = new URL(window.location.href);
      url.searchParams.set('_r', String(Date.now()));
      window.location.href = url.toString();
    } catch (err) {
      console.error('[캐시 재생성] 실패:', err);
      setCacheRefreshing(false);
    }
  };

  // URL 쿼리 파라미터에서 ym 읽기 (마운트 시, 클라이언트에서만)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlYm = params.get('ym');
      if (urlYm) {
        setYm(urlYm);
      }
    }
  }, []);

  // 데이터 조회
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        // 페이지 URL에 _r= 있으면(캐시 재생성 직후) API에도 전달 → CDN 우회
        const pageSearch = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const cacheBuster = pageSearch?.get('_r');
        const apiUrl = cacheBuster
          ? `/api/pl-forecast?ym=${ym}&brand=all&_r=${cacheBuster}`
          : `/api/pl-forecast?ym=${ym}&brand=all`;
        const res = await fetch(apiUrl, cacheBuster ? { cache: 'no-store' } : {});
        const json: ApiResponse = await res.json();
        if (json.error) {
          setError(json.error);
        } else {
          setData(json);
          // 기본 펼침 상태 설정 (실판(V+)는 기본 접힘)
          const defaultExpanded = new Set<string>();
          const forceCollapsed = new Set(['act-sale-vat-inc']);
          if (json.lines && json.lines.length > 0) {
            json.lines.forEach((line) => {
              if (line.defaultExpanded && !forceCollapsed.has(line.id)) {
                defaultExpanded.add(line.id);
              }
              line.children?.forEach((child) => {
                if (child.defaultExpanded && !forceCollapsed.has(child.id)) {
                  defaultExpanded.add(child.id);
                }
              });
            });
          }
          setExpandedRows(defaultExpanded);
          // 초기 차트 데이터 설정
          if (json.charts) {
            setChartData(json.charts);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '데이터 조회 실패');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [ym]);

  // 브랜드 선택 시 차트 데이터 조회
  useEffect(() => {
    async function fetchChartData() {
      if (!data?.lastDt) return;
      
      setChartDataLoading(true);
      try {
        const brandParam = chartBrand === 'all' ? 'all' : chartBrand;
        const res = await fetch(`/api/pl-forecast?ym=${ym}&brand=${brandParam}`);
        const json: ApiResponse = await res.json();
        if (json.charts) {
          setChartData(json.charts);
        }
      } catch (err) {
        console.error('차트 데이터 조회 실패:', err);
      } finally {
        setChartDataLoading(false);
      }
    }
    fetchChartData();
  }, [chartBrand, ym, data?.lastDt]);

  // 주차별 스냅샷 존재 여부 확인
  useEffect(() => {
    async function checkWeeklySnap() {
      try {
        const res = await fetch(`/api/snapshot?type=weekly&ym=${ym}&brand=all`);
        const json = await res.json();
        setWeeklySnapped(!!json.exists);
      } catch { /* 무시 */ }
    }
    checkWeeklySnap();
  }, [ym]);

  // 주차별 저장
  const handleWeeklySave = async () => {
    if (!data?.charts) return;
    setWeeklySnapLoading(true);
    setWeeklyDropOpen(false);
    try {
      await fetch('/api/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'weekly',
          ym,
          brand: 'all',
          data: {
            weeklyTrend: data.charts.weeklyTrend,
            weeklyAccumTrend: data.charts.weeklyAccumTrend,
          },
        }),
      });
      setWeeklySnapped(true);
    } catch { /* 무시 */ } finally {
      setWeeklySnapLoading(false);
    }
  };

  // 주차별 재계산
  const handleWeeklyRecalc = async () => {
    setWeeklySnapLoading(true);
    setWeeklyDropOpen(false);
    try {
      await fetch(`/api/snapshot?type=weekly&ym=${ym}&brand=all`, { method: 'DELETE' });
      setWeeklySnapped(false);
      // 데이터 재조회
      const res = await fetch(`/api/pl-forecast?ym=${ym}&brand=all`);
      const json: ApiResponse = await res.json();
      if (!json.error) setData(json);
    } catch { /* 무시 */ } finally {
      setWeeklySnapLoading(false);
    }
  };

  // 행 토글
  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // 기준월 변경 핸들러 (URL 쿼리 파라미터 업데이트)
  const handleYmChange = (newYm: string) => {
    setYm(newYm);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      params.set('ym', newYm);
      router.push(`/pl-forecast?${params.toString()}`);
    }
  };

  // 탭 클릭 (브랜드 변경) - 기준월 유지
  const handleTabClick = (slug: string) => {
    const params = new URLSearchParams();
    params.set('ym', ym);
    if (slug === 'all') {
      router.push(`/pl-forecast?${params.toString()}`);
    } else {
      router.push(`/pl-forecast/${slug}?${params.toString()}`);
    }
  };

  // 행 렌더링 (재귀)
  const renderRow = (line: PlLine, depth: number = 0): React.ReactNode[] => {
    const isExpanded = expandedRows.has(line.id);
    const hasChildren = line.children && line.children.length > 0;
    const indent = depth * 16;

    // 버터색 배경 적용 대상 라인 ID
    const butterBackgroundLines = ['act-sale-vat-inc', 'gross-profit', 'direct-profit', 'operating-profit'];
    const hasButterBackground = butterBackgroundLines.includes(line.id);
    const butterBgClass = hasButterBackground ? 'bg-yellow-50' : 'bg-white';

    const rows: React.ReactNode[] = [];

    rows.push(
      <tr
        key={line.id}
        className={`
          ${line.isCalculated ? 'bg-white' : 'hover:bg-slate-50'}
          ${hasButterBackground ? butterBgClass : ''}
          ${depth === 0 ? '' : 'text-xs'}
          ${hasButterBackground ? 'border-l-4 border-l-yellow-300' : ''}
        `}
      >
        {/* 라벨 */}
        <td className={`py-3 px-4 sticky left-0 ${butterBgClass} z-10 text-xs border-r border-gray-100`}>
          <div className="flex items-center" style={{ paddingLeft: `${indent}px` }}>
            {hasChildren && (
              <button
                onClick={() => toggleRow(line.id)}
                className="w-2 h-2 mr-0.5 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-all text-[8px]"
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            )}
            {!hasChildren && <span className="w-2 mr-0.5" />}
            <span className={
              line.id === 'gross-profit' || line.id === 'direct-profit' || line.id === 'operating-profit'
                ? 'text-black' 
                : line.id === 'cogs-sum' || line.id === 'direct-cost-sum' || line.id === 'opex-sum'
                  ? 'text-black'
                  : line.isCalculated 
                    ? 'text-amber-600' 
                    : 'text-gray-800'
            }>
              {line.label}
            </span>
          </div>
        </td>

        {/* 전년 */}
        <td className={`py-3 px-4 text-right font-mono tabular-nums text-gray-700 text-xs ${butterBgClass}`}>
          {formatK(line.prevYear)}
        </td>

        {/* (전년)누적 */}
        {showAccum && (
          <td className={`py-3 px-4 text-right font-mono tabular-nums text-gray-600 text-xs ${butterBgClass}`}>
            {formatK(line.prevYearAccum ?? null)}
          </td>
        )}

        {/* (전년)진척률 */}
        {showAccum && (
          <td className={`py-3 px-4 text-right font-mono tabular-nums text-gray-600 text-xs ${butterBgClass}`}>
            {line.prevYearProgressRate != null ? `${(line.prevYearProgressRate * 100).toFixed(1)}%` : '-'}
          </td>
        )}

        {/* 목표 */}
        <td className={`py-3 px-4 text-right font-mono tabular-nums text-gray-700 text-xs bg-sky-50`}>
          {formatK(line.target)}
        </td>

        {/* 누적 */}
        <td className={`py-3 px-4 text-right font-mono tabular-nums text-cyan-600 text-xs ${butterBgClass}`}>
          {formatK(line.accum)}
        </td>

        {/* 월말예상 */}
        <td className={`py-3 px-4 text-right font-mono tabular-nums text-emerald-600 text-xs bg-sky-50`}>
          {formatK(line.forecast)}
        </td>

        {/* 전년비 */}
        <td className={`py-3 px-4 text-right font-mono tabular-nums text-xs ${butterBgClass} ${
          line.yoyRate !== null && line.yoyRate >= 0 ? 'text-emerald-600' : 'text-rose-600'
        }`}>
          {formatPercentNoDecimal(line.yoyRate !== null ? line.yoyRate + 1 : null)}
        </td>

        {/* 달성율 */}
        <td className={`py-3 px-4 text-right font-mono tabular-nums text-xs ${butterBgClass} ${
          line.achvRate !== null && line.achvRate >= 1 ? 'text-emerald-600' : 'text-amber-600'
        }`}>
          {formatPercentNoDecimal(line.achvRate)}
        </td>
      </tr>
    );

    // 자식 행 렌더링
    if (hasChildren && isExpanded) {
      for (const child of line.children!) {
        rows.push(...renderRow(child, depth + 1));
      }
    }

    return rows;
  };

  const summary = data?.summary;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* 헤더 */}
      <header className="border-b border-slate-200 bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-full mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                {/* 바 차트 아이콘 */}
                <svg width="38" height="38" viewBox="0 0 32 32" className="drop-shadow-sm">
                  <defs>
                    <pattern id="grid-icon" width="4" height="4" patternUnits="userSpaceOnUse">
                      <path d="M 4 0 L 0 0 0 4" fill="none" stroke="#E5E7EB" strokeWidth="0.5"/>
                    </pattern>
                    <linearGradient id="greenGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#059669" stopOpacity="1" />
                      <stop offset="100%" stopColor="#047857" stopOpacity="1" />
                    </linearGradient>
                    <linearGradient id="pinkGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#DB2777" stopOpacity="1" />
                      <stop offset="100%" stopColor="#BE185D" stopOpacity="1" />
                    </linearGradient>
                    <linearGradient id="blueGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#2563EB" stopOpacity="1" />
                      <stop offset="100%" stopColor="#1D4ED8" stopOpacity="1" />
                    </linearGradient>
                  </defs>
                  {/* 배경 사각형 */}
                  <rect x="2" y="2" width="28" height="28" fill="#F3F4F6" rx="2" />
                  <rect x="2" y="2" width="28" height="28" fill="url(#grid-icon)" rx="2" />
                  {/* x축 선 */}
                  <line x1="6" y1="24" x2="26" y2="24" stroke="#1D4ED8" strokeWidth="1.5" />
                  {/* 막대 1 (왼쪽, 초록, 가장 높음) */}
                  <rect x="6" y="8" width="5" height="16" rx="1" fill="url(#greenGradient)" />
                  {/* 막대 2 (중간, 분홍, 가장 짧음) */}
                  <rect x="13" y="20" width="5" height="4" rx="1" fill="url(#pinkGradient)" />
                  {/* 막대 3 (오른쪽, 파랑, 중간 높이) */}
                  <rect x="20" y="12" width="5" height="12" rx="1" fill="url(#blueGradient)" />
                </svg>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                  F&F CHINA 월중 손익예측 대시보드
                </h1>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                PL Forecast Dashboard
              </p>
            </div>
            
            {/* 캐시 재생성 + 월 선택 */}
            <div className="flex items-center gap-3">
              {/* 캐시 재생성 버튼 */}
              <button
                onClick={handleRefreshCache}
                disabled={cacheRefreshing}
                title="Redis 캐시를 삭제하고 Snowflake에서 최신 데이터를 다시 받아 캐싱합니다"
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg text-white transition-colors ${
                  cacheRefreshing
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                <svg
                  className={`h-3.5 w-3.5 ${cacheRefreshing ? 'animate-spin' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {cacheRefreshing ? '재생성 중...' : '캐시 재생성'}
              </button>

              {/* 월 선택 */}
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-500">기준월</label>
                <input
                  type="month"
                  value={ym}
                  onChange={(e) => handleYmChange(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
            </div>
          </div>

          {/* 탭 */}
          <div className="flex items-center gap-1 mt-4">
            {brandTabs.map((tab) => (
              <button
                key={tab.slug}
                onClick={() => handleTabClick(tab.slug)}
                className={`
                  px-4 py-2 rounded-t-lg text-sm font-medium transition-all
                  ${tab.slug === 'all'
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                  }
                `}
              >
                {tab.label}
              </button>
            ))}
            {/* AI 분석 버튼 */}
            <button
              onClick={() => setShowAiModal(true)}
              className="ml-3 flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium bg-gradient-to-r from-violet-600 to-violet-500 text-white hover:from-violet-700 hover:to-violet-600 transition-all shadow-sm"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.346A3.89 3.89 0 0116 16.5V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-.5a3.89 3.89 0 01-1.071-2.653l-.347-.346z" />
              </svg>
              AI 분석
            </button>
          </div>
        </div>
      </header>

      {/* 메인 - 2분할 레이아웃 */}
      <main className="px-6 py-6">
        {/* 메타 정보 */}
        {data && !loading && (
          <div className="flex items-center gap-6 mb-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500">마감일</span>
              <span className="text-gray-900 font-mono">{formatDateShort(data.lastDt)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">누적일수</span>
              <span className="text-gray-900 font-mono">{data.accumDays}일</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">당월일수</span>
              <span className="text-gray-900 font-mono">{data.monthDays}일</span>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <span className="text-xs text-indigo-600 font-medium">
                npm run update-csv 실행 및 업데이트
              </span>
            </div>
            
            <div className="ml-auto text-gray-500 text-xs">
              단위: CNY K (천 위안)
            </div>
          </div>
        )}

        {/* 로딩 */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-3 text-gray-500">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span>데이터 조회 중...</span>
            </div>
          </div>
        )}

        {/* 에러 */}
        {error && !loading && (
          <div className="bg-rose-50 border border-rose-300 rounded-lg px-6 py-4 text-rose-700">
            {error}
          </div>
        )}

        {/* 2분할 레이아웃 */}
        {data && !loading && !error && (
          <div className="flex gap-6">
            {/* 좌측 3/4 - 카드 영역 */}
            <div className="w-3/4">
              <div className="grid grid-cols-2 gap-4 mb-6">
                <RetailSummaryCard ym={ym} brand="M" />
                <RetailSummaryCard ym={ym} brand="I" />
                <RetailSummaryCard ym={ym} brand="X" />
                <RetailBrandSummaryCard ym={ym} />
              </div>
              {summary && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
                  <KpiCard
                    title="실판매출(할인율)"
                    mainValue={formatK(summary.actSale.accumValue)}
                    secondaryValue={summary.actSale.accumRate !== null ? `${(summary.actSale.accumRate * 100).toFixed(1)}%` : null}
                    forecastValue={formatK(summary.actSale.forecastValue)}
                    forecastSecondaryValue={summary.actSale.forecastRate !== null ? `${(summary.actSale.forecastRate * 100).toFixed(1)}%` : null}
                    forecastLabel="(월말예상)"
                    progressValue={summary.actSale.targetRate !== null ? Math.min(summary.actSale.targetRate * 100, 100) : 0}
                    showProgressBar
                    targetRate={summary.actSale.targetRate}
                    yoyRate={summary.actSale.yoyRate}
                  />
                  <KpiCard
                    title="직접이익(이익율)"
                    mainValue={formatK(summary.directProfit.accumValue)}
                    secondaryValue={summary.directProfit.accumRate !== null ? `${(summary.directProfit.accumRate * 100).toFixed(1)}%` : null}
                    forecastValue={formatK(summary.directProfit.forecastValue)}
                    forecastSecondaryValue={summary.directProfit.forecastRate !== null ? `${(summary.directProfit.forecastRate * 100).toFixed(1)}%` : null}
                    forecastLabel="(월말예상)"
                    progressValue={summary.directProfit.targetRate !== null ? Math.min(summary.directProfit.targetRate * 100, 100) : 0}
                    showProgressBar
                    targetRate={summary.directProfit.targetRate}
                    yoyRate={summary.directProfit.yoyRate}
                  />
                  <KpiCard
                    title="영업이익(이익율)"
                    mainValue={formatK(summary.operatingProfit.accumValue)}
                    secondaryValue={summary.operatingProfit.accumRate !== null ? `${(summary.operatingProfit.accumRate * 100).toFixed(1)}%` : null}
                    forecastValue={formatK(summary.operatingProfit.forecastValue)}
                    forecastSecondaryValue={summary.operatingProfit.forecastRate !== null ? `${(summary.operatingProfit.forecastRate * 100).toFixed(1)}%` : null}
                    forecastLabel="(월말예상)"
                    progressValue={summary.operatingProfit.targetRate !== null ? Math.min(summary.operatingProfit.targetRate * 100, 100) : 0}
                    showProgressBar
                    targetRate={summary.operatingProfit.targetRate}
                    yoyRate={summary.operatingProfit.yoyRate}
                  />
                  <KpiCard
                    title="직접이익 진척률"
                    mainValue={summary.directProfitProgress.accumRate !== null ? `${(summary.directProfitProgress.accumRate * 100).toFixed(1)}%` : '-'}
                    forecastValue={summary.directProfitProgress.forecastRate !== null ? `${(summary.directProfitProgress.forecastRate * 100).toFixed(1)}%` : '-'}
                    forecastLabel="(월말예상)"
                    progressValue={summary.directProfitProgress.forecastRate !== null ? Math.min(summary.directProfitProgress.forecastRate * 100, 100) : 0}
                    showProgressBar
                  />
                </div>
              )}

              {/* 차트 영역 - 2x2 그리드 */}
              {data.charts && (
                <div className="grid grid-cols-2 gap-4">
                  {/* 차트1: 브랜드별 매출/영업이익 */}
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">[월말예상] 브랜드별 매출현황(V+) & 영업이익</h4>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={data.charts.brandSales} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="brand" tick={{ fontSize: 11, fill: '#6b7280' }} />
                          <YAxis 
                            yAxisId="left"
                            tick={{ fontSize: 11, fill: '#6b7280' }} 
                            tickFormatter={(v) => formatKChart(v)}
                          />
                          <YAxis 
                            yAxisId="right" 
                            orientation="right"
                            tick={{ fontSize: 11, fill: '#6b7280' }} 
                            tickFormatter={(v) => formatKChart(v)}
                          />
                          <Tooltip 
                            formatter={(value) => [formatKChart(Number(value || 0)), value !== undefined ? (typeof value === 'number' ? '매출' : '영업이익') : '']}
                            contentStyle={{ fontSize: 11, backgroundColor: '#fff', border: '1px solid #e5e7eb' }}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar yAxisId="left" dataKey="sales" name="매출" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                          <Bar yAxisId="right" dataKey="operatingProfit" name="영업이익" fill="#10b981" radius={[4, 4, 0, 0]} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* 차트2: 브랜드별 레이더 (계획/전년비) */}
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">전체 브랜드 매출 목표/전년비 (%), (V+)</h4>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={data.charts.brandRadar} margin={{ top: 10, right: 30, left: 30, bottom: 10 }}>
                          <PolarGrid stroke="#e5e7eb" />
                          <PolarAngleAxis dataKey="brand" tick={{ fontSize: 11, fill: '#6b7280' }} />
                          <PolarRadiusAxis angle={90} domain={[0, 150]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
                          <Radar name="목표달성율" dataKey="target" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.3} />
                          <Radar name="전년비" dataKey="prevYear" stroke="#f97316" fill="#f97316" fillOpacity={0.3} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Tooltip 
                            content={({ active, payload, label }) => {
                              if (!active || !payload || !payload.length) return null;
                              
                              // payload에서 target과 prevYear 찾기
                              const targetData = payload.find(p => p.dataKey === 'target');
                              const prevYearData = payload.find(p => p.dataKey === 'prevYear');
                              
                              const targetValue = targetData?.value ? Number(targetData.value).toFixed(1) : '0.0';
                              const prevYearValue = prevYearData?.value ? Number(prevYearData.value).toFixed(1) : '0.0';
                              
                              return (
                                <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
                                  <div className="font-semibold text-gray-900 mb-2">{label}</div>
                                  <div className="space-y-1 text-sm">
                                    <div className="text-gray-700">
                                      <span className="text-gray-500">목표대비:</span> <span className="font-medium">{targetValue}%</span>
                                    </div>
                                    <div className="text-gray-700">
                                      <span className="text-gray-500">전년비:</span> <span className="font-medium">{prevYearValue}%</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            }}
                            contentStyle={{ fontSize: 11 }}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* 차트3: Waterfall 손익 구조 */}
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">[월말예상] 법인 손익 구조</h4>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart 
                          data={prepareWaterfallData(data.charts.waterfall)} 
                          margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} angle={-15} textAnchor="end" height={50} />
                          <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => formatKChart(v)} />
                          <Tooltip 
                            formatter={(value) => [formatKChart(Math.abs(Number(value || 0))), '']}
                            contentStyle={{ fontSize: 11 }}
                          />
                          <ReferenceLine y={0} stroke="#6b7280" />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {prepareWaterfallData(data.charts.waterfall).map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={getWaterfallColor(entry.type)} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex gap-4 justify-center mt-2 text-xs">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#10b981' }} /> 매출</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#f43f5e' }} /> 비용</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#8b5cf6' }} /> 소계</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#0ea5e9' }} /> 최종</span>
                    </div>
                  </div>

                </div>
              )}
            </div>

            {/* 우측 1/4 - 손익표 */}
            <div className="w-1/4">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                {/* 헤더 개선 */}
                <div className="bg-gradient-to-r from-slate-50 via-gray-50 to-slate-50 px-4 py-3 border-b border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* 바 차트 아이콘 (제목과 동일) */}
                      <svg width="20" height="20" viewBox="0 0 32 32" className="drop-shadow-sm">
                        <defs>
                          <pattern id="grid-icon-pl-all" width="4" height="4" patternUnits="userSpaceOnUse">
                            <path d="M 4 0 L 0 0 0 4" fill="none" stroke="#E5E7EB" strokeWidth="0.5"/>
                          </pattern>
                          <linearGradient id="greenGradient-pl-all" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#059669" stopOpacity="1" />
                            <stop offset="100%" stopColor="#047857" stopOpacity="1" />
                          </linearGradient>
                          <linearGradient id="pinkGradient-pl-all" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#DB2777" stopOpacity="1" />
                            <stop offset="100%" stopColor="#BE185D" stopOpacity="1" />
                          </linearGradient>
                          <linearGradient id="blueGradient-pl-all" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#2563EB" stopOpacity="1" />
                            <stop offset="100%" stopColor="#1D4ED8" stopOpacity="1" />
                          </linearGradient>
                        </defs>
                        {/* 배경 사각형 */}
                        <rect x="2" y="2" width="28" height="28" fill="#F3F4F6" rx="2" />
                        <rect x="2" y="2" width="28" height="28" fill="url(#grid-icon-pl-all)" rx="2" />
                        {/* x축 선 */}
                        <line x1="6" y1="24" x2="26" y2="24" stroke="#1D4ED8" strokeWidth="1.5" />
                        {/* 막대 1 (왼쪽, 초록, 가장 높음) */}
                        <rect x="6" y="8" width="5" height="16" rx="1" fill="url(#greenGradient-pl-all)" />
                        {/* 막대 2 (중간, 분홍, 가장 짧음) */}
                        <rect x="13" y="20" width="5" height="4" rx="1" fill="url(#pinkGradient-pl-all)" />
                        {/* 막대 3 (오른쪽, 파랑, 중간 높이) */}
                        <rect x="20" y="12" width="5" height="12" rx="1" fill="url(#blueGradient-pl-all)" />
                      </svg>
                      <h3 className="text-base text-gray-800 tracking-tight">전체 손익계산서</h3>
                      {/* 마감 표시 배지 */}
                      {data.isClosed && (
                        <span className="ml-3 px-3 py-1 rounded-md bg-emerald-100 text-emerald-700 text-xs font-medium border border-emerald-200">
                          ✓ Snowflake 마감데이터 적용완료
                        </span>
                      )}
                    </div>
                    {/* 누적 토글 버튼 개선 */}
                    <button
                      onClick={() => setShowAccum(!showAccum)}
                      className={`
                        px-4 py-1.5 rounded-lg text-xs transition-all shadow-sm
                        ${showAccum
                          ? 'bg-gradient-to-r from-cyan-500 to-cyan-600 text-white hover:from-cyan-600 hover:to-cyan-700 shadow-cyan-200'
                          : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-300 shadow-sm'
                        }
                      `}
                    >
                      전년누적 {showAccum ? '숨기기' : '보기'}
                    </button>
                  </div>
                </div>
                {/* 테이블 개선 */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr className="text-slate-700">
                        <th className="py-3 px-4 text-left text-slate-800 sticky left-0 bg-slate-50 z-20 border-r border-slate-200">
                          구분
                        </th>
                        <th className="py-3 px-4 text-right text-slate-800">
                          <div className="flex flex-col items-end leading-tight">
                            <span>(전년)</span>
                            <span>월전체</span>
                          </div>
                        </th>
                        {showAccum && (
                          <>
                            <th className="py-3 px-4 text-right text-slate-800">
                              <div className="flex flex-col items-end leading-tight">
                                <span>(전년)</span>
                                <span>누적</span>
                              </div>
                            </th>
                            <th className="py-3 px-4 text-right text-slate-800">
                              <div className="flex flex-col items-end leading-tight">
                                <span>(전년)</span>
                                <span>진척률</span>
                              </div>
                            </th>
                          </>
                        )}
                        <th className="py-3 px-4 text-right text-slate-800 bg-sky-50">
                          <div className="flex flex-col items-end leading-tight">
                            <span>(당월)</span>
                            <span>목표</span>
                          </div>
                        </th>
                        <th className="py-3 px-4 text-right text-slate-800">
                          <div className="flex flex-col items-end leading-tight">
                            <span>(당월)</span>
                            <span>누적실적</span>
                          </div>
                        </th>
                        <th className="py-3 px-4 text-right text-slate-800 bg-sky-50">
                          <div className="flex flex-col items-end leading-tight">
                            <span>(당월)</span>
                            <span>월말예상</span>
                          </div>
                        </th>
                        <th className="py-3 px-4 text-right text-slate-800">
                          <div className="flex flex-col items-end leading-tight">
                            <span>(당월말)</span>
                            <span>전년비</span>
                          </div>
                        </th>
                        <th className="py-3 px-4 text-right text-slate-800">
                          <div className="flex flex-col items-end leading-tight">
                            <span>(목표비)</span>
                            <span>달성율</span>
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {data.lines && data.lines.length > 0 ? (
                        data.lines.map((line) => renderRow(line))
                      ) : (
                        <tr>
                          <td colSpan={showAccum ? 9 : 8} className="py-12 text-center text-gray-400">
                            데이터가 없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 범례 - 손익표 아래 개선 */}
              <div className="mt-4 p-4 bg-gradient-to-br from-gray-50 to-white rounded-xl border border-gray-200 shadow-sm text-xs">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-5 bg-gradient-to-b from-indigo-500 to-indigo-600 rounded"></div>
                  <div className="font-bold text-gray-800">월말예상 계산 방식</div>
                </div>
                <div className="space-y-3 pl-3">
                  <div className="bg-white rounded-lg p-3 border border-gray-100 shadow-sm">
                    <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                      Tag매출, 실판(V+), 실판(V-) 채널별 계산
                    </div>
                    <ul className="space-y-1 text-gray-600">
                      <li>• <strong>대리상</strong> (온라인 대리상, 오프라인 대리상): 월말예상 = 목표</li>
                      <li>• <strong>직영</strong> (온라인 직영, 오프라인 직영): 월말예상 = 누적 ÷ 전년 진척률</li>
                      <li className="text-gray-500 italic">전년 진척률 = (전년 D일까지 누적) ÷ (전년 월전체)</li>
                      <li className="text-gray-500 italic">전년 데이터가 없거나 분모가 0이면 "-"</li>
                    </ul>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-gray-100 shadow-sm">
                    <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                      매출원가 채널별 계산
                    </div>
                    <ul className="space-y-1 text-gray-600">
                      <li>• <strong>대리상</strong> (온라인 대리상, 오프라인 대리상): 월말예상 = 목표</li>
                      <li>• <strong>직영</strong> (온라인 직영, 오프라인 직영):</li>
                      <li className="ml-4">- Tag대비 원가율 = (누적 매출원가 × 1.13) ÷ 누적 Tag매출</li>
                      <li className="ml-4">- 월말예상 매출원가 = (Tag대비 원가율 × 월말예상 Tag매출) ÷ 1.13</li>
                      <li className="text-gray-500 italic">예외: Tag매출 누적이 0이거나 월말예상 Tag매출이 "-"이면 "-"</li>
                    </ul>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-gray-100 shadow-sm">
                    <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                      직접비 (고정비)
                    </div>
                    <ul className="space-y-1 text-gray-600">
                      <li>• 지급수수료, 대리상지원금, 포장비, 감가상각비, 진열소모품, 기타지급수수료</li>
                      <li className="text-gray-500 italic">계산식: 월말예상 = 목표 비용</li>
                    </ul>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-gray-100 shadow-sm">
                    <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      직접비 (변동비)
                    </div>
                    <ul className="space-y-1 text-gray-600">
                      <li>• 오프라인 직영 기준: 급여, 복리후생비, 매장임차료</li>
                      <li>• 온라인 직영 기준: 플랫폼수수료, TP수수료, 직접광고비</li>
                      <li>• 전체 기준: 물류비</li>
                      <li className="text-gray-500 italic">계산식: 월말예상 = 목표 비용 ÷ 목표 실판(V-) × 월말예상 실판(V-)</li>
                    </ul>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-gray-100 shadow-sm">
                    <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                      영업비 (모두 고정비)
                    </div>
                    <ul className="space-y-1 text-gray-600">
                      <li>• 급여, 복리후생비, 광고비, 수주회, 지급수수료, 임차료, 감가상각비, 세금과공과, 기타지급수수료</li>
                      <li className="text-gray-500 italic">계산식: 월말예상 = 목표 비용</li>
                    </ul>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-200 bg-white rounded-lg p-3 border-l-4 border-l-indigo-500">
                    <div className="font-semibold text-gray-800 mb-1">달성율</div>
                    <div className="text-gray-600">월말예상 ÷ 목표 × 100%</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* AI 분석 모달 */}
      {showAiModal && (
        <AiAnalysisModal ym={ym} onClose={() => setShowAiModal(false)} />
      )}
    </div>
  );
}
