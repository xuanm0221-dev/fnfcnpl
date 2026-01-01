'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import type { ApiResponse, PlLine, BrandSlug, ChannelTableData, ChannelRowData, ChannelPlanTable, ChannelActualTable, RetailSalesTableData, RetailSalesRow, ShopSalesDetail, TierRegionSalesData, TierRegionSalesRow, ClothingSalesData, ClothingSalesRow, ClothingItemDetail } from '@/lib/plforecast/types';
import { brandTabs, isValidBrandSlug, slugToCode, codeToLabel } from '@/lib/plforecast/brand';
import { formatK, formatPercent, formatDateShort } from '@/lib/plforecast/format';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Treemap } from 'recharts';

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
              <th rowSpan={2} className="py-2 px-3 text-left font-semibold text-gray-600 border-r border-gray-200 sticky left-0 bg-gray-50 z-10"></th>
              <th colSpan={5} className="py-2 px-2 text-center font-semibold text-gray-700 border-r border-gray-300 bg-blue-50">채널별 계획</th>
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
              
              return (
                <tr 
                  key={row.key} 
                  className={`border-b border-gray-100 ${isHighlight ? 'bg-yellow-50' : ''} ${isClickable ? 'cursor-pointer hover:bg-blue-100' : ''}`}
                  onClick={isClickable ? onSalesClick : undefined}
                >
                  <td className={`py-2 px-3 text-left font-medium border-r border-gray-200 whitespace-nowrap ${isClickable ? 'text-blue-600 underline' : 'text-gray-700'}`}>
                    {row.label}
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
      </div>
    </div>
  );
}

