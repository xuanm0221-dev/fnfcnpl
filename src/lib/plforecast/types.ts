// 개별 PL 라인 (행)
export interface PlLine {
  id: string;
  label: string;
  level: number; // 들여쓰기 레벨 (0, 1, 2)
  isParent: boolean; // 토글 가능한 부모 행 여부
  isCalculated: boolean; // 계산행 여부 (매출총이익 등)
  prevYear: number | null; // 전년
  target: number | null; // 목표
  accum: number | null; // 누적
  forecast: number | null; // 월말예상
  yoyRate: number | null; // 전년비% = (월말예상/전년) - 1
  achvRate: number | null; // 달성율% = 월말예상/목표
  children?: PlLine[];
  defaultExpanded?: boolean; // 기본 펼침 상태
}

// API 응답 타입
export interface ApiResponse {
  ym: string; // YYYY-MM
  brand: string; // all | M | I | X | V | W
  lastDt: string; // 누적 마지막 날짜 (YYYY-MM-DD)
  accumDays: number; // 누적일수
  monthDays: number; // 당월일수 (달력일수)
  lines: PlLine[];
  error?: string;
}

// 계정맵핑 CSV 행
export interface AccountMapping {
  level1: string;
  level2: string;
  level3: string;
  item: string; // Snowflake 컬럼명
}

// 목표 CSV 행
export interface TargetRow {
  level1: string;
  level2: string;
  level3: string;
  M: number | null;
  I: number | null;
  X: number | null;
  V: number | null;
  W: number | null;
}

// 브랜드 코드
export type BrandCode = 'M' | 'I' | 'X' | 'V' | 'W';

// 브랜드 슬러그
export type BrandSlug = 'mlb' | 'mlb-kids' | 'discovery' | 'duvetica' | 'supra';

// Snowflake에서 조회한 실적 데이터
export interface ActualData {
  brdCd: BrandCode;
  lastDt: string;
  accumDays: number;
  // 전년 실적 (item -> 금액)
  prevYear: Record<string, number>;
  // 당월 누적 (item -> 금액)
  accum: Record<string, number>;
  // 대리상지원금 특별 계산 (전년)
  dealerSupportPrevYear: number;
  // 대리상지원금 특별 계산 (누적)
  dealerSupportAccum: number;
}

// 라인 정의 (화면 표시 순서/구조)
export interface LineDefinition {
  id: string;
  label: string;
  level: number;
  isParent: boolean;
  isCalculated: boolean;
  defaultExpanded?: boolean;
  // 계정맵핑 조건
  level1?: string;
  level2?: string;
  level3?: string;
  // 특수 처리 타입
  type?: 'vatExcluded' | 'cogsSum' | 'grossProfit' | 'directCostSum' | 'opexSum' | 'dealerSupport';
  // 직접비/영업비 분류 (월말예상 계산 방식 결정)
  costCategory?: 'direct' | 'opex';
  children?: LineDefinition[];
}

