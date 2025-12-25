/**
 * 숫자를 K 단위로 변환하여 표시
 * @param value 원본 금액 (CNY)
 * @returns K 단위로 표시된 문자열 (콤마 포함)
 */
export function formatK(value: number | null): string {
  if (value === null) {
    return '-';
  }
  const kValue = value / 1000;
  // 소수점 없이 정수로 표시, 콤마 구분
  return Math.round(kValue).toLocaleString('ko-KR');
}

/**
 * 비율을 % 형태로 변환하여 표시
 * @param value 비율 (0.1 = 10%)
 * @returns % 문자열 (소수점 1자리)
 */
export function formatPercent(value: number | null): string {
  if (value === null) {
    return '-';
  }
  const percent = value * 100;
  return `${percent.toFixed(1)}%`;
}

/**
 * 날짜를 YY.MM.DD 형식으로 변환
 * @param dateStr YYYY-MM-DD 형식의 날짜
 * @returns YY.MM.DD 형식
 */
export function formatDateShort(dateStr: string): string {
  if (!dateStr) return '-';
  const [year, month, day] = dateStr.split('-');
  return `${year.slice(2)}.${month}.${day}`;
}

/**
 * 안전하게 나눗셈 수행 (분모가 0이면 null 반환)
 */
export function safeDivide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

/**
 * 전년비 계산: (월말예상/전년) - 1
 */
export function calcYoyRate(forecast: number | null, prevYear: number | null): number | null {
  const ratio = safeDivide(forecast, prevYear);
  if (ratio === null) return null;
  return ratio - 1;
}

/**
 * 달성율 계산: 월말예상/목표
 */
export function calcAchvRate(forecast: number | null, target: number | null): number | null {
  return safeDivide(forecast, target);
}

