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

// 카드 요약 데이터 (개별 카드)
export interface CardData {
  accumValue: number | null; // 현시점(누적) 금액
  accumRate: number | null; // 현시점 비율 (할인율/이익율)
  forecastValue: number | null; // 월말예상 금액
  forecastRate: number | null; // 월말예상 비율
  targetRate: number | null; // 목표대비 (달성율)
  yoyRate: number | null; // 전년대비
}

// 카드 요약 전체
export interface CardSummary {
  // 카드1: 실판매출(할인율)
  actSale: CardData;
  // 카드2: 직접이익(이익율)
  directProfit: CardData;
  // 카드3: 영업이익(이익율)
  operatingProfit: CardData;
  // 카드4: 직접이익 진척률
  directProfitProgress: {
    accumRate: number | null; // 현시점 진척률
    forecastRate: number | null; // 월말예상 진척률
  };
}

// 차트용 데이터 타입
export interface BrandSalesData {
  brand: string;
  brandCode: BrandCode;
  sales: number; // 실판(V+)
  operatingProfit: number; // 영업이익
}

export interface BrandRadarData {
  brand: string;
  target: number; // 목표 달성율 (%)
  prevYear: number; // 전년비 (%)
}

export interface WaterfallData {
  name: string;
  value: number;
  type: 'positive' | 'negative' | 'subtotal' | 'total';
}

export interface TrendData {
  label: string; // 주차 라벨 또는 날짜
  curAccum: number; // 당년 누적
  prevAccum: number; // 전년 누적
}

// 주차별 매출 데이터 (막대 차트용)
export interface WeeklyTrendData {
  label: string; // "11/10~11/16" 형식
  curValue: number; // 당년 매출
  prevValue: number; // 전년 매출
}

export interface ChartData {
  brandSales: BrandSalesData[]; // 브랜드별 매출/영업이익
  brandRadar: BrandRadarData[]; // 브랜드별 레이더
  waterfall: WaterfallData[]; // 손익 구조
  weeklyTrend: WeeklyTrendData[]; // 주차별 매출 (4주)
  weeklyAccumTrend: WeeklyTrendData[]; // 주차별 누적 (4주)
}

