// 목표판매매출 CSV 데이터 (대리상 오프라인)
// 파일: C:\대시보드\월중손익\목표판매매출_25.12.csv

const retailPlan_25_12 = `,MLB,MLB KIDS,DISCOVERY
대리상오프라인_판매매출,644261977,22776000,
대리상매장수,904,106,
`;

// 월별 목표 CSV 매핑
const retailPlanCsvMap: Record<string, string> = {
  '2025-12': retailPlan_25_12,
};

// 브랜드별 계획 데이터
export interface RetailPlanData {
  salesAmt: number | null;  // 대리상오프라인_판매매출
  shopCnt: number | null;   // 대리상매장수
}

// 브랜드명 매핑 (brd_cd -> CSV 컬럼명)
const brandCodeToName: Record<string, string> = {
  'M': 'MLB',
  'I': 'MLB KIDS',
  'X': 'DISCOVERY',
};

/**
 * 기준월과 브랜드 코드로 계획 데이터 조회
 */
export function getRetailPlan(ym: string, brandCode: string): RetailPlanData | null {
  const csv = retailPlanCsvMap[ym];
  if (!csv) return null;
  
  const brandName = brandCodeToName[brandCode];
  if (!brandName) return null;
  
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return null;
  
  // 헤더 파싱
  const headers = lines[0].split(',');
  const brandIndex = headers.findIndex(h => h.trim() === brandName);
  if (brandIndex === -1) return null;
  
  let salesAmt: number | null = null;
  let shopCnt: number | null = null;
  
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const rowKey = cols[0]?.trim();
    const value = cols[brandIndex]?.trim();
    
    if (rowKey === '대리상오프라인_판매매출') {
      salesAmt = value ? parseFloat(value.replace(/,/g, '')) : null;
    } else if (rowKey === '대리상매장수') {
      shopCnt = value ? parseFloat(value.replace(/,/g, '')) : null;
    }
  }
  
  return { salesAmt, shopCnt };
}

/**
 * 점당매출 표시 대상 브랜드인지 확인 (M, I, X만)
 */
export function isRetailSalesBrand(brandCode: string): boolean {
  return ['M', 'I', 'X'].includes(brandCode);
}

