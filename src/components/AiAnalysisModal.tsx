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

/** 번호+제목 섹션 카드 */
function SectionCard({
  num, title, children, collapsible = false,
}: {
  num?: number | string;
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
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
  return (
    <div className="space-y-4">
      {/* 채널 안내 배너 */}
      <div className="rounded-lg border border-blue-400 bg-blue-50 px-4 py-3 flex items-start gap-2.5">
        <svg className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm font-semibold text-blue-900">
          리테일 매출 · 점당매출 · Trade Zone 데이터는 <span className="font-bold underline decoration-blue-400">오프라인 대리상(OFF) 채널</span> 기준입니다.
        </p>
      </div>

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

      {/* 리스크 */}
      {data.risks?.length > 0 && (
        <InsightBox
          title="리스크 & 주의사항"
          items={data.risks}
          color="red"
          icon={
            <svg className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
            </svg>
          }
        />
      )}

      {/* Trade Zone */}
      {data.trade_zone?.length > 0 && (
        <SectionCard num={1} title="Trade Zone 분석">
          <BulletList bullets={data.trade_zone} />
        </SectionCard>
      )}

      {/* 점당매출 */}
      {data.sales_per_store?.length > 0 && (
        <SectionCard num={2} title="점당매출 분석">
          <BulletList bullets={data.sales_per_store} />
        </SectionCard>
      )}

      {/* 카테고리 */}
      {data.category?.length > 0 && (
        <SectionCard num={3} title="카테고리 분석">
          <BulletList bullets={data.category} />
        </SectionCard>
      )}

      {/* 의류 판매율 */}
      {data.apparel_sellthrough?.length > 0 && (
        <SectionCard num={4} title="의류 판매율 분석">
          <BulletList bullets={data.apparel_sellthrough} />
        </SectionCard>
      )}

      {/* Top 10 아이템 */}
      {data.top10_items?.length > 0 && (
        <SectionCard num={5} title="Top 10 아이템 분석">
          <BulletList bullets={data.top10_items} />
        </SectionCard>
      )}
    </div>
  );
}

// ── 전체 탭 (OVERALL) ─────────────────────────────────────────────────────────

function OverallTab({ data }: { data: OverallAnalysis }) {
  const hasAnomaly = data.anomaly_notes?.length > 0;

  return (
    <div className="space-y-4">
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

// ── 메인 모달 ─────────────────────────────────────────────────────────────────

export default function AiAnalysisModal({ ym, onClose }: AiAnalysisModalProps) {
  const [tab, setTab] = useState<'MLB' | 'MLB_KIDS' | 'DISCOVERY' | 'OVERALL'>('MLB');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [cached, setCached] = useState(false);
  const [baseDate, setBaseDate] = useState('');

  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/analyze?ym=${ym}`);
        if (cancelled) return;
        const json = await res.json();
        if (json.error) { setError(json.error); }
        else {
          setAnalysis(json.analysis as AnalysisResult);
          setCached(json.cached === true);
          setBaseDate(json.base_date || ym);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '알 수 없는 오류');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [ym]);

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
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
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
                <OverallTab data={analysis.OVERALL} />
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
