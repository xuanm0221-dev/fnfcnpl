// 자동 생성 — 수정하지 마세요. npm run update-csv 로 재생성됩니다.
// 생성 시간: 2026. 6. 8. AM 8:49:05
// CSV 경로: D:\로컬파일\월중손익\실적
// 총 7개월: 2025-12, 2026-01, 2026-02, 2026-03, 2026-04, 2026-05, 2026-06

// 날짜별 동적 import 로더 (월별 파일을 lazy load)
const loaders: Record<string, () => Promise<Record<string, string>>> = {
  '2025-12-31': () => import('./2025-12'),
  '2026-01-31': () => import('./2026-01'),
  '2026-02-28': () => import('./2026-02'),
  '2026-03-31': () => import('./2026-03'),
  '2026-04-30': () => import('./2026-04'),
  '2026-05-31': () => import('./2026-05'),
  '2026-06-07': () => import('./2026-06'),
};

const varNames: Record<string, string> = {
  '2025-12-31': 'actuals_2025_12_31',
  '2026-01-31': 'actuals_2026_01_31',
  '2026-02-28': 'actuals_2026_02_28',
  '2026-03-31': 'actuals_2026_03_31',
  '2026-04-30': 'actuals_2026_04_30',
  '2026-05-31': 'actuals_2026_05_31',
  '2026-06-07': 'actuals_2026_06_07',
};

/**
 * 기준월과 날짜로 실적 CSV 반환 (lazy load)
 * @param ym 기준월 (YYYY-MM)
 * @param date 기준일 (YYYY-MM-DD)
 */
export async function getActualsCsv(ym: string, date: string): Promise<string | null> {
  if (!date.startsWith(ym)) return null;
  const loader = loaders[date];
  if (!loader) return null;
  const mod = await loader();
  return mod[varNames[date]] ?? null;
}
