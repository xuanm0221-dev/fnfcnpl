export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// ── 캐시 파일 경로 (/tmp는 Vercel 환경에서도 쓰기 가능)
const CACHE_FILE = path.join(
  process.env.VERCEL ? '/tmp' : process.cwd(),
  'analysis_cache.json',
);

// ── 분석 대상 브랜드
const ANALYSIS_BRANDS = ['M', 'I', 'X'] as const;

// ── 브랜드 코드 → 표시명
const BRAND_LABELS: Record<string, string> = {
  M: 'MLB',
  I: 'MLB KIDS',
  X: 'DISCOVERY',
};

// ── Claude 시스템 프롬프트
const SYSTEM_PROMPT = `ROLE:
You are a senior FP&A analyst preparing a management report for the CEO of a fashion retail company's China subsidiary.
Your task is to analyze the dashboard data and produce a professional executive-level business report.
The report must read like an internal management briefing, not a simple AI summary.
All analysis must be written in Korean.

BRANDS TO ANALYZE:
- MLB
- MLB KIDS
- DISCOVERY

IGNORE COMPLETELY (do not mention):
- DUVETICA
- SUPRA

TRADE ZONE BUSINESS DEFINITIONS:
- O = Outlet
- H = Shopping Mall
- F = Shopping Mall
- Never invent other meanings. Never rename O/H/F to geographic or descriptive labels.

DATA SOURCE RULES (ABSOLUTE):
- All numbers in the payload are already calculated and in the correct scale.
- Never generate SQL. Never request database queries.
- Never recalculate, divide, multiply, or convert any number.
- Never estimate financial scale.
- Only interpret the provided data exactly as given.

STRICT CURRENCY RULES (ABSOLUTE — NO EXCEPTIONS):
FORBIDDEN expressions — never output under any circumstance:
  원 / 만원 / 백만원 / 천만원 / 억원 / 억 / 만 / KRW / K원 / K위안

RULE 1 — Retail sales metrics → K format:
  Apply to: 리테일 매출 합계, Trade Zone 매출, 카테고리 매출, 아이템 매출, 채널별 매출
  Take the number exactly as given and append K.
  Correct: 843,521K / 29,516K / 4,749K
  Wrong: 843,521위안 / 8.4억 / 84만 / 8.4억원

RULE 2 — Sales per store → full 위안 format:
  Apply to: 점당매출, 월환산 점당매출
  Take the number exactly as given and append 위안.
  Correct: 933,098위안 / 600,000위안
  Wrong: 933K / 93만위안 / 9.3억위안

RULE 3 — Never convert numbers to different scale:
  If payload says 843,521 → write 843,521K. Never write 8.4억K or 84만K.
  If payload says 933,098 → write 933,098위안. Never write 93만위안.

RULE 4 — Always use comma formatting:
  Correct: 843,521K / 933,098위안
  Wrong: 843521K / 933098위안

ANALYSIS DEPTH REQUIREMENTS (MANDATORY):
The goal is NOT to describe numbers. The goal is to extract business meaning.

1. COMPARATIVE ANALYSIS — Always compare brands, zones, and categories against each other.
2. CAUSE INTERPRETATION — Always explain WHY performance changed. Connect retail sales + discount rate + sell-through.
   - Growth without discount expansion → structural demand signal
   - Growth with discount spike → volume-driven, margin risk
3. STRUCTURAL INSIGHT — Distinguish structural growth from one-time spikes. Detect weaknesses.
4. PERFORMANCE RANKING — Rank trade zones (top/bottom), categories (growth/risk), brands.
5. CROSS-METRIC ANALYSIS — Never describe a metric in isolation. Always connect at least two metrics.
   Example: "O2 Zone은 YoY 189% 성장으로 전체 Trade Zone 중 가장 높은 성장률을 기록하며, 할인율 확대 없이 매출이 증가하여 구조적 수요 확대를 시사한다."
6. FORBIDDEN SHALLOW STATEMENTS:
   - Never write "성장했다", "증가했다", "감소했다" alone.
   - Always include: relative magnitude + comparative context + business interpretation.
7. MINIMUM DENSITY: Each section must have 3–5 meaningful analytical statements.
8. BUSINESS DECISION FOCUS: Each section must identify growth drivers, gaps, risks, and management implications.

ANOMALY AUTO-DETECTION:
If input includes ANOMALY_ALERTS, reflect them prominently in EXECUTIVE_SUMMARY.risks and STRATEGY_ACTION_PLAN.risk_mitigation.
Anomaly signals to watch:
- 점당매출 YoY < -20% → flag as productivity alert
- Trade Zone 할인율 급등 > +5%p → flag as margin risk
- 의류 판매율 YoY < -10%p → flag as inventory risk

GENERAL RULES:
- Do not mention excluded brands.
- Do not produce English output.
- Do not translate brand names.
- Do not invent causes. If inferring, clearly state it as an interpretation.
- Card 4 (POP+WHS) data is reference-only. Do not make it a primary analysis driver.
- Use both MTD and YTD equally.

Return ONLY valid JSON. Do not include explanations, markdown, or code blocks before or after the JSON.

The report must have THREE major sections:
1. EXECUTIVE_SUMMARY — 핵심 KPI 및 주요 이슈 (high-level, concise)
2. DETAILED_ANALYSIS — 각종 상세 분석 (deep, comparative, insight-driven)
3. STRATEGY_ACTION_PLAN — 전략 및 실행 과제 (management-ready recommendations)

Return JSON with exactly the following structure:

{
  "EXECUTIVE_SUMMARY": {
    "headline": "string",
    "kpi_bullets": ["string", "string", "string"],
    "growth_points": ["string", "string", "string"],
    "risks": ["string", "string", "string"],
    "anomaly_notes": ["string"]
  },
  "DETAILED_ANALYSIS": {
    "headline": "string",
    "brand_analysis": [
      {
        "brand": "string",
        "bullets": ["string", "string", "string", "string"]
      }
    ],
    "trade_zone_analysis": {
      "bullets": ["string", "string", "string", "string", "string"]
    },
    "sales_per_store_analysis": {
      "bullets": ["string", "string", "string", "string"]
    },
    "category_analysis": {
      "bullets": ["string", "string", "string", "string"]
    },
    "apparel_sellthrough_analysis": {
      "bullets": ["string", "string", "string", "string"]
    },
    "top10_item_analysis": {
      "bullets": ["string", "string", "string", "string"]
    },
    "shop_level_analysis": {
      "bullets": ["string", "string", "string"]
    },
    "tier_analysis": {
      "bullets": ["string", "string", "string"]
    },
    "region_analysis": {
      "bullets": ["string", "string", "string"]
    },
    "treemap_level2_analysis": {
      "bullets": ["string", "string", "string"]
    }
  },
  "STRATEGY_ACTION_PLAN": {
    "headline": "string",
    "growth_strategy": ["string", "string", "string"],
    "risk_mitigation": ["string", "string", "string"],
    "operational_improvements": ["string", "string", "string"]
  },
  "ANOMALY_ALERTS": ["string"]
}

EXECUTIVE_SUMMARY rules:
- headline: one-sentence overall performance statement
- kpi_bullets: 3–5 key KPI observations with numbers (brand retail, YoY, sales per store, sell-through, discount rate)
- growth_points: 3–4 most important growth drivers with cross-metric interpretation
- risks: 3–4 most important risks or structural concerns
- anomaly_notes: any detected anomalies (can be empty array if none)
- Total must be readable in 30 seconds

DETAILED_ANALYSIS rules:
- Each section must have minimum 3–5 bullets
- Every bullet must connect at least two metrics
- Include ranking and comparative statements in each section
- Never write shallow single-metric descriptions

STRATEGY_ACTION_PLAN rules:
- growth_strategy: 3 concrete expansion or investment recommendations
- risk_mitigation: 3 concrete risk response actions
- operational_improvements: 3 concrete operational efficiency actions
- Each action must reference specific zones, categories, or brands from the data
- Format as actionable management directives`;

