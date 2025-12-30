'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { ApiResponse, PlLine, BrandSlug, ChannelTableData, ChannelRowData, ChannelPlanTable, ChannelActualTable } from '@/lib/plforecast/types';
import { brandTabs, isValidBrandSlug, slugToCode, codeToLabel } from '@/lib/plforecast/brand';
import { formatK, formatPercent, formatDateShort } from '@/lib/plforecast/format';

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

// 채널 라벨 매핑
const CHANNEL_LABELS: Record<string, string> = {
  onlineDirect: '온라인 직영',
  onlineDealer: '온라인 대리상',
  offlineDirect: '오프라인 직영',
  offlineDealer: '오프라인 대리상',
};

// 채널별 매출 진척률 테이블 컴포넌트
function ChannelTable({ data }: { data: ChannelTableData }) {
  const { plan, actual } = data;
  
  // 채널 순서
  const channels: Array<'onlineDirect' | 'onlineDealer' | 'offlineDirect' | 'offlineDealer'> = 
    ['onlineDirect', 'onlineDealer', 'offlineDirect', 'offlineDealer'];
  
  // 금액 포맷 (K 단위, 소수점 없음)
  const formatAmount = (value: number | null): string => {
    if (value === null) return '-';
    return Math.round(value / 1000).toLocaleString();
  };
  
  // 퍼센트 포맷 (소수점 1자리)
  const formatRate = (value: number | null): string => {
    if (value === null) return '-';
    return `${(value * 100).toFixed(1)}%`;
  };
  
  // 퍼센트p 포맷 (차이용)
  const formatRateDiff = (value: number | null): string => {
    if (value === null) return '-';
    const pct = value * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%p`;
  };
  
  // 행 데이터 정의
  type RowKey = 'tagSale' | 'actSaleVatInc' | 'actSaleVatIncRate' | 'actSaleVatExc' | 'cogs' | 'cogsRate' | 'tagCogsRate' | 'grossProfit' | 'grossProfitRate';
  
  const rows: Array<{
    key: RowKey;
    label: string;
    category?: string;
    isRate?: boolean;
    isRateDiff?: boolean;
    highlight?: boolean;
  }> = [
    { key: 'tagSale', label: 'Tag가 매출' },
    { key: 'actSaleVatInc', label: '실판 매출(V+)', category: '매출액' },
    { key: 'actSaleVatIncRate', label: '', isRate: true },
    { key: 'actSaleVatExc', label: '실판 매출(V-)', category: '매출액', highlight: true },
    { key: 'cogs', label: '매출원가', category: '매출원가' },
    { key: 'cogsRate', label: '', isRate: true },
    { key: 'tagCogsRate', label: '(Tag 대비 원가율)', category: '매출원가', isRate: true, isRateDiff: true },
    { key: 'grossProfit', label: '매출총이익', highlight: true },
    { key: 'grossProfitRate', label: '', isRate: true },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700">채널별 매출 진척률</h3>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            {/* 헤더 1행: 대분류 */}
            <tr className="border-b border-gray-200">
              <th colSpan={2} rowSpan={2} className="py-2 px-3 text-left font-semibold text-gray-600 border-r border-gray-200 sticky left-0 bg-gray-50 z-10"></th>
              <th colSpan={5} className="py-2 px-2 text-center font-semibold text-gray-700 border-r border-gray-300 bg-blue-50">채널별 계획</th>
              <th colSpan={6} className="py-2 px-2 text-center font-semibold text-gray-700 bg-green-50">채널별 진척률</th>
            </tr>
            {/* 헤더 2행: 채널별 */}
            <tr className="border-b border-gray-200">
              {/* 계획 */}
              {channels.map((ch) => (
                <th key={`plan-${ch}`} className="py-2 px-1 text-center font-medium text-gray-600 border-r border-gray-100 bg-blue-50 whitespace-nowrap">
                  <div className="text-[10px]">{CHANNEL_LABELS[ch].split(' ')[0]}</div>
                  <div className="text-[10px]">{CHANNEL_LABELS[ch].split(' ')[1]}</div>
                </th>
              ))}
              <th className="py-2 px-1 text-center font-medium text-gray-700 border-r border-gray-300 bg-blue-100 whitespace-nowrap text-[10px]">12월<br/>계획합계</th>
              {/* 진척률 */}
              {channels.map((ch) => (
                <th key={`actual-${ch}`} className="py-2 px-1 text-center font-medium text-gray-600 border-r border-gray-100 bg-green-50 whitespace-nowrap">
                  <div className="text-[10px]">{CHANNEL_LABELS[ch].split(' ')[0]}</div>
                  <div className="text-[10px]">{CHANNEL_LABELS[ch].split(' ')[1]}</div>
                </th>
              ))}
              <th className="py-2 px-1 text-center font-medium text-gray-700 border-r border-gray-200 bg-green-100 whitespace-nowrap text-[10px]">12월<br/>실적합계</th>
              <th className="py-2 px-1 text-center font-medium text-gray-700 bg-amber-100 whitespace-nowrap text-[10px]">진척률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const planRow = plan[row.key] as ChannelRowData;
              const actualRow = actual[row.key] as ChannelRowData & { progressRate: number | null };
              
              return (
                <tr 
                  key={row.key} 
                  className={`border-b border-gray-100 ${row.highlight ? 'bg-yellow-50' : ''} ${row.isRate ? 'bg-gray-50' : ''}`}
                >
                  {/* 카테고리 */}
                  <td className="py-1.5 px-2 text-left text-gray-500 sticky left-0 bg-inherit z-10 w-12 text-[10px]">
                    {row.category || ''}
                  </td>
                  {/* 행 라벨 */}
                  <td className="py-1.5 px-2 text-left font-medium text-gray-700 sticky left-12 bg-inherit z-10 border-r border-gray-200 whitespace-nowrap text-[10px]">
                    {row.label}
                  </td>
                  
                  {/* 계획 - 채널별 */}
                  {channels.map((ch) => (
                    <td key={`plan-${ch}`} className="py-1.5 px-1 text-right font-mono text-gray-600 border-r border-gray-100">
                      {row.isRate ? formatRate(planRow[ch]) : formatAmount(planRow[ch])}
                    </td>
                  ))}
                  {/* 계획 - 합계 */}
                  <td className="py-1.5 px-1 text-right font-mono font-semibold text-gray-800 border-r border-gray-300 bg-blue-50">
                    {row.isRate ? formatRate(planRow.total) : formatAmount(planRow.total)}
                  </td>
                  
                  {/* 진척률 - 채널별 */}
                  {channels.map((ch) => (
                    <td key={`actual-${ch}`} className="py-1.5 px-1 text-right font-mono text-gray-600 border-r border-gray-100">
                      {row.isRate ? formatRate(actualRow[ch]) : formatAmount(actualRow[ch])}
                    </td>
                  ))}
                  {/* 진척률 - 합계 */}
                  <td className="py-1.5 px-1 text-right font-mono font-semibold text-gray-800 border-r border-gray-200 bg-green-50">
                    {row.isRate ? formatRate(actualRow.total) : formatAmount(actualRow.total)}
                  </td>
                  {/* 진척률 */}
                  <td className={`py-1.5 px-1 text-right font-mono font-semibold bg-amber-50 ${
                    row.isRateDiff 
                      ? (actualRow.progressRate !== null && actualRow.progressRate > 0 ? 'text-rose-600' : 'text-emerald-600')
                      : (actualRow.progressRate !== null && actualRow.progressRate >= 1 ? 'text-emerald-600' : 'text-amber-600')
                  }`}>
                    {row.isRateDiff ? formatRateDiff(actualRow.progressRate) : formatRate(actualRow.progressRate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-[10px] text-gray-500">
        단위: K (천 위안) / 진척률 = 12월 실적합계 ÷ 12월 계획합계
      </div>
    </div>
  );
}

export default function BrandPlForecastPage() {
  const router = useRouter();
  const params = useParams();
  const brandSlug = params.brand as string;

  const [ym, setYm] = useState(getCurrentYm());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showAccum, setShowAccum] = useState(true);

  // 유효한 브랜드인지 확인
  const isValid = isValidBrandSlug(brandSlug);
  const brandCode = isValid ? slugToCode(brandSlug as BrandSlug) : null;
  const brandLabel = brandCode ? codeToLabel(brandCode) : '';

  // 데이터 조회
  useEffect(() => {
    if (!brandCode) {
      setLoading(false);
      setError('유효하지 않은 브랜드입니다.');
      return;
    }

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/pl-forecast?ym=${ym}&brand=${brandCode}`);
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
  }, [ym, brandCode]);

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

  // 브랜드별 테마 색상
  const getBrandColor = (slug: string): string => {
    const colors: Record<string, string> = {
      'mlb': 'from-red-500 to-red-700',
      'mlb-kids': 'from-pink-500 to-pink-700',
      'discovery': 'from-orange-500 to-orange-700',
      'duvetica': 'from-blue-500 to-blue-700',
      'supra': 'from-purple-500 to-purple-700',
    };
    return colors[slug] || 'from-cyan-500 to-cyan-700';
  };

  const summary = data?.summary;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* 헤더 */}
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-full mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                  예상 손익 현황
                </h1>
                {isValid && (
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold text-white bg-gradient-to-r ${getBrandColor(brandSlug)}`}>
                    {brandLabel}
                  </span>
                )}
              </div>
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
                  ${tab.slug === brandSlug
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
                <div className="grid grid-cols-4 gap-4">
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
              
              {/* 채널별 매출 진척률 테이블 */}
              {data.channelTable && (
                <div className="mt-6">
                  <ChannelTable data={data.channelTable} />
                </div>
              )}
            </div>

            {/* 우측 1/4 - 손익표 */}
            <div className="w-1/4">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700">{brandLabel} 손익계산서</h3>
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
