'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ApiResponse, PlLine } from '@/lib/plforecast/types';
import { brandTabs } from '@/lib/plforecast/brand';
import { formatK, formatPercent, formatDateShort } from '@/lib/plforecast/format';

// 현재 월 계산 (YYYY-MM)
function getCurrentYm(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function PlForecastPage() {
  const router = useRouter();
  const [ym, setYm] = useState(getCurrentYm());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

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
    const indent = depth * 24;

    const rows: React.ReactNode[] = [];

    rows.push(
      <tr
        key={line.id}
        className={`
          border-b border-slate-700/50 
          ${line.isCalculated ? 'bg-slate-800/50 font-semibold' : 'hover:bg-slate-800/30'}
          ${depth === 0 ? '' : 'text-sm'}
        `}
      >
        {/* 라벨 */}
        <td className="py-3 px-4 sticky left-0 bg-slate-900 z-10">
          <div className="flex items-center" style={{ paddingLeft: `${indent}px` }}>
            {hasChildren && (
              <button
                onClick={() => toggleRow(line.id)}
                className="w-5 h-5 mr-2 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            )}
            {!hasChildren && <span className="w-5 mr-2" />}
            <span className={line.isCalculated ? 'text-amber-400' : 'text-slate-200'}>
              {line.label}
            </span>
          </div>
        </td>

        {/* 전년 */}
        <td className="py-3 px-4 text-right font-mono text-slate-300">
          {formatK(line.prevYear)}
        </td>

        {/* 목표 */}
        <td className="py-3 px-4 text-right font-mono text-slate-300">
          {formatK(line.target)}
        </td>

        {/* 누적 */}
        <td className="py-3 px-4 text-right font-mono text-cyan-400">
          {formatK(line.accum)}
        </td>

        {/* 월말예상 */}
        <td className="py-3 px-4 text-right font-mono text-emerald-400 font-semibold">
          {formatK(line.forecast)}
        </td>

        {/* 전년비 */}
        <td className={`py-3 px-4 text-right font-mono ${
          line.yoyRate !== null && line.yoyRate >= 0 ? 'text-emerald-400' : 'text-rose-400'
        }`}>
          {formatPercent(line.yoyRate)}
        </td>

        {/* 달성율 */}
        <td className={`py-3 px-4 text-right font-mono ${
          line.achvRate !== null && line.achvRate >= 1 ? 'text-emerald-400' : 'text-amber-400'
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* 헤더 */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                예상 손익 현황
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                PL Forecast Dashboard
              </p>
            </div>
            
            {/* 월 선택 */}
            <div className="flex items-center gap-4">
              <label className="text-sm text-slate-400">기준월</label>
              <input
                type="month"
                value={ym}
                onChange={(e) => setYm(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
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
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                  }
                `}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* 메인 */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* 메타 정보 */}
        {data && !loading && (
          <div className="flex items-center gap-6 mb-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">마감일</span>
              <span className="text-white font-mono">{formatDateShort(data.lastDt)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500">누적일수</span>
              <span className="text-white font-mono">{data.accumDays}일</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500">당월일수</span>
              <span className="text-white font-mono">{data.monthDays}일</span>
            </div>
            <div className="ml-auto text-slate-500 text-xs">
              단위: CNY K (천 위안)
            </div>
          </div>
        )}

        {/* 로딩 */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-3 text-slate-400">
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
          <div className="bg-rose-900/30 border border-rose-700 rounded-lg px-6 py-4 text-rose-300">
            {error}
          </div>
        )}

        {/* 테이블 */}
        {data && !loading && !error && (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full">
              <thead className="bg-slate-800/80">
                <tr className="text-slate-300 text-sm">
                  <th className="py-3 px-4 text-left font-semibold sticky left-0 bg-slate-800 z-10 min-w-[200px]">
                    구분
                  </th>
                  <th className="py-3 px-4 text-right font-semibold min-w-[100px]">전년</th>
                  <th className="py-3 px-4 text-right font-semibold min-w-[100px]">목표</th>
                  <th className="py-3 px-4 text-right font-semibold min-w-[100px]">누적</th>
                  <th className="py-3 px-4 text-right font-semibold min-w-[100px]">월말예상</th>
                  <th className="py-3 px-4 text-right font-semibold min-w-[80px]">전년비</th>
                  <th className="py-3 px-4 text-right font-semibold min-w-[80px]">달성율</th>
                </tr>
              </thead>
              <tbody className="bg-slate-900">
                {data.lines.map((line) => renderRow(line))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

