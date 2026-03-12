'use client';

import React, { useState } from 'react';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface BrandAnalysis {
  kpi_bullets: string[];
  growth_points: string[];
  risks: string[];
  trade_zone: string[];
  sales_per_store: string[];
  category: string[];
  apparel_sellthrough: string[];
  top10_items: string[];
}

interface OverallAnalysis {
  headline: string;
  anomaly_notes: string[];
  growth_strategy: string[];
  risk_mitigation: string[];
  operational_improvements: string[];
}

interface AnalysisResult {
  BRANDS: {
    MLB: BrandAnalysis;
    MLB_KIDS: BrandAnalysis;
    DISCOVERY: BrandAnalysis;
  };
  OVERALL: OverallAnalysis;
}

interface AiAnalysisModalProps {
  ym: string;
  onClose: () => void;
}

// ── 파싱 헬퍼 ─────────────────────────────────────────────────────────────────

function parseKpiMetrics(kpiBullets: string[]): {
  retailSales: string;
  yoyMtd: string;
  yoyYtd: string;
  salesPerShop: string;
  apparelRate: string;
  apparelRateYoyColor: 'red' | 'green' | 'gray';
} {
  const text = (kpiBullets?.[0] || '') + ' ' + (kpiBullets?.join(' ') || '');
  const retailMatch = text.match(/(\d{1,3}(?:,\d{3})*)K/);
  const yoyMtdMatch = text.match(/(?:전년\s*대비|YoY)\s*[^\d]*?(-?\d+\.?\d*)%/);
  const yoyYtdMatch = text.match(/YTD[^(]*\([^)]*YoY\s*(-?\d+\.?\d*)%/) ||
    text.match(/YTD\s*[^Y]*(?:YoY\s*)?(-?\d+\.?\d*)%/) ||
    text.match(/YTD\s*[^(]*\([^)]*(-?\d+\.?\d*)%/) ||
    text.match(/YTD[^%\d]*(\d+\.?\d*)%(\s|$)/);
  const spMatch = text.match(/(\d{1,3}(?:,\d{3})*)위안/);
  const apparelMatch = text.match(/의류\s*판매율[^\d]*(\d+\.?\d*%)/);
  const apparelYoy = text.match(/의류\s*판매율[^(]*\((?:전년[^)]*)?(\d+\.?\d*%p|[-+]\d+\.?\d*%p|하락|개선)/);
  let apparelRateYoyColor: 'red' | 'green' | 'gray' = 'gray';
  if (apparelYoy) {
    const s = apparelYoy[1];
    if (s?.includes('하락') || s?.includes('-')) apparelRateYoyColor = 'red';
    else if (s?.includes('개선') || s?.includes('+')) apparelRateYoyColor = 'green';
  }
  const ytdVal = yoyYtdMatch?.[1] ?? yoyYtdMatch?.[2] ?? '';
  const yoyYtd = ytdVal ? ytdVal + '%' : '';
  return {
    retailSales: retailMatch ? retailMatch[1] + 'K' : '-',
    yoyMtd: yoyMtdMatch ? yoyMtdMatch[1] + '%' : '-',
    yoyYtd,
    salesPerShop: spMatch ? spMatch[1] + '위안' : '-',
    apparelRate: apparelMatch ? apparelMatch[1] : '-',
    apparelRateYoyColor,
  };
}

function parseTradeZoneBars(bullets: string[]): { zone: string; salesK: number; label: string }[] {
  const result: { zone: string; salesK: number; label: string }[] = [];
  for (const b of bullets || []) {
    const salesMatch = b.match(/(\d{1,3}(?:,\d{3})*)K/);
    const zoneMatch = b.match(/^([A-Z0-9-]+(?:\s+[A-Z0-9-]+)?)/);
    if (salesMatch && zoneMatch) {
      const salesK = parseInt(salesMatch[1].replace(/,/g, ''), 10) || 0;
      result.push({ zone: zoneMatch[1].trim(), salesK, label: b });
    }
  }
  return result;
}

function getRiskSeverity(bullet: string): 'critical' | 'watch' {
  const criticalPatterns = ['급락', '급등', '심각', '전면 재검토'];
  return criticalPatterns.some((p) => bullet.includes(p)) ? 'critical' : 'watch';
}

function sortRisks(bullets: string[]): string[] {
  return [...(bullets || [])].sort((a, b) =>
    getRiskSeverity(a) === 'critical' && getRiskSeverity(b) === 'watch' ? -1
    : getRiskSeverity(a) === 'watch' && getRiskSeverity(b) === 'critical' ? 1 : 0
  );
}

function isScaleUpBrand(kpiBullets: string[]): boolean {
  const text = (kpiBullets || []).join(' ');
  const storeIncreaseMatch = text.match(/매장수\s*[^\d]*(\d+)%/) || text.match(/(\d+)개\s*(?:에서|→|~)\s*(\d+)개/);
  if (storeIncreaseMatch) {
    const pct = parseInt(storeIncreaseMatch[1], 10);
    if (pct > 50) return true;
    if (storeIncreaseMatch[2]) {
      const prev = parseInt(storeIncreaseMatch[1], 10);
      const next = parseInt(storeIncreaseMatch[2], 10);
      if (prev > 0 && (next - prev) / prev > 0.5) return true;
    }
  }
  return false;
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────────────────────

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-6 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
        active
          ? 'border-indigo-600 text-indigo-700'
          : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-300'
      }`}
    >
      {label}
    </button>
  );
}

function BulletList({ bullets }: { bullets: string[] }) {
  if (!bullets?.length) return null;
  return (
    <ul className="space-y-2.5">
      {bullets.map((b, i) => (
        <li key={i} className="flex gap-2.5 text-sm text-gray-700 leading-relaxed">
          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-400" />
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}

/** YoY 배지: 당월 + YTD */
function YoYBadges({ mtd, ytd }: { mtd: string; ytd: string }) {
  if (mtd === '-' && !ytd) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
      {mtd !== '-' && (
        <span className="text-gray-500">
          <span className="font-medium text-gray-400">당월</span> {mtd}
        </span>
      )}
      {ytd && (
        <span className="text-gray-500">
          <span className="font-medium text-gray-400">YTD</span> {ytd}
        </span>
      )}
    </div>
  );
}

/** KPI 요약 카드 4개 */
function KpiSummaryCards({ kpiBullets }: { kpiBullets: string[] }) {
  if (!kpiBullets?.length) return null;
  const m = parseKpiMetrics(kpiBullets);
  const cards = [
    { label: '리테일 매출', value: m.retailSales, yoyMtd: m.yoyMtd, yoyYtd: m.yoyYtd },
    { label: 'YoY 성장률', value: m.yoyMtd, yoyMtd: m.yoyMtd, yoyYtd: m.yoyYtd },
    { label: '점당매출', value: m.salesPerShop, yoyMtd: m.yoyMtd, yoyYtd: m.yoyYtd },
    { label: '의류판매율', value: m.apparelRate, badgeColor: m.apparelRateYoyColor },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c, i) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs text-gray-500 font-medium mb-1">{c.label}</p>
          <p className="text-lg font-bold text-gray-900">{c.value}</p>
          {c.badgeColor ? (
            <span
              className={`inline-block mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                c.badgeColor === 'red' ? 'bg-red-100 text-red-700' : c.badgeColor === 'green' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {c.badgeColor === 'red' ? '↓ 하락' : c.badgeColor === 'green' ? '↑ 개선' : '-'}
            </span>
          ) : (
            <YoYBadges mtd={c.yoyMtd ?? '-'} ytd={c.yoyYtd ?? ''} />
          )}
        </div>
      ))}
    </div>
  );
}

