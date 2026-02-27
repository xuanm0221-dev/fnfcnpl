'use client';

import React from 'react';
import MetricDelta from './MetricDelta';

function formatPct(value: number | null): string {
  if (value === null) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

interface KpiCardProps {
  title: string;
  mainValue: string;
  secondaryValue?: string | null;
  forecastValue?: string | null;
  forecastLabel?: string;
  forecastSecondaryValue?: string | null;
  progressValue?: number;
  showProgressBar?: boolean;
  targetRate?: number | null;
  yoyRate?: number | null;
}

export default function KpiCard({
  title,
  mainValue,
  secondaryValue = null,
  forecastValue = null,
  forecastLabel = '(월말예상)',
  forecastSecondaryValue = null,
  progressValue = 0,
  showProgressBar = true,
  targetRate = null,
  yoyRate = null,
}: KpiCardProps) {
  const targetIsPositive = targetRate !== null && targetRate >= 1;
  const yoyDisplayValue = yoyRate !== null ? formatPct(yoyRate + 1) : '-';
  const yoyIsPositive = (yoyRate !== null ? yoyRate + 1 : 0) >= 1;
  const barWidth = Math.min(progressValue, 100);

  return (
    <div className="relative overflow-hidden bg-white rounded-2xl border border-slate-200/90 p-5 shadow-md shadow-slate-200/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      <div className="absolute -right-8 -top-8 h-20 w-20 rounded-full bg-cyan-100/60 blur-2xl" />
      <h3 className="text-sm font-semibold tracking-tight text-slate-700">{title}</h3>

      {/* 현시점 (누적) */}
      <div className="mt-2">
        <span className="text-[28px] leading-none font-bold text-slate-900 tabular-nums tracking-tight">{mainValue}</span>
        {secondaryValue != null && secondaryValue !== '' && (
          <span className="ml-2 text-sm font-medium text-slate-500">({secondaryValue})</span>
        )}
        <span className="ml-2 text-xs text-slate-500">(현시점)</span>
      </div>

      {/* 월말예상 */}
      {forecastValue != null && (
        <div className="mt-3 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2">
          <span className="text-lg font-semibold text-slate-800 tabular-nums">{forecastValue}</span>
          {forecastSecondaryValue != null && forecastSecondaryValue !== '' && (
            <span className="ml-2 text-sm text-slate-500">({forecastSecondaryValue})</span>
          )}
          <span className="ml-2 text-xs text-slate-500">{forecastLabel}</span>
        </div>
      )}

      {/* 프로그레스 바 */}
      {showProgressBar && (
        <div className="mt-4">
          <div className="w-full bg-slate-200/80 rounded-full h-2.5">
            <div
              className="h-2.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-[width] duration-200"
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
      )}

      {/* 목표대비 / 전년대비 */}
      {(targetRate !== null || yoyRate !== null) && (
        <div className="mt-4 flex gap-3 flex-wrap">
          {targetRate !== null && (
            <MetricDelta label="목표대비" value={formatPct(targetRate)} isPositive={targetIsPositive} />
          )}
          {yoyRate !== null && (
            <MetricDelta label="전년대비" value={yoyDisplayValue} isPositive={yoyIsPositive} />
          )}
        </div>
      )}
    </div>
  );
}
