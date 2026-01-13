'use client';

import React from 'react';
import type { ApiResponse } from '@/lib/plforecast/types';
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
          // **로 감싸진 부분을 굵게 표시
          const parts = line.split(/(\*\*.*?\*\*)/g);
          return (
            <p key={idx} className="pl-1">
              {parts.map((part, partIdx) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                  return (
                    <strong key={partIdx} className={`font-semibold ${style.accentColor}`}>
                      {part.slice(2, -2)}
                    </strong>
                  );
                }
                return <span key={partIdx}>{part}</span>;
              })}
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
}

export default function AnalysisSection({ data, brandLabel, ym }: AnalysisSectionProps) {
  const analysisData = collectAnalysisData(data, brandLabel, ym);

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

  const clothingSalesAnalysis = generateClothingSalesAnalysis(
    analysisData.clothingSales,
    analysisData.brandLabel,
    analysisData.isClosed
  );

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

      {/* 카드 3: 상품(의류) 판매 구조 분석 */}
      {clothingSalesAnalysis.length > 0 && (
        <AnalysisCard title="상품(의류) 판매 구조 분석" content={clothingSalesAnalysis} variant="info" />
      )}

      {/* 카드 4: 리스크 & 체크포인트 (조건부) */}
      {riskAnalysis && riskAnalysis.length > 0 && (
        <AnalysisCard title="리스크 & 체크포인트" content={riskAnalysis} variant="warning" />
      )}
    </div>
  );
}
