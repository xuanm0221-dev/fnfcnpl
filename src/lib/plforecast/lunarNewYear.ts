/**
 * 중국 춘절(설날) 및 한국 추석 날짜 관리
 * 음력 명절의 양력 날짜 매핑
 */

// 중국 춘절(설날) 양력 날짜 매핑 (2020~2030)
export const lunarNewYearDates: Record<number, string> = {
  2020: '2020-01-25',
  2021: '2021-02-12',
  2022: '2022-02-01',
  2023: '2023-01-22',
  2024: '2024-02-10',
  2025: '2025-01-29',
  2026: '2026-02-17',
  2027: '2027-02-06',
  2028: '2028-01-26',
  2029: '2029-02-13',
  2030: '2030-02-03',
};

/**
 * D-index 계산: 특정 날짜가 설날 기준 몇일 전/후인지
 * @param dateStr 날짜 문자열 (YYYY-MM-DD)
 * @returns D-index (음수: 설날 전 D-X, 양수: 설날 후 D+X, null: 설날 정보 없음)
 * @example
 * // 2025년 1월 19일 = 설날(1/29) 10일 전 = D-10
 * getLunarNewYearDIndex('2025-01-19') // -10
 */
export function getLunarNewYearDIndex(dateStr: string): number | null {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const lnyStr = lunarNewYearDates[year];
  
  if (!lnyStr) return null;
  
  const lnyDate = new Date(lnyStr);
  const diffTime = date.getTime() - lnyDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

/**
 * 특정 연도의 설날 날짜 조회
 * @param year 연도
 * @returns 설날 날짜 (YYYY-MM-DD) 또는 null
 */
export function getLunarNewYearDate(year: number): string | null {
  return lunarNewYearDates[year] ?? null;
}

/**
 * 날짜를 YYYY-MM-DD 형식으로 포맷
 */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 설날 기준 날짜 범위 계산 (설날 -48일 ~ +15일)
 * @param year 연도
 * @param currentDateStr 현재 날짜 (YYYY-MM-DD)
 * @returns 시작일, 종료일, 설날 날짜, 현재 D-index
 */
export function getLunarDateRange(year: number, currentDateStr: string) {
  const lunarDateStr = lunarNewYearDates[year];
  
  if (!lunarDateStr) {
    return null;
  }
  
  const lunarDate = new Date(lunarDateStr);
  const currentDate = new Date(currentDateStr);
  
  // 설날 -48일
  const startDate = new Date(lunarDate);
  startDate.setDate(startDate.getDate() - 48);
  
  // 설날 +15일
  const endDate = new Date(lunarDate);
  endDate.setDate(endDate.getDate() + 15);
  
  // 현재 D-index 계산
  const currentDIndex = getLunarNewYearDIndex(currentDateStr);
  
  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    lunarDate: formatDate(lunarDate),
    currentDIndex,
  };
}

// ============================================
// 추석 (Chuseok) 관련 함수
// ============================================

// 추석 양력 날짜 매핑 (2020~2030)
export const chuseokDates: Record<number, string> = {
  2020: '2020-10-01',
  2021: '2021-09-21',
  2022: '2022-09-10',
  2023: '2023-09-29',
  2024: '2024-09-17',
  2025: '2025-10-06',
  2026: '2026-09-25',
  2027: '2027-09-15',
  2028: '2028-10-03',
  2029: '2029-09-22',
  2030: '2030-09-12',
};

/**
 * 추석 D-index 계산: 특정 날짜가 추석 기준 몇일 전/후인지
 * @param dateStr 날짜 문자열 (YYYY-MM-DD)
 * @returns D-index (음수: 추석 전 D-X, 양수: 추석 후 D+X, null: 추석 정보 없음)
 * @example
 * // 2025년 9월 29일 = 추석(10/6) 7일 전 = D-7
 * getChuseokDIndex('2025-09-29') // -7
 */
export function getChuseokDIndex(dateStr: string): number | null {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const chuseokStr = chuseokDates[year];
  
  if (!chuseokStr) return null;
  
  const chuseokDate = new Date(chuseokStr);
  const diffTime = date.getTime() - chuseokDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

/**
 * 특정 연도의 추석 날짜 조회
 * @param year 연도
 * @returns 추석 날짜 (YYYY-MM-DD) 또는 null
 */
export function getChuseokDate(year: number): string | null {
  return chuseokDates[year] ?? null;
}
