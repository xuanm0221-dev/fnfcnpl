'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ApiResponse, PlLine, ChartData } from '@/lib/plforecast/types';
import { brandTabs } from '@/lib/plforecast/brand';
import { formatK, formatPercent, formatDateShort } from '@/lib/plforecast/format';
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
function getCurrentYm(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// 퍼센트 포맷 (소수점 1자리)
function formatPct(value: number | null): string {
  if (value === null) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

// 카드 컴포넌트
function SummaryCard({
  title,
  accumValue,
  accumRate,
  forecastValue,
  forecastRate,
  targetRate,
  yoyRate,
  color,
}: {
  title: string;
  accumValue: number | null;
  accumRate: number | null;
  forecastValue: number | null;
  forecastRate: number | null;
  targetRate: number | null;
  yoyRate: number | null;
  color: string;
}) {
  const progressValue = targetRate !== null ? Math.min(targetRate * 100, 100) : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <h3 className={`text-sm font-semibold mb-4 ${color}`}>{title}</h3>
      
      {/* 현시점 (누적) */}
      <div className="mb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-gray-900">{formatK(accumValue)}</span>
          <span className="text-sm text-gray-500">({formatPct(accumRate)})</span>
          <span className="text-xs text-gray-400">(현시점)</span>
        </div>
      </div>

      {/* 월말예상 */}
      <div className="mb-4">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-gray-700">{formatK(forecastValue)}</span>
          <span className="text-sm text-gray-500">({formatPct(forecastRate)})</span>
          <span className="text-xs text-gray-400">(월말예상)</span>
        </div>
      </div>

      {/* 프로그레스 바 */}
      <div className="mb-3">
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              progressValue >= 100 ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            style={{ width: `${Math.min(progressValue, 100)}%` }}
          />
        </div>
      </div>

      {/* 목표대비 / 전년대비 */}
      <div className="flex gap-4 text-xs">
        <div>
          <span className="text-gray-500">목표대비 </span>
          <span className={targetRate !== null && targetRate >= 1 ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
            {formatPct(targetRate)}
          </span>
        </div>
        <div>
          <span className="text-gray-500">전년대비 </span>
          <span className={yoyRate !== null && yoyRate >= 0 ? 'text-emerald-600 font-medium' : 'text-rose-600 font-medium'}>
            {formatPct(yoyRate !== null ? yoyRate + 1 : null)}
          </span>
        </div>
      </div>
    </div>
  );
}

// 진척률 카드 컴포넌트
function ProgressCard({
  title,
  accumRate,
  forecastRate,
  color,
}: {
  title: string;
  accumRate: number | null;
  forecastRate: number | null;
  color: string;
}) {
  const progressValue = forecastRate !== null ? Math.min(forecastRate * 100, 100) : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <h3 className={`text-sm font-semibold mb-4 ${color}`}>{title}</h3>
      
      {/* 현시점 진척률 */}
      <div className="mb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-gray-900">{formatPct(accumRate)}</span>
          <span className="text-xs text-gray-400">(현시점)</span>
        </div>
      </div>

      {/* 월말예상 진척률 */}
      <div className="mb-4">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-gray-700">{formatPct(forecastRate)}</span>
          <span className="text-xs text-gray-400">(월말예상)</span>
        </div>
      </div>

      {/* 프로그레스 바 */}
      <div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              progressValue >= 100 ? 'bg-emerald-500' : 'bg-purple-500'
            }`}
            style={{ width: `${Math.min(progressValue, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
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
  const [ym, setYm] = useState(getCurrentYm());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showAccum, setShowAccum] = useState(true);
  const [trendTab, setTrendTab] = useState<'weekly' | 'daily'>('weekly');

  // 데이터 조회
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/pl-forecast?ym=${ym}&brand=all`);
        const json: ApiResponse = await res.json();
        if (json.error) {
          setError(json.error);
        } else {
          setData(json);
          // 기본 펼침 상태 설정
          const defaultExpanded = new Set<string>();
          json.lines.forEach((line) => {
            if (line.defaultExpanded) {
              defaultExpanded.add(line.id);
            }
            line.children?.forEach((child) => {
              if (child.defaultExpanded) {
                defaultExpanded.add(child.id);
              }
            });
          });
          setExpandedRows(defaultExpanded);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '데이터 조회 실패');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [ym]);

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

  // 탭 클릭 (브랜드 변경)
  const handleTabClick = (slug: string) => {
    if (slug === 'all') {
      router.push('/pl-forecast');
    } else {
      router.push(`/pl-forecast/${slug}`);
    }
  };

  // 행 렌더링 (재귀)
  const renderRow = (line: PlLine, depth: number = 0): React.ReactNode[] => {
    const isExpanded = expandedRows.has(line.id);
    const hasChildren = line.children && line.children.length > 0;
    const indent = depth * 16;

    const rows: React.ReactNode[] = [];

    rows.push(
      <tr
        key={line.id}
        className={`
          border-b border-gray-200 
          ${line.isCalculated ? 'bg-gray-100 font-semibold' : 'hover:bg-gray-50'}
          ${depth === 0 ? '' : 'text-xs'}
        `}
      >
        {/* 라벨 */}
        <td className="py-2 px-3 sticky left-0 bg-white z-10 text-xs">
          <div className="flex items-center" style={{ paddingLeft: `${indent}px` }}>
            {hasChildren && (
              <button
                onClick={() => toggleRow(line.id)}
                className="w-4 h-4 mr-1 flex items-center justify-center text-gray-500 hover:text-gray-900 transition-colors text-xs"
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            )}
            {!hasChildren && <span className="w-4 mr-1" />}
            <span className={line.isCalculated ? 'text-amber-600' : 'text-gray-800'}>
              {line.label}
            </span>
          </div>
        </td>

        {/* 전년 */}
        <td className="py-2 px-2 text-right font-mono text-gray-700 text-xs">
          {formatK(line.prevYear)}
        </td>

        {/* 목표 */}
        <td className="py-2 px-2 text-right font-mono text-gray-700 text-xs">
          {formatK(line.target)}
        </td>

        {/* 누적 */}
        {showAccum && (
          <td className="py-2 px-2 text-right font-mono text-cyan-600 text-xs">
            {formatK(line.accum)}
          </td>
        )}

        {/* 월말예상 */}
        <td className="py-2 px-2 text-right font-mono text-emerald-600 font-semibold text-xs">
          {formatK(line.forecast)}
        </td>

        {/* 전년비 */}
        <td className={`py-2 px-2 text-right font-mono text-xs ${
          line.yoyRate !== null && line.yoyRate >= 0 ? 'text-emerald-600' : 'text-rose-600'
        }`}>
          {formatPercent(line.yoyRate)}
        </td>

        {/* 달성율 */}
        <td className={`py-2 px-2 text-right font-mono text-xs ${
          line.achvRate !== null && line.achvRate >= 1 ? 'text-emerald-600' : 'text-amber-600'
        }`}>
          {formatPercent(line.achvRate)}
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* 헤더 */}
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-full mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                예상 손익 현황
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                PL Forecast Dashboard
              </p>
            </div>
            
            {/* 월 선택 */}
            <div className="flex items-center gap-4">
              <label className="text-sm text-gray-500">기준월</label>
              <input
                type="month"
                value={ym}
                onChange={(e) => setYm(e.target.value)}
                className="bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
          </div>

          {/* 탭 */}
          <div className="flex gap-1 mt-4">
            {brandTabs.map((tab) => (
              <button
                key={tab.slug}
                onClick={() => handleTabClick(tab.slug)}
                className={`
                  px-4 py-2 rounded-t-lg text-sm font-medium transition-all
                  ${tab.slug === 'all'
                    ? 'bg-cyan-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                  }
                `}
              >
                {tab.label}
              </button>
            ))}
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
            
            {/* 누적 토글 버튼 */}
            <button
              onClick={() => setShowAccum(!showAccum)}
              className={`
                px-3 py-1 rounded-md text-xs font-medium transition-all
                ${showAccum
                  ? 'bg-cyan-100 text-cyan-700 hover:bg-cyan-200'
                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                }
              `}
            >
              누적 {showAccum ? '숨기기' : '보기'}
            </button>
            
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
              {summary && (
                <div className="grid grid-cols-4 gap-4 mb-6">
                  {/* 카드1: 실판매출(할인율) */}
                  <SummaryCard
                    title="실판매출(할인율)"
                    accumValue={summary.actSale.accumValue}
                    accumRate={summary.actSale.accumRate}
                    forecastValue={summary.actSale.forecastValue}
                    forecastRate={summary.actSale.forecastRate}
                    targetRate={summary.actSale.targetRate}
                    yoyRate={summary.actSale.yoyRate}
                    color="text-rose-600"
                  />

                  {/* 카드2: 직접이익(이익율) */}
                  <SummaryCard
                    title="직접이익(이익율)"
                    accumValue={summary.directProfit.accumValue}
                    accumRate={summary.directProfit.accumRate}
                    forecastValue={summary.directProfit.forecastValue}
                    forecastRate={summary.directProfit.forecastRate}
                    targetRate={summary.directProfit.targetRate}
                    yoyRate={summary.directProfit.yoyRate}
                    color="text-amber-600"
                  />

                  {/* 카드3: 영업이익(이익율) */}
                  <SummaryCard
                    title="영업이익(이익율)"
                    accumValue={summary.operatingProfit.accumValue}
                    accumRate={summary.operatingProfit.accumRate}
                    forecastValue={summary.operatingProfit.forecastValue}
                    forecastRate={summary.operatingProfit.forecastRate}
                    targetRate={summary.operatingProfit.targetRate}
                    yoyRate={summary.operatingProfit.yoyRate}
                    color="text-emerald-600"
                  />

                  {/* 카드4: 직접이익 진척률 */}
                  <ProgressCard
                    title="직접이익 진척률"
                    accumRate={summary.directProfitProgress.accumRate}
                    forecastRate={summary.directProfitProgress.forecastRate}
                    color="text-purple-600"
                  />
                </div>
              )}

              {/* 차트 영역 - 2x2 그리드 */}
              {data.charts && (
                <div className="grid grid-cols-2 gap-4">
                  {/* 차트1: 브랜드별 매출/영업이익 */}
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">브랜드별 매출현황 & 영업이익 (K단위)</h4>
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
                            formatter={(value: number | string, name: string) => [formatKChart(Number(value)), name === 'sales' ? '매출' : '영업이익']}
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
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">전체 브랜드 매출 계획/전년비 (%)</h4>
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
                            formatter={(value: number | string, name: string) => [`${Number(value).toFixed(1)}%`, name]}
                            contentStyle={{ fontSize: 11 }}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* 차트3: Waterfall 손익 구조 */}
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">전체 손익 구조 (Waterfall)</h4>
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
                            formatter={(value: number | string) => [formatKChart(Math.abs(Number(value))), '']}
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

                  {/* 차트4: 월중 누적 매출 추이 */}
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-700">월중 누적 매출 추이</h4>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setTrendTab('weekly')}
                          className={`px-2 py-1 text-xs rounded ${
                            trendTab === 'weekly' 
                              ? 'bg-cyan-600 text-white' 
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          주차별
                        </button>
                        <button
                          onClick={() => setTrendTab('daily')}
                          className={`px-2 py-1 text-xs rounded ${
                            trendTab === 'daily' 
                              ? 'bg-cyan-600 text-white' 
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          누적
                        </button>
                      </div>
                    </div>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart 
                          data={trendTab === 'weekly' ? data.charts.weeklyTrend : data.charts.dailyTrend} 
                          margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis 
                            dataKey="label" 
                            tick={{ fontSize: 10, fill: '#6b7280' }} 
                            interval={trendTab === 'daily' ? 4 : 0}
                          />
                          <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => formatKChart(v)} />
                          <Tooltip 
                            formatter={(value: number | string, name: string) => [formatKChart(Number(value)), name === 'curAccum' ? '당년' : '전년']}
                            contentStyle={{ fontSize: 11 }}
                          />
                          <Legend 
                            wrapperStyle={{ fontSize: 11 }} 
                            formatter={(value) => value === 'curAccum' ? '당년' : '전년'}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="curAccum" 
                            stroke="#0ea5e9" 
                            strokeWidth={2} 
                            dot={{ r: 3 }} 
                            name="curAccum"
                          />
                          <Line 
                            type="monotone" 
                            dataKey="prevAccum" 
                            stroke="#f97316" 
                            strokeWidth={2} 
                            strokeDasharray="5 5"
                            dot={{ r: 3 }} 
                            name="prevAccum"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 우측 1/4 - 손익표 */}
            <div className="w-1/4">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700">전체 손익계산서</h3>
                </div>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr className="text-gray-700">
                        <th className="py-2 px-3 text-left font-semibold sticky left-0 bg-gray-50 z-10">
                          구분
                        </th>
                        <th className="py-2 px-2 text-right font-semibold">전년</th>
                        <th className="py-2 px-2 text-right font-semibold">목표</th>
                        {showAccum && (
                          <th className="py-2 px-2 text-right font-semibold">누적</th>
                        )}
                        <th className="py-2 px-2 text-right font-semibold">월말예상</th>
                        <th className="py-2 px-2 text-right font-semibold">전년비</th>
                        <th className="py-2 px-2 text-right font-semibold">달성율</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {data.lines.map((line) => renderRow(line))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 범례 - 손익표 아래 */}
              <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-500">
                <div className="font-medium text-gray-600 mb-1">계산 방식</div>
                <ul className="space-y-0.5">
                  <li><span className="text-gray-600">직접비</span>: 목표직접비÷목표실판(V-)×월말예상실판(V-)</li>
                  <li><span className="text-gray-600">영업비</span>: 목표 그대로 (고정비)</li>
                  <li><span className="text-gray-600">달성율</span>: 월말예상÷목표×100%</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