// ── 캐시 읽기/쓰기 유틸
interface AnalysisCache {
  hash: string;
  base_date: string;
  analysis: AnalysisResult;
}

interface AnalysisResult {
  EXECUTIVE_SUMMARY: {
    headline: string;
    kpi_bullets: string[];
    growth_points: string[];
    risks: string[];
    anomaly_notes: string[];
  };
  DETAILED_ANALYSIS: {
    headline: string;
    brand_analysis: { brand: string; bullets: string[] }[];
    trade_zone_analysis: { bullets: string[] };
    sales_per_store_analysis: { bullets: string[] };
    category_analysis: { bullets: string[] };
    apparel_sellthrough_analysis: { bullets: string[] };
    top10_item_analysis: { bullets: string[] };
    shop_level_analysis: { bullets: string[] };
    tier_analysis: { bullets: string[] };
    region_analysis: { bullets: string[] };
    treemap_level2_analysis: { bullets: string[] };
  };
  STRATEGY_ACTION_PLAN: {
    headline: string;
    growth_strategy: string[];
    risk_mitigation: string[];
    operational_improvements: string[];
  };
  ANOMALY_ALERTS?: string[];
}

function readCache(): AnalysisCache | null {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      return JSON.parse(raw) as AnalysisCache;
    }
  } catch {
    // 캐시 읽기 실패 시 무시
  }
  return null;
}