// 티어별/지역별 점당매출 테이블 컴포넌트
function TierRegionTable({ data }: { data: TierRegionSalesData }) {
  const [activeTab, setActiveTab] = useState<'tier' | 'region'>('tier');
  
  // 숫자 포맷 (천단위 콤마)
  const formatNumber = (value: number): string => {
    return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };
  
  // K 단위 포맷 (매출)
  const formatK = (value: number): string => {
    return Math.round(value / 1000).toLocaleString();
  };
  
  // 안전한 데이터 배열
  const safeTiers = Array.isArray(data?.tiers) ? data.tiers : [];
  const safeRegions = Array.isArray(data?.regions) ? data.regions : [];
  const rows = activeTab === 'tier' ? safeTiers : safeRegions;
  
  // 합계 계산 (null 체크)
  const totalSalesAmt = rows.reduce((sum, r) => sum + (r?.salesAmt || 0), 0);
  const totalShopCnt = rows.reduce((sum, r) => sum + (r?.shopCnt || 0), 0);
  const totalSalesPerShop = totalShopCnt > 0 ? totalSalesAmt / totalShopCnt : 0;
  const totalPrevSalesAmt = rows.reduce((sum, r) => sum + (r?.prevSalesAmt || 0), 0);
  const totalPrevShopCnt = rows.reduce((sum, r) => sum + (r?.prevShopCnt || 0), 0);
  const totalPrevSalesPerShop = totalPrevShopCnt > 0 ? totalPrevSalesAmt / totalPrevShopCnt : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* 탭 헤더 */}
      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex gap-2">
        <button
          onClick={() => setActiveTab('tier')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'tier' 
              ? 'bg-blue-600 text-white' 
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
          }`}
        >
          티어
        </button>
        <button
          onClick={() => setActiveTab('region')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'region' 
              ? 'bg-blue-600 text-white' 
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
          }`}
        >
          지역
        </button>
      </div>
      
      {/* 테이블 */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr className="border-b border-gray-200">
              {activeTab === 'tier' ? (
                <th className="py-2 px-3 text-left font-semibold text-gray-700 border-r border-gray-200">티어구분</th>
              ) : (
                <>
                  <th className="py-2 px-3 text-left font-semibold text-gray-700 border-r border-gray-100">중국어</th>
                  <th className="py-2 px-3 text-left font-semibold text-gray-700 border-r border-gray-200">한국어</th>
                </>
              )}
              <th className="py-2 px-2 text-right font-semibold text-gray-700 bg-blue-50 border-r border-gray-100">리테일매출(K)</th>
              <th className="py-2 px-2 text-right font-semibold text-gray-700 bg-blue-50 border-r border-gray-100">매장수</th>
              <th className="py-2 px-2 text-right font-semibold text-gray-700 bg-blue-50 border-r border-gray-100">점당매출</th>
              <th className="py-2 px-2 text-right font-semibold text-gray-700 bg-blue-50 border-r border-gray-200">YOY(점당매출)</th>
              <th className="py-2 px-2 text-right font-semibold text-gray-700 border-r border-gray-100">(전년)리테일매출(K)</th>
              <th className="py-2 px-2 text-right font-semibold text-gray-700 border-r border-gray-100">(전년)매장수</th>
              <th className="py-2 px-2 text-right font-semibold text-gray-700">(전년)점당매출</th>
            </tr>
          </thead>
          <tbody>
            {/* 합계 행 */}
            <tr className="border-b border-gray-300 bg-yellow-50 font-semibold">
              {activeTab === 'tier' ? (
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
              <td className="py-2 px-2 text-right font-mono text-gray-600 border-r border-gray-100">{formatK(totalPrevSalesAmt)}</td>
              <td className="py-2 px-2 text-right font-mono text-gray-600 border-r border-gray-100">{formatNumber(totalPrevShopCnt)}</td>
              <td className="py-2 px-2 text-right font-mono text-gray-600">{formatNumber(totalPrevSalesPerShop)}</td>
            </tr>
            {/* 데이터 행 */}
            {rows.map((row) => {
              if (!row) return null;
              return (
                <tr key={row.key} className="border-b border-gray-100 hover:bg-gray-50">
                  {activeTab === 'tier' ? (
                    <td className="py-2 px-3 text-left font-medium text-gray-700 border-r border-gray-200">{row.key}</td>
                  ) : (
                    <>
                      <td className="py-2 px-3 text-left font-medium text-gray-700 border-r border-gray-100">{row.key}</td>
                      <td className="py-2 px-3 text-left text-gray-600 border-r border-gray-200">{row.labelKo || row.key}</td>
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
                  <td className="py-2 px-2 text-right font-mono text-gray-600 border-r border-gray-100">{formatK(row.prevSalesAmt || 0)}</td>
                  <td className="py-2 px-2 text-right font-mono text-gray-600 border-r border-gray-100">{formatNumber(row.prevShopCnt || 0)}</td>
                  <td className="py-2 px-2 text-right font-mono text-gray-600">{formatNumber(row.prevSalesPerShop || 0)}</td>
                </tr>
              );
            })}
            {(rows?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={activeTab === 'tier' ? 8 : 9} className="py-4 text-center text-gray-500">
                  데이터가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
  color?: string;
}

function TreemapContent(props: TreemapContentProps) {
  const { 
    x = 0, y = 0, width = 0, height = 0, 
    displayName, salesPerShop, salesK, shopCnt, 
    prevSalesPerShop, prevSalesK, prevShopCnt,
    yoy, color 
  } = props;
  
  // 타일 간 간격 (2px)
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
          fill="#000" 
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
  const formatYoy = (v: number | undefined) => v ? `${(v * 100).toFixed(1)}%` : '-';
  
  // 판매매출 YOY 계산
  const salesYoy = salesK && prevSalesK ? 
    (parseFloat(salesK.replace(/,/g, '')) / parseFloat(prevSalesK.replace(/,/g, ''))) : undefined;
  
  // 라인 높이
  const lineHeight = 18;
  const startY = innerY + 16;
  
  return (
    <g>
      {/* 타일 배경 (간격 포함, 라운드 제거) */}
      <rect x={innerX} y={innerY} width={innerWidth} height={innerHeight} 
            fill={color || '#8884d8'} stroke="#fff" strokeWidth={1} rx={0} />
      
      {/* 1줄: 카테고리명 */}
      <text 
        x={innerX + 12} 
        y={startY} 
        fill="#000" 
        fontSize={16} 
        fontWeight="normal"
        stroke="none"
        style={{ fontFamily: 'inherit' }}
      >
        {displayName}
      </text>
      
      {/* 2줄: 당월 점당매출 */}
      <text x={innerX + 12} y={startY + lineHeight} fill="#000" fontSize={12}>
        당월: {formatNum(salesPerShop || 0)} ({salesK}K)
      </text>
      
      {/* 3줄: 전년 점당매출 */}
      <text x={innerX + 12} y={startY + lineHeight * 2} fill="#000" fontSize={12}>
        전년: {formatNum(prevSalesPerShop || 0)} ({prevSalesK}K)
      </text>
      
      {/* 4줄: YOY */}
      {innerHeight > 80 && (
        <text x={innerX + 12} y={startY + lineHeight * 3} fill="#000" fontSize={11}>
          YOY : <tspan fill="#B9F18C">{formatYoy(yoy)}</tspan>
          {salesYoy && (
            <tspan fill="#B9F18C"> ({formatYoy(salesYoy)})</tspan>
          )}
        </text>
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
  onCategoryClick: (categoryName: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<{ category: string; cySalesAmt: number; pySalesAmt: number; yoy: number | null }[]>([]);
  
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
  
  // 카테고리별 색상
  const categoryColors: Record<string, string> = {
    'Shoes': '#8B5CF6',
    'Headwear': '#EC4899',
    'Bag': '#F59E0B',
    'Acc_etc': '#10B981',
    '의류 당시즌': '#3B82F6',
    '의류 차시즌': '#8B5CF6',
    '의류 과시즌': '#6B7280',
    '신발': '#8B5CF6',
    '모자': '#EC4899',
    '가방': '#F59E0B',
    '기타악세': '#10B981',
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
    return {
      name: categoryKey,
      displayName: cat.category,
      size: cat.cySalesAmt || 0,
      cySalesAmt: cat.cySalesAmt || 0,
      pySalesAmt: cat.pySalesAmt || 0,
      yoy: cat.yoy,
      percentage,
      color: categoryColors[cat.category] || categoryColors[categoryKey] || '#6B7280',
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null);
  
  const handleCategoryClick = (data: { name: string }) => {
    if (data && data.name) {
      onCategoryClick(data.name);
    }
  };
  
  return (
    <div className="relative p-2">
      {/* 뒤로가기 버튼 */}
      <button
        onClick={onBack}
        className="absolute top-4 left-4 z-10 bg-white border border-gray-300 rounded px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm flex items-center gap-1"
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
              stroke="#fff"
              content={(props) => {
                const { x, y, width, height, name, displayName, cySalesAmt, pySalesAmt, yoy, color, percentage } = props as TreemapContentProps & { cySalesAmt?: number; pySalesAmt?: number; percentage?: string };
                
                const gap = 2;
                const innerX = (x || 0) + gap;
                const innerY = (y || 0) + gap;
                const innerWidth = (width || 0) - gap * 2;
                const innerHeight = (height || 0) - gap * 2;
                
                if (innerWidth < 80 || innerHeight < 60) {
                  return (
                    <g>
                      <rect x={innerX} y={innerY} width={innerWidth} height={innerHeight} 
                            fill={color || '#8884d8'} stroke="#fff" strokeWidth={1} rx={0} />
                      <text 
                        x={innerX + 12} 
                        y={innerY + 20} 
                        fill="#000" 
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
                
                const formatK = (v: number) => Math.round(v / 1000).toLocaleString();
                const formatYoy = (v: number | null | undefined) => v ? `${(v * 100).toFixed(1)}%` : '-';
                
                const lineHeight = 18;
                const startY = innerY + 16;
                
                return (
                  <g style={{ cursor: 'pointer' }}>
                    <rect x={innerX} y={innerY} width={innerWidth} height={innerHeight} 
                          fill={color || '#8884d8'} stroke="#fff" strokeWidth={1} rx={0} />
                    
                    <text 
                      x={innerX + 12} 
                      y={startY} 
                      fill="#000" 
                      fontSize={16} 
                      fontWeight="normal"
                      stroke="none"
                      style={{ fontFamily: 'inherit' }}
                    >
                      {displayName}
                    </text>
                    
                    <text x={innerX + 12} y={startY + lineHeight} fill="#000" fontSize={12}>
                      당년: {formatK(cySalesAmt || 0)}K ({percentage || '0.0'}%)
                    </text>
                    
                    <text x={innerX + 12} y={startY + lineHeight * 2} fill="#000" fontSize={12}>
                      전년: {formatK(pySalesAmt || 0)}K
                    </text>
                    
                    {innerHeight > 80 && (
                      <text x={innerX + 12} y={startY + lineHeight * 3} fill="#000" fontSize={11}>
                        YOY : <tspan fill="#B9F18C">{formatYoy(yoy)}</tspan>
                      </text>
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
  const [categories, setCategories] = useState<{ category: string; cySalesAmt: number; pySalesAmt: number; yoy: number | null }[]>([]);
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
  
  // 카테고리별 색상 (영문 키와 한글 키 모두 지원)
  const categoryColors: Record<string, string> = {
    'Shoes': '#8B5CF6',
    'Headwear': '#EC4899',
    'Bag': '#F59E0B',
    'Acc_etc': '#10B981',
    '의류 당시즌': '#3B82F6',
    '의류 차시즌': '#8B5CF6',
    '의류 과시즌': '#6B7280',
    // 한글 키도 지원 (API에서 한글로 올 수 있음)
    '신발': '#8B5CF6',
    '모자': '#EC4899',
    '가방': '#F59E0B',
    '기타악세': '#10B981',
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
    return {
      name: categoryKey,
      displayName: cat.category, // 원본 카테고리명 표시
      size: cat.cySalesAmt || 0,
      cySalesAmt: cat.cySalesAmt || 0,
      pySalesAmt: cat.pySalesAmt || 0,
      yoy: cat.yoy,
      percentage,
      color: categoryColors[cat.category] || categoryColors[categoryKey] || '#6B7280',
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
                    stroke="#fff"
                    content={(props) => {
                      const { x, y, width, height, name, displayName, cySalesAmt, pySalesAmt, yoy, color, percentage } = props as TreemapContentProps & { cySalesAmt?: number; pySalesAmt?: number; percentage?: string };
                      
                      // 타일 간 간격 (2px)
                      const gap = 2;
                      const innerX = (x || 0) + gap;
                      const innerY = (y || 0) + gap;
                      const innerWidth = (width || 0) - gap * 2;
                      const innerHeight = (height || 0) - gap * 2;
                      
                      // 작은 타일 처리
                      if (innerWidth < 80 || innerHeight < 60) {
                        return (
                          <g>
                            <rect x={innerX} y={innerY} width={innerWidth} height={innerHeight} 
                                  fill={color || '#8884d8'} stroke="#fff" strokeWidth={1} rx={0} />
                            <text 
                              x={innerX + 12} 
                              y={innerY + 20} 
                              fill="#000" 
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
                      
                      const formatK = (v: number) => Math.round(v / 1000).toLocaleString();
                      const formatYoy = (v: number | null | undefined) => v ? `${(v * 100).toFixed(1)}%` : '-';
                      
                      // 라인 높이
                      const lineHeight = 18;
                      const startY = innerY + 16;
                      
                      return (
                        <g style={{ cursor: 'pointer' }}>
                          {/* 타일 배경 (간격 포함, 라운드 제거) */}
                          <rect x={innerX} y={innerY} width={innerWidth} height={innerHeight} 
                                fill={color || '#8884d8'} stroke="#fff" strokeWidth={1} rx={0} />
                          
                          {/* 1줄: 카테고리명 (속 채움 스타일 - 일반 텍스트) */}
                          <text 
                            x={innerX + 12} 
                            y={startY} 
                            fill="#000" 
                            fontSize={16} 
                            fontWeight="normal"
                            stroke="none"
                            style={{ fontFamily: 'inherit' }}
                          >
                            {displayName}
                          </text>
                          
                          {/* 2줄: 당년 판매액 + 비중 */}
                          <text x={innerX + 12} y={startY + lineHeight} fill="#000" fontSize={12}>
                            당년: {formatK(cySalesAmt || 0)}K ({percentage || '0.0'}%)
                          </text>
                          
                          {/* 3줄: 전년 판매액 */}
                          <text x={innerX + 12} y={startY + lineHeight * 2} fill="#000" fontSize={12}>
                            전년: {formatK(pySalesAmt || 0)}K
                          </text>
                          
                          {/* 4줄: YOY */}
                          {innerHeight > 80 && (
                            <text x={innerX + 12} y={startY + lineHeight * 3} fill="#000" fontSize={11}>
                              YOY : <tspan fill="#B9F18C">{formatYoy(yoy)}</tspan>
                            </text>
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
  const [drilldownLevel, setDrilldownLevel] = useState<'level1' | 'level2'>('level1');
  const [selectedTierOrRegion, setSelectedTierOrRegion] = useState<{ type: 'tier' | 'region'; key: string; labelKo?: string } | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  
  // 티어별 고정 색상 (T0~T5)
  const tierColorMap: Record<string, string> = {
    'T0': '#60A5FA',  // 하늘색
    'T1': '#34D399',  // 민트색
    'T2': '#F472B6',  // 핑크색
    'T3': '#FBBF24',  // 노랑색
    'T4': '#A78BFA',  // 보라색
    'T5': '#FB923C',  // 주황색
  };
  
  // 지역별 고정 색상
  const regionColorMap: Record<string, string> = {
    '西北': '#60A5FA',  // 하늘색
    '华东': '#34D399',  // 민트색
    '华南': '#F472B6',  // 핑크색
    '华北': '#FBBF24',  // 노랑색
    '华中': '#A78BFA',  // 보라색
    '东北': '#FB923C',  // 주황색
    '西南': '#F87171',  // 빨간색 계열
  };
  
  // 안전한 데이터 배열 (null 체크)
  const safeTiers = Array.isArray(data?.tiers) ? data.tiers : [];
  const safeRegions = Array.isArray(data?.regions) ? data.regions : [];
  
  // 티어 데이터 변환
  const tierTreemapData = safeTiers.map((tier) => {
    if (!tier) return null;
    return {
      name: tier.key,
      displayName: tier.key,
      size: tier.salesPerShop || 0,
      salesPerShop: tier.salesPerShop || 0,
      salesK: Math.round((tier.salesAmt || 0) / 1000).toLocaleString(),
      shopCnt: tier.shopCnt || 0,
      prevSalesPerShop: tier.prevSalesPerShop || 0,
      prevSalesK: Math.round((tier.prevSalesAmt || 0) / 1000).toLocaleString(),
      prevShopCnt: tier.prevShopCnt || 0,
      yoy: (tier.prevSalesPerShop || 0) > 0 ? (tier.salesPerShop || 0) / tier.prevSalesPerShop : undefined,
      color: tierColorMap[tier.key] || '#8884d8', // 기본값
      labelKo: tier.labelKo,
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null);
  
  // 지역 데이터 변환 (한국어(중국어) 형식)
  const regionTreemapData = safeRegions.map((region) => {
    if (!region) return null;
    return {
      name: region.key,
      displayName: region.labelKo ? `${region.labelKo}(${region.key})` : region.key,
      size: region.salesPerShop || 0,
      salesPerShop: region.salesPerShop || 0,
      salesK: Math.round((region.salesAmt || 0) / 1000).toLocaleString(),
      shopCnt: region.shopCnt || 0,
      prevSalesPerShop: region.prevSalesPerShop || 0,
      prevSalesK: Math.round((region.prevSalesAmt || 0) / 1000).toLocaleString(),
      prevShopCnt: region.prevShopCnt || 0,
      yoy: (region.prevSalesPerShop || 0) > 0 ? (region.salesPerShop || 0) / region.prevSalesPerShop : undefined,
      color: regionColorMap[region.key] || '#8884d8', // 기본값
      labelKo: region.labelKo,
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null);
  
  const handleTierClick = (data: { name: string; labelKo?: string }) => {
    setSelectedTierOrRegion({ type: 'tier', key: data.name, labelKo: data.labelKo });
    setDrilldownLevel('level2');
  };
  
  const handleRegionClick = (data: { name: string; labelKo?: string }) => {
    setSelectedTierOrRegion({ type: 'region', key: data.name, labelKo: data.labelKo });
    setDrilldownLevel('level2');
  };
  
  const handleBackClick = () => {
    setDrilldownLevel('level1');
    setSelectedTierOrRegion(null);
  };
  
  const handleCategoryClick = (categoryName: string) => {
    setSelectedCategory(categoryName);
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
  
  return (
    <div className="bg-white rounded-none border border-gray-300 shadow-none overflow-hidden">
      {drilldownLevel === 'level1' ? (
        <div className="p-2">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 티어별 트리맵 */}
            <div>
              <div className="mb-2 text-center">
                <h4 className="text-sm font-semibold text-gray-700">티어별 점당매출</h4>
                <p className="text-xs text-gray-500 mt-1">
                  당해 기간: {formatPeriod()}
                </p>
              </div>
              <div className="h-[320px] border border-gray-300 rounded-none overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <Treemap
                    data={tierTreemapData}
                    dataKey="size"
                    aspectRatio={4 / 3}
                    stroke="#fff"
                    content={<TreemapContent />}
                    onClick={(data) => data && handleTierClick(data as { name: string; labelKo?: string })}
                  />
                </ResponsiveContainer>
              </div>
            </div>
            
            {/* 지역별 트리맵 */}
            <div>
              <div className="mb-2 text-center">
                <h4 className="text-sm font-semibold text-gray-700">지역별 점당매출</h4>
                <p className="text-xs text-gray-500 mt-1">
                  당해 기간: {formatPeriod()}
                </p>
              </div>
              <div className="h-[320px] border border-gray-300 rounded-none overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <Treemap
                    data={regionTreemapData}
                    dataKey="size"
                    aspectRatio={4 / 3}
                    stroke="#fff"
                    content={<TreemapContent />}
                    onClick={(data) => data && handleRegionClick(data as { name: string; labelKo?: string })}
                  />
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      ) : (
        selectedTierOrRegion && (
          <CategoryTreemapInline
            type={selectedTierOrRegion.type}
            keyName={selectedTierOrRegion.key}
            labelKo={selectedTierOrRegion.labelKo}
            brandCode={brandCode}
            ym={ym}
            lastDt={lastDt}
            onBack={handleBackClick}
            onCategoryClick={handleCategoryClick}
          />
        )
      )}
      
      {/* 상품별 내역 모달 (2단계에서 클릭 시) */}
      {selectedCategory && selectedTierOrRegion && (
        <ProductSalesModal
          isOpen={categoryModalOpen}
          onClose={() => {
            setCategoryModalOpen(false);
            setSelectedCategory(null);
          }}
          type={selectedTierOrRegion.type}
          keyName={selectedTierOrRegion.key}
          categoryName={selectedCategory}
          brandCode={brandCode}
          ym={ym}
          lastDt={lastDt}
        />
      )}
    </div>
  );
}

// 의류 판매율 테이블 및 차트 컴포넌트
function ClothingSalesSection({ 
  data, 
  brandCode, 
  lastDt 
}: { 
  data: ClothingSalesData; 
  brandCode: string; 
  lastDt: string;
}) {
  const [sortBy, setSortBy] = useState<'rate' | 'sales'>('rate');
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [itemDetails, setItemDetails] = useState<ClothingItemDetail[]>([]);
  const [loading, setLoading] = useState(false);
  
  // 정렬된 아이템 목록
  const sortedItems = React.useMemo(() => {
    if (!data || !data.items || !Array.isArray(data.items)) {
      return [];
    }
    const items = [...data.items];
    if (sortBy === 'rate') {
      return items.sort((a, b) => (b.cyRate || 0) - (a.cyRate || 0));
    } else {
      return items.sort((a, b) => b.cySalesAmt - a.cySalesAmt);
    }
  }, [data, sortBy]);
  
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
  
  // 차트 데이터
  const chartData = sortedItems.map(item => ({
    name: item.itemNm,
    rate: item.cyRate || 0,
    yoy: item.yoy ? (item.yoy - 1) * 100 : 0,
  }));
  
  const formatRate = (value: number | null) => value ? `${value.toFixed(1)}%` : '-';
  const formatYoy = (value: number | null) => value ? `${(value * 100).toFixed(1)}%` : '-';
  const formatK = (value: number) => Math.round(value / 1000).toLocaleString();
  
  // 누적판매 YOY 계산 함수
  const calcSalesYoy = (cy: number, py: number): number | null => {
    if (py === 0) return null;
    return cy / py;
  };
  
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">의류 판매율</h3>
      </div>
      
      <div className="p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 좌측: 테이블 */}
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr className="border-b border-gray-200">
                    <th className="py-2 px-3 text-left font-semibold text-gray-700">아이템코드</th>
                    <th className="py-2 px-3 text-left font-semibold text-gray-700">아이템 명칭</th>
                    <th className="py-2 px-2 text-right font-semibold text-gray-700">Tag누적판매(25시즌)</th>
                    <th className="py-2 px-2 text-right font-semibold text-gray-700">당시즌 판매율</th>
                    <th className="py-2 px-2 text-right font-semibold text-gray-700">Tag 누적판매(24시즌)</th>
                    <th className="py-2 px-2 text-right font-semibold text-gray-700">전년시즌 판매율</th>
                    <th className="py-2 px-2 text-right font-semibold text-gray-700">누적 판매금액 YOY</th>
                    <th className="py-2 px-2 text-right font-semibold text-gray-700">판매율 YOY</th>
                  </tr>
                </thead>
                <tbody>
                  {/* 전체 합계 */}
                  <tr className="border-b border-gray-300 bg-yellow-50 font-semibold">
                    <td className="py-2 px-3 text-left text-gray-800">{data.total.itemCd}</td>
                    <td className="py-2 px-3 text-left text-gray-800">{data.total.itemNm}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-800">{formatK(data.total.cySalesAmt)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-800">{formatRate(data.total.cyRate)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600">{formatK(data.total.pySalesAmt)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600">{formatRate(data.total.pyRate)}</td>
                    <td className={`py-2 px-2 text-right font-mono font-semibold ${
                      calcSalesYoy(data.total.cySalesAmt, data.total.pySalesAmt) && calcSalesYoy(data.total.cySalesAmt, data.total.pySalesAmt)! >= 1 ? 'text-emerald-600' : 'text-rose-600'
                    }`}>
                      {formatYoy(calcSalesYoy(data.total.cySalesAmt, data.total.pySalesAmt))}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono font-semibold ${
                      data.total.yoy && data.total.yoy >= 1 ? 'text-emerald-600' : 'text-rose-600'
                    }`}>
                      {formatYoy(data.total.yoy)}
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              ※ 판매율 = 누적 판매 TAG 금액 / (PO 수량 × TAG 단가) × 100
            </p>
          </div>
          
          {/* 우측: 차트 */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-xs font-medium text-gray-600">아이템별 판매율 차트</h4>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'rate' | 'sales')}
                className="text-xs border border-gray-300 rounded px-2 py-1"
              >
                <option value="rate">판매율순</option>
                <option value="sales">누적판매순</option>
              </select>
            </div>
            <div className="h-[320px] border border-gray-200 rounded-lg overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 20, right: 30, bottom: 60, left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="name" 
                    angle={-45} 
                    textAnchor="end" 
                    height={80}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis 
                    yAxisId="left" 
                    label={{ value: '판매율 (%)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis 
                    yAxisId="right" 
                    orientation="right"
                    label={{ value: 'YOY (%)', angle: 90, position: 'insideRight', style: { fontSize: 11 } }}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip 
                    contentStyle={{ fontSize: 12 }}
                    formatter={(value: number | undefined, name: string | undefined) => [
                      value !== undefined ? `${value.toFixed(1)}${name === 'rate' ? '%' : '%'}` : '-',
                      name === 'rate' ? '판매율' : 'YOY'
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="rate" fill="#3B82F6" name="당시즌 판매율" />
                  <Line yAxisId="right" dataKey="yoy" stroke="#F59E0B" strokeWidth={2} name="YOY" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
      
      {/* 아이템 상세 모달 */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setSelectedItem(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-purple-600 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">
                아이템 상세: {data?.items?.find(i => i.itemCd === selectedItem)?.itemNm || ''}
              </h3>
              <button onClick={() => setSelectedItem(null)} className="text-white hover:text-gray-200 text-3xl font-bold">×</button>
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
                      <th className="py-3 px-4 text-right font-semibold text-gray-700 border-b-2">당시즌 판매율</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700 border-b-2">전년 당시즌 판매율</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700 border-b-2">전년시즌 판매율</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700 border-b-2">YOY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemDetails.map((prod, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50'}>
                        <td className="py-2 px-4 text-gray-800 font-mono text-xs">{prod.prdtCd}</td>
                        <td className="py-2 px-4 text-gray-800">{prod.prdtNm}</td>
                        <td className="py-2 px-4 text-right text-gray-800 font-semibold">{formatRate(prod.cyRate)}</td>
                        <td className="py-2 px-4 text-right text-gray-600">{formatRate(prod.pyCurrentRate)}</td>
                        <td className="py-2 px-4 text-right text-gray-600">{formatRate(prod.pyRate)}</td>
                        <td className={`py-2 px-4 text-right font-semibold ${prod.yoy && prod.yoy >= 1 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatYoy(prod.yoy)}
                        </td>
                      </tr>
                    ))}
                    {itemDetails.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-gray-400">데이터가 없습니다.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
            
            <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
              총 {itemDetails.length}개 상품 | 당시즌 판매액 기준 내림차순
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BrandPlForecastPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const brandSlug = params.brand as string;

  // 초기값은 현재 월 (처음 대시보드 켤 때)
  const [ym, setYm] = useState(getCurrentYm());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showAccum, setShowAccum] = useState(true);
  
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

  // URL 쿼리 파라미터에서 ym 읽기 (마운트 시)
  useEffect(() => {
    const urlYm = searchParams.get('ym');
    if (urlYm) {
      setYm(urlYm);
    }
  }, [searchParams]);

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
    const params = new URLSearchParams(searchParams.toString());
    params.set('ym', newYm);
    router.push(`/pl-forecast/${brandSlug}?${params.toString()}`);
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
            <span className={
              line.id === 'cogs-sum' || line.id === 'gross-profit' || line.id === 'direct-cost-sum' || line.id === 'opex-sum' || line.id === 'operating-profit'
                ? 'text-indigo-600' 
                : line.isCalculated 
                  ? 'text-amber-600' 
                  : 'text-gray-800'
            }>
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
                  월중 손익예측 대시보드
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
                  <TierRegionTable data={data.tierRegionData} />
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
                    lastDt={data.lastDt}
                  />
                </div>
              ) : data && ['M', 'I', 'X', 'V', 'W'].includes(data.brand) ? (
                <div className="mt-6 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">의류 판매율</h3>
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
                <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                  <div className="flex items-center gap-2">
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
                    <h3 className="text-sm font-semibold text-gray-700">{brandLabel} 손익계산서</h3>
                  </div>
                </div>
                <div className="overflow-x-auto">
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
                      {data.lines && data.lines.length > 0 ? (
                        data.lines.map((line) => renderRow(line))
                      ) : (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-gray-400">
                            데이터가 없습니다.
                          </td>
                        </tr>
                      )}
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
