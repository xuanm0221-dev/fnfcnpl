'use client';

import React from 'react';
import type { ApiResponse, ClothingSalesData } from '@/lib/plforecast/types';
import {
  collectAnalysisData,
  generateProfitAnalysis,
  generateRetailSalesAnalysis,
  generateClothingSalesAnalysis,
  generateRiskAnalysis,
} from '@/lib/plforecast/analysis';

interface AnalysisCardProps {
  title: string;
  content: string[];
  variant?: 'default' | 'success' | 'warning' | 'info';
}

function AnalysisCard({ title, content, variant = 'default' }: AnalysisCardProps) {
  const variantStyles = {
    default: {
      headerBg: 'bg-gradient-to-r from-blue-50 to-indigo-50',
      borderColor: 'border-blue-200',
      accentColor: 'text-blue-600',
      iconBg: 'bg-blue-100',
    },
    success: {
      headerBg: 'bg-gradient-to-r from-emerald-50 to-teal-50',
      borderColor: 'border-emerald-200',
      accentColor: 'text-emerald-600',
      iconBg: 'bg-emerald-100',
    },
    warning: {
      headerBg: 'bg-gradient-to-r from-amber-50 to-orange-50',
      borderColor: 'border-amber-200',
      accentColor: 'text-amber-600',
      iconBg: 'bg-amber-100',
    },
    info: {
      headerBg: 'bg-gradient-to-r from-purple-50 to-pink-50',
      borderColor: 'border-purple-200',
      accentColor: 'text-purple-600',
      iconBg: 'bg-purple-100',
    },
  };

  const style = variantStyles[variant];

  // [[키워드]] 별 색상 (점당매출·채널 구조 분석용, 의류 판매 구조 분석용)
  const keywordColors: Record<string, string> = {
    'Trade Zone': 'text-blue-600',
    'Shop Level': 'text-blue-600',
    'Tier': 'text-blue-600',
    '지역': 'text-blue-600',
    '▲': 'text-yellow-500', // 발주·판매율 세모 (애매) - 채워진 삼각형
  };

  const renderLine = (line: string) => {
    const parts = line.split(/(\*\*.*?\*\*|\[\[.*?\]\])/g);
    return parts.map((part, partIdx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={partIdx} className={`font-semibold ${style.accentColor}`}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('[[') && part.endsWith(']]')) {
        const keyword = part.slice(2, -2);
        const colorClass = keywordColors[keyword] ?? style.accentColor;
        return (
          <span key={partIdx} className={`font-semibold ${colorClass}`}>
            {keyword}
          </span>
        );
      }
      return <span key={partIdx}>{part}</span>;
    });
  };

  return (
    <div className={`bg-white rounded-xl border-2 ${style.borderColor} shadow-md hover:shadow-lg transition-all duration-200 overflow-hidden`}>
      {/* 헤더 */}
      <div className={`${style.headerBg} px-4 py-3 border-b ${style.borderColor}`}>
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 ${style.iconBg} rounded-lg flex items-center justify-center`}>
            <svg className={`w-5 h-5 ${style.accentColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h4 className={`font-bold ${style.accentColor} text-sm`}>{title}</h4>
        </div>
      </div>
      
      {/* 본문 */}
      <div className="p-4 space-y-2.5 text-xs text-gray-700 leading-relaxed">
        {content.map((line, idx) => {
          const isIndented = line.startsWith('[[INDENT]]');
          const cleanLine = isIndented ? line.slice('[[INDENT]]'.length) : line;
          return (
            <p key={idx} className={isIndented ? 'pl-1 ml-4' : 'pl-1'}>
              {renderLine(cleanLine)}
            </p>
          );
        })}
      </div>
    </div>
  );
}

interface AnalysisSectionProps {
  data: ApiResponse;
  brandLabel: string;
  ym: string;
  seasons?: string[];
  clothingSalesSecondary?: ClothingSalesData | null;
}

export default function AnalysisSection({ data, brandLabel, ym, seasons, clothingSalesSecondary }: AnalysisSectionProps) {
  const analysisData = collectAnalysisData(data, brandLabel, ym);

  const isTransition = seasons && seasons.length === 2;
  // 전환월: seasons[0] = 이전 시즌(secondary), seasons[1] = 현재 시즌(primary)
  const primarySeason = isTransition ? seasons[1] : (seasons?.[0] ?? undefined);
  const secondarySeason = isTransition ? seasons[0] : undefined;

  const profitAnalysis = generateProfitAnalysis(
    analysisData.summary,
    analysisData.brandLabel,
    analysisData.isClosed
  );

  const retailSalesAnalysis = generateRetailSalesAnalysis(
    analysisData.retailSalesTable,
    analysisData.tierRegionData,
    analysisData.brandLabel,
    analysisData.isClosed
  );

  // 현재 시즌(primary) 의류 분석
  const clothingSalesAnalysis = generateClothingSalesAnalysis(
    analysisData.clothingSales,
    analysisData.brandLabel,
    analysisData.isClosed,
    isTransition ? primarySeason : undefined
  );

  // 이전 시즌(secondary) 의류 분석 - 전환월에만
  const clothingSalesAnalysisSecondary = isTransition && clothingSalesSecondary
    ? generateClothingSalesAnalysis(
        clothingSalesSecondary,
        analysisData.brandLabel,
        analysisData.isClosed,
        secondarySeason
      )
    : null;

  const riskAnalysis = generateRiskAnalysis(
    analysisData.summary,
    analysisData.retailSalesTable,
    analysisData.clothingSales,
    analysisData.brandLabel
  );

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-6 bg-gradient-to-b from-indigo-500 to-purple-500 rounded"></div>
        <h3 className="text-sm font-bold text-gray-800">AI 분석</h3>
      </div>
      
      {/* 카드 1: 손익 요약 분석 */}
      {profitAnalysis.length > 0 && (
        <AnalysisCard title="손익 요약 분석" content={profitAnalysis} variant="default" />
      )}

      {/* 카드 2: 점당매출 · 채널 구조 분석 */}
      {retailSalesAnalysis.length > 0 && (
        <AnalysisCard title="점당매출 · 채널 구조 분석" content={retailSalesAnalysis} variant="success" />
      )}

      {/* 카드 3-A: 현재 시즌 의류 판매 구조 분석 */}
      {clothingSalesAnalysis.length > 0 && (
        <AnalysisCard
          title={isTransition ? `상품(의류) 판매 구조 분석 — ${primarySeason}` : '상품(의류) 판매 구조 분석'}
          content={clothingSalesAnalysis}
          variant="info"
        />
      )}

      {/* 카드 3-B: 이전 시즌 의류 판매 구조 분석 (전환월에만) */}
      {clothingSalesAnalysisSecondary && clothingSalesAnalysisSecondary.length > 0 && (
        <AnalysisCard
          title={`상품(의류) 판매 구조 분석 — ${secondarySeason}`}
          content={clothingSalesAnalysisSecondary}
          variant="info"
        />
      )}

      {/* 카드 4: 리스크 & 체크포인트 (조건부) */}
      {riskAnalysis && riskAnalysis.length > 0 && (
        <AnalysisCard title="리스크 & 체크포인트" content={riskAnalysis} variant="warning" />
      )}
    </div>
  );
}
