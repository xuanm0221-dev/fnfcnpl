'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { ApiResponse, PlLine, BrandSlug, ChannelTableData, ChannelRowData, ChannelPlanTable, ChannelActualTable, RetailSalesTableData, RetailSalesRow, ShopSalesDetail, TierRegionSalesData, TierRegionSalesRow, ClothingSalesData, ClothingSalesRow, ClothingItemDetail } from '@/lib/plforecast/types';
import { brandTabs, isValidBrandSlug, slugToCode, codeToLabel } from '@/lib/plforecast/brand';
import { formatK, formatPercent, formatPercentNoDecimal, formatDateShort } from '@/lib/plforecast/format';
import { getKstCurrentYm } from '@/lib/plforecast/date';
import { calculateAdjustedProgressRate } from '@/lib/plforecast/progressRateAdjustment';
import { ResponsiveContainer, Treemap } from 'recharts';

// 현재 월 계산 (YYYY-MM)
// 한국 시간대(KST) 기준으로 계산
function getCurrentYm(): string {
  return getKstCurrentYm();
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

  // 제목에서 괄호 부분 분리
  const titleParts = title.match(/^(.+?)(\(.+?\))$/);
  const mainTitle = titleParts ? titleParts[1] : title;
  const bracketText = titleParts ? titleParts[2] : '';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <h3 className="text-sm font-semibold mb-4 text-gray-800">
        {mainTitle}
        {bracketText && <span className="text-indigo-600">{bracketText}</span>}
      </h3>
      
      {/* 현시점 (누적) */}
      <div className="mb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-gray-900">{formatK(accumValue)}</span>
          <span className="text-sm text-indigo-600">({formatPct(accumRate)})</span>
          <span className="text-xs text-gray-400">(현시점)</span>
        </div>
      </div>

      {/* 월말예상 */}
      <div className="mb-4">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-gray-700">{formatK(forecastValue)}</span>
          <span className="text-sm text-indigo-600">({formatPct(forecastRate)})</span>
          <span className="text-xs text-gray-400">(월말예상)</span>
        </div>
      </div>

      {/* 프로그레스 바 */}
      <div className="mb-3">
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="h-2 rounded-full transition-all bg-indigo-600"
            style={{ width: `${Math.min(progressValue, 100)}%` }}
          />
        </div>
      </div>

      {/* 목표대비 / 전년대비 */}
      <div className="flex gap-4 text-xs">
        <div>
          <span className={targetRate !== null && targetRate >= 1 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
            목표대비 {formatPct(targetRate)}
          </span>
        </div>
        <div>
          <span className={(yoyRate !== null ? yoyRate + 1 : 0) >= 1 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
            전년대비 {formatPct(yoyRate !== null ? yoyRate + 1 : null)}
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
      <h3 className="text-sm font-semibold mb-4 text-gray-800">{title}</h3>
      
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
            className="h-2 rounded-full transition-all bg-indigo-600"
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
function ChannelTable({ data, lastDt }: { data: ChannelTableData; lastDt: string }) {
  const { plan, actual } = data;
  
  // 채널 순서
  const channels: Array<'onlineDirect' | 'onlineDealer' | 'offlineDirect' | 'offlineDealer'> = 
    ['onlineDirect', 'onlineDealer', 'offlineDirect', 'offlineDealer'];
  
  // 날짜 포맷 (25.12.06 형식)
  const formatShortDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${year.slice(2)}.${month}.${day}`;
  };
  
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
    { key: 'actSaleVatIncRate', label: '(할인율)', isRate: true },
    { key: 'actSaleVatExc', label: '실판 매출(V-)', category: '매출액', highlight: true },
    { key: 'cogs', label: '매출원가', category: '매출원가' },
    { key: 'cogsRate', label: '(원가율)', isRate: true },
    { key: 'tagCogsRate', label: '(Tag 대비 원가율)', category: '매출원가', isRate: true, isRateDiff: true },
    { key: 'grossProfit', label: '매출총이익', highlight: true },
    { key: 'grossProfitRate', label: '(매출총이익률)', isRate: true },
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
              <th rowSpan={2} className="py-2 px-3 text-left font-semibold text-gray-600 border-r border-gray-200 sticky left-0 bg-gray-50 z-10"></th>
              <th colSpan={5} className="py-2 px-2 text-center font-semibold text-gray-700 border-r border-gray-300 bg-blue-50">채널별 목표</th>
              <th colSpan={6} className="py-2 px-2 text-center font-semibold text-gray-700 bg-green-50">채널별 진척률({formatShortDate(lastDt)})</th>
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
                  {/* 행 라벨 */}
                  <td className="py-1.5 px-2 text-left font-medium text-gray-700 sticky left-0 bg-inherit z-10 border-r border-gray-200 whitespace-nowrap text-[10px]">
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

// 매장별 상세 모달 컴포넌트
function ShopSalesModal({
  isOpen,
  onClose,
  currentShops,
  prevShops,
  currentLoading,
  prevLoading,
  lastDt,
  onTabChange,
  activeTab,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentShops: ShopSalesDetail[];
  prevShops: ShopSalesDetail[];
  currentLoading: boolean;
  prevLoading: boolean;
  lastDt: string;
  onTabChange: (tab: 'current' | 'prev') => void;
  activeTab: 'current' | 'prev';
}) {
  if (!isOpen) return null;
  
  // 날짜 포맷 (25.12.06 형식)
  const formatShortDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${year.slice(2)}.${month}.${day}`;
  };
  
  // 전년 날짜 계산
  const getPrevYearDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-').map(Number);
    return `${year - 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  
  const shops = activeTab === 'current' ? currentShops : prevShops;
  const loading = activeTab === 'current' ? currentLoading : prevLoading;
  const displayDate = activeTab === 'current' ? lastDt : getPrevYearDate(lastDt);
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">
            매장별 판매매출 (누적 {formatShortDate(displayDate)})
          </h3>
          <div className="flex items-center gap-3">
            {/* 당년/전년 탭 */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => onTabChange('current')}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'current' 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-600 hover:bg-gray-200'
                }`}
              >
                당년
              </button>
              <button
                onClick={() => onTabChange('prev')}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'prev' 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-600 hover:bg-gray-200'
                }`}
              >
                전년
              </button>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* 테이블 */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3 text-gray-500">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>데이터 조회 중...</span>
              </div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="py-3 px-4 text-left font-semibold text-gray-700 border-b border-gray-200">oa_shop_id</th>
                  <th className="py-3 px-4 text-left font-semibold text-gray-700 border-b border-gray-200">매장명</th>
                  <th className="py-3 px-4 text-center font-semibold text-gray-700 border-b border-gray-200">FR/OR</th>
                  <th className="py-3 px-4 text-right font-semibold text-gray-700 border-b border-gray-200">판매매출</th>
                </tr>
              </thead>
              <tbody>
                {shops.map((shop, idx) => (
                  <tr key={shop.shopId} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="py-2 px-4 text-gray-600 font-mono text-xs">{shop.shopId}</td>
                    <td className="py-2 px-4 text-gray-800">{shop.shopName}</td>
                    <td className="py-2 px-4 text-center text-gray-600">{shop.frOrCls}</td>
                    <td className="py-2 px-4 text-right font-mono text-gray-800">
                      {shop.salesAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
                {shops.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-gray-500">
                      데이터가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        
        {/* 푸터 */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
          총 {shops.length}개 매장 / 판매매출 내림차순
        </div>
      </div>
    </div>
  );
}

// 점당매출 테이블 컴포넌트 (대리상 오프라인)
function RetailSalesTable({ data, brandLabel, onSalesClick, retailLastDt }: { data: RetailSalesTableData; brandLabel: string; onSalesClick: () => void; retailLastDt: string }) {
  // 토글 상태
  const [isLegendExpanded, setIsLegendExpanded] = React.useState(false);
  
  // 날짜 포맷 (25.12.29 형식)
  const formatShortDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${year.slice(2)}.${month}.${day}`;
  };
  // 숫자 포맷 (천단위 콤마)
  const formatNumber = (value: number | null, decimals: number = 0): string => {
    if (value === null) return '-';
    return value.toLocaleString(undefined, { 
      minimumFractionDigits: decimals, 
      maximumFractionDigits: decimals 
    });
  };
  
  // 퍼센트 포맷
  const formatPercent = (value: number | null): string => {
    if (value === null) return '-';
    return `${(value * 100).toFixed(1)}%`;
  };
  
  // 행 데이터 정의
  const rows: Array<{
    key: keyof RetailSalesTableData;
    label: string;
    labelExtra?: React.ReactNode;
    formatActual: (v: number | null) => string;
    formatPlan: (v: number | null) => string;
    formatPrev: (v: number | null) => string;
  }> = [
    { 
      key: 'salesK', 
      label: '1. 리테일 매출액(1K)',
      formatActual: (v) => formatNumber(v, 0),
      formatPlan: (v) => formatNumber(v, 0),
      formatPrev: (v) => formatNumber(v, 0),
    },
    { 
      key: 'shopCount', 
      label: '2. 매장수',
      formatActual: (v) => formatNumber(v, 0),
      formatPlan: (v) => formatNumber(v, 0),
      formatPrev: (v) => formatNumber(v, 0),
    },
    { 
      key: 'salesPerShop', 
      label: '3. 점당매출',
      formatActual: (v) => formatNumber(v, 0),
      formatPlan: (v) => formatNumber(v, 0),
      formatPrev: (v) => formatNumber(v, 0),
    },
    { 
      key: 'salesPerShopMonthly', 
      label: '4. 점당매출_월환산',
      labelExtra: data.isProgressRateAdjusted ? (
        <span className="ml-2 px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded-full">
          명절보정
        </span>
      ) : null,
      formatActual: (v) => formatNumber(v, 0),
      formatPlan: (v) => formatNumber(v, 0),
      formatPrev: (v) => formatNumber(v, 0),
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700">
          {brandLabel} (대리상 오프라인) 점당 매출
          {retailLastDt && <span className="text-xs font-normal text-gray-500 ml-2">({formatShortDate(retailLastDt)} 기준)</span>}
        </h3>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr className="border-b border-gray-200">
              <th className="py-2 px-3 text-center font-semibold text-gray-700 border-r border-gray-200">{brandLabel}</th>
              <th className="py-2 px-2 text-center font-semibold text-gray-700 bg-blue-50 border-r border-gray-100">실 적</th>
              <th className="py-2 px-2 text-center font-semibold text-gray-700 bg-blue-50 border-r border-gray-100">진척률</th>
              <th className="py-2 px-2 text-center font-semibold text-gray-700 bg-blue-50 border-r border-gray-200">YOY</th>
              <th className="py-2 px-2 text-center font-semibold text-gray-700 border-r border-gray-100">계 획</th>
              <th className="py-2 px-2 text-center font-semibold text-gray-700">전년</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowData = data[row.key];
              const isHighlight = row.key === 'salesPerShopMonthly';
              const isClickable = row.key === 'salesK';
              
              if (!rowData || typeof rowData !== 'object') return null;
              
              return (
                <tr 
                  key={row.key} 
                  className={`border-b border-gray-100 ${isHighlight ? 'bg-yellow-50' : ''} ${isClickable ? 'cursor-pointer hover:bg-blue-100' : ''}`}
                  onClick={isClickable ? onSalesClick : undefined}
                >
                  <td className={`py-2 px-3 text-left font-medium border-r border-gray-200 ${isClickable ? 'text-blue-600 underline' : 'text-gray-700'}`}>
                    <div className="flex items-center">
                      <span>{row.label}</span>
                      {row.labelExtra}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-gray-800 bg-blue-50 border-r border-gray-100">
                    {row.formatActual(rowData.actual)}
                  </td>
                  <td className={`py-2 px-2 text-right font-mono font-semibold border-r border-gray-100 ${
                    isHighlight ? 'bg-yellow-200' : 'bg-blue-50'
                  } ${
                    rowData.progressRate !== null && rowData.progressRate >= 1 ? 'text-emerald-600' : 'text-amber-600'
                  }`}>
                    {formatPercent(rowData.progressRate)}
                  </td>
                  <td className={`py-2 px-2 text-right font-mono bg-blue-50 border-r border-gray-200 ${
                    rowData.yoy !== null && rowData.yoy >= 1 ? 'text-emerald-600' : 'text-rose-600'
                  }`}>
                    {formatPercent(rowData.yoy)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-gray-600 border-r border-gray-100">
                    {row.formatPlan(rowData.plan)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-gray-600">
                    {row.formatPrev(rowData.prevYear)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* 범례 */}
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 space-y-0.5">
        <p>※ 기준 안내</p>
        <p>• 리테일 매출: 대리상 오프라인 매장 + 상품 브랜드 필터 (매장 브랜드 무관)</p>
        <p>• 매장수: 대리상 오프라인 매장 + 매장 브랜드 필터 (해당 상품 브랜드 매출 &gt; 0 매장만 카운팅)</p>
        <p>
          • 점당매출_월환산: {' '}
          {data.isProgressRateAdjusted ? (
            <>
              <span className="text-indigo-600 font-semibold">[명절보정]</span> 요일계수 × 명절D계수를 적용한 보정 진척률로 월환산 (1~2월 설날, 9~10월 추석)
            </>
          ) : (
            <>전년 단순 진척률(전년 누적/전년 전체)로 월환산</>
          )}
        </p>
        {data.isProgressRateAdjusted && (
          <div className="mt-2">
            <button
              onClick={() => setIsLegendExpanded(!isLegendExpanded)}
              className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-semibold text-xs transition-colors"
            >
              <span className={`transform transition-transform duration-200 ${isLegendExpanded ? 'rotate-90' : ''}`}>
                ▶
              </span>
              명절보정 계산 방식 {isLegendExpanded ? '접기' : '상세보기'}
            </button>
            
            {isLegendExpanded && (
              <div className="mt-2 p-3 bg-white rounded border border-indigo-100">
                <p className="text-gray-700 font-semibold mb-1">
                  <span className="text-indigo-600">▸</span> 명절보정 계산 방식
                </p>
                <div className="ml-3 space-y-1 text-gray-600">
                  <p>
                    <strong>1. 문제</strong>: 설날(춘절, 1~2월) 및 추석(9~10월)이 매년 이동하여 단순 진척률로는 부정확
                  </p>
                  <p className="ml-4 text-gray-500 text-[11px]">
                    예) 2025년 1월 설날 포함 vs 2026년 1월 설날 없음 / 2025년 추석 10월 vs 2026년 추석 9월
                  </p>
                  
                  <p className="mt-2">
                    <strong>2. 해결</strong>: 전년 요일 패턴 + 당년 명절 위치를 결합하여 보정
                  </p>
                  <p className="ml-4 text-gray-500 text-[11px]">
                    • 요일계수: 전년 실제 요일 (주말 1.3~1.5배, 평일 0.7~0.9배)
                  </p>
                  <p className="ml-4 text-gray-500 text-[11px]">
                    • 명절D계수: 당년 명절 기준 (D-7~D-1 피크 1.3~2.1배, D+0~D+7 연휴 0.5~0.9배)
                  </p>
                  <p className="ml-4 text-gray-500 text-[11px]">
                    • 설날: D-48 ~ D+15 범위 / 추석: D-14 ~ D+7 범위
                  </p>
                  
                  <p className="mt-2">
                    <strong>3. 계산식</strong>:
                  </p>
                  <p className="ml-4 text-gray-500 text-[11px] font-mono">
                    진척률 = Σ(전년 요일계수 × 당년 D-index계수) / 전년 월전체 가중치합
                  </p>
                  <p className="ml-4 text-gray-500 text-[11px] font-mono">
                    월환산 = 당년 누적 매출 / 진척률
                  </p>
                  
                  <p className="mt-2">
                    <strong>4. 예시</strong>: 2026년 1월 7일 조회 (설날 보정)
                  </p>
                  <p className="ml-4 text-gray-500 text-[11px]">
                    • 당년 설날: 2/17 (1월은 D-47~D-17, 일반 기간)
                  </p>
                  <p className="ml-4 text-gray-500 text-[11px]">
                    • 전년(2025) 1/1~1/7 요일 × 당년(2026) D-index계수 = 누적 가중치
                  </p>
                  <p className="ml-4 text-gray-500 text-[11px]">
                    • 전년(2025) 1/1~1/31 요일 × 당년(2026) D-index계수 = 월전체 가중치
                  </p>
                  <p className="ml-4 text-gray-500 text-[11px]">
                    • 진척률 ≈ 7/31 = 23% → 월환산 = 누적 / 0.23 = 약 4.3배
                  </p>
                </div>
                
                <p className="text-gray-400 mt-2 text-[11px] border-t border-gray-200 pt-2">
                  ※ 3~8월, 11~12월은 명절 영향이 없어 기존 단순 진척률 사용
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 티어별/지역별 점당매출 테이블 컴포넌트
function TierRegionTable({ 
  data, 
  ym, 
  retailLastDt 
}: { 
  data: TierRegionSalesData; 
  ym: string; 
  retailLastDt: string; 
}) {
  // 숫자 포맷 (천단위 콤마)
  const formatNumber = (value: number): string => {
    return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };
  
  // K 단위 포맷 (매출)
  const formatK = (value: number): string => {
    return Math.round(value / 1000).toLocaleString();
  };
  
  // 매장수 YOY 포맷팅 (증감 개수 + 백분율)
  const formatShopYoy = (shopCnt: number, prevShopCnt: number): string => {
    // 전년이 0이고 당년도 0이면 '-'
    if ((!prevShopCnt || prevShopCnt === 0) && (!shopCnt || shopCnt === 0)) return '-';
    // 전년이 0이고 당년이 있으면 증감만 표시
    if (!prevShopCnt || prevShopCnt === 0) {
      const diff = shopCnt;
      const sign = diff >= 0 ? '+' : '△';
      return `${sign}${Math.abs(diff)}개`;
    }
    // 전년이 있으면 증감 + 백분율 표시
    const diff = shopCnt - prevShopCnt;
    const percent = Math.round((shopCnt / prevShopCnt) * 100);
    const sign = diff >= 0 ? '+' : '△';
    return `${sign}${Math.abs(diff)}개(${percent}%)`;
  };
  
  // 안전한 데이터 배열 (리테일 매출 내림차순 정렬)
  const safeTiers = Array.isArray(data?.tiers) 
    ? [...data.tiers].sort((a, b) => (b?.salesAmt || 0) - (a?.salesAmt || 0))
    : [];
  const safeRegions = Array.isArray(data?.regions) 
    ? [...data.regions].sort((a, b) => (b?.salesAmt || 0) - (a?.salesAmt || 0))
    : [];
  const safeTradeZones = Array.isArray(data?.tradeZones) 
    ? [...data.tradeZones].sort((a, b) => (b?.salesAmt || 0) - (a?.salesAmt || 0))
    : [];
  const safeShopLevels = Array.isArray(data?.shopLevels) 
    ? [...data.shopLevels].sort((a, b) => (b?.salesAmt || 0) - (a?.salesAmt || 0))
    : [];
  
  // 티어 합계 계산 - 전체 데이터 사용 (상단 표와 일치)
  const tierTotalSalesAmt = safeTiers.reduce((sum, r) => sum + (r?.salesAmt || 0), 0);
  const tierTotalShopCnt = safeTiers.reduce((sum, r) => sum + (r?.shopCnt || 0), 0);
  // 전년 누적 데이터는 서버에서 전달된 전체 데이터 우선 사용 (상단 표와 일치)
  const tierTotalPrevCumSalesAmt = data?.prevTotalCumSalesAmt ?? safeTiers.reduce((sum, r) => sum + (r?.prevCumSalesAmt || 0), 0);
  const tierTotalPrevCumShopCnt = data?.prevTotalCumShopCnt ?? safeTiers.reduce((sum, r) => sum + (r?.prevCumShopCnt || 0), 0);
  // 전년 월전체 데이터는 서버에서 전달된 전체 데이터 우선 사용 (상단 표와 일치)
  const tierTotalPrevFullSalesAmt = data?.prevTotalSalesAmt ?? safeTiers.reduce((sum, r) => sum + (r?.prevFullSalesAmt || 0), 0);
  const tierTotalPrevFullShopCnt = data?.prevTotalShopCnt ?? safeTiers.reduce((sum, r) => sum + (r?.prevFullShopCnt || 0), 0);
  // 월환산 점당매출 계산 (명절 보정 적용)
  const { progressRate: tierLyProgressRate } = calculateAdjustedProgressRate(
    ym,
    retailLastDt,
    tierTotalPrevCumSalesAmt,
    tierTotalPrevFullSalesAmt
  );
  const tierMonthlyTotalAmt = tierLyProgressRate > 0 ? tierTotalSalesAmt / tierLyProgressRate : 0;
  const tierTotalSalesPerShop = tierTotalShopCnt > 0 ? tierMonthlyTotalAmt / tierTotalShopCnt : 0;
  // 전년 월전체 데이터 (표시용) - 대리상 오프라인 점당매출의 전년 합계 데이터 사용
  const tierTotalPrevSalesAmt = data?.prevTotalSalesAmt ?? safeTiers.reduce((sum, r) => sum + (r?.prevSalesAmt || 0), 0);
  const tierTotalPrevShopCnt = data?.prevTotalShopCnt ?? safeTiers.reduce((sum, r) => sum + (r?.prevShopCnt || 0), 0);
  const tierTotalPrevSalesPerShop = data?.prevTotalSalesPerShop ?? (tierTotalPrevShopCnt > 0 ? tierTotalPrevSalesAmt / tierTotalPrevShopCnt : 0);
  
  // 지역 합계 계산 - 전체 데이터 사용 (상단 표와 일치)
  const regionTotalSalesAmt = safeRegions.reduce((sum, r) => sum + (r?.salesAmt || 0), 0);
  const regionTotalShopCnt = safeRegions.reduce((sum, r) => sum + (r?.shopCnt || 0), 0);
  // 전년 누적 데이터는 서버에서 전달된 전체 데이터 우선 사용 (상단 표와 일치)
  const regionTotalPrevCumSalesAmt = data?.prevTotalCumSalesAmt ?? safeRegions.reduce((sum, r) => sum + (r?.prevCumSalesAmt || 0), 0);
  const regionTotalPrevCumShopCnt = data?.prevTotalCumShopCnt ?? safeRegions.reduce((sum, r) => sum + (r?.prevCumShopCnt || 0), 0);
  // 전년 월전체 데이터는 서버에서 전달된 전체 데이터 우선 사용 (상단 표와 일치)
  const regionTotalPrevFullSalesAmt = data?.prevTotalSalesAmt ?? safeRegions.reduce((sum, r) => sum + (r?.prevFullSalesAmt || 0), 0);
  const regionTotalPrevFullShopCnt = data?.prevTotalShopCnt ?? safeRegions.reduce((sum, r) => sum + (r?.prevFullShopCnt || 0), 0);
  // 월환산 점당매출 계산 (명절 보정 적용)
  const { progressRate: regionLyProgressRate } = calculateAdjustedProgressRate(
    ym,
    retailLastDt,
    regionTotalPrevCumSalesAmt,
    regionTotalPrevFullSalesAmt
  );
  const regionMonthlyTotalAmt = regionLyProgressRate > 0 ? regionTotalSalesAmt / regionLyProgressRate : 0;
  const regionTotalSalesPerShop = regionTotalShopCnt > 0 ? regionMonthlyTotalAmt / regionTotalShopCnt : 0;
  // 전년 월전체 데이터 (표시용) - 대리상 오프라인 점당매출의 전년 합계 데이터 사용
  const regionTotalPrevSalesAmt = data?.prevTotalSalesAmt ?? safeRegions.reduce((sum, r) => sum + (r?.prevSalesAmt || 0), 0);
  const regionTotalPrevShopCnt = data?.prevTotalShopCnt ?? safeRegions.reduce((sum, r) => sum + (r?.prevShopCnt || 0), 0);
  const regionTotalPrevSalesPerShop = data?.prevTotalSalesPerShop ?? (regionTotalPrevShopCnt > 0 ? regionTotalPrevSalesAmt / regionTotalPrevShopCnt : 0);
  
  // Trade Zone 합계 계산 - 전체 데이터 사용 (상단 표와 일치)
  const tradeZoneTotalSalesAmt = safeTradeZones.reduce((sum, r) => sum + (r?.salesAmt || 0), 0);
  const tradeZoneTotalShopCnt = safeTradeZones.reduce((sum, r) => sum + (r?.shopCnt || 0), 0);
  // 전년 누적 데이터는 서버에서 전달된 전체 데이터 우선 사용 (상단 표와 일치)
  const tradeZoneTotalPrevCumSalesAmt = data?.prevTotalCumSalesAmt ?? safeTradeZones.reduce((sum, r) => sum + (r?.prevCumSalesAmt || 0), 0);
  const tradeZoneTotalPrevCumShopCnt = data?.prevTotalCumShopCnt ?? safeTradeZones.reduce((sum, r) => sum + (r?.prevCumShopCnt || 0), 0);
  // 전년 월전체 데이터는 서버에서 전달된 전체 데이터 우선 사용 (상단 표와 일치)
  const tradeZoneTotalPrevFullSalesAmt = data?.prevTotalSalesAmt ?? safeTradeZones.reduce((sum, r) => sum + (r?.prevFullSalesAmt || 0), 0);
  const tradeZoneTotalPrevFullShopCnt = data?.prevTotalShopCnt ?? safeTradeZones.reduce((sum, r) => sum + (r?.prevFullShopCnt || 0), 0);
  // 월환산 점당매출 계산 (명절 보정 적용)
  const { progressRate: tradeZoneLyProgressRate } = calculateAdjustedProgressRate(
    ym,
    retailLastDt,
    tradeZoneTotalPrevCumSalesAmt,
    tradeZoneTotalPrevFullSalesAmt
  );
  const tradeZoneMonthlyTotalAmt = tradeZoneLyProgressRate > 0 ? tradeZoneTotalSalesAmt / tradeZoneLyProgressRate : 0;
  const tradeZoneTotalSalesPerShop = tradeZoneTotalShopCnt > 0 ? tradeZoneMonthlyTotalAmt / tradeZoneTotalShopCnt : 0;
  // 전년 월전체 데이터 (표시용) - 대리상 오프라인 점당매출의 전년 합계 데이터 사용
  const tradeZoneTotalPrevSalesAmt = data?.prevTotalSalesAmt ?? safeTradeZones.reduce((sum, r) => sum + (r?.prevSalesAmt || 0), 0);
  const tradeZoneTotalPrevShopCnt = data?.prevTotalShopCnt ?? safeTradeZones.reduce((sum, r) => sum + (r?.prevShopCnt || 0), 0);
  const tradeZoneTotalPrevSalesPerShop = data?.prevTotalSalesPerShop ?? (tradeZoneTotalPrevShopCnt > 0 ? tradeZoneTotalPrevSalesAmt / tradeZoneTotalPrevShopCnt : 0);
  
  // Shop Level 합계 계산 - 전체 데이터 사용 (상단 표와 일치)
  const shopLevelTotalSalesAmt = safeShopLevels.reduce((sum, r) => sum + (r?.salesAmt || 0), 0);
  const shopLevelTotalShopCnt = safeShopLevels.reduce((sum, r) => sum + (r?.shopCnt || 0), 0);
  // 전년 누적 데이터는 서버에서 전달된 전체 데이터 우선 사용 (상단 표와 일치)
  const shopLevelTotalPrevCumSalesAmt = data?.prevTotalCumSalesAmt ?? safeShopLevels.reduce((sum, r) => sum + (r?.prevCumSalesAmt || 0), 0);
  const shopLevelTotalPrevCumShopCnt = data?.prevTotalCumShopCnt ?? safeShopLevels.reduce((sum, r) => sum + (r?.prevCumShopCnt || 0), 0);
  // 전년 월전체 데이터는 서버에서 전달된 전체 데이터 우선 사용 (상단 표와 일치)
  const shopLevelTotalPrevFullSalesAmt = data?.prevTotalSalesAmt ?? safeShopLevels.reduce((sum, r) => sum + (r?.prevFullSalesAmt || 0), 0);
  const shopLevelTotalPrevFullShopCnt = data?.prevTotalShopCnt ?? safeShopLevels.reduce((sum, r) => sum + (r?.prevFullShopCnt || 0), 0);
  // 월환산 점당매출 계산 (명절 보정 적용)
  const { progressRate: shopLevelLyProgressRate } = calculateAdjustedProgressRate(
    ym,
    retailLastDt,
    shopLevelTotalPrevCumSalesAmt,
    shopLevelTotalPrevFullSalesAmt
  );
  const shopLevelMonthlyTotalAmt = shopLevelLyProgressRate > 0 ? shopLevelTotalSalesAmt / shopLevelLyProgressRate : 0;
  const shopLevelTotalSalesPerShop = shopLevelTotalShopCnt > 0 ? shopLevelMonthlyTotalAmt / shopLevelTotalShopCnt : 0;
  // 전년 월전체 데이터 (표시용) - 대리상 오프라인 점당매출의 전년 합계 데이터 사용
  const shopLevelTotalPrevSalesAmt = data?.prevTotalSalesAmt ?? safeShopLevels.reduce((sum, r) => sum + (r?.prevSalesAmt || 0), 0);
  const shopLevelTotalPrevShopCnt = data?.prevTotalShopCnt ?? safeShopLevels.reduce((sum, r) => sum + (r?.prevShopCnt || 0), 0);
  const shopLevelTotalPrevSalesPerShop = data?.prevTotalSalesPerShop ?? (shopLevelTotalPrevShopCnt > 0 ? shopLevelTotalPrevSalesAmt / shopLevelTotalPrevShopCnt : 0);

  // 테이블 렌더링 함수
  const renderTable = (type: 'tier' | 'region' | 'trade_zone' | 'shop_level', rows: TierRegionSalesRow[], totalSalesAmt: number, totalShopCnt: number, totalSalesPerShop: number, totalPrevSalesAmt: number, totalPrevShopCnt: number, totalPrevSalesPerShop: number) => {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden h-full flex flex-col">
        {/* 헤더 */}
        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700">
            {type === 'tier' ? 'Tier (대리상)' : type === 'region' ? '지역(대리상)' : type === 'trade_zone' ? 'Trade Zone (대리상)' : 'Shop Level (대리상)'}
          </h3>
        </div>
        
        {/* 테이블 */}
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="border-b border-gray-200">
                {type === 'tier' || type === 'trade_zone' || type === 'shop_level' ? (
                  <th className="py-2 px-3 text-left font-semibold text-gray-700 border-r border-gray-200">
                    {type === 'tier' ? '티어구분' : type === 'trade_zone' ? 'Trade Zone' : 'Shop Level'}
                  </th>
                ) : (
                  <>
                    <th className="py-2 px-3 text-left font-semibold text-gray-700 border-r border-gray-100">중국어</th>
                    <th className="py-2 px-3 text-left font-semibold text-gray-700 border-r border-gray-200">한국어</th>
                  </>
                )}
                <th className="py-2 px-2 text-right font-semibold text-gray-700 bg-blue-50 border-r border-gray-100">리테일매출(K)</th>
                <th className="py-2 px-2 text-right font-semibold text-gray-700 bg-blue-50 border-r border-gray-100">매장수</th>
                <th className="py-2 px-2 text-right font-semibold text-gray-700 bg-blue-50 border-r border-gray-100">
                  <div className="flex items-center justify-end gap-1">
                    <span>월환산 점당매출</span>
                    {rows.some(r => r.isProgressRateAdjusted) && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-indigo-100 text-indigo-700 rounded">
                        명절보정
                      </span>
                    )}
                  </div>
                </th>
                <th className="py-2 px-2 text-right font-semibold text-gray-700 bg-blue-50 border-r border-gray-200">YOY(점당매출)</th>
                <th className="py-2 px-2 text-right font-semibold text-gray-700 bg-blue-50 border-r border-gray-200">YOY(매장수)</th>
                <th className="py-2 px-2 text-right font-semibold text-gray-700 border-r border-gray-100">(전년)리테일매출(K)</th>
                <th className="py-2 px-2 text-right font-semibold text-gray-700 border-r border-gray-100">(전년)매장수</th>
                <th className="py-2 px-2 text-right font-semibold text-gray-700">(전년)점당매출</th>
              </tr>
            </thead>
            <tbody>
              {/* 합계 행 */}
              <tr className="border-b border-gray-300 bg-yellow-50 font-semibold">
                {type === 'tier' || type === 'trade_zone' || type === 'shop_level' ? (
                  <td className="py-2 px-3 text-left text-gray-800 border-r border-gray-200">합계</td>
                ) : (
                  <>
                    <td className="py-2 px-3 text-left text-gray-800 border-r border-gray-100">합계</td>
                    <td className="py-2 px-3 text-left text-gray-600 border-r border-gray-200">-</td>
                  </>
                )}
                <td className="py-2 px-2 text-right font-mono text-gray-800 bg-yellow-100 border-r border-gray-100">{formatK(totalSalesAmt)}</td>
                <td className="py-2 px-2 text-right font-mono text-gray-800 bg-yellow-100 border-r border-gray-100">{formatNumber(totalShopCnt)}</td>
                <td className="py-2 px-2 text-right font-mono text-gray-800 bg-yellow-100 border-r border-gray-100">{formatNumber(totalSalesPerShop)}</td>
                <td className={`py-2 px-2 text-right font-mono font-semibold bg-yellow-100 border-r border-gray-200 ${
                  totalPrevSalesPerShop > 0 && totalSalesPerShop / totalPrevSalesPerShop >= 1 ? 'text-emerald-600' : 'text-rose-600'
                }`}>
                  {totalPrevSalesPerShop > 0 ? ((totalSalesPerShop / totalPrevSalesPerShop) * 100).toFixed(1) + '%' : '-'}
                </td>
                <td className={`py-2 px-2 text-right font-mono font-semibold bg-yellow-100 border-r border-gray-200 ${
                  totalPrevShopCnt > 0 && totalShopCnt / totalPrevShopCnt >= 1 ? 'text-emerald-600' : 'text-rose-600'
                }`}>
                  {formatShopYoy(totalShopCnt, totalPrevShopCnt)}
                </td>
                <td className="py-2 px-2 text-right font-mono text-gray-600 border-r border-gray-100">{formatK(totalPrevSalesAmt)}</td>
                <td className="py-2 px-2 text-right font-mono text-gray-600 border-r border-gray-100">{formatNumber(totalPrevShopCnt)}</td>
                <td className="py-2 px-2 text-right font-mono text-gray-600">{formatNumber(totalPrevSalesPerShop)}</td>
              </tr>
              {/* 데이터 행 */}
              {rows.map((row) => {
                if (!row) return null;
                const tooltipText = row.cities && row.cities.length > 0 
                  ? `주요 도시: ${row.cities.join(', ')}`
                  : null;
                const hasTooltip = !!tooltipText;
                return (
                  <tr key={row.key} className="border-b border-gray-100 hover:bg-gray-50">
                    {type === 'tier' || type === 'trade_zone' || type === 'shop_level' ? (
                      <td 
                        className={`py-2 px-3 text-left font-medium text-gray-700 border-r border-gray-200 ${hasTooltip ? 'cursor-help' : ''}`}
                        {...(hasTooltip ? { title: tooltipText } : {})}
                      >
                        {row.key}
                      </td>
                    ) : (
                      <>
                        <td 
                          className={`py-2 px-3 text-left font-medium text-gray-700 border-r border-gray-100 ${hasTooltip ? 'cursor-help' : ''}`}
                          {...(hasTooltip ? { title: tooltipText } : {})}
                        >
                          {row.key}
                        </td>
                        <td 
                          className={`py-2 px-3 text-left text-gray-600 border-r border-gray-200 ${hasTooltip ? 'cursor-help' : ''}`}
                          {...(hasTooltip ? { title: tooltipText } : {})}
                        >
                          {row.labelKo || row.key}
                        </td>
                      </>
                    )}
                    <td className="py-2 px-2 text-right font-mono text-gray-800 bg-blue-50 border-r border-gray-100">{formatK(row.salesAmt || 0)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-800 bg-blue-50 border-r border-gray-100">{formatNumber(row.shopCnt || 0)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-800 bg-blue-50 border-r border-gray-100">{formatNumber(row.salesPerShop || 0)}</td>
                    <td className={`py-2 px-2 text-right font-mono bg-blue-50 border-r border-gray-200 ${
                      (row.prevSalesPerShop || 0) > 0 && (row.salesPerShop || 0) / (row.prevSalesPerShop || 1) >= 1 ? 'text-emerald-600' : 'text-rose-600'
                    }`}>
                      {(row.prevSalesPerShop || 0) > 0 ? (((row.salesPerShop || 0) / row.prevSalesPerShop) * 100).toFixed(1) + '%' : '-'}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono bg-blue-50 border-r border-gray-200 ${
                      (row.prevShopCnt || 0) > 0 && (row.shopCnt || 0) / (row.prevShopCnt || 1) >= 1 ? 'text-emerald-600' : 'text-rose-600'
                    }`}>
                      {formatShopYoy(row.shopCnt || 0, row.prevShopCnt || 0)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600 border-r border-gray-100">{formatK(row.prevSalesAmt || 0)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600 border-r border-gray-100">{formatNumber(row.prevShopCnt || 0)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600">{formatNumber(row.prevSalesPerShop || 0)}</td>
                  </tr>
                );
              })}
              {(rows?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={type === 'tier' || type === 'trade_zone' || type === 'shop_level' ? 8 : 9} className="py-4 text-center text-gray-500">
                    데이터가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* 1행: Tier 표 | 지역 표 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 좌측: Tier 테이블 */}
        {renderTable('tier', safeTiers, tierTotalSalesAmt, tierTotalShopCnt, tierTotalSalesPerShop, tierTotalPrevSalesAmt, tierTotalPrevShopCnt, tierTotalPrevSalesPerShop)}
        
        {/* 우측: 지역 테이블 */}
        {renderTable('region', safeRegions, regionTotalSalesAmt, regionTotalShopCnt, regionTotalSalesPerShop, regionTotalPrevSalesAmt, regionTotalPrevShopCnt, regionTotalPrevSalesPerShop)}
      </div>
      
      {/* 2행: Trade Zone 표 | Shop Level 표 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 좌측: Trade Zone 테이블 */}
        {renderTable('trade_zone', safeTradeZones, tradeZoneTotalSalesAmt, tradeZoneTotalShopCnt, tradeZoneTotalSalesPerShop, tradeZoneTotalPrevSalesAmt, tradeZoneTotalPrevShopCnt, tradeZoneTotalPrevSalesPerShop)}
        
        {/* 우측: Shop Level 테이블 */}
        {renderTable('shop_level', safeShopLevels, shopLevelTotalSalesAmt, shopLevelTotalShopCnt, shopLevelTotalSalesPerShop, shopLevelTotalPrevSalesAmt, shopLevelTotalPrevShopCnt, shopLevelTotalPrevSalesPerShop)}
      </div>
    </div>
  );
}

// 트리맵 커스텀 컨텐츠 컴포넌트 (개선된 디자인)
interface TreemapContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  displayName?: string; // 지역용: 한국어(중국어)
  salesPerShop?: number;
  salesK?: string;
  shopCnt?: number;
  prevSalesPerShop?: number;
  prevSalesK?: string;
  prevShopCnt?: number;
  yoy?: number;
  discountRate?: number | null;
  discountRateYoy?: number | null;
  color?: string;
}

function TreemapContent(props: TreemapContentProps & { payload?: any }) {
  const { 
    x = 0, y = 0, width = 0, height = 0, 
    displayName, salesPerShop, salesK, shopCnt, 
    prevSalesPerShop, prevSalesK, prevShopCnt,
    yoy, discountRate, discountRateYoy, color, payload
  } = props;
  
  // Recharts가 props로 전달하지 않을 경우 payload에서 가져오기
  const finalDiscountRate = discountRate !== undefined ? discountRate : (payload?.discountRate ?? null);
  const finalDiscountRateYoy = discountRateYoy !== undefined ? discountRateYoy : (payload?.discountRateYoy ?? null);
  
  // 타일 간 간격 (2px - 하얀색 구분선)
  const gap = 2;
  const innerX = x + gap;
  const innerY = y + gap;
  const innerWidth = width - gap * 2;
  const innerHeight = height - gap * 2;
  
  // 작은 타일 처리
  if (innerWidth < 80 || innerHeight < 60) {
    return (
      <g>
        <rect x={innerX} y={innerY} width={innerWidth} height={innerHeight} 
              fill={color || '#8884d8'} stroke="#fff" strokeWidth={1} rx={0} />
        <text 
          x={innerX + 12} 
          y={innerY + 20} 
          fill="#fff" 
          fontSize={14} 
          fontWeight="normal"
          stroke="none"
          style={{ fontFamily: 'inherit' }}
        >
          {displayName}
        </text>
      </g>
    );
  }
  
  const formatNum = (v: number) => Math.round(v).toLocaleString();
  const formatYoyPercent = (v: number | null | undefined) => {
    if (v === null || v === undefined) return '-';
    return `${Math.round(v)}%`;
  };
  
  // 매장수 YOY 포맷팅 (증감 개수 + 백분율)
  const formatShopYoy = (shopCnt: number | undefined, prevShopCnt: number | undefined): string => {
    const currentCnt = shopCnt || 0;
    const prevCnt = prevShopCnt || 0;
    // 전년이 0이고 당년도 0이면 '-'
    if (prevCnt === 0 && currentCnt === 0) return '-';
    // 전년이 0이고 당년이 있으면 증감만 표시
    if (prevCnt === 0) {
      const diff = currentCnt;
      const sign = diff >= 0 ? '+' : '△';
      return `${sign}${Math.abs(diff)}개`;
    }
    // 전년이 있으면 증감 + 백분율 표시
    const diff = currentCnt - prevCnt;
    const percent = Math.round((currentCnt / prevCnt) * 100);
    const sign = diff >= 0 ? '+' : '△';
    return `${sign}${Math.abs(diff)}개, ${percent}%`;
  };
  
  // 실판 YOY 계산 (당월누적 vs 전년 누적)
  const salesYoyPercent = salesK && prevSalesK 
    ? Math.round((parseFloat(salesK.replace(/,/g, '')) / parseFloat(prevSalesK.replace(/,/g, ''))) * 100)
    : null;
  
  // 점당매출 YOY 계산 (월말예상 점당 vs 전년 월전체 점당) - 테이블과 일치
  const salesPerShopYoyPercent = prevSalesPerShop && prevSalesPerShop > 0
    ? Math.round((salesPerShop || 0) / prevSalesPerShop * 100)
    : null;
  
  // 매장수 YOY 포맷팅 (테이블과 일치)
  const shopYoyText = formatShopYoy(shopCnt, prevShopCnt);
  
  // 라인 높이
  const lineHeight = 18;
  const startY = innerY + 16;
  const contentStartY = startY + lineHeight;
  
  // 작은 박스 처리: 폰트 크기 조정 (더 작게)
  const fontSize = innerWidth < 120 ? '8px' : innerWidth < 150 ? '9px' : '10px';
  const titleFontSize = innerWidth < 120 ? 14 : innerWidth < 150 ? 15 : 16;
  
  return (
    <g>
      {/* 타일 배경 (간격 포함, 라운드 제거) */}
      <rect x={innerX} y={innerY} width={innerWidth} height={innerHeight} 
            fill={color || '#8884d8'} stroke="#fff" strokeWidth={1} rx={0} />
      
      {/* 1줄: 카테고리명 */}
      <text 
        x={innerX + 8} 
        y={startY} 
        fill="#fff" 
        fontSize={titleFontSize} 
        fontWeight="normal"
        stroke="none"
        style={{ fontFamily: 'inherit' }}
      >
        {displayName}
      </text>
      
      {/* 간단한 텍스트 형식으로 표시 */}
      {innerHeight > 80 && (
        <foreignObject x={innerX + 8} y={contentStartY} width={innerWidth - 16} height={innerHeight - (contentStartY - innerY) - 12}>
          {/* @ts-ignore - xmlns 속성은 foreignObject 내부에서 필요하지만 TypeScript가 인식하지 못함 */}
          <div xmlns="http://www.w3.org/1999/xhtml" style={{ color: '#fff', fontSize, fontFamily: 'inherit', lineHeight: '1.4' }}>
            <div>당월누적 실판&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{salesK}K ({salesYoyPercent !== null ? `${salesYoyPercent}%` : '-'})</div>
            <div>할인율 (YOY)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{finalDiscountRate !== null && finalDiscountRate !== undefined ? `${finalDiscountRate.toFixed(1)}%` : '-'} {finalDiscountRateYoy !== null && finalDiscountRateYoy !== undefined ? `(${finalDiscountRateYoy >= 0 ? '+' : ''}${finalDiscountRateYoy.toFixed(1)}%)` : ''}</div>
            <div>월말예상 점당&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{formatNum(salesPerShop || 0)} ({salesPerShopYoyPercent !== null ? `${salesPerShopYoyPercent}%` : '-'})</div>
            <div>매장수&nbsp;&nbsp;{shopCnt || 0}개 ({shopYoyText})</div>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

// 카테고리 트리맵 인라인 (2단계)
function CategoryTreemapInline({
  type,
  keyName,
  labelKo,
  brandCode,
  ym,
  lastDt,
  onBack,
  onCategoryClick
}: {
  type: 'tier' | 'region';
  keyName: string;
  labelKo?: string;
  brandCode: string;
  ym: string;
  lastDt: string;
  onBack: () => void;
  onCategoryClick: (categoryName: string, type: 'tier' | 'region') => void;
}) {
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<{ category: string; cySalesAmt: number; pySalesAmt: number; yoy: number | null; discountRate: number | null; prevDiscountRate: number | null; discountRateYoy: number | null }[]>([]);
  
  useEffect(() => {
    if (keyName) {
      setLoading(true);
      fetch(`/api/category-sales?type=${type}&key=${encodeURIComponent(keyName)}&brandCode=${brandCode}&ym=${ym}&lastDt=${lastDt}`)
        .then(res => res.json())
        .then(data => {
          setCategories(Array.isArray(data?.categories) ? data.categories : []);
        })
        .catch(err => {
          console.error('카테고리 판매 조회 오류:', err);
          setCategories([]);
        })
        .finally(() => setLoading(false));
    } else {
      setCategories([]);
    }
  }, [keyName, type, brandCode, ym, lastDt]);
  
  const displayName = labelKo ? `${labelKo}(${keyName})` : keyName;
  
  // 파스텔 변환 함수
  const toPastel = (r: number, g: number, b: number): [number, number, number] => {
    return [
      Math.floor(r * 0.7 + 255 * 0.3),
      Math.floor(g * 0.7 + 255 * 0.3),
      Math.floor(b * 0.7 + 255 * 0.3)
    ];
  };
  
  // YOY 기반 그라데이션 색상 계산 (7단계, 파스텔 톤)
  const getYoyColor = (yoy: number | null | undefined): string => {
    if (!yoy || yoy === 0) return '#8884d8'; // 기본색
    
    const yoyPercent = yoy * 100; // 100% 기준
    
    // 색상 범위 정의 (원본 색상 보간 후 파스텔 변환)
    let r, g, b;
    
    if (yoyPercent >= 110) {
      // 110% 이상: 네이비
      [r, g, b] = toPastel(30, 58, 138);
    } else if (yoyPercent >= 105) {
      // 105% ~ 110%: 파랑 (경계에서 그라데이션)
      const ratio = (yoyPercent - 105) / 5; // 0~1
      const r1 = 59 + (30 - 59) * ratio;
      const g1 = 130 + (58 - 130) * ratio;
      const b1 = 246 + (138 - 246) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else if (yoyPercent >= 100) {
      // 100% ~ 105%: 민트 (경계에서 그라데이션)
      const ratio = (yoyPercent - 100) / 5; // 0~1
      const r1 = 16 + (59 - 16) * ratio;
      const g1 = 185 + (130 - 185) * ratio;
      const b1 = 129 + (246 - 129) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else if (yoyPercent >= 95) {
      // 95% ~ 100%: 연한 노랑 (경계에서 그라데이션)
      const ratio = (yoyPercent - 95) / 5; // 0~1
      const r1 = 254 + (16 - 254) * ratio;
      const g1 = 240 + (185 - 240) * ratio;
      const b1 = 138 + (129 - 138) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else if (yoyPercent >= 90) {
      // 90% ~ 95%: 연한 오렌지 (경계에서 그라데이션)
      const ratio = (yoyPercent - 90) / 5; // 0~1
      const r1 = 255 + (254 - 255) * ratio;
      const g1 = 183 + (240 - 183) * ratio;
      const b1 = 107 + (138 - 107) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else if (yoyPercent >= 85) {
      // 85% ~ 90%: 오렌지 (경계에서 그라데이션)
      const ratio = (yoyPercent - 85) / 5; // 0~1
      const r1 = 251 + (255 - 251) * ratio;
      const g1 = 146 + (183 - 146) * ratio;
      const b1 = 60 + (107 - 60) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else {
      // 85% 미만: 빨강 계열 (낮을수록 진한 빨강)
      const ratio = Math.min(yoyPercent / 85, 1); // 0~1
      const r1 = 239 + (220 - 239) * ratio;
      const g1 = 68 - 68 * ratio;
      const b1 = 68 - 68 * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    }
    
    return `rgb(${r}, ${g}, ${b})`;
  };
  
  // 영문 키와 한글 키 매핑
  const categoryKeyMap: Record<string, string> = {
    'Shoes': 'Shoes',
    'Headwear': 'Headwear',
    'Bag': 'Bag',
    'Acc_etc': 'Acc_etc',
    '의류 당시즌': '의류 당시즌',
    '의류 차시즌': '의류 차시즌',
    '의류 과시즌': '의류 과시즌',
    '신발': 'Shoes',
    '모자': 'Headwear',
    '가방': 'Bag',
    '기타악세': 'Acc_etc',
  };
  
  const safeCategories = Array.isArray(categories) ? categories : [];
  const totalSales = safeCategories.reduce((sum, cat) => sum + (cat?.cySalesAmt || 0), 0);
  
  const treemapData = safeCategories.map(cat => {
    if (!cat) return null;
    const categoryKey = categoryKeyMap[cat.category] || cat.category;
    const percentage = totalSales > 0 ? ((cat.cySalesAmt || 0) / totalSales * 100).toFixed(1) : '0.0';
    // YOY 계산 (판매액 기준)
    const categoryYoy = cat.pySalesAmt && cat.pySalesAmt > 0 
      ? (cat.cySalesAmt || 0) / cat.pySalesAmt 
      : null;
    return {
      name: categoryKey,
      displayName: cat.category,
      size: cat.cySalesAmt || 0,
      cySalesAmt: cat.cySalesAmt || 0,
      pySalesAmt: cat.pySalesAmt || 0,
      yoy: categoryYoy,
      percentage,
      discountRate: cat.discountRate ?? null,
      discountRateYoy: cat.discountRateYoy ?? null,
      color: getYoyColor(categoryYoy), // YOY 기반 그라데이션 색상
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null);
  
  const handleCategoryClick = (data: { name: string }) => {
    if (data && data.name) {
      onCategoryClick(data.name, type);
    }
  };
  
  return (
    <div className="relative p-2">
      {/* 뒤로가기 버튼 */}
      <button
        onClick={onBack}
        className="absolute -top-2 left-4 z-10 bg-white border border-gray-300 rounded px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        뒤로가기
      </button>
      
      {/* 제목 */}
      <div className="mb-2 text-center">
        <h4 className="text-sm font-semibold text-gray-700">
          {type === 'tier' ? '티어' : '지역'}: {displayName} - 카테고리별 판매
        </h4>
      </div>
      
      {/* 트리맵 */}
      <div className="h-[320px] border border-gray-300 rounded-none overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500">로딩 중...</div>
        ) : (treemapData?.length ?? 0) > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={treemapData}
              dataKey="size"
              aspectRatio={4 / 3}
              stroke="none"
              content={(props) => {
                const { x, y, width, height, name, displayName, cySalesAmt, pySalesAmt, yoy, color, percentage, discountRate, discountRateYoy } = props as TreemapContentProps & { cySalesAmt?: number; pySalesAmt?: number; percentage?: string; discountRate?: number | null; discountRateYoy?: number | null };
                
                const gap = 2;
                const innerX = (x || 0) + gap;
                const innerY = (y || 0) + gap;
                const innerWidth = (width || 0) - gap * 2;
                const innerHeight = (height || 0) - gap * 2;
                
                // level2는 전부 하얀색 글씨
                const textColor = '#fff';
                
                if (innerWidth < 80 || innerHeight < 60) {
                  return (
                    <g>
                      <rect x={innerX} y={innerY} width={innerWidth} height={innerHeight} 
                            fill={color || '#8884d8'} stroke="#fff" strokeWidth={1} rx={0} />
                      <text 
                        x={innerX + 12} 
                        y={innerY + 20} 
                        fill={textColor} 
                        fontSize={16} 
                        fontWeight="normal"
                        stroke="none"
                        style={{ fontFamily: 'inherit' }}
                      >
                        {displayName}
                      </text>
                    </g>
                  );
                }
                
                const formatK = (v: number) => Math.round(v / 1000).toLocaleString();
                
                // 카테고리 판매액 YOY 계산
                const categoryYoy = cySalesAmt && pySalesAmt && pySalesAmt > 0
                  ? Math.round((cySalesAmt / pySalesAmt) * 100)
                  : null;
                
                const lineHeight = 20;
                const startY = innerY + 16;
                const contentStartY = startY + lineHeight;
                
                // 작은 박스 처리: 폰트 크기 조정 (level1 T0 정도로)
                const baseFontSize = innerWidth < 120 ? 8 : innerWidth < 150 ? 9 : 10;
                const fontSize = `${Math.round(baseFontSize * 1.2)}px`;
                const titleFontSize = innerWidth < 120 ? 16 : innerWidth < 150 ? 16 : 16; // level1 T0와 동일한 크기
                
                // textColor는 이미 위에서 계산됨
                
                return (
                  <g style={{ cursor: 'pointer' }}>
                    <rect x={innerX} y={innerY} width={innerWidth} height={innerHeight} 
                                  fill={color || '#8884d8'} stroke="#fff" strokeWidth={1} rx={0} />
                    
                    <text 
                      x={innerX + 8} 
                      y={startY} 
                      fill={textColor} 
                      fontSize={titleFontSize} 
                      fontWeight="normal"
                      stroke="none"
                      style={{ fontFamily: 'inherit' }}
                    >
                      {displayName}
                    </text>
                    
                    {innerHeight > 60 && (
                      <foreignObject x={innerX + 8} y={contentStartY} width={innerWidth - 16} height={innerHeight - (contentStartY - innerY) - 12}>
                        {/* @ts-ignore - xmlns 속성은 foreignObject 내부에서 필요하지만 TypeScript가 인식하지 못함 */}
                        <div xmlns="http://www.w3.org/1999/xhtml" style={{ color: '#fff', fontSize, fontFamily: 'inherit', lineHeight: '1.4' }}>
                          <div>당월누적 실판 {formatK(cySalesAmt || 0)}K (전년 {formatK(pySalesAmt || 0)}K, {categoryYoy !== null ? `${categoryYoy}%` : '-'})</div>
                          <div>비중 {percentage || '0.0'}%</div>
                          <div>할인율 (YOY) {discountRate !== null && discountRate !== undefined ? `${discountRate.toFixed(1)}%` : '-'} {discountRateYoy !== null && discountRateYoy !== undefined ? `(${discountRateYoy >= 0 ? '+' : ''}${discountRateYoy.toFixed(1)}%)` : ''}</div>
                        </div>
                      </foreignObject>
                    )}
                  </g>
                );
              }}
              onClick={(data) => data && handleCategoryClick(data as { name: string })}
            />
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">데이터가 없습니다.</div>
        )}
      </div>
      
      <div className="px-2 py-2 text-xs text-gray-500 text-center">
        ※ 네모 크기 = 당년 판매액 기준 | 클릭 시 상품별 내역 확인
      </div>
    </div>
  );
}

// 카테고리 트리맵 모달
function CategoryTreemapModal({
  isOpen,
  onClose,
  type,
  keyName,
  labelKo,
  brandCode,
  ym,
  lastDt
}: {
  isOpen: boolean;
  onClose: () => void;
  type: 'tier' | 'region';
  keyName: string;
  labelKo?: string;
  brandCode: string;
  ym: string;
  lastDt: string;
}) {
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<{ category: string; cySalesAmt: number; pySalesAmt: number; yoy: number | null; discountRate: number | null; prevDiscountRate: number | null; discountRateYoy: number | null }[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showProductModal, setShowProductModal] = useState(false);
  
  useEffect(() => {
    if (isOpen && keyName) {
      setLoading(true);
      fetch(`/api/category-sales?type=${type}&key=${encodeURIComponent(keyName)}&brandCode=${brandCode}&ym=${ym}&lastDt=${lastDt}`)
        .then(res => res.json())
        .then(data => {
          // null 체크 및 빈 배열 기본값
          setCategories(Array.isArray(data?.categories) ? data.categories : []);
        })
        .catch(err => {
          console.error('카테고리 판매 조회 오류:', err);
          setCategories([]);
        })
        .finally(() => setLoading(false));
    } else {
      setCategories([]);
    }
  }, [isOpen, keyName, type, brandCode, ym, lastDt]);
  
  if (!isOpen) return null;
  
  const displayName = labelKo ? `${labelKo}(${keyName})` : keyName;
  
  // 파스텔 변환 함수
  const toPastel = (r: number, g: number, b: number): [number, number, number] => {
    return [
      Math.floor(r * 0.7 + 255 * 0.3),
      Math.floor(g * 0.7 + 255 * 0.3),
      Math.floor(b * 0.7 + 255 * 0.3)
    ];
  };
  
  // YOY 기반 그라데이션 색상 계산 (7단계, 파스텔 톤)
  const getYoyColor = (yoy: number | null | undefined): string => {
    if (!yoy || yoy === 0) return '#8884d8'; // 기본색
    
    const yoyPercent = yoy * 100; // 100% 기준
    
    // 색상 범위 정의 (원본 색상 보간 후 파스텔 변환)
    let r, g, b;
    
    if (yoyPercent >= 110) {
      // 110% 이상: 네이비
      [r, g, b] = toPastel(30, 58, 138);
    } else if (yoyPercent >= 105) {
      // 105% ~ 110%: 파랑 (경계에서 그라데이션)
      const ratio = (yoyPercent - 105) / 5; // 0~1
      const r1 = 59 + (30 - 59) * ratio;
      const g1 = 130 + (58 - 130) * ratio;
      const b1 = 246 + (138 - 246) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else if (yoyPercent >= 100) {
      // 100% ~ 105%: 민트 (경계에서 그라데이션)
      const ratio = (yoyPercent - 100) / 5; // 0~1
      const r1 = 16 + (59 - 16) * ratio;
      const g1 = 185 + (130 - 185) * ratio;
      const b1 = 129 + (246 - 129) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else if (yoyPercent >= 95) {
      // 95% ~ 100%: 연한 노랑 (경계에서 그라데이션)
      const ratio = (yoyPercent - 95) / 5; // 0~1
      const r1 = 254 + (16 - 254) * ratio;
      const g1 = 240 + (185 - 240) * ratio;
      const b1 = 138 + (129 - 138) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else if (yoyPercent >= 90) {
      // 90% ~ 95%: 연한 오렌지 (경계에서 그라데이션)
      const ratio = (yoyPercent - 90) / 5; // 0~1
      const r1 = 255 + (254 - 255) * ratio;
      const g1 = 183 + (240 - 183) * ratio;
      const b1 = 107 + (138 - 107) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else if (yoyPercent >= 85) {
      // 85% ~ 90%: 오렌지 (경계에서 그라데이션)
      const ratio = (yoyPercent - 85) / 5; // 0~1
      const r1 = 251 + (255 - 251) * ratio;
      const g1 = 146 + (183 - 146) * ratio;
      const b1 = 60 + (107 - 60) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else {
      // 85% 미만: 빨강 계열 (낮을수록 진한 빨강)
      const ratio = Math.min(yoyPercent / 85, 1); // 0~1
      const r1 = 239 + (220 - 239) * ratio;
      const g1 = 68 - 68 * ratio;
      const b1 = 68 - 68 * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    }
    
    return `rgb(${r}, ${g}, ${b})`;
  };
  
  // 영문 키와 한글 키 매핑
  const categoryKeyMap: Record<string, string> = {
    'Shoes': 'Shoes',
    'Headwear': 'Headwear',
    'Bag': 'Bag',
    'Acc_etc': 'Acc_etc',
    '의류 당시즌': '의류 당시즌',
    '의류 차시즌': '의류 차시즌',
    '의류 과시즌': '의류 과시즌',
    '신발': 'Shoes',
    '모자': 'Headwear',
    '가방': 'Bag',
    '기타악세': 'Acc_etc',
  };
  
  // 안전한 카테고리 배열 (null 체크)
  const safeCategories = Array.isArray(categories) ? categories : [];
  
  // 총 판매액 계산 (비중 계산용) - null 체크
  const totalSales = safeCategories.reduce((sum, cat) => sum + (cat?.cySalesAmt || 0), 0);
  
  const treemapData = safeCategories.map(cat => {
    if (!cat) return null;
    const categoryKey = categoryKeyMap[cat.category] || cat.category;
    const percentage = totalSales > 0 ? ((cat.cySalesAmt || 0) / totalSales * 100).toFixed(1) : '0.0';
    // YOY 계산 (판매액 기준)
    const categoryYoy = cat.pySalesAmt && cat.pySalesAmt > 0 
      ? (cat.cySalesAmt || 0) / cat.pySalesAmt 
      : null;
    return {
      name: categoryKey,
      displayName: cat.category, // 원본 카테고리명 표시
      size: cat.cySalesAmt || 0,
      cySalesAmt: cat.cySalesAmt || 0,
      pySalesAmt: cat.pySalesAmt || 0,
      yoy: categoryYoy,
      percentage,
      discountRate: cat.discountRate ?? null,
      discountRateYoy: cat.discountRateYoy ?? null,
      color: getYoyColor(categoryYoy), // YOY 기반 그라데이션 색상
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null);
  
  const handleCategoryClick = (data: { name: string }) => {
    if (data && data.name) {
      setSelectedCategory(data.name);
      setShowProductModal(true);
    }
  };
  
  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div className="bg-white rounded-none shadow-none w-[900px] max-h-[85vh] overflow-hidden border border-gray-300" onClick={e => e.stopPropagation()}>
          <div className="px-6 py-4 border-b border-gray-200 bg-white flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-800">
              {type === 'tier' ? '티어' : '지역'}: {displayName} - 카테고리별 판매
            </h3>
            <button onClick={onClose} className="text-gray-600 hover:text-gray-800 text-3xl font-bold">×</button>
          </div>
          
          <div className="p-6">
            {loading ? (
              <div className="py-12 text-center text-gray-500">로딩 중...</div>
            ) : (treemapData?.length ?? 0) > 0 ? (
              <div className="h-[500px] border border-gray-300 rounded-none overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <Treemap
                    data={treemapData}
                    dataKey="size"
                    aspectRatio={4 / 3}
                    stroke="none"
                    content={(props) => {
                      const { x, y, width, height, name, displayName, cySalesAmt, pySalesAmt, yoy, color, percentage, discountRate, discountRateYoy } = props as TreemapContentProps & { cySalesAmt?: number; pySalesAmt?: number; percentage?: string; discountRate?: number | null; discountRateYoy?: number | null };
                      
                      // 타일 간 간격 (2px - 하얀색 구분선)
                      const gap = 2;
                      const innerX = (x || 0) + gap;
                      const innerY = (y || 0) + gap;
                      const innerWidth = (width || 0) - gap * 2;
                      const innerHeight = (height || 0) - gap * 2;
                      
                      // level2는 전부 하얀색 글씨
                      const textColor = '#fff';
                      
                      // 작은 타일 처리
                      if (innerWidth < 80 || innerHeight < 60) {
                        return (
                          <g>
                            <rect x={innerX} y={innerY} width={innerWidth} height={innerHeight} 
                                  fill={color || '#8884d8'} stroke="#fff" strokeWidth={1} rx={0} />
                            <text 
                              x={innerX + 12} 
                              y={innerY + 20} 
                              fill={textColor} 
                              fontSize={16} 
                              fontWeight="normal"
                              stroke="none"
                              style={{ fontFamily: 'inherit' }}
                            >
                              {displayName}
                            </text>
                          </g>
                        );
                      }
                      
                      const formatK = (v: number) => Math.round(v / 1000).toLocaleString();
                      
                      // 카테고리 판매액 YOY 계산
                      const categoryYoy = cySalesAmt && pySalesAmt && pySalesAmt > 0
                        ? Math.round((cySalesAmt / pySalesAmt) * 100)
                        : null;
                      
                      // 라인 높이
                      const lineHeight = 20;
                      const startY = innerY + 16;
                      const contentStartY = startY + lineHeight;
                      
                      // 작은 박스 처리: 폰트 크기 조정 (level1 T0 정도로)
                      const baseFontSize = innerWidth < 120 ? 8 : innerWidth < 150 ? 9 : 10;
                      const fontSize = `${Math.round(baseFontSize * 1.2)}px`;
                      const titleFontSize = innerWidth < 120 ? 16 : innerWidth < 150 ? 16 : 16; // level1 T0와 동일한 크기
                      
                      return (
                        <g style={{ cursor: 'pointer' }}>
                          {/* 타일 배경 (간격 포함, 라운드 제거) */}
                          <rect x={innerX} y={innerY} width={innerWidth} height={innerHeight} 
                                fill={color || '#8884d8'} stroke="#fff" strokeWidth={1} rx={0} />
                          
                          {/* 1줄: 카테고리명 (속 채움 스타일 - 일반 텍스트) */}
                          <text 
                            x={innerX + 8} 
                            y={startY} 
                            fill={textColor} 
                            fontSize={titleFontSize} 
                            fontWeight="normal"
                            stroke="none"
                            style={{ fontFamily: 'inherit' }}
                          >
                            {displayName}
                          </text>
                          
                          {/* 간단한 텍스트 형식으로 표시 */}
                          {innerHeight > 60 && (
                            <foreignObject x={innerX + 8} y={contentStartY} width={innerWidth - 16} height={innerHeight - (contentStartY - innerY) - 12}>
                              {/* @ts-ignore - xmlns 속성은 foreignObject 내부에서 필요하지만 TypeScript가 인식하지 못함 */}
                              <div xmlns="http://www.w3.org/1999/xhtml" style={{ color: '#fff', fontSize, fontFamily: 'inherit', lineHeight: '1.4' }}>
                                <div>당월누적 실판 {formatK(cySalesAmt || 0)}K (전년 {formatK(pySalesAmt || 0)}K, {categoryYoy !== null ? `${categoryYoy}%` : '-'})</div>
                                <div>비중 {percentage || '0.0'}%</div>
                                <div>할인율 (YOY) {discountRate !== null && discountRate !== undefined ? `${discountRate.toFixed(1)}%` : '-'} {discountRateYoy !== null && discountRateYoy !== undefined ? `(${discountRateYoy >= 0 ? '+' : ''}${discountRateYoy.toFixed(1)}%)` : ''}</div>
                              </div>
                            </foreignObject>
                          )}
                        </g>
                      );
                    }}
                    onClick={(data) => data && handleCategoryClick(data as { name: string })}
                  />
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="py-12 text-center text-gray-400">데이터가 없습니다.</div>
            )}
          </div>
          
          <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
            ※ 네모 크기 = 당년 판매액 기준 | 클릭 시 상품별 내역 확인
          </div>
        </div>
      </div>
      
      {/* 상품별 내역 모달 */}
      {selectedCategory && (() => {
        const selectedCat = safeCategories.find(c => {
          if (!c) return false;
          const categoryKey = categoryKeyMap[c.category] || c.category;
          return categoryKey === selectedCategory || c.category === selectedCategory;
        });
        return (
          <ProductSalesModal
            isOpen={showProductModal}
            onClose={() => {
              setShowProductModal(false);
              setSelectedCategory(null);
            }}
            type={type}
            keyName={keyName}
            categoryName={selectedCategory}
            brandCode={brandCode}
            ym={ym}
            lastDt={lastDt}
            totalCySalesAmt={selectedCat?.cySalesAmt || 0}
            totalPySalesAmt={selectedCat?.pySalesAmt || 0}
            totalYoy={selectedCat?.yoy || null}
          />
        );
      })()}
    </>
  );
}

// 상품별 판매 내역 모달
function ProductSalesModal({
  isOpen,
  onClose,
  type,
  keyName,
  categoryName,
  brandCode,
  ym,
  lastDt,
  totalCySalesAmt,
  totalPySalesAmt,
  totalYoy
}: {
  isOpen: boolean;
  onClose: () => void;
  type: 'tier' | 'region';
  keyName: string;
  categoryName: string;
  brandCode: string;
  ym: string;
  lastDt: string;
  totalCySalesAmt?: number;
  totalPySalesAmt?: number;
  totalYoy?: number | null;
}) {
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<{ prdtCd: string; prdtNm: string; cySalesAmt: number; pySalesAmt: number; yoy: number | null }[]>([]);
  
  useEffect(() => {
    if (isOpen && categoryName) {
      setLoading(true);
      fetch(`/api/product-sales?type=${type}&key=${encodeURIComponent(keyName)}&category=${encodeURIComponent(categoryName)}&brandCode=${brandCode}&ym=${ym}&lastDt=${lastDt}`)
        .then(res => res.json())
        .then(data => {
          // null 체크 및 빈 배열 기본값
          setProducts(Array.isArray(data?.products) ? data.products : []);
        })
        .catch(err => {
          console.error('상품별 판매 조회 오류:', err);
          setProducts([]);
        })
        .finally(() => setLoading(false));
    } else {
      setProducts([]);
    }
  }, [isOpen, categoryName, type, keyName, brandCode, ym, lastDt]);
  
  if (!isOpen) return null;
  
  const formatK = (value: number) => Math.round(value / 1000).toLocaleString();
  const formatYoy = (value: number | null | undefined) => value ? `${(value * 100).toFixed(1)}%` : '-';
  
  // 안전한 products 배열
  const safeProducts = Array.isArray(products) ? products : [];
  
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-600 to-pink-600 flex justify-between items-center">
          <h3 className="text-lg font-bold text-white">
            {categoryName} - 상품별 판매 내역
          </h3>
          <button onClick={onClose} className="text-white hover:text-gray-200 text-3xl font-bold">×</button>
        </div>
        
        <div className="p-6 max-h-[calc(80vh-140px)] overflow-y-auto">
          {loading ? (
            <div className="py-12 text-center text-gray-500">로딩 중...</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-100 z-10">
                <tr>
                  <th className="py-3 px-4 text-left font-semibold text-gray-700 border-b-2">상품코드</th>
                  <th className="py-3 px-4 text-left font-semibold text-gray-700 border-b-2">상품명</th>
                  <th className="py-3 px-4 text-right font-semibold text-gray-700 border-b-2">당년 (K)</th>
                  <th className="py-3 px-4 text-right font-semibold text-gray-700 border-b-2">전년 (K)</th>
                  <th className="py-3 px-4 text-right font-semibold text-gray-700 border-b-2">YOY</th>
                </tr>
              </thead>
              <tbody>
                {/* 합계 행 */}
                {totalCySalesAmt !== undefined && totalPySalesAmt !== undefined && (
                  <tr className="bg-gray-100 font-semibold">
                    <td className="py-2 px-4 text-gray-800">합계</td>
                    <td className="py-2 px-4 text-gray-800">-</td>
                    <td className="py-2 px-4 text-right text-gray-800">{formatK(totalCySalesAmt)}</td>
                    <td className="py-2 px-4 text-right text-gray-600">{formatK(totalPySalesAmt)}</td>
                    <td className={`py-2 px-4 text-right ${totalYoy && totalYoy >= 1 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatYoy(totalYoy)}
                    </td>
                  </tr>
                )}
                {safeProducts.map((prod, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50'}>
                    <td className="py-2 px-4 text-gray-800 font-mono text-xs">{prod?.prdtCd || ''}</td>
                    <td className="py-2 px-4 text-gray-800">{prod?.prdtNm || ''}</td>
                    <td className="py-2 px-4 text-right text-gray-800 font-semibold">{formatK(prod?.cySalesAmt || 0)}</td>
                    <td className="py-2 px-4 text-right text-gray-600">{formatK(prod?.pySalesAmt || 0)}</td>
                    <td className={`py-2 px-4 text-right font-semibold ${prod?.yoy && prod.yoy >= 1 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatYoy(prod?.yoy || null)}
                    </td>
                  </tr>
                ))}
                {(safeProducts?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-gray-400">데이터가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
          총 {safeProducts?.length ?? 0}개 상품 | 당년 판매액 기준 내림차순
        </div>
      </div>
    </div>
  );
}

// 티어/지역별 트리맵 차트 컴포넌트
function TierRegionTreemap({ 
  data, 
  brandCode, 
  ym, 
  lastDt 
}: { 
  data: TierRegionSalesData; 
  brandCode: string; 
  ym: string; 
  lastDt: string;
}) {
  const [selectedTier, setSelectedTier] = useState<{ key: string; labelKo?: string } | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<{ key: string; labelKo?: string } | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedCategoryType, setSelectedCategoryType] = useState<'tier' | 'region' | null>(null);
  
  // 파스텔 색상 변환 함수
  const toPastel = (r: number, g: number, b: number): [number, number, number] => {
    return [
      Math.floor(r * 0.7 + 255 * 0.3),
      Math.floor(g * 0.7 + 255 * 0.3),
      Math.floor(b * 0.7 + 255 * 0.3)
    ];
  };
  
  // YOY 기반 그라데이션 색상 계산 (7단계, 파스텔 톤)
  const getYoyColor = (yoy: number | undefined): string => {
    if (!yoy || yoy === 0) return '#8884d8'; // 기본색
    
    const yoyPercent = yoy * 100; // 100% 기준
    
    // 색상 범위 정의 (원본 색상 보간 후 파스텔 변환)
    let r, g, b;
    
    if (yoyPercent >= 110) {
      // 110% 이상: 네이비
      [r, g, b] = toPastel(30, 58, 138);
    } else if (yoyPercent >= 105) {
      // 105% ~ 110%: 파랑 (경계에서 그라데이션)
      const ratio = (yoyPercent - 105) / 5; // 0~1
      const r1 = 59 + (30 - 59) * ratio;
      const g1 = 130 + (58 - 130) * ratio;
      const b1 = 246 + (138 - 246) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else if (yoyPercent >= 100) {
      // 100% ~ 105%: 민트 (경계에서 그라데이션)
      const ratio = (yoyPercent - 100) / 5; // 0~1
      const r1 = 34 + (59 - 34) * ratio;
      const g1 = 211 + (130 - 211) * ratio;
      const b1 = 153 + (246 - 153) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else if (yoyPercent >= 95) {
      // 95% ~ 100%: 연한 노랑 (경계에서 그라데이션)
      const ratio = (yoyPercent - 95) / 5; // 0~1
      const r1 = 252 + (34 - 252) * ratio;
      const g1 = 211 + (211 - 211) * ratio;
      const b1 = 77 + (153 - 77) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else if (yoyPercent >= 90) {
      // 90% ~ 95%: 연한 오렌지 (경계에서 그라데이션)
      const ratio = (yoyPercent - 90) / 5; // 0~1
      const r1 = 251 + (252 - 251) * ratio;
      const g1 = 146 + (211 - 146) * ratio;
      const b1 = 60 + (77 - 60) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else if (yoyPercent >= 85) {
      // 85% ~ 90%: 오렌지 (경계에서 그라데이션)
      const ratio = (yoyPercent - 85) / 5; // 0~1
      const r1 = 249 + (251 - 249) * ratio;
      const g1 = 115 + (146 - 115) * ratio;
      const b1 = 22 + (60 - 22) * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    } else {
      // 85% 미만: 빨강 계열 (낮을수록 진한 빨강)
      const ratio = Math.min(yoyPercent / 85, 1); // 0~1
      const r1 = 239 + (220 - 239) * ratio;
      const g1 = 68 - 68 * ratio;
      const b1 = 68 - 68 * ratio;
      [r, g, b] = toPastel(Math.floor(r1), Math.floor(g1), Math.floor(b1));
    }
    
    return `rgb(${r}, ${g}, ${b})`;
  };
  
  // 안전한 데이터 배열 (null 체크)
  const safeTiers = Array.isArray(data?.tiers) ? data.tiers : [];
  const safeRegions = Array.isArray(data?.regions) ? data.regions : [];
  
  // 티어 데이터 변환
  const tierTreemapData = safeTiers.map((tier) => {
    if (!tier) return null;
    // 전년 월전체 데이터 (점당매출 YOY 및 매장수 YOY 계산용)
    const prevShopCnt = tier.prevShopCnt || 0;
    const prevSalesPerShop = tier.prevSalesPerShop || 0;
    // 전년 누적 데이터 (실판 YOY 계산용)
    const prevCumSalesAmt = tier.prevCumSalesAmt || 0;
    // 실판 YOY 계산 (색상용, 당월누적 vs 전년 누적)
    const yoy = prevCumSalesAmt > 0 ? (tier.salesAmt || 0) / prevCumSalesAmt : undefined;
    return {
      name: tier.key,
      displayName: tier.key,
      size: tier.salesAmt || 0, // 당월누적 실판 기준으로 박스 크기 결정
      salesPerShop: tier.salesPerShop || 0,
      salesK: Math.round((tier.salesAmt || 0) / 1000).toLocaleString(),
      shopCnt: tier.shopCnt || 0,
      prevSalesPerShop: prevSalesPerShop, // 전년 월전체 점당매출 (점당매출 YOY 계산용)
      prevSalesK: Math.round(prevCumSalesAmt / 1000).toLocaleString(), // 전년 누적 매출 (실판 YOY 계산용)
      prevShopCnt: prevShopCnt, // 전년 월전체 매장수 (매장수 YOY 계산용)
      yoy,
      discountRate: tier.discountRate,
      discountRateYoy: tier.discountRateYoy,
      color: getYoyColor(yoy), // YOY 기반 그라데이션 색상 (실판 기준)
      labelKo: tier.labelKo,
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => {
      // 당월누적 실판 기준으로 정렬 (salesAmt)
      const aSalesAmt = parseFloat(a.salesK?.replace(/,/g, '') || '0') * 1000;
      const bSalesAmt = parseFloat(b.salesK?.replace(/,/g, '') || '0') * 1000;
      return bSalesAmt - aSalesAmt;
    }); // 당월누적 실판 기준 내림차순 정렬
  
  // 지역 데이터 변환 (한국어(중국어) 형식)
  const regionTreemapData = safeRegions.map((region) => {
    if (!region) return null;
    // 전년 월전체 데이터 (점당매출 YOY 및 매장수 YOY 계산용)
    const prevShopCnt = region.prevShopCnt || 0;
    const prevSalesPerShop = region.prevSalesPerShop || 0;
    // 전년 누적 데이터 (실판 YOY 계산용)
    const prevCumSalesAmt = region.prevCumSalesAmt || 0;
    // 실판 YOY 계산 (색상용, 당월누적 vs 전년 누적)
    const yoy = prevCumSalesAmt > 0 ? (region.salesAmt || 0) / prevCumSalesAmt : undefined;
    return {
      name: region.key,
      displayName: region.labelKo ? `${region.labelKo}(${region.key})` : region.key,
      size: region.salesAmt || 0, // 당월누적 실판 기준으로 박스 크기 결정
      salesPerShop: region.salesPerShop || 0,
      salesK: Math.round((region.salesAmt || 0) / 1000).toLocaleString(),
      shopCnt: region.shopCnt || 0,
      prevSalesPerShop: prevSalesPerShop, // 전년 월전체 점당매출 (점당매출 YOY 계산용)
      prevSalesK: Math.round(prevCumSalesAmt / 1000).toLocaleString(), // 전년 누적 매출 (실판 YOY 계산용)
      prevShopCnt: prevShopCnt, // 전년 월전체 매장수 (매장수 YOY 계산용)
      yoy,
      discountRate: region.discountRate,
      discountRateYoy: region.discountRateYoy,
      color: getYoyColor(yoy), // YOY 기반 그라데이션 색상 (실판 기준)
      cities: region.cities,
      labelKo: region.labelKo,
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => {
      // 당월누적 실판 기준으로 정렬 (salesAmt)
      const aSalesAmt = parseFloat(a.salesK?.replace(/,/g, '') || '0') * 1000;
      const bSalesAmt = parseFloat(b.salesK?.replace(/,/g, '') || '0') * 1000;
      return bSalesAmt - aSalesAmt;
    }); // 당월누적 실판 기준 내림차순 정렬
  
  const handleTierClick = (data: { name: string; labelKo?: string }) => {
    setSelectedTier({ key: data.name, labelKo: data.labelKo });
  };
  
  const handleRegionClick = (data: { name: string; labelKo?: string }) => {
    setSelectedRegion({ key: data.name, labelKo: data.labelKo });
  };
  
  const handleTierBack = () => {
    setSelectedTier(null);
  };
  
  const handleRegionBack = () => {
    setSelectedRegion(null);
  };
  
  const handleCategoryClick = (categoryName: string, type: 'tier' | 'region') => {
    setSelectedCategory(categoryName);
    setSelectedCategoryType(type);
    setCategoryModalOpen(true);
  };
  
  // 기간 포맷팅
  const formatPeriod = () => {
    if (!ym || !lastDt) return '';
    const year = ym.substring(0, 4);
    const month = ym.substring(5, 7);
    const day = lastDt.substring(8, 10);
    return `${year}년 ${month}월 01일 ~ ${year}년 ${month}월 ${day}일`;
  };
  
  // 전년 기간 포맷팅
  const formatPrevPeriod = () => {
    if (!ym || !lastDt) return '';
    const year = parseInt(ym.substring(0, 4)) - 1;
    const month = ym.substring(5, 7);
    const day = lastDt.substring(8, 10);
    return `${year}년 ${month}월 01일 ~ ${year}년 ${month}월 ${day}일`;
  };
  
  // 색상 범례용 색상 계산 (각 범위의 대표 색상)
  const getLegendColor = (yoyPercent: number): string => {
    return getYoyColor(yoyPercent / 100);
  };
  
  return (
    <div className="bg-white rounded-none border border-gray-300 shadow-none overflow-hidden">
      <div className="p-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 티어별 트리맵 */}
          <div>
            <div className="mb-2 text-center">
              <h4 className="text-sm font-semibold text-gray-700">대리상 Tier별 점당매출</h4>
              <div className="flex justify-center gap-4 text-xs text-gray-500 mt-1">
                <span>당해 기간: {formatPeriod()}</span>
                <span>전년 기간: {formatPrevPeriod()}</span>
              </div>
            </div>
            {selectedTier ? (
              <CategoryTreemapInline
                type="tier"
                keyName={selectedTier.key}
                labelKo={selectedTier.labelKo}
                brandCode={brandCode}
                ym={ym}
                lastDt={lastDt}
                onBack={handleTierBack}
                onCategoryClick={(categoryName) => handleCategoryClick(categoryName, 'tier')}
              />
            ) : (
              <div className="h-[320px] border border-gray-300 rounded-none overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <Treemap
                    data={tierTreemapData}
                    dataKey="size"
                    aspectRatio={4 / 3}
                    stroke="none"
                    content={<TreemapContent />}
                    onClick={(data) => data && handleTierClick(data as { name: string; labelKo?: string })}
                  />
                </ResponsiveContainer>
              </div>
            )}
          </div>
          
          {/* 지역별 트리맵 */}
          <div>
            <div className="mb-2 text-center">
              <h4 className="text-sm font-semibold text-gray-700">대리상 지역별 점당매출</h4>
              <div className="flex justify-center gap-4 text-xs text-gray-500 mt-1">
                <span>당해 기간: {formatPeriod()}</span>
                <span>전년 기간: {formatPrevPeriod()}</span>
              </div>
            </div>
            {selectedRegion ? (
              <CategoryTreemapInline
                type="region"
                keyName={selectedRegion.key}
                labelKo={selectedRegion.labelKo}
                brandCode={brandCode}
                ym={ym}
                lastDt={lastDt}
                onBack={handleRegionBack}
                onCategoryClick={(categoryName) => handleCategoryClick(categoryName, 'region')}
              />
            ) : (
              <div className="h-[320px] border border-gray-300 rounded-none overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <Treemap
                    data={regionTreemapData}
                    dataKey="size"
                    aspectRatio={4 / 3}
                    stroke="none"
                    content={<TreemapContent />}
                    onClick={(data) => data && handleRegionClick(data as { name: string; labelKo?: string })}
                  />
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
        
        {/* 범례 */}
        <div className="mt-4 pt-3 border-t border-gray-200">
          <div className="flex flex-col gap-3">
            {/* 순서 설명 */}
            <div className="text-xs text-gray-600 text-center">
              ※ 트리맵 순서: 당월누적 실판 기준 내림차순 정렬
            </div>
            
            {/* 색상 기준 범례 */}
            <div className="flex justify-center items-center gap-3 flex-wrap">
              <span className="text-xs text-gray-600">※ 색상 기준 (YOY):</span>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: getLegendColor(110) }}></div>
                <span className="text-xs text-gray-600">110% 이상</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: getLegendColor(107.5) }}></div>
                <span className="text-xs text-gray-600">105% ~ 110%</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: getLegendColor(102.5) }}></div>
                <span className="text-xs text-gray-600">100% ~ 105%</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: getLegendColor(97.5) }}></div>
                <span className="text-xs text-gray-600">95% ~ 100%</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: getLegendColor(92.5) }}></div>
                <span className="text-xs text-gray-600">90% ~ 95%</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: getLegendColor(87.5) }}></div>
                <span className="text-xs text-gray-600">85% ~ 90%</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: getLegendColor(70) }}></div>
                <span className="text-xs text-gray-600">85% 미만</span>
              </div>
            </div>
            
            {/* 시즌 구분 설명 */}
            {(() => {
              const currentMonth = parseInt(ym.substring(5, 7));
              const baseYearShort = ym.substring(2, 4);
              const prevYearShort = String(parseInt(baseYearShort) - 1).padStart(2, '0');
              const nextYearShort = String(parseInt(baseYearShort) + 1).padStart(2, '0');
              
              return (
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <div className="text-xs text-gray-600 text-center mb-2">
                    ※ 시즌 구분 기준:
                  </div>
                  <div className="flex justify-center items-center gap-6 flex-wrap text-xs text-gray-600">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">S 시즌 (예: {baseYearShort}S):</span>
                      <span>• 기준연도와 비교하여 구분</span>
                      <span>|</span>
                      <span>{baseYearShort}S = 당시즌, {nextYearShort}S = 차시즌, 그 외 = 과시즌</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">F/N 시즌 (예: {baseYearShort}F, {baseYearShort}N):</span>
                      {currentMonth <= 2 ? (
                        <>
                          <span>• 기준월이 1-2월인 경우:</span>
                          <span>{prevYearShort}F/N = 당시즌, {baseYearShort}F/N = 차시즌, 그 외 = 과시즌</span>
                        </>
                      ) : (
                        <>
                          <span>• 기준월이 3월 이상인 경우:</span>
                          <span>{baseYearShort}F/N = 당시즌, {nextYearShort}F/N = 차시즌, 그 외 = 과시즌</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
      
      {/* 상품별 내역 모달 (2단계에서 클릭 시) */}
      {selectedCategory && selectedCategoryType && (
        <ProductSalesModal
          isOpen={categoryModalOpen}
          onClose={() => {
            setCategoryModalOpen(false);
            setSelectedCategory(null);
            setSelectedCategoryType(null);
          }}
          type={selectedCategoryType}
          keyName={selectedCategoryType === 'tier' ? selectedTier?.key || '' : selectedRegion?.key || ''}
          categoryName={selectedCategory}
          brandCode={brandCode}
          ym={ym}
          lastDt={lastDt}
        />
      )}
    </div>
  );
}

// 시즌 목록 생성 (과거 2년 ~ 미래 1년)
function generateSeasonList(): string[] {
  const currentYear = new Date().getFullYear();
  const seasons: string[] = [];
  for (let year = currentYear - 2; year <= currentYear + 1; year++) {
    const shortYear = year.toString().substring(2);
    seasons.push(`${shortYear}S`, `${shortYear}F`);
  }
  return seasons;
}

// 기본 시즌 계산
function getDefaultSeason(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const shortYear = year.toString().substring(2);
  // 1-6월: 전년도 F, 7-12월: 당해년도 S
  if (month >= 1 && month <= 6) {
    const prevYear = (year - 1).toString().substring(2);
    return `${prevYear}F`;
  } else {
    return `${shortYear}S`;
  }
}

// 전년 시즌 계산
function getPreviousSeason(currentSeason: string): string {
  const year = parseInt(currentSeason.substring(0, 2));
  const season = currentSeason.substring(2);
  const prevYear = year - 1;
  return `${prevYear.toString().padStart(2, '0')}${season}`;
}

// 의류 판매율 테이블 및 차트 컴포넌트
function ClothingSalesSection({ 
  data, 
  brandCode, 
  lastDt,
  ym
}: { 
  data: ClothingSalesData; 
  brandCode: string; 
  lastDt: string;
  ym: string;
}) {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [itemDetails, setItemDetails] = useState<ClothingItemDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<string>(getDefaultSeason());
  const [clothingData, setClothingData] = useState<ClothingSalesData | null>(data);
  const [dataLoading, setDataLoading] = useState(false);
  
  const cySeason = selectedSeason;
  const pySeason = getPreviousSeason(selectedSeason);
  const seasonList = generateSeasonList();
  
  // 메인 테이블 정렬 상태
  const [mainSortColumn, setMainSortColumn] = useState<'cySalesAmt' | 'cyRate' | 'pySalesAmt' | 'pyRate' | 'salesYoy' | 'rateYoy' | 'poQtyYoy' | null>('cySalesAmt');
  const [mainSortDirection, setMainSortDirection] = useState<'asc' | 'desc'>('desc');
  
  // 상세 테이블 정렬 상태
  const [detailSortColumn, setDetailSortColumn] = useState<'cyRate' | 'cySalesQty' | 'cyStockQty' | 'poQty' | null>('cySalesQty');
  const [detailSortDirection, setDetailSortDirection] = useState<'asc' | 'desc'>('desc');
  
  // 시즌 변경 핸들러
  const handleSeasonChange = async (newSeason: string) => {
    setSelectedSeason(newSeason);
    setDataLoading(true);
    try {
      const newCySeason = newSeason;
      const newPySeason = getPreviousSeason(newSeason);
      const res = await fetch(`/api/pl-forecast?ym=${ym}&brand=${brandCode}&cySeason=${newCySeason}&pySeason=${newPySeason}`);
      const json = await res.json();
      if (json.error) {
        console.error('의류 판매율 데이터 조회 오류:', json.error);
        setClothingData(null);
      } else if (json.clothingSales) {
        setClothingData(json.clothingSales);
      } else {
        setClothingData(null);
      }
    } catch (error) {
      console.error('의류 판매율 데이터 조회 오류:', error);
      setClothingData(null);
    } finally {
      setDataLoading(false);
    }
  };

  // 정렬된 아이템 목록
  const sortedItems = React.useMemo(() => {
    if (!clothingData || !clothingData.items || !Array.isArray(clothingData.items)) {
      return [];
    }
    const items = [...clothingData.items];
    
    if (!mainSortColumn) {
      return items.sort((a, b) => b.cySalesAmt - a.cySalesAmt);
    }
    
    return items.sort((a, b) => {
      let aValue: number | null = null;
      let bValue: number | null = null;
      
      switch (mainSortColumn) {
        case 'cySalesAmt':
          aValue = a.cySalesAmt;
          bValue = b.cySalesAmt;
          break;
        case 'cyRate':
          aValue = a.cyRate;
          bValue = b.cyRate;
          break;
        case 'pySalesAmt':
          aValue = a.pySalesAmt;
          bValue = b.pySalesAmt;
          break;
        case 'pyRate':
          aValue = a.pyRate;
          bValue = b.pyRate;
          break;
        case 'salesYoy':
          aValue = calcSalesYoy(a.cySalesAmt, a.pySalesAmt);
          bValue = calcSalesYoy(b.cySalesAmt, b.pySalesAmt);
          break;
        case 'rateYoy':
          aValue = a.yoy;
          bValue = b.yoy;
          break;
        case 'poQtyYoy':
          aValue = calcPoQtyYoy(a.cyPoQty, a.pyPoQty);
          bValue = calcPoQtyYoy(b.cyPoQty, b.pyPoQty);
          break;
      }
      
      // null 값 처리: null은 항상 마지막에
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      
      const diff = aValue - bValue;
      return mainSortDirection === 'asc' ? diff : -diff;
    });
  }, [clothingData, mainSortColumn, mainSortDirection]);
  
  // 아이템 상세 정렬
  const sortedItemDetails = React.useMemo(() => {
    if (!itemDetails || !Array.isArray(itemDetails)) {
      return [];
    }
    const details = [...itemDetails];
    
    if (!detailSortColumn) {
      return details.sort((a, b) => b.cySalesQty - a.cySalesQty);
    }
    
    return details.sort((a, b) => {
      let aValue: number | null = null;
      let bValue: number | null = null;
      
      switch (detailSortColumn) {
        case 'cyRate':
          aValue = a.cyRate;
          bValue = b.cyRate;
          break;
        case 'cySalesQty':
          aValue = a.cySalesQty;
          bValue = b.cySalesQty;
          break;
        case 'cyStockQty':
          aValue = a.cyStockQty;
          bValue = b.cyStockQty;
          break;
        case 'poQty':
          aValue = a.poQty;
          bValue = b.poQty;
          break;
      }
      
      // null 값 처리: null은 항상 마지막에
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      
      const diff = aValue - bValue;
      return detailSortDirection === 'asc' ? diff : -diff;
    });
  }, [itemDetails, detailSortColumn, detailSortDirection]);
  
  // 메인 테이블 헤더 클릭 핸들러
  const handleMainSort = (column: 'cySalesAmt' | 'cyRate' | 'pySalesAmt' | 'pyRate' | 'salesYoy' | 'rateYoy' | 'poQtyYoy') => {
    if (mainSortColumn === column) {
      setMainSortDirection(mainSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setMainSortColumn(column);
      setMainSortDirection('desc');
    }
  };
  
  // 상세 테이블 헤더 클릭 핸들러
  const handleDetailSort = (column: 'cyRate' | 'cySalesQty' | 'cyStockQty' | 'poQty') => {
    if (detailSortColumn === column) {
      setDetailSortDirection(detailSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setDetailSortColumn(column);
      setDetailSortDirection('desc');
    }
  };
  
  // 정렬 방향 아이콘
  const SortIcon = ({ column, currentColumn, direction }: { column: string; currentColumn: string | null; direction: 'asc' | 'desc' }) => {
    if (currentColumn !== column) return <span className="text-gray-400 ml-1">↕</span>;
    return <span className="text-blue-600 ml-1 font-bold">{direction === 'asc' ? '↑' : '↓'}</span>;
  };
  
  // 아이템 클릭 핸들러
  const handleItemClick = async (itemCd: string) => {
    setSelectedItem(itemCd);
    setLoading(true);
    try {
      const res = await fetch(`/api/clothing-sales?brandCode=${brandCode}&itemCd=${itemCd}&lastDt=${lastDt}`);
      const result = await res.json();
      setItemDetails(result.details || []);
    } catch (error) {
      console.error('의류 아이템 상세 조회 오류:', error);
      setItemDetails([]);
    } finally {
      setLoading(false);
    }
  };
  
  const formatRate = (value: number | null) => value ? `${value.toFixed(1)}%` : '-';
  const formatYoy = (value: number | null) => value ? `${(value * 100).toFixed(1)}%` : '-';
  const formatK = (value: number) => Math.round(value / 1000).toLocaleString();
  
  // 누적판매 YOY 계산 함수
  const calcSalesYoy = (cy: number, py: number): number | null => {
    if (py === 0) return null;
    return cy / py;
  };
  
  // 발주수량 YOY 계산 함수 (비율: 1.0 = 100%)
  const calcPoQtyYoy = (cy: number, py: number): number | null => {
    if (py === 0) return null;
    return cy / py; // 비율로 반환 (formatYoy에서 백분율로 변환)
  };
  
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <h3 className="text-sm font-semibold text-gray-700">의류 판매율 ({formatDateShort(lastDt)} 까지)</h3>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">시즌:</label>
            <select 
              value={selectedSeason}
              onChange={(e) => handleSeasonChange(e.target.value)}
              className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={dataLoading}
            >
              {seasonList.map(season => (
                <option key={season} value={season}>{season}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          ※ 판매율 = 누적 판매 TAG 금액 ÷ (PO 수량 × TAG 단가) × 100
        </p>
      </div>
      
      <div className="p-4">
        {dataLoading ? (
          <div className="py-12 text-center text-gray-500">로딩 중...</div>
        ) : !clothingData || !clothingData.items || clothingData.items.length === 0 ? (
          <div className="py-12 text-center text-gray-400">데이터가 없습니다.</div>
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 좌측: 메인 테이블 */}
          <div className={selectedItem ? 'lg:col-span-1' : 'lg:col-span-2'}>
            {/* 테이블 */}
            <div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr className="border-b border-gray-200">
                    <th className="py-2 px-3 text-left font-semibold text-gray-700">아이템코드</th>
                    <th className="py-2 px-3 text-left font-semibold text-gray-700">아이템 명칭</th>
                    <th 
                      className="py-2 px-2 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleMainSort('cySalesAmt')}
                    >
                      Tag누적판매({cySeason})
                      <SortIcon column="cySalesAmt" currentColumn={mainSortColumn} direction={mainSortDirection} />
                    </th>
                    <th 
                      className="py-2 px-2 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleMainSort('cyRate')}
                    >
                      당시즌 판매율
                      <SortIcon column="cyRate" currentColumn={mainSortColumn} direction={mainSortDirection} />
                    </th>
                    <th 
                      className="py-2 px-2 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleMainSort('pySalesAmt')}
                    >
                      Tag 누적판매({pySeason})
                      <SortIcon column="pySalesAmt" currentColumn={mainSortColumn} direction={mainSortDirection} />
                    </th>
                    <th 
                      className="py-2 px-2 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleMainSort('pyRate')}
                    >
                      전년시즌 판매율
                      <SortIcon column="pyRate" currentColumn={mainSortColumn} direction={mainSortDirection} />
                    </th>
                    <th 
                      className="py-2 px-2 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleMainSort('salesYoy')}
                    >
                      누적 판매금액 YOY
                      <SortIcon column="salesYoy" currentColumn={mainSortColumn} direction={mainSortDirection} />
                    </th>
                    <th 
                      className="py-2 px-2 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleMainSort('rateYoy')}
                    >
                      판매율 YOY
                      <SortIcon column="rateYoy" currentColumn={mainSortColumn} direction={mainSortDirection} />
                    </th>
                    <th 
                      className="py-2 px-2 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleMainSort('poQtyYoy')}
                    >
                      발주수량 YOY
                      <SortIcon column="poQtyYoy" currentColumn={mainSortColumn} direction={mainSortDirection} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* 전체 합계 */}
                  <tr className="border-b border-gray-300 bg-yellow-50 font-semibold">
                    <td className="py-2 px-3 text-left text-gray-800">{clothingData.total.itemCd}</td>
                    <td className="py-2 px-3 text-left text-gray-800">{clothingData.total.itemNm}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-800">{formatK(clothingData.total.cySalesAmt)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-800">{formatRate(clothingData.total.cyRate)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600">{formatK(clothingData.total.pySalesAmt)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600">{formatRate(clothingData.total.pyRate)}</td>
                    <td className={`py-2 px-2 text-right font-mono font-semibold ${
                      calcSalesYoy(clothingData.total.cySalesAmt, clothingData.total.pySalesAmt) && calcSalesYoy(clothingData.total.cySalesAmt, clothingData.total.pySalesAmt)! >= 1 ? 'text-emerald-600' : 'text-rose-600'
                    }`}>
                      {formatYoy(calcSalesYoy(clothingData.total.cySalesAmt, clothingData.total.pySalesAmt))}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono font-semibold ${
                      clothingData.total.yoy && clothingData.total.yoy >= 1 ? 'text-emerald-600' : 'text-rose-600'
                    }`}>
                      {formatYoy(clothingData.total.yoy)}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono font-semibold ${
                      calcPoQtyYoy(clothingData.total.cyPoQty, clothingData.total.pyPoQty) && calcPoQtyYoy(clothingData.total.cyPoQty, clothingData.total.pyPoQty)! >= 1 ? 'text-emerald-600' : 'text-rose-600'
                    }`}>
                      {formatYoy(calcPoQtyYoy(clothingData.total.cyPoQty, clothingData.total.pyPoQty))}
                    </td>
                  </tr>
                  {/* 아이템별 */}
                  {sortedItems.map((item) => (
                    <tr 
                      key={item.itemCd} 
                      className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
                      onClick={() => handleItemClick(item.itemCd)}
                    >
                      <td className="py-2 px-3 text-left text-gray-700">{item.itemCd}</td>
                      <td className="py-2 px-3 text-left text-gray-700">{item.itemNm}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-700">{formatK(item.cySalesAmt)}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-700">{formatRate(item.cyRate)}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-600">{formatK(item.pySalesAmt)}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-600">{formatRate(item.pyRate)}</td>
                      <td className={`py-2 px-2 text-right font-mono ${
                        calcSalesYoy(item.cySalesAmt, item.pySalesAmt) && calcSalesYoy(item.cySalesAmt, item.pySalesAmt)! >= 1 ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        {formatYoy(calcSalesYoy(item.cySalesAmt, item.pySalesAmt))}
                      </td>
                      <td className={`py-2 px-2 text-right font-mono ${
                        item.yoy && item.yoy >= 1 ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        {formatYoy(item.yoy)}
                      </td>
                      <td className={`py-2 px-2 text-right font-mono ${
                        calcPoQtyYoy(item.cyPoQty, item.pyPoQty) && calcPoQtyYoy(item.cyPoQty, item.pyPoQty)! >= 1 ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        {formatYoy(calcPoQtyYoy(item.cyPoQty, item.pyPoQty))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          </div>
          
          {/* 우측: 아이템 상세 (선택 시 표시) */}
          {selectedItem && (
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden h-full">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-gray-700">
                      아이템 상세: {clothingData?.items?.find(i => i.itemCd === selectedItem)?.itemNm || ''}
                    </h3>
                    <span className="text-xs text-gray-500">
                      총 {sortedItemDetails.length}개 상품 | {
                        detailSortColumn === 'cyRate' ? '당시즌 판매율' :
                        detailSortColumn === 'cySalesQty' ? '당시즌 판매수량' :
                        detailSortColumn === 'cyStockQty' ? '당시즌 기말 재고수량' :
                        detailSortColumn === 'poQty' ? '발주수량' :
                        '당시즌 판매수량'
                      } 기준 {detailSortDirection === 'asc' ? '오름차순' : '내림차순'}
                    </span>
                  </div>
                  <button 
                    onClick={() => setSelectedItem(null)} 
                    className="text-gray-500 hover:text-gray-700 text-xl font-bold"
                  >
                    ×
                  </button>
                </div>
                
                <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
                  {loading ? (
                    <div className="py-12 text-center text-gray-500">로딩 중...</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-gray-100 z-10">
                          <tr>
                            <th className="py-2 px-3 text-left font-semibold text-gray-700 border-b-2">상품코드</th>
                            <th className="py-2 px-3 text-left font-semibold text-gray-700 border-b-2">상품명</th>
                            <th 
                              className="py-2 px-3 text-right font-semibold text-gray-700 border-b-2 cursor-pointer hover:bg-gray-200 select-none"
                              onClick={() => handleDetailSort('cyRate')}
                            >
                              당시즌 판매율
                              <SortIcon column="cyRate" currentColumn={detailSortColumn} direction={detailSortDirection} />
                            </th>
                            <th 
                              className="py-2 px-3 text-right font-semibold text-gray-700 border-b-2 cursor-pointer hover:bg-gray-200 select-none"
                              onClick={() => handleDetailSort('cySalesQty')}
                            >
                              당시즌 판매수량
                              <SortIcon column="cySalesQty" currentColumn={detailSortColumn} direction={detailSortDirection} />
                            </th>
                            <th 
                              className="py-2 px-3 text-right font-semibold text-gray-700 border-b-2 cursor-pointer hover:bg-gray-200 select-none"
                              onClick={() => handleDetailSort('cyStockQty')}
                            >
                              당시즌 기말 재고수량
                              <SortIcon column="cyStockQty" currentColumn={detailSortColumn} direction={detailSortDirection} />
                            </th>
                            <th 
                              className="py-2 px-3 text-right font-semibold text-gray-700 border-b-2 cursor-pointer hover:bg-gray-200 select-none"
                              onClick={() => handleDetailSort('poQty')}
                            >
                              발주수량
                              <SortIcon column="poQty" currentColumn={detailSortColumn} direction={detailSortDirection} />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedItemDetails.map((prod, idx) => (
                            <tr key={`${prod.prdtCd}-${idx}`} className={idx % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50'}>
                              <td className="py-2 px-3 text-gray-800 font-mono text-xs">{prod.prdtCd}</td>
                              <td className="py-2 px-3 text-gray-800">{prod.prdtNm}</td>
                              <td className="py-2 px-3 text-right text-gray-800 font-semibold">{formatRate(prod.cyRate)}</td>
                              <td className="py-2 px-3 text-right text-gray-800">{prod.cySalesQty.toLocaleString()}</td>
                              <td className="py-2 px-3 text-right text-gray-800">{prod.cyStockQty !== null ? prod.cyStockQty.toLocaleString() : '-'}</td>
                              <td className="py-2 px-3 text-right text-gray-800">{prod.poQty.toLocaleString()}</td>
                            </tr>
                          ))}
                          {sortedItemDetails.length === 0 && (
                            <tr>
                              <td colSpan={6} className="py-12 text-center text-gray-400">데이터가 없습니다.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

export default function BrandPlForecastPage() {
  const router = useRouter();
  const params = useParams();
  const brandSlug = params.brand as string;

  // 초기값은 현재 월 (처음 대시보드 켤 때)
  const [ym, setYm] = useState(getCurrentYm());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showAccum, setShowAccum] = useState(false);
  
  // 매장별 상세 모달 상태
  const [showShopModal, setShowShopModal] = useState(false);
  const [currentShopDetails, setCurrentShopDetails] = useState<ShopSalesDetail[]>([]);
  const [prevShopDetails, setPrevShopDetails] = useState<ShopSalesDetail[]>([]);
  const [currentShopLoading, setCurrentShopLoading] = useState(false);
  const [prevShopLoading, setPrevShopLoading] = useState(false);
  const [shopModalTab, setShopModalTab] = useState<'current' | 'prev'>('current');

  // 유효한 브랜드인지 확인
  const isValid = isValidBrandSlug(brandSlug);
  const brandCode = isValid ? slugToCode(brandSlug as BrandSlug) : null;
  const brandLabel = brandCode ? codeToLabel(brandCode) : '';

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
          if (json.lines && json.lines.length > 0) {
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
          }
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
  
  // 매장별 상세 조회 핸들러
  const handleSalesClick = async () => {
    if (!brandCode) return;
    
    // 점당매출은 전일 기준 (retailLastDt 사용)
    const retailDt = data?.retailLastDt || data?.lastDt;
    if (!retailDt) return;
    
    setShowShopModal(true);
    setShopModalTab('current');
    setCurrentShopDetails([]);
    setPrevShopDetails([]);
    
    // 당년 데이터 조회
    setCurrentShopLoading(true);
    try {
      const res = await fetch(`/api/shop-sales?ym=${ym}&brand=${brandCode}&lastDt=${retailDt}&year=current`);
      const result = await res.json();
      if (!result.error) {
        setCurrentShopDetails(result.shops || []);
      }
    } catch (err) {
      console.error('Failed to fetch current shop sales:', err);
    } finally {
      setCurrentShopLoading(false);
    }
    
    // 전년 데이터 조회
    setPrevShopLoading(true);
    try {
      const res = await fetch(`/api/shop-sales?ym=${ym}&brand=${brandCode}&lastDt=${retailDt}&year=prev`);
      const result = await res.json();
      if (!result.error) {
        setPrevShopDetails(result.shops || []);
      }
    } catch (err) {
      console.error('Failed to fetch prev shop sales:', err);
    } finally {
      setPrevShopLoading(false);
    }
  };

  // 기준월 변경 핸들러 (URL 쿼리 파라미터 업데이트)
  const handleYmChange = (newYm: string) => {
    setYm(newYm);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      params.set('ym', newYm);
      router.push(`/pl-forecast/${brandSlug}?${params.toString()}`);
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
    // 실판(V-) 숨김 처리
    if (line.id === 'act-sale-vat-exc') {
      return [];
    }
    
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
          transition-colors duration-150
          ${line.isCalculated ? 'bg-white' : 'hover:bg-gray-50/50'}
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
        <td className={`py-3 px-3 text-right font-mono text-gray-700 text-xs ${butterBgClass}`}>
          {formatK(line.prevYear)}
        </td>

        {/* (전년)누적 */}
        {showAccum && (
          <td className={`py-3 px-3 text-right font-mono text-gray-600 text-xs ${butterBgClass}`}>
            {formatK(line.prevYearAccum ?? null)}
          </td>
        )}

        {/* (전년)진척률 */}
        {showAccum && (
          <td className={`py-3 px-3 text-right font-mono text-gray-600 text-xs ${butterBgClass}`}>
            {line.prevYearProgressRate != null ? `${(line.prevYearProgressRate * 100).toFixed(1)}%` : '-'}
          </td>
        )}

        {/* 목표 */}
        <td className={`py-3 px-3 text-right font-mono text-gray-700 text-xs bg-sky-50`}>
          {formatK(line.target)}
        </td>

        {/* 누적 */}
        <td className={`py-3 px-3 text-right font-mono text-cyan-600 text-xs ${butterBgClass}`}>
          {formatK(line.accum)}
        </td>

        {/* 월말예상 */}
        <td className={`py-3 px-3 text-right font-mono text-emerald-600 text-xs bg-sky-50`}>
          {formatK(line.forecast)}
        </td>

        {/* 전년비 */}
        <td className={`py-3 px-3 text-right font-mono text-xs ${butterBgClass} ${
          line.yoyRate !== null && line.yoyRate >= 0 ? 'text-emerald-600' : 'text-rose-600'
        }`}>
          {formatPercentNoDecimal(line.yoyRate !== null ? line.yoyRate + 1 : null)}
        </td>

        {/* 달성율 */}
        <td className={`py-3 px-3 text-right font-mono text-xs ${butterBgClass} ${
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

  // 브랜드별 테마 색상 (모두 동일한 라벤더/연한 보라색)
  const getBrandColor = (slug: string): string => {
    return 'from-purple-400 to-purple-500';
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
                {/* 바 차트 아이콘 */}
                <svg width="38" height="38" viewBox="0 0 32 32" className="drop-shadow-sm">
                  <defs>
                    <pattern id="grid-icon-brand" width="4" height="4" patternUnits="userSpaceOnUse">
                      <path d="M 4 0 L 0 0 0 4" fill="none" stroke="#E5E7EB" strokeWidth="0.5"/>
                    </pattern>
                    <linearGradient id="greenGradient-brand" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#059669" stopOpacity="1" />
                      <stop offset="100%" stopColor="#047857" stopOpacity="1" />
                    </linearGradient>
                    <linearGradient id="pinkGradient-brand" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#DB2777" stopOpacity="1" />
                      <stop offset="100%" stopColor="#BE185D" stopOpacity="1" />
                    </linearGradient>
                    <linearGradient id="blueGradient-brand" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#2563EB" stopOpacity="1" />
                      <stop offset="100%" stopColor="#1D4ED8" stopOpacity="1" />
                    </linearGradient>
                  </defs>
                  {/* 배경 사각형 */}
                  <rect x="2" y="2" width="28" height="28" fill="#F3F4F6" rx="2" />
                  <rect x="2" y="2" width="28" height="28" fill="url(#grid-icon-brand)" rx="2" />
                  {/* x축 선 */}
                  <line x1="6" y1="24" x2="26" y2="24" stroke="#1D4ED8" strokeWidth="1.5" />
                  {/* 막대 1 (왼쪽, 초록, 가장 높음) */}
                  <rect x="6" y="8" width="5" height="16" rx="1" fill="url(#greenGradient-brand)" />
                  {/* 막대 2 (중간, 분홍, 가장 짧음) */}
                  <rect x="13" y="20" width="5" height="4" rx="1" fill="url(#pinkGradient-brand)" />
                  {/* 막대 3 (오른쪽, 파랑, 중간 높이) */}
                  <rect x="20" y="12" width="5" height="12" rx="1" fill="url(#blueGradient-brand)" />
                </svg>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                  F&F CHINA 월중 손익예측 대시보드
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
                onChange={(e) => handleYmChange(e.target.value)}
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
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white'
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
                  <ChannelTable data={data.channelTable} lastDt={data.lastDt} />
                </div>
              )}
              
              {/* 점당매출 테이블 (MLB, MLB KIDS, DISCOVERY만) */}
              {data.retailSalesTable && (
                <div className="mt-6">
                  <RetailSalesTable 
                    data={data.retailSalesTable} 
                    brandLabel={brandLabel}
                    onSalesClick={handleSalesClick}
                    retailLastDt={data.retailLastDt || ''}
                  />
                </div>
              )}
              
              {/* 티어별/지역별 점당매출 테이블 */}
              {data.tierRegionData && (
                <div className="mt-6">
                  <TierRegionTable 
                    data={data.tierRegionData} 
                    ym={ym}
                    retailLastDt={data.retailLastDt || ''}
                  />
                </div>
              )}
              
              {/* 티어별/지역별 점당매출 트리맵 차트 */}
              {data.tierRegionData && data.retailLastDt && (
                <div className="mt-6">
                  <TierRegionTreemap 
                    data={data.tierRegionData} 
                    brandCode={data.brand} 
                    ym={data.ym}
                    lastDt={data.retailLastDt}
                  />
                </div>
              )}
              
              {/* 의류 판매율 섹션 */}
              {data.clothingSales && data.clothingSales.items && data.clothingSales.items.length > 0 ? (
                <div className="mt-6">
                  <ClothingSalesSection 
                    data={data.clothingSales} 
                    brandCode={data.brand} 
                    lastDt={data.clothingLastDt || data.lastDt}
                    ym={ym}
                  />
                </div>
              ) : data && ['M', 'I', 'X', 'V', 'W'].includes(data.brand) ? (
                <div className="mt-6 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">의류 판매율 {(data?.clothingLastDt || data?.lastDt) ? `(${formatDateShort(data.clothingLastDt || data.lastDt)} 까지)` : ''}</h3>
                  <p className="text-sm text-gray-500">의류 판매율 데이터를 조회 중이거나 데이터가 없습니다.</p>
                  <p className="text-xs text-gray-400 mt-2">브랜드: {data?.brand || ''}, 기준일: {data?.lastDt || ''}</p>
                </div>
              ) : null}
              
              {/* 매장별 상세 모달 */}
              <ShopSalesModal
                isOpen={showShopModal}
                onClose={() => setShowShopModal(false)}
                currentShops={currentShopDetails}
                prevShops={prevShopDetails}
                currentLoading={currentShopLoading}
                prevLoading={prevShopLoading}
                lastDt={data?.retailLastDt || data?.lastDt || ''}
                activeTab={shopModalTab}
                onTabChange={setShopModalTab}
              />
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
                          <pattern id="grid-icon-pl" width="4" height="4" patternUnits="userSpaceOnUse">
                            <path d="M 4 0 L 0 0 0 4" fill="none" stroke="#E5E7EB" strokeWidth="0.5"/>
                          </pattern>
                          <linearGradient id="greenGradient-pl" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#059669" stopOpacity="1" />
                            <stop offset="100%" stopColor="#047857" stopOpacity="1" />
                          </linearGradient>
                          <linearGradient id="pinkGradient-pl" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#DB2777" stopOpacity="1" />
                            <stop offset="100%" stopColor="#BE185D" stopOpacity="1" />
                          </linearGradient>
                          <linearGradient id="blueGradient-pl" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#2563EB" stopOpacity="1" />
                            <stop offset="100%" stopColor="#1D4ED8" stopOpacity="1" />
                          </linearGradient>
                        </defs>
                        {/* 배경 사각형 */}
                        <rect x="2" y="2" width="28" height="28" fill="#F3F4F6" rx="2" />
                        <rect x="2" y="2" width="28" height="28" fill="url(#grid-icon-pl)" rx="2" />
                        {/* x축 선 */}
                        <line x1="6" y1="24" x2="26" y2="24" stroke="#1D4ED8" strokeWidth="1.5" />
                        {/* 막대 1 (왼쪽, 초록, 가장 높음) */}
                        <rect x="6" y="8" width="5" height="16" rx="1" fill="url(#greenGradient-pl)" />
                        {/* 막대 2 (중간, 분홍, 가장 짧음) */}
                        <rect x="13" y="20" width="5" height="4" rx="1" fill="url(#pinkGradient-pl)" />
                        {/* 막대 3 (오른쪽, 파랑, 중간 높이) */}
                        <rect x="20" y="12" width="5" height="12" rx="1" fill="url(#blueGradient-pl)" />
                      </svg>
                      <h3 className="text-base text-gray-800 tracking-tight">{brandLabel} 손익계산서</h3>
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
                    <thead className="bg-gradient-to-b from-gray-100 to-gray-50 sticky top-0 z-20 shadow-sm">
                      <tr className="text-gray-700">
                        <th className="py-3 px-4 text-left text-gray-800 sticky left-0 bg-gradient-to-b from-gray-100 to-gray-50 z-20 border-r border-gray-200">
                          구분
                        </th>
                        <th className="py-3 px-3 text-right text-gray-800">
                          <div className="flex flex-col items-end leading-tight">
                            <span>(전년)</span>
                            <span>월전체</span>
                          </div>
                        </th>
                        {showAccum && (
                          <>
                            <th className="py-3 px-3 text-right text-gray-800">
                              <div className="flex flex-col items-end leading-tight">
                                <span>(전년)</span>
                                <span>누적</span>
                              </div>
                            </th>
                            <th className="py-3 px-3 text-right text-gray-800">
                              <div className="flex flex-col items-end leading-tight">
                                <span>(전년)</span>
                                <span>진척률</span>
                              </div>
                            </th>
                          </>
                        )}
                        <th className="py-3 px-3 text-right text-gray-800 bg-sky-50">
                          <div className="flex flex-col items-end leading-tight">
                            <span>(당월)</span>
                            <span>목표</span>
                          </div>
                        </th>
                        <th className="py-3 px-3 text-right text-gray-800">
                          <div className="flex flex-col items-end leading-tight">
                            <span>(당월)</span>
                            <span>누적실적</span>
                          </div>
                        </th>
                        <th className="py-3 px-3 text-right text-gray-800 bg-sky-50">
                          <div className="flex flex-col items-end leading-tight">
                            <span>(당월)</span>
                            <span>월말예상</span>
                          </div>
                        </th>
                        <th className="py-3 px-3 text-right text-gray-800">
                          <div className="flex flex-col items-end leading-tight">
                            <span>(당월말)</span>
                            <span>전년비</span>
                          </div>
                        </th>
                        <th className="py-3 px-3 text-right text-gray-800">
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
                    <ul className="space-y-1 ml-4 text-gray-600">
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span><strong>대리상</strong> (온라인 대리상, 오프라인 대리상): 월말예상 = 목표</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span><strong>직영</strong> (온라인 직영, 오프라인 직영): 월말예상 = 누적 ÷ 전년 진척률</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span className="text-gray-500 italic">전년 진척률 = (전년 D일까지 누적) ÷ (전년 월전체)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span className="text-gray-500 italic">전년 데이터가 없거나 분모가 0이면 "-"</span>
                      </li>
                    </ul>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-gray-100 shadow-sm">
                    <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                      매출원가 채널별 계산
                    </div>
                    <ul className="space-y-1 ml-4 text-gray-600">
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span><strong>대리상</strong> (온라인 대리상, 오프라인 대리상): 월말예상 = 목표</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span><strong>직영</strong> (온라인 직영, 오프라인 직영):</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">-</span>
                        <span>Tag대비 원가율 = (누적 매출원가 × 1.13) ÷ 누적 Tag매출</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">-</span>
                        <span>월말예상 매출원가 = (Tag대비 원가율 × 월말예상 Tag매출) ÷ 1.13</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span className="text-gray-500 italic">예외: Tag매출 누적이 0이거나 월말예상 Tag매출이 "-"이면 "-"</span>
                      </li>
                    </ul>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-gray-100 shadow-sm">
                    <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                      직접비 (고정비)
                    </div>
                    <ul className="space-y-1 ml-4 text-gray-600">
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span>지급수수료, 대리상지원금, 포장비, 감가상각비, 진열소모품, 기타지급수수료</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span className="font-medium text-gray-700">계산식: 월말예상 = 목표 비용</span>
                      </li>
                    </ul>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-gray-100 shadow-sm">
                    <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      직접비 (변동비)
                    </div>
                    <ul className="space-y-1 ml-4 text-gray-600">
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span>오프라인 직영 기준: 급여, 복리후생비, 매장임차료</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span>온라인 직영 기준: 플랫폼수수료, TP수수료, 직접광고비</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span>전체 기준: 물류비</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span className="font-medium text-gray-700">계산식: 월말예상 = 목표 비용 ÷ 목표 실판(V-) × 월말예상 실판(V-)</span>
                      </li>
                    </ul>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-gray-100 shadow-sm">
                    <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                      영업비 (모두 고정비)
                    </div>
                    <ul className="space-y-1 ml-4 text-gray-600">
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span>급여, 복리후생비, 광고비, 수주회, 지급수수료, 임차료, 감가상각비, 세금과공과, 기타지급수수료</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-gray-400 mt-1">•</span>
                        <span className="font-medium text-gray-700">계산식: 월말예상 = 목표 비용</span>
                      </li>
                    </ul>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-200 bg-white rounded-lg p-3 border-x border-b border-gray-100 shadow-sm">
                    <div className="font-semibold text-gray-800">달성율: 월말예상 ÷ 목표 × 100%</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
