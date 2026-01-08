/**
 * 진척률 보정 계수
 * - 요일계수: 요일별 매출 패턴 반영
 * - 설날 D-index 계수: 설날 전후 매출 변동 패턴 반영
 * - 추석 D-index 계수: 추석 전후 매출 변동 패턴 반영
 */

/**
 * 요일계수 (0=일요일, 6=토요일)
 * 기준: 평일 대비 주말 매출이 높은 패턴 반영
 * TODO: 실제 데이터 분석으로 최적화 필요
 */
export const weekdayCoefficients: Record<number, number> = {
  0: 1.37,  // 일요일 - 주말 피크
  1: 0.73,  // 월요일 - 평일 저점
  2: 0.82,  // 화요일
  3: 0.89,  // 수요일
  4: 0.94,  // 목요일
  5: 0.91,  // 금요일
  6: 1.57,  // 토요일 - 주말 최고점
};

/**
 * 설날 D-index별 계수
 * D-index: 설날 기준 일수 (음수=설날 전, 양수=설날 후)
 * 패턴: 설날 1주일 전부터 매출 급증, 설날 연휴 중 급감, 이후 정상화
 * TODO: 실제 데이터 분석으로 최적화 필요
 */
export const lunarNewYearDIndexCoefficients: Record<number, number> = {
  // D-60 ~ D-31: 정상 기간 (영향 없음)
  ...createRangeCoefficients(-60, -31, 1.0),
  
  // D-30 ~ D-21: 설날 준비 시작 (약간 증가)
  ...createRangeCoefficients(-30, -21, 1.05),
  
  // D-20 ~ D-11: 설날 준비 본격화 (점진적 증가)
  [-20]: 1.08, [-19]: 1.08, [-18]: 1.10, [-17]: 1.10,
  [-16]: 1.12, [-15]: 1.12, [-14]: 1.15, [-13]: 1.15,
  [-12]: 1.18, [-11]: 1.18,
  
  // D-10 ~ D-1: 설날 피크 (대폭 증가)
  // 사용자 피드백: 1/27일 전 일주일이 피크 (D-7 ~ D-1)
  // 명절 보정 강화: 계수 약 10-15% 낮춤 (월환산 95% → 90% 조정)
  [-10]: 1.25, [-9]: 1.35, [-8]: 1.45, [-7]: 1.55,
  [-6]: 1.75, [-5]: 1.80, [-4]: 1.90, [-3]: 1.80,
  [-2]: 1.70, [-1]: 1.45,
  
  // D+0 ~ D+7: 설날 연휴 (급감)
  [0]: 0.50, [1]: 0.50, [2]: 0.60, [3]: 0.70,
  [4]: 0.80, [5]: 0.90, [6]: 0.95, [7]: 1.00,
  
  // D+8 이후: 정상화
  ...createRangeCoefficients(8, 60, 1.0),
};

/**
 * 범위 계수 생성 헬퍼
 */
function createRangeCoefficients(start: number, end: number, value: number): Record<number, number> {
  const result: Record<number, number> = {};
  for (let i = start; i <= end; i++) {
    result[i] = value;
  }
  return result;
}

/**
 * 설날 D-index 계수 조회
 * @param dIndex D-index (설날 기준 일수)
 * @returns 계수 (범위 밖이면 1.0)
 */
export function getLunarNewYearCoefficient(dIndex: number | null): number {
  if (dIndex === null) return 1.0;
  return lunarNewYearDIndexCoefficients[dIndex] ?? 1.0;
}

/**
 * 요일 계수 조회
 * @param dayOfWeek 요일 (0=일요일, 6=토요일)
 * @returns 계수
 */
export function getWeekdayCoefficient(dayOfWeek: number): number {
  return weekdayCoefficients[dayOfWeek] ?? 1.0;
}

// ============================================
// 추석 (Chuseok) 관련 계수
// ============================================

/**
 * 추석 D-index별 계수
 * D-index: 추석 기준 일수 (음수=추석 전, 양수=추석 후)
 * 패턴: 추석 1~2주 전부터 매출 증가, 추석 연휴 중 급감, 이후 정상화
 * 범위: D-14 ~ D+7 (22일)
 * TODO: 실제 데이터 분석으로 최적화 필요
 */
export const chuseokDIndexCoefficients: Record<number, number> = {
  // D-14 ~ D-8: 추석 준비 (점진적 증가)
  // 명절 보정 강화: 계수 약 10-15% 낮춤 (월환산 95% → 90% 조정)
  [-14]: 1.15, [-13]: 1.15, [-12]: 1.18, [-11]: 1.18,
  [-10]: 1.25, [-9]: 1.35, [-8]: 1.45,
  
  // D-7 ~ D-1: 추석 피크 (대폭 증가)
  [-7]: 1.55, [-6]: 1.75, [-5]: 1.80, [-4]: 1.90,
  [-3]: 1.80, [-2]: 1.70, [-1]: 1.45,
  
  // D+0 ~ D+7: 추석 연휴 (급감 후 정상화)
  [0]: 0.50, [1]: 0.50, [2]: 0.60, [3]: 0.70,
  [4]: 0.80, [5]: 0.90, [6]: 0.95, [7]: 1.00,
  
  // 범위 밖(D-15 이전, D+8 이후): 1.0 (기본값으로 처리)
};

/**
 * 추석 D-index 계수 조회
 * @param dIndex D-index (추석 기준 일수)
 * @returns 계수 (범위 밖이면 1.0)
 */
export function getChuseokCoefficient(dIndex: number | null): number {
  if (dIndex === null) return 1.0;
  return chuseokDIndexCoefficients[dIndex] ?? 1.0;
}
