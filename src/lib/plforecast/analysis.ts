import type { ApiResponse, CardSummary, RetailSalesTableData, TierRegionSalesData, ClothingSalesData } from './types';

// 억 단위 변환
function formatEok(value: number | null): string {
  if (value === null || value === 0) return '0';
  const eok = value / 100000000;
  return eok.toFixed(1);
}

// 퍼센트 포맷팅
function formatPercent(value: number | null, decimals: number = 1): string {
  if (value === null) return '-';
  return `${(value * 100).toFixed(decimals)}%`;
}

// 퍼센트 포인트 포맷팅
function formatPercentPoint(value: number | null, decimals: number = 1): string {
  if (value === null) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(decimals)}p`;
}

// 마감/월중 구분 텍스트
function getStatusText(isClosed: boolean): { verb: string; suffix: string } {
  if (isClosed) {
    return { verb: '달성했습니다', suffix: '입니다' };
  } else {
    return { verb: '예상됩니다', suffix: ' 전망됩니다' };
  }
}

// 카드 1: 손익 요약 분석
export function generateProfitAnalysis(
  summary: CardSummary | undefined,
  brandLabel: string,
  isClosed: boolean
): string[] {
  if (!summary) {
    return ['데이터가 없습니다.'];
  }

  const status = getStatusText(isClosed);
  const lines: string[] = [];

  // 실판매출
  const actSaleForecast = summary.actSale.forecastValue || 0;
  const actSaleTargetRate = summary.actSale.targetRate || 0;
  const actSaleYoy = summary.actSale.yoyRate !== null ? summary.actSale.yoyRate + 1 : null;
  lines.push(
    `실판매액은 **${formatEok(actSaleForecast)}억 위안**으로 목표 대비 **${formatPercent(actSaleTargetRate)}**, 전년 대비 **${formatPercent(actSaleYoy)}** 수준${status.suffix}.`
  );

  // 할인율
  const discountRateForecast = summary.actSale.forecastRate || 0;
  const discountRateAccum = summary.actSale.accumRate || 0;
  // 할인율 목표 대비 차이 (월말예상 - 누적)
  const discountTargetDiff = discountRateForecast - discountRateAccum;
  if (discountTargetDiff !== 0) {
    lines.push(
      `할인율은 **${formatPercent(discountRateForecast)}**로 목표 대비 **${formatPercentPoint(discountTargetDiff)}** 변동하였습니다.`
    );
  } else {
    lines.push(
      `할인율은 **${formatPercent(discountRateForecast)}**로 목표 수준을 유지하고 있습니다.`
    );
  }

  // 직접이익
  const directProfitForecast = summary.directProfit.forecastValue || 0;
  const directProfitRate = summary.directProfit.forecastRate || 0;
  const directProfitTargetRate = summary.directProfit.targetRate || 0;
  const directProfitYoy = summary.directProfit.yoyRate !== null ? summary.directProfit.yoyRate + 1 : null;
  lines.push(
    `직접이익은 **${formatEok(directProfitForecast)}억 위안(${formatPercent(directProfitRate)})**으로 목표 대비 **${formatPercent(directProfitTargetRate)}**, 전년 대비 **${formatPercent(directProfitYoy)}** ${status.verb}.`
  );

  // 영업이익
  const opProfitForecast = summary.operatingProfit.forecastValue || 0;
  const opProfitRate = summary.operatingProfit.forecastRate || 0;
  const opProfitTargetRate = summary.operatingProfit.targetRate || 0;
  const opProfitYoy = summary.operatingProfit.yoyRate !== null ? summary.operatingProfit.yoyRate + 1 : null;
  lines.push(
    `영업이익은 **${formatEok(opProfitForecast)}억 위안(${formatPercent(opProfitRate)})**으로 목표 대비 **${formatPercent(opProfitTargetRate)}**, 전년 대비 **${formatPercent(opProfitYoy)}** ${status.verb}.`
  );

  // 직접이익 진척률 경고
  const directProfitProgress = summary.directProfitProgress.forecastRate || 0;
  if (directProfitProgress < 0.95) {
    lines.push(
      `월말 목표 달성을 위해 추가 모니터링이 필요합니다. (직접이익 진척률: ${formatPercent(directProfitProgress)})`
    );
  }

  return lines;
}

// 카드 2: 점당매출 · 채널 구조 분석
export function generateRetailSalesAnalysis(
  retailSalesTable: RetailSalesTableData | undefined,
  tierRegionData: TierRegionSalesData | undefined,
  brandLabel: string,
  isClosed: boolean
): string[] {
  const lines: string[] = [];

  if (!retailSalesTable) {
    return ['점당매출 데이터가 없습니다.'];
  }

  const status = getStatusText(isClosed);

  // 점당매출_월환산 YOY 및 진척률 사용
  const salesPerShopMonthlyYoy = retailSalesTable.salesPerShopMonthly.yoy || 0;
  const salesPerShopMonthlyProgress = retailSalesTable.salesPerShopMonthly.progressRate || 0;
  const salesPerShopMonthly = retailSalesTable.salesPerShopMonthly.actual || 0;
  const salesPerShopMonthlyPlan = retailSalesTable.salesPerShopMonthly.plan || 0;

  lines.push(
    `점당매출(월환산)은 전년 대비 **${formatPercent(salesPerShopMonthlyYoy)}**, 진척률 **${formatPercent(salesPerShopMonthlyProgress)}** 수준${status.suffix}.`
  );

  // 월환산 기준 목표 달성 가능성
  if (salesPerShopMonthlyPlan && salesPerShopMonthlyPlan > 0 && salesPerShopMonthly) {
    const monthlyAchievement = salesPerShopMonthly / salesPerShopMonthlyPlan;
    if (monthlyAchievement >= 1.0) {
      lines.push(`월환산 기준 목표 달성이 가능한 수준입니다.`);
    } else if (monthlyAchievement >= 0.95) {
      lines.push(`월환산 기준 목표 달성에 근접한 수준입니다.`);
    } else {
      lines.push(`월환산 기준 목표 달성을 위해 추가 노력이 필요합니다.`);
    }
  }

  // Trade Zone → Shop Level → Tier → 지역 순서 분석
  if (tierRegionData) {
    // 1. Trade Zone별 분석 (level2: 많이 팔린 카테고리)
    const tradeZones = tierRegionData.tradeZones || [];
    if (tradeZones.length > 0) {
      const sortedTZ = [...tradeZones].sort((a, b) => (b.salesPerShop || 0) - (a.salesPerShop || 0));
      const topTZ = sortedTZ[0];
      const secondTZ = sortedTZ[1];
      const bottomTZ = sortedTZ[sortedTZ.length - 1];
      
      if (topTZ) {
        lines.push(
          `[[Trade Zone]]별로는 **${topTZ.key}**가 기여도가 높은 양상을 보입니다.`
        );
        const cats = topTZ.topCategories && topTZ.topCategories.length > 0
          ? topTZ.topCategories.slice(0, 3).map((c) => `**${c.category}**`).join(', ')
          : null;
        if (cats) {
          lines.push(
            `[[INDENT]]**${topTZ.key}**에서는 ${cats} 등이 많이 판매되었습니다.`
          );
        }
      }
      if (secondTZ && secondTZ !== topTZ) {
        lines.push(
          `[[INDENT]]이어서 **${secondTZ.key}**도 양호한 성과를 보이고 있습니다.`
        );
      }
      if (bottomTZ && bottomTZ !== topTZ && bottomTZ !== secondTZ) {
        lines.push(
          `[[INDENT]]반면 **${bottomTZ.key}**는 상대적으로 부진한 양상을 보입니다.`
        );
      }
    }

    // 2. Shop Level별 분석 (level2: 많이 팔린 카테고리)
    const shopLevels = tierRegionData.shopLevels || [];
    if (shopLevels.length > 0) {
      const sortedSL = [...shopLevels].sort((a, b) => (b.salesPerShop || 0) - (a.salesPerShop || 0));
      const topSL = sortedSL[0];
      const secondSL = sortedSL[1];
      const bottomSL = sortedSL[sortedSL.length - 1];
      
      if (topSL) {
        lines.push(
          `[[Shop Level]]별로는 **${topSL.key}**가 기여도가 높은 양상을 보입니다.`
        );
        const cats = topSL.topCategories && topSL.topCategories.length > 0
          ? topSL.topCategories.slice(0, 3).map((c) => `**${c.category}**`).join(', ')
          : null;
        if (cats) {
          lines.push(
            `[[INDENT]]**${topSL.key}**에서는 ${cats} 등이 많이 판매되었습니다.`
          );
        }
      }
      if (secondSL && secondSL !== topSL) {
        lines.push(
          `[[INDENT]]이어서 **${secondSL.key}**도 양호한 성과를 보이고 있습니다.`
        );
      }
      if (bottomSL && bottomSL !== topSL && bottomSL !== secondSL) {
        lines.push(
          `[[INDENT]]반면 **${bottomSL.key}**는 상대적으로 부진한 양상을 보입니다.`
        );
      }
    }

    // 3. Tier별 분석 (level2: 주요 도시 포함)
    const tiers = tierRegionData.tiers || [];
    if (tiers.length > 0) {
      const sortedTiers = [...tiers].sort((a, b) => (b.salesPerShop || 0) - (a.salesPerShop || 0));
      const topTier = sortedTiers[0];
      const secondTier = sortedTiers[1];
      const bottomTier = sortedTiers[sortedTiers.length - 1];
      
      if (topTier) {
        const tierCities = topTier.cities && topTier.cities.length > 0 
          ? topTier.cities.slice(0, 2).join(', ') 
          : null;
        
        if (tierCities) {
          lines.push(
            `[[Tier]]별로는 **${topTier.key}**가 기여도가 높으며, 주요 도시로는 **${tierCities}** 등이 있습니다.`
          );
        } else {
          lines.push(
            `[[Tier]]별로는 **${topTier.key}**가 기여도가 높은 양상을 보입니다.`
          );
        }
      }
      
      if (secondTier && secondTier !== topTier) {
        const secondTierCities = secondTier.cities && secondTier.cities.length > 0 
          ? secondTier.cities.slice(0, 2).join(', ') 
          : null;
        
        if (secondTierCities) {
          lines.push(
            `[[INDENT]]이어서 **${secondTier.key}**도 양호한 성과를 보이며, 주요 도시로는 **${secondTierCities}** 등이 있습니다.`
          );
        }
      }
      
      if (bottomTier && bottomTier !== topTier && bottomTier !== secondTier) {
        lines.push(
          `[[INDENT]]반면 **${bottomTier.key}**는 상대적으로 부진한 양상을 보입니다.`
        );
      }
    }

    // 4. 지역별 분석 (level2: 주요 도시 포함)
    const regions = tierRegionData.regions || [];
    if (regions.length > 0) {
      const sortedRegions = [...regions].sort((a, b) => (b.salesPerShop || 0) - (a.salesPerShop || 0));
      const topRegion = sortedRegions[0];
      const secondRegion = sortedRegions[1];
      
      if (topRegion) {
        const regionCities = topRegion.cities && topRegion.cities.length > 0 
          ? topRegion.cities.slice(0, 2).join(', ') 
          : null;
        
        if (regionCities) {
          lines.push(
            `[[지역]]별로는 **${topRegion.labelKo || topRegion.key}**가 높은 기여도를 보이며, 주요 도시로는 **${regionCities}** 등이 있습니다.`
          );
        } else {
          lines.push(
            `[[지역]]별로는 **${topRegion.labelKo || topRegion.key}**가 높은 기여도를 보이고 있습니다.`
          );
        }
      }
      
      if (secondRegion && secondRegion !== topRegion) {
        const secondRegionCities = secondRegion.cities && secondRegion.cities.length > 0 
          ? secondRegion.cities.slice(0, 2).join(', ') 
          : null;
        
        if (secondRegionCities) {
          lines.push(
            `[[INDENT]]이어서 **${secondRegion.labelKo || secondRegion.key}**도 양호한 성과를 보이며, 주요 도시로는 **${secondRegionCities}** 등이 있습니다.`
          );
        }
      }
    }
  }

  return lines;
}

// 카드 3: 상품(의류) 판매 구조 분석
export function generateClothingSalesAnalysis(
  clothingSales: ClothingSalesData | undefined,
  brandLabel: string,
  isClosed: boolean
): string[] {
  const lines: string[] = [];

  if (!clothingSales || !clothingSales.items || clothingSales.items.length === 0) {
    return ['의류 판매율 데이터가 없습니다.'];
  }

  const status = getStatusText(isClosed);

  // Tag누적판매(cySalesAmt) 기준 Top5 분석
  const items = clothingSales.items || [];
  if (items.length > 0) {
    // Tag누적판매 기준으로 정렬하여 Top5 추출
    const sortedBySalesAmt = [...items]
      .sort((a, b) => (b.cySalesAmt || 0) - (a.cySalesAmt || 0))
      .slice(0, 5);
    
    if (sortedBySalesAmt.length > 0) {
      lines.push(
        `Tag누적판매 기준 상위 5개 아이템 분석:`
      );
      
      sortedBySalesAmt.forEach((item, idx) => {
        // 전년비 판매금액 YOY (의류판매율 표와 동일하게 계산: cy / py)
        const salesYoy = item.pySalesAmt > 0 
          ? (item.cySalesAmt / item.pySalesAmt) 
          : null;
        
        // 판매율 YOY (이미 백분율 차이로 계산되어 있음, 예: -3.2는 -3.2%)
        const rateYoy = item.yoy;
        
        // 누적 판매율
        const rateForecast = item.cyRate;
        
        // 발주수량 YOY (의류판매율 표와 동일하게 계산: cy / py)
        const poQtyYoy = item.pyPoQty > 0 
          ? (item.cyPoQty / item.pyPoQty) 
          : null;
        
        // 판매금액 YOY는 의류판매율 표와 동일하게 표시 (비율 * 100, 예: 0.989 → 98.9%)
        const salesYoyText = salesYoy !== null 
          ? `${(salesYoy * 100).toFixed(1)}%` 
          : '-';
        // 판매율 YOY는 이미 백분율 차이이므로 그대로 포맷 (100 곱하지 않음)
        const rateYoyText = rateYoy !== null 
          ? `${rateYoy >= 0 ? '+' : ''}${rateYoy.toFixed(1)}%` 
          : '-';
        // 누적 판매율
        const rateForecastText = rateForecast !== null 
          ? `${rateForecast.toFixed(1)}%` 
          : '-';
        // 발주수량 YOY는 의류판매율 표와 동일하게 표시 (비율 * 100, 예: 1.372 → 137.2%)
        const poQtyYoyText = poQtyYoy !== null 
          ? `${(poQtyYoy * 100).toFixed(1)}%` 
          : '-';
        
        // 발주-판매율 관계 설명
        let relationNote = '';
        if (poQtyYoy !== null && rateYoy !== null) {
          const poQtyYoyPercent = (poQtyYoy - 1) * 100;
          if (poQtyYoy > 1.0 && rateYoy < 0) {
            relationNote = ' (발주 증가하면서 판매율 하락 [[▲]])';
          } else if (poQtyYoy > 1.0 && rateYoy > 0) {
            relationNote = ' (발주 증가와 함께 판매율 상승 👍)';
          } else if (poQtyYoy < 1.0 && rateYoy > 0) {
            relationNote = ' (발주 감소하면서 판매율 상승 👍)';
          } else if (poQtyYoy < 1.0 && rateYoy < 0) {
            relationNote = ' (발주 감소와 함께 판매율 하락 👎)';
          }
        }
        
        lines.push(
          `${idx + 1}. **${item.itemNm}**: 누적 판매율 **${rateForecastText}**, 판매금액 YOY **${salesYoyText}**, 판매율 YOY **${rateYoyText}**, 발주수량 YOY **${poQtyYoyText}**${relationNote}`
        );
      });
    }
  }

  return lines;
}

// 카드 4: 리스크 & 체크포인트 (조건부)
export function generateRiskAnalysis(
  summary: CardSummary | undefined,
  retailSalesTable: RetailSalesTableData | undefined,
  clothingSales: ClothingSalesData | undefined,
  brandLabel: string
): string[] | null {
  const risks: string[] = [];
  let hasRisk = false;

  // 할인율 목표 대비 +3%p 이상
  if (summary) {
    const discountRateForecast = summary.actSale.forecastRate || 0;
    const discountRateAccum = summary.actSale.accumRate || 0;
    // 목표 대비 차이 계산 (월말예상이 누적보다 높으면 할인율 증가)
    const discountDiff = discountRateForecast - discountRateAccum;
    if (discountDiff >= 0.03) {
      risks.push(`할인율이 목표 대비 **${formatPercentPoint(discountDiff)}** 높아 수익성에 영향을 줄 수 있습니다.`);
      hasRisk = true;
    }
  }

  // 점당매출_월환산 진척률 95% 미만
  if (retailSalesTable) {
    const salesPerShopMonthlyProgress = retailSalesTable.salesPerShopMonthly.progressRate || 0;
    if (salesPerShopMonthlyProgress < 0.95) {
      risks.push(`점당매출(월환산) 진척률이 **${formatPercent(salesPerShopMonthlyProgress)}**로 목표 달성에 어려움이 예상됩니다.`);
      hasRisk = true;
    }
  }

  // 발주수량 YOY 대비 판매 YOY 현저히 낮음
  if (clothingSales && clothingSales.total) {
    const totalCySalesAmt = clothingSales.total.cySalesAmt || 0;
    const totalPySalesAmt = clothingSales.total.pySalesAmt || 0;
    const totalCyPoQty = clothingSales.total.cyPoQty || 0;
    const totalPyPoQty = clothingSales.total.pyPoQty || 0;

    const salesYoy = totalPySalesAmt > 0 ? (totalCySalesAmt / totalPySalesAmt) - 1 : null;
    const poQtyYoy = totalPyPoQty > 0 ? (totalCyPoQty / totalPyPoQty) - 1 : null;

    if (salesYoy !== null && poQtyYoy !== null) {
      const gap = salesYoy - poQtyYoy;
      if (gap < -0.15) {
        risks.push(`발주수량 증가 대비 판매 증가가 부족하여 재고 리스크가 있습니다.`);
        hasRisk = true;
      }
    }
  }

  if (!hasRisk) {
    return null;
  }

  // 다음 월 관리 포인트
  risks.push('');
  risks.push('다음 월 관리 포인트:');
  if (summary && (summary.actSale.forecastRate || 0) - (summary.actSale.accumRate || 0) >= 0.03) {
    risks.push('• 할인율 관리 및 프로모션 효율성 검토');
  }
  if (retailSalesTable && (retailSalesTable.salesPerShopMonthly.progressRate || 0) < 0.95) {
    risks.push('• 점당매출(월환산) 개선을 위한 매장별 집중 관리');
  }
  if (clothingSales) {
    risks.push('• 의류 판매율 모니터링 및 재고 최적화');
  }

  return risks;
}

// 분석 데이터 수집
export interface AnalysisData {
  summary: CardSummary | undefined;
  retailSalesTable: RetailSalesTableData | undefined;
  tierRegionData: TierRegionSalesData | undefined;
  clothingSales: ClothingSalesData | undefined;
  isClosed: boolean;
  brandLabel: string;
  ym: string;
}

export function collectAnalysisData(
  data: ApiResponse,
  brandLabel: string,
  ym: string
): AnalysisData {
  return {
    summary: data.summary,
    retailSalesTable: data.retailSalesTable,
    tierRegionData: data.tierRegionData,
    clothingSales: data.clothingSales,
    isClosed: data.isClosed || false,
    brandLabel,
    ym,
  };
}