/** 리스크 배지 + 정렬된 리스트 */
function RiskBulletList({ bullets }: { bullets: string[] }) {
  const sorted = sortRisks(bullets);
  if (!sorted.length) return null;
  return (
    <ul className="space-y-2.5">
      {sorted.map((b, i) => {
        const severity = getRiskSeverity(b);
        return (
          <li key={i} className="flex gap-2.5 text-sm text-gray-700 leading-relaxed items-start">
            <span
              className={`flex-shrink-0 mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
              }`}
            >
              {severity === 'critical' ? '🔴 Critical' : '🟡 Watch'}
            </span>
            <span>{b}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Trade Zone 수평 막대 차트 */
function TradeZoneBarChart({ bullets }: { bullets: string[] }) {
  const data = parseTradeZoneBars(bullets);
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.salesK), 1);
  const getColor = (zone: string) => {
    if (zone.startsWith('O')) return 'bg-orange-500';
    if (zone.startsWith('F')) return 'bg-blue-500';
    if (zone.startsWith('H')) return 'bg-purple-500';
    if (zone.startsWith('DX')) return 'bg-teal-500';
    return 'bg-indigo-500';
  };
  return (
    <div className="space-y-3 mb-4">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-16 flex-shrink-0 text-xs font-medium text-gray-700">{d.zone}</span>
          <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
            <div
              className={`h-full rounded ${getColor(d.zone)} transition-all`}
              style={{ width: `${(d.salesK / max) * 100}%`, minWidth: d.salesK > 0 ? '4px' : 0 }}
            />
          </div>
          <span className="w-20 flex-shrink-0 text-right text-xs font-semibold text-gray-700">
            {d.salesK.toLocaleString()}K
          </span>
        </div>
      ))}
    </div>
  );
}

/** 스케일업 브랜드 안내 배너 */
function ScaleUpNotice() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
      <span className="text-amber-600 text-lg flex-shrink-0">⚠️</span>
      <div className="text-sm text-amber-900">
        <p className="font-semibold mb-1">스케일업 단계 브랜드</p>
        <p className="leading-relaxed">
          점당매출보다 채널 커버리지 확대가 선행 지표입니다. 신규 출점 효과가 YoY 성장률에 포함되어 있어 LFL 기준 실질 성장률은 별도 검증이 필요합니다.
        </p>
      </div>
    </div>
  );
}