// API 응답 타입
export interface ApiResponse {
  ym: string; // YYYY-MM
  brand: string; // all | M | I | X | V | W
  lastDt: string; // 누적 마지막 날짜 (YYYY-MM-DD)
  accumDays: number; // 누적일수
  monthDays: number; // 당월일수 (달력일수)
  lines: PlLine[];
  summary?: CardSummary; // 카드용 요약 데이터
  charts?: ChartData; // 차트용 데이터 (전체 페이지만)
  channelTable?: ChannelTableData; // 채널별 계획/진척률 테이블 (브랜드별 페이지만)
  retailSalesTable?: RetailSalesTableData; // 점당매출 테이블 (MLB, MLB KIDS, DISCOVERY만)
  retailLastDt?: string; // 점당매출 기준일 (전일)
  tierRegionData?: TierRegionSalesData; // 티어별/지역별 점당매출 (MLB, MLB KIDS, DISCOVERY만)
  clothingSales?: ClothingSalesData; // 의류 판매율 (MLB, MLB KIDS, DISCOVERY, DUVETICA, SUPRA만)
  clothingLastDt?: string; // 의류 판매율 기준일 (Snowflake 최신 날짜)
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

// 채널 타입
export type ChannelType = 'onlineDirect' | 'onlineDealer' | 'offlineDirect' | 'offlineDealer';

// 채널별 행 데이터
export interface ChannelRowData {
  onlineDirect: number | null;
  onlineDealer: number | null;
  offlineDirect: number | null;
  offlineDealer: number | null;
  total: number | null;
}

// 채널별 계획 테이블 데이터 (좌측)
export interface ChannelPlanTable {
  tagSale: ChannelRowData;
  actSaleVatInc: ChannelRowData; // 실판(V+)
  actSaleVatIncRate: ChannelRowData; // 할인율
  actSaleVatExc: ChannelRowData; // 실판(V-)
  cogs: ChannelRowData; // 매출원가
  cogsRate: ChannelRowData; // 원가율 (매출원가/실판V-)
  tagCogsRate: ChannelRowData; // Tag 대비 원가율 (매출원가×1.13/Tag매출)
  grossProfit: ChannelRowData; // 매출총이익
  grossProfitRate: ChannelRowData; // 이익율
}

// 채널별 실적 데이터
export interface ChannelActuals {
  tagSale: ChannelRowData;
  actSaleVatInc: ChannelRowData;
  actSaleVatExc: ChannelRowData;
  cogs: ChannelRowData;
}

// 채널별 진척률 테이블 데이터 (우측)
export interface ChannelActualTable {
  tagSale: ChannelRowData & { progressRate: number | null };
  actSaleVatInc: ChannelRowData & { progressRate: number | null };
  actSaleVatIncRate: ChannelRowData & { progressRate: number | null }; // 할인율
  actSaleVatExc: ChannelRowData & { progressRate: number | null };
  cogs: ChannelRowData & { progressRate: number | null };
  cogsRate: ChannelRowData & { progressRate: number | null }; // 원가율
  tagCogsRate: ChannelRowData & { progressRate: number | null }; // Tag 대비 원가율 차이
  grossProfit: ChannelRowData & { progressRate: number | null };
  grossProfitRate: ChannelRowData & { progressRate: number | null }; // 이익율
}

// 채널별 테이블 전체 데이터
export interface ChannelTableData {
  plan: ChannelPlanTable;
  actual: ChannelActualTable;
}

// 점당매출 행 데이터
export interface RetailSalesRow {
  actual: number | null;       // 실적
  progressRate: number | null; // 진척률
  yoy: number | null;          // YOY
  plan: number | null;         // 계획
  prevYear: number | null;     // 전년
}

// 점당매출 테이블 데이터
export interface RetailSalesTableData {
  salesK: RetailSalesRow;          // 리테일 매출액(1K)
  shopCount: RetailSalesRow;       // 매장수
  salesPerShop: RetailSalesRow;    // 점당매출
  salesPerShopMonthly: RetailSalesRow; // 점당매출_월환산
}

// 매장별 상세 데이터 (모달용)
export interface ShopSalesDetail {
  shopId: string;       // oa_shop_id
  shopName: string;     // 매장명 (shop_nm_cn)
  salesAmt: number;     // 누적 판매매출
  frOrCls: string;      // FR/OR 구분
}

// 티어별/지역별 점당매출 행 데이터
export interface TierRegionSalesRow {
  key: string;          // 티어명 또는 지역명 (중국어)
  labelKo?: string;     // 지역 한국어 번역 (지역만)
  cities?: string[];    // 주요 도시 목록 (중국어)
  salesAmt: number;     // 당년 매출 합계
  shopCnt: number;      // 당년 매장수
  salesPerShop: number; // 당년 점당매출 (월환산)
  prevSalesAmt: number; // 전년 월전체 매출 합계 (표시 및 YOY 비교용)
  prevShopCnt: number;  // 전년 월전체 매장수 (표시 및 YOY 비교용)
  prevSalesPerShop: number; // 전년 월전체 점당매출 (표시 및 YOY 비교용)
  prevFullSalesAmt: number; // 전년 월전체 매출 합계
  prevFullShopCnt: number;  // 전년 월전체 매장수
  prevCumSalesAmt: number; // 전년 누적 매출 합계 (월환산 계산용)
  prevCumShopCnt: number;  // 전년 누적 매장수 (월환산 계산용)
}

// 티어별/지역별 점당매출 데이터
export interface TierRegionSalesData {
  tiers: TierRegionSalesRow[];   // 티어별
  regions: TierRegionSalesRow[]; // 지역별
}

// 의류 판매율 (item 단위)
export interface ClothingSalesRow {
  itemCd: string;        // 아이템 코드
  itemNm: string;        // 아이템 명칭
  cyRate: number | null; // 당시즌 판매율 (%)
  pyRate: number | null; // 전년시즌 판매율 (%)
  yoy: number | null;    // 판매율 YOY (당시즌/전년시즌)
  cySalesAmt: number;    // 당시즌 누적 판매액 (Tag)
  pySalesAmt: number;    // 전년시즌 누적 판매액 (Tag)
  cyPoQty: number;       // 당년 발주수량
  pyPoQty: number;       // 전년 발주수량
}

// 의류 판매율 데이터
export interface ClothingSalesData {
  items: ClothingSalesRow[]; // 아이템별
  total: ClothingSalesRow;   // 전체 합계
}

// 의류 아이템 상세 (product 단위)
export interface ClothingItemDetail {
  prdtCd: string;
  prdtNm: string;
  cyRate: number | null; // 당시즌 판매율
  cySalesQty: number; // 당시즌 판매수량 (누적)
  cyStockQty: number | null; // 당시즌 기말 재고수량
  poQty: number; // 발주수량
}

// 비용 계산 타입
export type CostCalculationType = 'fixed' | 'variable';

// 변동비 채널 타입
export type VariableCostChannel = 'onlineDirect' | 'offlineDirect' | 'total';

// level3별 비용 계산 방식 매핑 (하드코딩)
export const COST_CALCULATION_MAP: Record<string, { type: CostCalculationType; channel?: VariableCostChannel }> = {
  // 직접비 - 변동비
  '급여': { type: 'variable', channel: 'offlineDirect' },
  '복리후생비': { type: 'variable', channel: 'offlineDirect' },
  '플랫폼수수료': { type: 'variable', channel: 'onlineDirect' },
  'TP수수료': { type: 'variable', channel: 'onlineDirect' },
  '직접광고비': { type: 'variable', channel: 'onlineDirect' },
  '물류비': { type: 'variable', channel: 'total' },
  '매장임차료': { type: 'variable', channel: 'offlineDirect' },
  // 직접비 - 고정비
  '지급수수료': { type: 'fixed' },
  '대리상지원금': { type: 'fixed' },
  '포장비': { type: 'fixed' },
  '감가상각비': { type: 'fixed' },
  '진열소모품': { type: 'fixed' },
  '기타지급수수료': { type: 'fixed' },
  // 영업비는 모두 고정비 (별도 매핑 불필요)
};

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
  type?: 'vatExcluded' | 'cogsSum' | 'grossProfit' | 'directCostSum' | 'directProfit' | 'opexSum' | 'dealerSupport' | 'operatingProfit' | 'channelVatInc';
  // 직접비/영업비 분류 (월말예상 계산 방식 결정)
  costCategory?: 'direct' | 'opex';
  children?: LineDefinition[];
}

