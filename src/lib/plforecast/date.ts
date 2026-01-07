/**
 * 한국 시간대(Asia/Seoul) 기준 날짜 유틸리티 함수
 * Vercel 서버(UTC)와 로컬(한국 KST) 간 타임존 차이 문제 해결
 */

/**
 * 한국 시간대 기준 오늘 Date 객체 반환
 */
export function getKstToday(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })
  );
}

/**
 * 한국 시간대 기준 오늘 날짜 (YYYY-MM-DD)
 */
export function getKstBaseDate(): string {
  const d = getKstToday();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * 한국 시간대 기준 어제 날짜 (YYYY-MM-DD)
 */
export function getKstYesterdayDate(): string {
  const today = getKstToday();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, '0');
  const day = String(yesterday.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * 한국 시간대 기준 현재 월 (YYYY-MM)
 */
export function getKstCurrentYm(): string {
  const today = getKstToday();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