/** 색상 인사이트 박스 */
function InsightBox({
  title, items, color, icon,
}: {
  title: string;
  items: string[];
  color: 'green' | 'red' | 'yellow' | 'blue' | 'purple' | 'slate';
  icon?: React.ReactNode;
}) {
  if (!items?.length) return null;
  const s = {
    green:  { wrap: 'bg-emerald-50 border-emerald-200', head: 'text-emerald-800', dot: 'bg-emerald-500', text: 'text-gray-700' },
    red:    { wrap: 'bg-red-50 border-red-200',          head: 'text-red-800',     dot: 'bg-red-500',     text: 'text-gray-700' },
    yellow: { wrap: 'bg-amber-50 border-amber-200',      head: 'text-amber-800',   dot: 'bg-amber-500',   text: 'text-gray-700' },
    blue:   { wrap: 'bg-sky-50 border-sky-200',          head: 'text-sky-800',     dot: 'bg-sky-500',     text: 'text-gray-700' },
    purple: { wrap: 'bg-violet-50 border-violet-200',    head: 'text-violet-800',  dot: 'bg-violet-500',  text: 'text-gray-700' },
    slate:  { wrap: 'bg-slate-50 border-slate-200',      head: 'text-slate-700',   dot: 'bg-slate-400',   text: 'text-gray-700' },
  }[color];
  return (
    <div className={`rounded-xl border px-5 py-4 ${s.wrap}`}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <p className={`text-xs font-bold tracking-widest uppercase ${s.head}`}>{title}</p>
      </div>
      <ul className="space-y-2">
        {items.map((b, i) => (
          <li key={i} className={`flex gap-2.5 text-sm leading-relaxed ${s.text}`}>
            <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${s.dot}`} />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 번호+제목 섹션 카드 (아코디언) */
function SectionCard({
  num, title, children, collapsible = false, defaultOpen = true,
}: {
  num?: number | string;
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(collapsible ? defaultOpen : true);
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div
        className={`flex items-center justify-between px-5 py-3.5 bg-gray-50/80 border-b border-gray-100 ${collapsible ? 'cursor-pointer hover:bg-gray-100/80' : ''}`}
        onClick={collapsible ? () => setOpen(!open) : undefined}
      >
        <div className="flex items-center gap-3">
          {num !== undefined && (
            <span className="h-6 w-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
              {num}
            </span>
          )}
          <h4 className="text-sm font-bold text-gray-800">{title}</h4>
        </div>
        {collapsible && (
          <svg className={`h-4 w-4 text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
      {open && <div className="px-5 py-4">{children}</div>}
    </div>
  );
}

/** 액션 아이템 (Strategy 섹션용) */
function ActionItem({ num, text }: { num: number; text: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="flex-shrink-0 h-6 w-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
        {num}
      </span>
      <p className="text-sm text-gray-700 leading-relaxed">{text}</p>
    </div>
  );
}

/** 로딩 */
function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5">
      <div className="relative h-14 w-14">
        <div className="absolute inset-0 rounded-full border-4 border-indigo-100" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-600 animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-gray-700">AI 분석 생성 중</p>
        <p className="text-xs text-gray-400 mt-1">데이터 수집 및 분석 · 약 30~90초 소요</p>
      </div>
    </div>
  );
}

// ── 브랜드 탭 (MLB / MLB KIDS / DISCOVERY) ───────────────────────────────────

function BrandTab({ data }: { data: BrandAnalysis }) {
  const showScaleUpNotice = isScaleUpBrand(data.kpi_bullets || []);

  return (
    <div className="space-y-4">
      {/* 스케일업 단계 배너 */}
      {showScaleUpNotice && <ScaleUpNotice />}

      {/* 채널 안내 배너 */}
      <div className="rounded-lg border border-blue-400 bg-blue-50 px-4 py-3 flex items-start gap-2.5">
        <svg className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm font-semibold text-blue-900">
          리테일 매출 · 점당매출 · Trade Zone 데이터는 <span className="font-bold underline decoration-blue-400">오프라인 대리상(OFF) 채널</span> 기준입니다.
        </p>
      </div>

      {/* KPI 요약 카드 4개 */}
      {data.kpi_bullets?.length > 0 && <KpiSummaryCards kpiBullets={data.kpi_bullets} />}

      {/* 핵심 KPI */}
      {data.kpi_bullets?.length > 0 && (
        <InsightBox
          title="핵심 KPI"
          items={data.kpi_bullets}
          color="slate"
          icon={
            <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          }
        />
      )}

      {/* 성장 포인트 */}
      {data.growth_points?.length > 0 && (
        <InsightBox
          title="성장 포인트"
          items={data.growth_points}
          color="green"
          icon={
            <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
      )}

      {/* 리스크 (배지 + 정렬) */}
      {data.risks?.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="h-4 w-4 text-red-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
            </svg>
            <p className="text-xs font-bold text-red-800 uppercase tracking-widest">리스크 & 주의사항</p>
          </div>
          <RiskBulletList bullets={data.risks} />
        </div>
      )}

      {/* Trade Zone (막대차트 + 아코디언) */}
      {data.trade_zone?.length > 0 && (
        <SectionCard num={1} title="Trade Zone 분석" collapsible defaultOpen={true}>
          <TradeZoneBarChart bullets={data.trade_zone} />
          <BulletList bullets={data.trade_zone} />
        </SectionCard>
      )}

      {/* 점당매출 */}
      {data.sales_per_store?.length > 0 && (
        <SectionCard num={2} title="점당매출 분석" collapsible defaultOpen={true}>
          <BulletList bullets={data.sales_per_store} />
        </SectionCard>
      )}

      {/* 카테고리 */}
      {data.category?.length > 0 && (
        <SectionCard num={3} title="카테고리 분석" collapsible defaultOpen={true}>
          <BulletList bullets={data.category} />
        </SectionCard>
      )}

      {/* 의류 판매율 */}
      {data.apparel_sellthrough?.length > 0 && (
        <SectionCard num={4} title="의류 판매율 분석" collapsible defaultOpen={true}>
          <BulletList bullets={data.apparel_sellthrough} />
        </SectionCard>
      )}

      {/* Top 10 아이템 */}
      {data.top10_items?.length > 0 && (
        <SectionCard num={5} title="Top 10 아이템 분석" collapsible defaultOpen={true}>
          <BulletList bullets={data.top10_items} />
        </SectionCard>
      )}
    </div>
  );
}

/** 브랜드 비교 테이블 */
function BrandComparisonTable({ brands }: { brands: AnalysisResult['BRANDS'] }) {
  const rows = [
    { key: 'retailSales', label: '리테일 매출' },
    { key: 'yoyMtd', label: '당월 YoY' },
    { key: 'yoyYtd', label: 'YTD YoY' },
    { key: 'salesPerShop', label: '점당매출' },
    { key: 'apparelRateYoy', label: '의류판매율 YoY' },
  ] as const;
  const brandKeys = ['MLB', 'MLB_KIDS', 'DISCOVERY'] as const;
  const labels: Record<string, string> = { MLB: 'MLB', MLB_KIDS: 'MLB KIDS', DISCOVERY: 'DISCOVERY' };

  const extract = (kpi: string[]) => {
    const m = parseKpiMetrics(kpi || []);
    const text = (kpi || []).join(' ');
    const apparelYoyMatch = text.match(/의류\s*판매율[^(]*\([^)]*([-+]?\d+\.?\d*%p)/);
    return {
      retailSales: m.retailSales,
      yoyMtd: m.yoyMtd,
      yoyYtd: m.yoyYtd,
      salesPerShop: m.salesPerShop,
      apparelRateYoy: apparelYoyMatch ? apparelYoyMatch[1] : '-',
    };
  };

  const fallback = { retailSales: '-', yoyMtd: '-', yoyYtd: '-', salesPerShop: '-', apparelRateYoy: '-' };
  const data: Record<string, Record<string, string>> = {};
  for (const b of brandKeys) {
    const d = brands?.[b];
    const ex = d ? extract(d.kpi_bullets || []) : null;
    data[b] = ex ? { ...ex, yoyYtd: ex.yoyYtd || '-' } : fallback;
  }

  const isPositive = (v: string) => v && v !== '-' && !v.startsWith('-');
  const isNegative = (v: string) => v && v.startsWith('-');
  const colorKeys = ['yoyMtd', 'yoyYtd', 'apparelRateYoy'];

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden mb-6">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <p className="text-xs font-bold text-gray-600 uppercase tracking-widest">브랜드별 KPI 비교</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 font-semibold text-gray-700 w-28">항목</th>
              {brandKeys.map((b) => (
                <th key={b} className="px-4 py-3 font-semibold text-gray-700 text-center">
                  {labels[b]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-gray-100 hover:bg-gray-50/50">
                <td className="px-4 py-2.5 font-medium text-gray-700">{r.label}</td>
                {brandKeys.map((b) => {
                  const v = data[b]?.[r.key] || '-';
                  const applyColor = colorKeys.includes(r.key);
                  const color = applyColor && isPositive(v) ? 'text-emerald-600' : applyColor && isNegative(v) ? 'text-red-600' : '';
                  return (
                    <td key={b} className={`px-4 py-2.5 text-center ${color}`}>
                      {v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 전체 탭 (OVERALL) ─────────────────────────────────────────────────────────

function OverallTab({ data, brands }: { data: OverallAnalysis; brands: AnalysisResult['BRANDS'] }) {
  const hasAnomaly = data.anomaly_notes?.length > 0;

  return (
    <div className="space-y-4">
      {/* 브랜드 비교 테이블 */}
      {brands && <BrandComparisonTable brands={brands} />}

      {/* 헤드라인 */}
      <div className="rounded-xl bg-slate-800 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1.5">법인 종합 요약</p>
            <h3 className="text-base font-bold text-white leading-snug">{data.headline}</h3>
          </div>
          {hasAnomaly && (
            <span className="flex-shrink-0 mt-1 rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white">주의</span>
          )}
        </div>
      </div>

      {/* 이상감지 */}
      {hasAnomaly && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <div className="flex items-center gap-2 mb-2">
            <svg className="h-4 w-4 text-red-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
            </svg>
            <p className="text-xs font-bold text-red-700 uppercase tracking-widest">이상징후 탐지</p>
          </div>
          <ul className="space-y-1.5">
            {data.anomaly_notes.map((a, i) => (
              <li key={i} className="flex gap-2 text-sm text-red-700">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-red-500 flex-shrink-0" />
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Strategy & Action Plan */}
      <div className="pt-1">
        <div className="rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-6 py-4 mb-4">
          <p className="text-xs text-violet-200 uppercase tracking-widest font-semibold mb-1">Strategy & Action Plan</p>
          <p className="text-sm text-violet-100 leading-snug">3개 브랜드 통합 전략 및 실행 과제</p>
        </div>

        <div className="space-y-4">
          {data.growth_strategy?.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
              <p className="text-xs font-bold text-emerald-800 uppercase tracking-widest mb-3">성장 확대 전략</p>
              <div className="space-y-3">
                {data.growth_strategy.map((a, i) => <ActionItem key={i} num={i + 1} text={a} />)}
              </div>
            </div>
          )}

          {data.risk_mitigation?.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
              <p className="text-xs font-bold text-red-800 uppercase tracking-widest mb-3">리스크 대응 전략</p>
              <div className="space-y-3">
                {data.risk_mitigation.map((a, i) => <ActionItem key={i} num={i + 1} text={a} />)}
              </div>
            </div>
          )}

          {data.operational_improvements?.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-widest mb-3">운영 개선 과제</p>
              <div className="space-y-3">
                {data.operational_improvements.map((a, i) => <ActionItem key={i} num={i + 1} text={a} />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── HTML 리포트 생성 (다운로드용) ───────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bulletsToHtml(bullets: string[]): string {
  if (!bullets?.length) return '';
  return `<ul class="list-none space-y-2 my-2">${bullets.map((b) => `<li class="flex gap-2 text-sm text-gray-700"><span class="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0"></span><span>${escapeHtml(b)}</span></li>`).join('')}</ul>`;
}

function sectionHtml(title: string, content: string): string {
  if (!content) return '';
  return `<div class="rounded-xl border border-gray-200 bg-white p-5 mb-4"><h4 class="text-sm font-bold text-gray-800 mb-3">${escapeHtml(title)}</h4>${content}</div>`;
}

function generateReportHtml(analysis: AnalysisResult, baseDate: string): string {
  const brandLabels: Record<string, string> = { MLB: 'MLB', MLB_KIDS: 'MLB KIDS', DISCOVERY: 'DISCOVERY' };
  let body = '';

  for (const [key, label] of Object.entries(brandLabels)) {
    const d = analysis.BRANDS?.[key as keyof typeof analysis.BRANDS];
    if (!d) continue;
    body += `<section class="mb-12"><h2 class="text-xl font-bold text-indigo-700 mb-6 pb-2 border-b-2 border-indigo-200">${label}</h2>`;
    body += sectionHtml('핵심 KPI', bulletsToHtml(d.kpi_bullets || []));
    body += sectionHtml('성장 포인트', bulletsToHtml(d.growth_points || []));
    body += sectionHtml('리스크 & 주의사항', bulletsToHtml(d.risks || []));
    body += sectionHtml('Trade Zone 분석', bulletsToHtml(d.trade_zone || []));
    body += sectionHtml('점당매출 분석', bulletsToHtml(d.sales_per_store || []));
    body += sectionHtml('카테고리 분석', bulletsToHtml(d.category || []));
    body += sectionHtml('의류 판매율 분석', bulletsToHtml(d.apparel_sellthrough || []));
    body += sectionHtml('Top 10 아이템 분석', bulletsToHtml(d.top10_items || []));
    body += '</section>';
  }

  const o = analysis.OVERALL;
  body += `<section class="mb-12"><h2 class="text-xl font-bold text-indigo-700 mb-6 pb-2 border-b-2 border-indigo-200">전체 전략</h2>`;
  // 브랜드 비교 테이블
  const brandKeys = ['MLB', 'MLB_KIDS', 'DISCOVERY'] as const;
  const extract = (kpi: string[]) => {
    const m = parseKpiMetrics(kpi || []);
    const text = (kpi || []).join(' ');
    const apparelYoy = text.match(/의류\s*판매율[^(]*\([^)]*([-+]?\d+\.?\d*%p)/);
    return {
      retailSales: m.retailSales,
      yoyMtd: m.yoyMtd,
      yoyYtd: m.yoyYtd || '-',
      salesPerShop: m.salesPerShop,
      apparelRateYoy: apparelYoy ? apparelYoy[1] : '-',
    };
  };
  const tableRows = [
    { key: 'retailSales', label: '리테일 매출' },
    { key: 'yoyMtd', label: '당월 YoY' },
    { key: 'yoyYtd', label: 'YTD YoY' },
    { key: 'salesPerShop', label: '점당매출' },
    { key: 'apparelRateYoy', label: '의류판매율 YoY' },
  ];
  let tableHtml = '<div class="rounded-xl border border-gray-200 bg-white overflow-hidden mb-6"><div class="px-4 py-3 bg-gray-50 border-b border-gray-200"><p class="text-xs font-bold text-gray-600 uppercase tracking-widest">브랜드별 KPI 비교</p></div><table class="w-full text-sm"><thead><tr class="bg-gray-50 border-b"><th class="text-left px-4 py-3 font-semibold text-gray-700 w-28">항목</th>';
  brandKeys.forEach((b) => { tableHtml += `<th class="px-4 py-3 font-semibold text-gray-700 text-center">${brandLabels[b]}</th>`; });
  tableHtml += '</tr></thead><tbody>';
  const dataMap: Record<string, Record<string, string>> = {};
  for (const b of brandKeys) {
    const brandData = analysis.BRANDS?.[b];
    const ex = brandData ? extract(brandData.kpi_bullets || []) : null;
    dataMap[b] = ex ? { ...ex, yoyYtd: ex.yoyYtd || '-' } : { retailSales: '-', yoyMtd: '-', yoyYtd: '-', salesPerShop: '-', apparelRateYoy: '-' };
  }
  for (const r of tableRows) {
    tableHtml += `<tr class="border-b"><td class="px-4 py-2.5 font-medium text-gray-700">${r.label}</td>`;
    for (const b of brandKeys) {
      const v = dataMap[b]?.[r.key] || '-';
      tableHtml += `<td class="px-4 py-2.5 text-center">${escapeHtml(String(v))}</td>`;
    }
    tableHtml += '</tr>';
  }
  tableHtml += '</tbody></table></div>';
  body += tableHtml;
  if (o?.headline) {
    body += `<div class="rounded-xl bg-slate-800 text-white p-6 mb-4"><p class="text-xs text-slate-400 uppercase tracking-widest mb-1.5">법인 종합 요약</p><h3 class="text-base font-bold">${escapeHtml(o.headline)}</h3></div>`;
  }
  if (o?.anomaly_notes?.length) {
    body += sectionHtml('이상징후 탐지', bulletsToHtml(o.anomaly_notes));
  }
  if (o?.growth_strategy?.length) {
    const items = o.growth_strategy.map((t, i) => `<div class="flex gap-3 my-2"><span class="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0">${i + 1}</span><p class="text-sm text-gray-700">${escapeHtml(t)}</p></div>`).join('');
    body += `<div class="rounded-xl border border-emerald-200 bg-emerald-50 p-5 mb-4"><h4 class="text-xs font-bold text-emerald-800 uppercase tracking-widest mb-3">성장 확대 전략</h4>${items}</div>`;
  }
  if (o?.risk_mitigation?.length) {
    const items = o.risk_mitigation.map((t, i) => `<div class="flex gap-3 my-2"><span class="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0">${i + 1}</span><p class="text-sm text-gray-700">${escapeHtml(t)}</p></div>`).join('');
    body += `<div class="rounded-xl border border-red-200 bg-red-50 p-5 mb-4"><h4 class="text-xs font-bold text-red-800 uppercase tracking-widest mb-3">리스크 대응 전략</h4>${items}</div>`;
  }
  if (o?.operational_improvements?.length) {
    const items = o.operational_improvements.map((t, i) => `<div class="flex gap-3 my-2"><span class="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0">${i + 1}</span><p class="text-sm text-gray-700">${escapeHtml(t)}</p></div>`).join('');
    body += `<div class="rounded-xl border border-amber-200 bg-amber-50 p-5 mb-4"><h4 class="text-xs font-bold text-amber-800 uppercase tracking-widest mb-3">운영 개선 과제</h4>${items}</div>`;
  }
  body += '</section>';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI 종합 분석 리포트 - ${escapeHtml(baseDate)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 p-8 text-gray-900">
  <header class="mb-10">
    <h1 class="text-2xl font-bold text-gray-900">AI 종합 분석 리포트</h1>
    <p class="text-sm text-gray-500 mt-1">기준월: ${escapeHtml(baseDate)} · 생성일: ${new Date().toLocaleDateString('ko-KR')}</p>
  </header>
  <main>${body}</main>
  <footer class="mt-12 pt-6 border-t border-gray-200 text-xs text-gray-400">Powered by Claude · AI 분석 리포트</footer>
</body>
</html>`;
}

function downloadReportAsHtml(analysis: AnalysisResult, baseDate: string) {
  const html = generateReportHtml(analysis, baseDate);
  const blob = new Blob(['\ufeff' + html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AI분석리포트_${baseDate || 'report'}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── 메인 모달 ─────────────────────────────────────────────────────────────────

export default function AiAnalysisModal({ ym, onClose }: AiAnalysisModalProps) {
  const [tab, setTab] = useState<'MLB' | 'MLB_KIDS' | 'DISCOVERY' | 'OVERALL'>('MLB');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [cached, setCached] = useState(false);
  const [baseDate, setBaseDate] = useState('');

  const fetchAnalysis = React.useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    try {
      const url = force ? `/api/analyze?ym=${ym}&force=true` : `/api/analyze?ym=${ym}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.error) { setError(json.error); }
      else {
        setAnalysis(json.analysis as AnalysisResult);
        setCached(json.cached === true);
        setBaseDate(json.base_date || ym);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }, [ym]);

  React.useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  const handleRegenerate = () => {
    if (!window.confirm('캐시를 무시하고 AI 분석을 재생성합니다.\n약 30~90초가 소요됩니다. 계속하시겠습니까?')) return;
    fetchAnalysis(true);
  };

  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* 모달 패널 — 70vw × 70vh */}
      <div
        className="relative flex flex-col bg-gray-50 rounded-2xl shadow-2xl overflow-hidden"
        style={{ width: '70vw', height: '70vh', minWidth: '680px', minHeight: '500px' }}
      >
        {/* 헤더 */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">AI 종합 분석 리포트</h2>
              {baseDate && (
                <p className="text-xs text-gray-400">
                  기준월: {baseDate}
                  {cached && <span className="ml-1.5 text-indigo-400">(캐시)</span>}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {analysis && (
              <button
                onClick={() => downloadReportAsHtml(analysis, baseDate || ym)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors"
                title="HTML 리포트 다운로드"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                HTML 다운로드
              </button>
            )}
            <button
              onClick={handleRegenerate}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="캐시 무시하고 AI 재분석"
            >
              <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              재생성
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 탭 바 */}
        {!loading && !error && analysis && (
          <div className="flex-shrink-0 flex gap-0 px-6 bg-white border-b border-gray-200 overflow-x-auto">
            <TabBtn label="MLB" active={tab === 'MLB'} onClick={() => setTab('MLB')} />
            <TabBtn label="MLB KIDS" active={tab === 'MLB_KIDS'} onClick={() => setTab('MLB_KIDS')} />
            <TabBtn label="DISCOVERY" active={tab === 'DISCOVERY'} onClick={() => setTab('DISCOVERY')} />
            <TabBtn label="전체 전략" active={tab === 'OVERALL'} onClick={() => setTab('OVERALL')} />
          </div>
        )}

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && <LoadingState />}

          {error && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="rounded-full bg-red-50 p-4">
                <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-700">분석 오류</p>
              <p className="text-xs text-gray-500 text-center max-w-sm">{error}</p>
            </div>
          )}

          {!loading && !error && analysis && (
            <>
              {tab === 'MLB' && analysis.BRANDS?.MLB && (
                <BrandTab data={analysis.BRANDS.MLB} />
              )}
              {tab === 'MLB_KIDS' && analysis.BRANDS?.MLB_KIDS && (
                <BrandTab data={analysis.BRANDS.MLB_KIDS} />
              )}
              {tab === 'DISCOVERY' && analysis.BRANDS?.DISCOVERY && (
                <BrandTab data={analysis.BRANDS.DISCOVERY} />
              )}
              {tab === 'OVERALL' && analysis.OVERALL && (
                <OverallTab data={analysis.OVERALL} brands={analysis.BRANDS} />
              )}
            </>
          )}
        </div>

        {/* 푸터 */}
        {!loading && !error && analysis && (
          <div className="flex-shrink-0 px-6 py-3 bg-white border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-400">Powered by Claude · 데이터 변경 시 자동 재분석</p>
            <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-700 underline">닫기</button>
          </div>
        )}
      </div>
    </div>
  );
}
