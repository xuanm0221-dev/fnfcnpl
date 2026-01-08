/**
 * 명절 보정 진척률 계산
 * 월 단위 범위에서 당년 명절 D-index 계수 적용
 * - 1~2월: 설날 보정
 * - 9~10월: 추석 보정
 * - 3~8월, 11~12월: 단순 진척률
 */

import { getLunarNewYearDIndex, getChuseokDIndex } from './lunarNewYear';
import { getWeekdayCoefficient, getLunarNewYearCoefficient, getChuseokCoefficient } from './coefficients';

/**
 * 명절 보정 필요 여부 확인
 * @param ym 기준월 (YYYY-MM)
 * @returns { needsAdjustment: 보정필요여부, season: 명절종류 }
 */
function needsSeasonalAdjustment(ym: string): { 
  needsAdjustment: boolean; 
  season: 'lunar' | 'chuseok' | null;
} {
  const month = parseInt(ym.split('-')[1]);
  
  // 1~2월: 설날 보정
  if (month === 1 || month === 2) {
    return { needsAdjustment: true, season: 'lunar' };
  }
  
  // 9~10월: 추석 보정
  if (month === 9 || month === 10) {
    return { needsAdjustment: true, season: 'chuseok' };
  }
  
  // 3~8월, 11~12월: 보정 불필요
  return { needsAdjustment: false, season: null };
}

/**
 * 명절 보정 진척률 계산
 * @param currentYm 당년 기준월 (YYYY-MM)
 * @param lastDt 당년 기준일 (YYYY-MM-DD)
 * @param prevYearSalesAmt 전년 동일기간 누적 매출 (사용 안 함)
 * @param prevYearFullSalesAmt 전년 월전체 매출 (사용 안 함)
 * @returns { progressRate: 보정된진척률, isAdjusted: 보정적용여부 }
 */
export function calculateAdjustedProgressRate(
  currentYm: string,
  lastDt: string,
  prevYearSalesAmt: number,
  prevYearFullSalesAmt: number
): { progressRate: number; isAdjusted: boolean } {
  // 전년 매출이 없으면 0 반환
  if (prevYearFullSalesAmt <= 0) {
    return { progressRate: 0, isAdjusted: false };
  }
  
  // 명절 보정 필요 여부 확인
  const { needsAdjustment, season } = needsSeasonalAdjustment(currentYm);
  
  // 3~8월, 11~12월: 단순 진척률 사용
  if (!needsAdjustment) {
    const simpleRate = prevYearSalesAmt / prevYearFullSalesAmt;
    return { progressRate: simpleRate, isAdjusted: false };
  }
  
  // 1~2월(설날) 또는 9~10월(추석): 보정 진척률 계산 (월 단위)
  const [cyYear, cyMonth] = currentYm.split('-').map(Number);
  const pyYear = cyYear - 1;
  const lastDay = parseInt(lastDt.split('-')[2]);
  
  // 전년 월의 일수
  const daysInMonth = new Date(pyYear, cyMonth, 0).getDate();
  
  // 전년 1일부터 기준일까지 가중치 합산
  let cumulativeWeight = 0;
  for (let day = 1; day <= lastDay; day++) {
    // 전년 날짜 (요일 계산용)
    const pyDateStr = `${pyYear}-${String(cyMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const pyDate = new Date(pyDateStr);
    const pyDayOfWeek = pyDate.getDay();
    
    // 요일계수 (전년 실제 요일)
    const weekdayCoef = getWeekdayCoefficient(pyDayOfWeek);
    
    // 당년 날짜 (D-index 계산용)
    const cyDateStr = `${cyYear}-${String(cyMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    // 명절 종류에 따라 다른 D-index 및 계수 함수 사용
    const dIndex = season === 'lunar' 
      ? getLunarNewYearDIndex(cyDateStr) 
      : getChuseokDIndex(cyDateStr);
    
    const seasonCoef = season === 'lunar'
      ? getLunarNewYearCoefficient(dIndex)
      : getChuseokCoefficient(dIndex);
    
    // 가중치 = 요일계수 × 명절계수
    cumulativeWeight += weekdayCoef * seasonCoef;
  }
  
  // 전년 월전체 가중치 합산 (1일 ~ 월말)
  let monthWeight = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    // 전년 날짜 (요일 계산용)
    const pyDateStr = `${pyYear}-${String(cyMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const pyDate = new Date(pyDateStr);
    const pyDayOfWeek = pyDate.getDay();
    const weekdayCoef = getWeekdayCoefficient(pyDayOfWeek);
    
    // 당년 날짜 (D-index 계산용)
    const cyDateStr = `${cyYear}-${String(cyMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    // 명절 종류에 따라 다른 D-index 및 계수 함수 사용
    const dIndex = season === 'lunar'
      ? getLunarNewYearDIndex(cyDateStr)
      : getChuseokDIndex(cyDateStr);
    
    const seasonCoef = season === 'lunar'
      ? getLunarNewYearCoefficient(dIndex)
      : getChuseokCoefficient(dIndex);
    
    monthWeight += weekdayCoef * seasonCoef;
  }
  
  // 보정된 진척률 = 누적기간 가중치합 / 월전체 가중치합
  const adjustedProgressRate = monthWeight > 0 
    ? cumulativeWeight / monthWeight 
    : 0;
  
  return { 
    progressRate: adjustedProgressRate, 
    isAdjusted: true 
  };
}
