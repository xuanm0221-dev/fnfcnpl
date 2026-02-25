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
    <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-6 hover:shadow-xl transition-shadow">
      <h3 className="text-sm font-medium text-slate-600">{title}</h3>

      {/* 현시점 (누적) */}
      <div className="mt-2">
        <span className="text-2xl font-bold text-slate-900 tabular-nums">{mainValue}</span>
        {secondaryValue != null && secondaryValue !== '' && (
          <span className="ml-2 text-sm text-slate-500">({secondaryValue})</span>
        )}
        <span className="ml-2 text-sm text-slate-500">(현시점)</span>
      </div>

      {/* 월말예상 */}
      {forecastValue != null && (
        <div className="mt-3">
          <span className="text-lg font-semibold text-slate-800 tabular-nums">{forecastValue}</span>
          {forecastSecondaryValue != null && forecastSecondaryValue !== '' && (
            <span className="ml-2 text-sm text-slate-500">({forecastSecondaryValue})</span>
          )}
          <span className="ml-2 text-sm text-slate-500">{forecastLabel}</span>
        </div>
      )}

      {/* 프로그레스 바 */}
      {showProgressBar && (
        <div className="mt-4">
          <div className="w-full bg-slate-200 rounded-full h-2.5">
            <div
              className="h-2.5 rounded-full bg-indigo-600 transition-[width] duration-200"
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