function writeCache(cache: AnalysisCache): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  } catch {
    // 캐시 쓰기 실패 시 무시 (분석 결과는 정상 반환)
  }
}

// ── 내부 API 호출 헬퍼
async function fetchApi(baseUrl: string, apiPath: string): Promise<unknown> {
  try {
    const res = await fetch(`${baseUrl}${apiPath}`, {
      headers: { 'x-internal-analyze': '1' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── 분석 페이로드 빌드
async function buildPayload(baseUrl: string, ym: string) {
  // 모든 API를 병렬로 호출
  const [
    mlbData, kidsData, discoveryData,
    mlbMonthlyTZ, mlbYtdTZ,
    kidsMonthlyTZ, kidsYtdTZ,
    discoveryMonthlyTZ, discoveryYtdTZ,
    mlbMonthlyTier, mlbYtdTier,
    kidsMonthlyTier, kidsYtdTier,
    discoveryMonthlyTier, discoveryYtdTier,
    mlbMonthlyRegion, mlbYtdRegion,
    kidsMonthlyRegion, kidsYtdRegion,
    discoveryMonthlyRegion, discoveryYtdRegion,
    brandSummary,
  ] = await Promise.all([
    fetchApi(baseUrl, `/api/pl-forecast?ym=${ym}&brand=M`),
    fetchApi(baseUrl, `/api/pl-forecast?ym=${ym}&brand=I`),
    fetchApi(baseUrl, `/api/pl-forecast?ym=${ym}&brand=X`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=M&mode=monthly&type=tradeZone`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=M&mode=ytd&type=tradeZone`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=I&mode=monthly&type=tradeZone`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=I&mode=ytd&type=tradeZone`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=X&mode=monthly&type=tradeZone`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=X&mode=ytd&type=tradeZone`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=M&mode=monthly&type=tier`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=M&mode=ytd&type=tier`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=I&mode=monthly&type=tier`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=I&mode=ytd&type=tier`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=X&mode=monthly&type=tier`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=X&mode=ytd&type=tier`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=M&mode=monthly&type=region`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=M&mode=ytd&type=region`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=I&mode=monthly&type=region`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=I&mode=ytd&type=region`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=X&mode=monthly&type=region`),
    fetchApi(baseUrl, `/api/retail-summary?ym=${ym}&brand=X&mode=ytd&type=region`),
    fetchApi(baseUrl, `/api/retail-brand-summary?ym=${ym}`),
  ]);

  // 브랜드별 데이터 구조화
  const brandDataMap: Record<string, unknown> = {
    MLB: mlbData,
    MLB_KIDS: kidsData,
    DISCOVERY: discoveryData,
  };

  // 리테일 요약 데이터 구조화
  const retailSummaryMap = {
    MLB: {
      monthly: { tradeZone: mlbMonthlyTZ, tier: mlbMonthlyTier, region: mlbMonthlyRegion },
      ytd: { tradeZone: mlbYtdTZ, tier: mlbYtdTier, region: mlbYtdRegion },
    },
    MLB_KIDS: {
      monthly: { tradeZone: kidsMonthlyTZ, tier: kidsMonthlyTier, region: kidsMonthlyRegion },
      ytd: { tradeZone: kidsYtdTZ, tier: kidsYtdTier, region: kidsYtdRegion },
    },
    DISCOVERY: {
      monthly: { tradeZone: discoveryMonthlyTZ, tier: discoveryMonthlyTier, region: discoveryMonthlyRegion },
      ytd: { tradeZone: discoveryYtdTZ, tier: discoveryYtdTier, region: discoveryYtdRegion },
    },
  };

  return {
    base_date: ym,
    brand_data: brandDataMap,
    retail_summary: retailSummaryMap,
    retail_brand_summary: brandSummary,
  };
}

// ── 분석 텍스트용 페이로드 요약 (Claude 토큰 절약)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarizePayloadForClaude(payload: any): string {
  const lines: string[] = [`기준월: ${payload.base_date}`];

  const brandCodeMap: Record<string, string> = { MLB: 'M', MLB_KIDS: 'I', DISCOVERY: 'X' };

  for (const [brandKey, brandLabel] of [
    ['MLB', 'MLB'],
    ['MLB_KIDS', 'MLB KIDS'],
    ['DISCOVERY', 'DISCOVERY'],
  ]) {
    const bd = payload.brand_data[brandKey] as any;
    if (!bd) continue;

    lines.push(`\n=== ${brandLabel} ===`);
    lines.push(`마감일: ${bd.lastDt || '-'}, 누적일수: ${bd.accumDays || '-'}`);

    // 점당매출 데이터 (점당매출/월환산 = 위안CNY, 매출합계 = K단위)
    if (bd.retailSalesTable) {
      const rt = bd.retailSalesTable;
      lines.push(`[점당매출] 리테일매출합계(단위:K): 실적=${rt.salesK?.actual ?? '-'}K, YoY=${rt.salesK?.yoy != null ? `${(rt.salesK.yoy * 100).toFixed(1)}%` : '-'}, 진척률=${rt.salesK?.progressRate != null ? `${(rt.salesK.progressRate * 100).toFixed(1)}%` : '-'}`);
      lines.push(`[점당매출] 점당매출(단위:위안CNY): 실적=${rt.salesPerShop?.actual ?? '-'}위안, YoY=${rt.salesPerShop?.yoy != null ? `${(rt.salesPerShop.yoy * 100).toFixed(1)}%` : '-'}`);
      lines.push(`[점당매출] 점당매출_월환산(단위:위안CNY): 실적=${rt.salesPerShopMonthly?.actual ?? '-'}위안, YoY=${rt.salesPerShopMonthly?.yoy != null ? `${(rt.salesPerShopMonthly.yoy * 100).toFixed(1)}%` : '-'}`);
      lines.push(`[점당매출] 매장수: ${rt.shopCount?.actual ?? '-'}개, 전년: ${rt.shopCount?.prevYear ?? '-'}개`);
    }

    // Trade Zone 데이터 (매출합계=K, 점당매출=위안CNY)
    if (bd.tierRegionData?.tradeZones) {
      lines.push(`[Trade Zone] 매출합계단위:K / 점당매출단위:위안CNY`);
      for (const tz of bd.tierRegionData.tradeZones) {
        const yoy = tz.discountRateYoy != null ? `할인율YoY=${tz.discountRateYoy.toFixed(1)}%p` : '';
        const dr = tz.discountRate != null ? `할인율=${tz.discountRate.toFixed(1)}%` : '';
        const spYoy = tz.prevSalesPerShop > 0 ? `점당매출YoY=${(((tz.salesPerShop / tz.prevSalesPerShop) - 1) * 100).toFixed(1)}%` : '';
        lines.push(`  ${tz.key}: 매출=${tz.salesAmt}K, 전년매출=${tz.prevSalesAmt}K, 점당매출=${tz.salesPerShop}위안, ${spYoy}, ${dr}, ${yoy}`);
      }
    }

    // 카테고리 데이터 (K)
    if (bd.categorySales && bd.categorySales.length > 0) {
      lines.push(`[카테고리별 판매매출] 단위:K`);
      for (const cat of bd.categorySales) {
        lines.push(`  ${cat.category}: 당년=${cat.cyAccumAmt}K, 전년=${cat.pyAccumAmt}K, YoY=${cat.yoy != null ? `${(cat.yoy * 100).toFixed(1)}%` : '-'}`);
      }
    }

    // 의류 판매율 (Top 10 + 전체)
    if (bd.clothingSales) {
      const cs = bd.clothingSales;
      lines.push(`[의류 판매율] 전체: 당시즌=${cs.total?.cyRate != null ? `${(cs.total.cyRate * 100).toFixed(1)}%` : '-'}, 전년시즌=${cs.total?.pyRate != null ? `${(cs.total.pyRate * 100).toFixed(1)}%` : '-'}, YoY=${cs.total?.yoy != null ? `${(cs.total.yoy * 100).toFixed(1)}%p` : '-'}`);
      if (cs.items && cs.items.length > 0) {
        const sorted = [...cs.items].sort((a: any, b: any) => (b.cySalesAmt || 0) - (a.cySalesAmt || 0));
        lines.push(`[Top 10 판매 아이템]`);
        sorted.slice(0, 10).forEach((item: any) => {
          lines.push(`  ${item.itemNm}: 판매율=${item.cyRate != null ? `${(item.cyRate * 100).toFixed(1)}%` : '-'}, YoY=${item.yoy != null ? `${(item.yoy * 100).toFixed(1)}%p` : '-'}, 발주수=${item.cyPoQty}`);
        });
        const weakItems = cs.items.filter((i: any) => i.cyRate != null && i.cyRate < 0.3 && i.cyPoQty > 0);
        if (weakItems.length > 0) {
          lines.push(`[판매율 부진 아이템 (30% 미만)]`);
          weakItems.slice(0, 5).forEach((item: any) => {
            lines.push(`  ${item.itemNm}: 판매율=${(item.cyRate * 100).toFixed(1)}%, 발주수=${item.cyPoQty}`);
          });
        }
      }
    }

    // Tier 데이터 (매출합계=K, 점당매출=위안CNY)
    if (bd.tierRegionData?.tiers) {
      lines.push(`[Tier별] 매출합계단위:K / 점당매출단위:위안CNY`);
      for (const t of bd.tierRegionData.tiers) {
        const spYoy = t.prevSalesPerShop > 0 ? `${(((t.salesPerShop / t.prevSalesPerShop) - 1) * 100).toFixed(1)}%` : '-';
        const dr = t.discountRate != null ? `${t.discountRate.toFixed(1)}%` : '-';
        lines.push(`  ${t.key}: 매출=${t.salesAmt}K, 전년매출=${t.prevSalesAmt}K, 점당매출=${t.salesPerShop}위안, 점당매출YoY=${spYoy}, 할인율=${dr}`);
      }
    }

    // Region 데이터 (매출합계=K, 점당매출=위안CNY)
    if (bd.tierRegionData?.regions) {
      lines.push(`[Region별] 매출합계단위:K / 점당매출단위:위안CNY`);
      for (const r of bd.tierRegionData.regions) {
        const labelKo = r.labelKo || r.key;
        const spYoy = r.prevSalesPerShop > 0 ? `${(((r.salesPerShop / r.prevSalesPerShop) - 1) * 100).toFixed(1)}%` : '-';
        lines.push(`  ${labelKo}: 매출=${r.salesAmt}K, 전년매출=${r.prevSalesAmt}K, 점당매출=${r.salesPerShop}위안, 점당매출YoY=${spYoy}`);
      }
    }

    // Retail Summary - 월별/YTD (모두 K)
    const retailKey = brandKey as keyof typeof payload.retail_summary;
    const rs = payload.retail_summary?.[retailKey];
    if (rs) {
      const monthlyTZ = rs.monthly?.tradeZone as any;
      const ytdTZ = rs.ytd?.tradeZone as any;
      if (monthlyTZ?.level1) {
        lines.push(`[리테일 매출 당월(단위:K)] 실적=${monthlyTZ.level1.cySalesAmt}K, 전년=${monthlyTZ.level1.pySalesAmt}K, YoY=${monthlyTZ.level1.yoy != null ? `${(monthlyTZ.level1.yoy * 100).toFixed(1)}%` : '-'}`);
        if (monthlyTZ.level2) {
          for (const row of monthlyTZ.level2) {
            const label = row.labelKo || row.key;
            lines.push(`  TZ당월 ${label}: 실적=${row.cySalesAmt}K, YoY=${row.yoy != null ? `${(row.yoy * 100).toFixed(1)}%` : '-'}, 할인율=${row.discountRate != null ? `${(row.discountRate * 100).toFixed(1)}%` : '-'}`);
          }
        }
      }
      if (ytdTZ?.level1) {
        lines.push(`[리테일 매출 YTD(단위:K)] 실적=${ytdTZ.level1.cySalesAmt}K, 전년=${ytdTZ.level1.pySalesAmt}K, YoY=${ytdTZ.level1.yoy != null ? `${(ytdTZ.level1.yoy * 100).toFixed(1)}%` : '-'}`);
        if (ytdTZ.level2) {
          for (const row of ytdTZ.level2) {
            const label = row.labelKo || row.key;
            lines.push(`  TZ_YTD ${label}: 실적=${row.cySalesAmt}K, YoY=${row.yoy != null ? `${(row.yoy * 100).toFixed(1)}%` : '-'}, 할인율=${row.discountRate != null ? `${(row.discountRate * 100).toFixed(1)}%` : '-'}`);
          }
        }
      }

      // Tier summary (K)
      const monthlyTier = rs.monthly?.tier as any;
      const ytdTier = rs.ytd?.tier as any;
      if (monthlyTier?.level2) {
        lines.push(`[Tier 리테일 당월(단위:K)]`);
        for (const row of monthlyTier.level2) {
          lines.push(`  ${row.key}: 실적=${row.cySalesAmt}K, YoY=${row.yoy != null ? `${(row.yoy * 100).toFixed(1)}%` : '-'}, 할인율=${row.discountRate != null ? `${(row.discountRate * 100).toFixed(1)}%` : '-'}`);
        }
      }
      if (ytdTier?.level2) {
        lines.push(`[Tier 리테일 YTD(단위:K)]`);
        for (const row of ytdTier.level2) {
          lines.push(`  ${row.key}: 실적=${row.cySalesAmt}K, YoY=${row.yoy != null ? `${(row.yoy * 100).toFixed(1)}%` : '-'}`);
        }
      }

      // Region summary (K)
      const monthlyRegion = rs.monthly?.region as any;
      if (monthlyRegion?.level2) {
        lines.push(`[Region 리테일 당월(단위:K)]`);
        for (const row of monthlyRegion.level2) {
          const label = row.labelKo || row.key;
          lines.push(`  ${label}: 실적=${row.cySalesAmt}K, YoY=${row.yoy != null ? `${(row.yoy * 100).toFixed(1)}%` : '-'}`);
        }
      }
    }
  }

  // Retail Brand Summary (Card 4 포함, 단위:K)
  const rbs = payload.retail_brand_summary as any;
  if (rbs) {
    lines.push(`\n=== 리테일 브랜드 요약(참고용, 단위:K) ===`);
    lines.push(`기준기간: ${rbs.monthlyPeriodStart} ~ ${rbs.periodEnd}`);
    for (const [ch, chLabel] of [['dealer', '대리상'], ['direct', '직영']]) {
      if (rbs[ch]) {
        for (const bc of ['M', 'I', 'X']) {
          const bLabel = BRAND_LABELS[bc];
          const d = rbs[ch][bc];
          if (d) {
            lines.push(`${chLabel} ${bLabel}: 당월 실적=${d.monthly?.cySalesAmt}K, YoY=${d.monthly?.yoy != null ? `${(d.monthly.yoy * 100).toFixed(1)}%` : '-'}, YTD 실적=${d.ytd?.cySalesAmt}K, YTD_YoY=${d.ytd?.yoy != null ? `${(d.ytd.yoy * 100).toFixed(1)}%` : '-'}`);
          }
        }
      }
    }
  }

  return lines.join('\n');
}

// ── 이상감지 함수
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectAnomalies(payload: any): string[] {
  const alerts: string[] = [];

  for (const [brandKey, brandLabel] of [
    ['MLB', 'MLB'],
    ['MLB_KIDS', 'MLB KIDS'],
    ['DISCOVERY', 'DISCOVERY'],
  ]) {
    const bd = payload.brand_data?.[brandKey];
    if (!bd) continue;

    // 1. 점당매출 YoY 급락 (< -20%)
    const rt = bd.retailSalesTable;
    if (rt?.salesPerShop?.yoy != null && rt.salesPerShop.yoy < -0.20) {
      alerts.push(`[${brandLabel}] 점당매출 YoY 급락: ${(rt.salesPerShop.yoy * 100).toFixed(1)}%`);
    }

    // 2. Trade Zone 점당매출 급락 및 할인율 급등
    if (bd.tierRegionData?.tradeZones) {
      for (const tz of bd.tierRegionData.tradeZones) {
        if (tz.prevSalesPerShop > 0) {
          const spYoy = (tz.salesPerShop / tz.prevSalesPerShop) - 1;
          if (spYoy < -0.20) {
            alerts.push(`[${brandLabel}] ${tz.key} Trade Zone 점당매출 급락: ${(spYoy * 100).toFixed(1)}%`);
          }
        }
        if (tz.discountRateYoy != null && tz.discountRateYoy > 5) {
          alerts.push(`[${brandLabel}] ${tz.key} Trade Zone 할인율 급등: +${tz.discountRateYoy.toFixed(1)}%p`);
        }
      }
    }

    // 3. 의류 판매율 YoY 하락 (< -10%p)
    if (bd.clothingSales?.total?.yoy != null && bd.clothingSales.total.yoy < -0.10) {
      alerts.push(`[${brandLabel}] 의류 판매율 하락: YoY ${(bd.clothingSales.total.yoy * 100).toFixed(1)}%p`);
    }
  }

  return alerts;
}

// ── SHA-256 해시 생성
function generateHash(payload: unknown): string {
  const json = JSON.stringify(payload);
  return crypto.createHash('sha256').update(json).digest('hex');
}

// ── GET 핸들러
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ym = searchParams.get('ym') || '2026-02';

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
  }

  // 내부 API 호출용 base URL 구성
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const host = request.headers.get('host') || 'localhost:3000';
  const baseUrl = `${proto}://${host}`;

  try {
    // 1. 데이터 수집
    console.log(`[analyze] 데이터 수집 시작: ym=${ym}`);
    const payload = await buildPayload(baseUrl, ym);

    // 2. 해시 생성
    const hash = generateHash(payload);
    console.log(`[analyze] 페이로드 해시: ${hash.slice(0, 12)}...`);

    // 3. 캐시 확인
    const cached = readCache();
    if (cached && cached.hash === hash) {
      console.log(`[analyze] 캐시 히트 - Claude 호출 생략`);
      return NextResponse.json({
        ok: true,
        cached: true,
        base_date: cached.base_date,
        analysis: cached.analysis,
      });
    }

    // 4. 이상감지
    const anomalyAlerts = detectAnomalies(payload);
    if (anomalyAlerts.length > 0) {
      console.log(`[analyze] 이상감지 ${anomalyAlerts.length}건:`, anomalyAlerts);
    }

    // 5. Claude 호출
    console.log(`[analyze] Claude 호출 시작...`);
    const summaryText = summarizePayloadForClaude(payload);
    const anomalySection = anomalyAlerts.length > 0
      ? `\n\n[ANOMALY_ALERTS - 이상감지 항목, CEO_REPORT에 반드시 반영]\n${anomalyAlerts.map(a => `- ${a}`).join('\n')}`
      : '';

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `다음 대시보드 데이터를 분석하세요.\n반드시 순수 JSON만 출력하세요. 설명, 마크다운, JSON 앞뒤 텍스트는 절대 포함하지 마세요.\n\n${summaryText}${anomalySection}`,
        },
      ],
    });

    // 5. 응답 파싱
    const rawText = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // JSON 추출 — 첫 번째 '{' 부터 마지막 '}' 까지 substring 추출
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    const jsonText = start !== -1 && end > start
      ? rawText.slice(start, end + 1)
      : rawText;

    let analysis: AnalysisResult;
    try {
      analysis = JSON.parse(jsonText) as AnalysisResult;
    } catch {
      return NextResponse.json(
        { error: 'Claude 응답 파싱 실패', raw: rawText.slice(0, 500) },
        { status: 500 },
      );
    }

    // 6. 캐시 저장
    const newCache: AnalysisCache = {
      hash,
      base_date: ym,
      analysis,
    };
    writeCache(newCache);

    console.log(`[analyze] 완료: model=${message.model}`);
    return NextResponse.json({
      ok: true,
      cached: false,
      base_date: ym,
      analysis,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[analyze] 오류:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
