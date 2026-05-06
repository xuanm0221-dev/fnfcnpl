/**
 * CSV 파일을 읽어서 TypeScript 파일을 자동 생성하는 스크립트
 * 
 * 사용 방법:
 *   npm run update-csv
 * 
 * CSV 파일 경로:
 *   - 예상손익: D:\로컬파일\월중손익\예상손익\YYYY-MM.csv
 *   - 목표retail: D:\로컬파일\월중손익\목표retail\YYYY-MM.csv
 *   - 실적: D:\로컬파일\월중손익\실적\YYYY-MM\YYYY-MM-DD.csv
 */

import * as fs from 'fs';
import * as path from 'path';

// .env.local 로드 (Redis 접속용 - standalone 스크립트는 Next.js env 로딩 없음)
const envLocalPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      // 따옴표 제거
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

const TARGET_DIR = 'D:\\로컬파일\\월중손익\\예상손익';
const RETAIL_PLAN_DIR = 'D:\\로컬파일\\월중손익\\목표retail';
const ACTUALS_DIR = 'D:\\로컬파일\\월중손익\\실적';

// 프로젝트 루트 경로 (process.cwd() 사용)
const PROJECT_ROOT = process.cwd();
const OUTPUT_TARGETS_FILE = path.join(PROJECT_ROOT, 'src', 'data', 'plforecast', 'targets.ts');
const OUTPUT_RETAIL_PLAN_FILE = path.join(PROJECT_ROOT, 'src', 'data', 'plforecast', 'retailPlan.ts');
const OUTPUT_ACTUALS_DIR = path.join(PROJECT_ROOT, 'src', 'data', 'plforecast', 'actuals');

/**
 * YY.MM 형식을 YYYY-MM 형식으로 변환
 * 예: 25.12 -> 2025-12, 26.01 -> 2026-01
 */
function convertYmToFullYear(yyMm: string): string {
  const [yy, mm] = yyMm.split('.');
  const year = parseInt(yy, 10);
  // 2000년대 가정 (00-99 -> 2000-2099)
  const fullYear = year < 50 ? 2000 + year : 1900 + year;
  return `${fullYear}-${mm}`;
}

/**
 * 변수명 생성 (예: target_2025_12, retailPlan_2025_12, actuals_2025_12_31)
 */
function getVariableName(dateStr: string, prefix: string): string {
  return `${prefix}_${dateStr.replace(/-/g, '_')}`;
}

/**
 * CSV 파일 내용을 읽어서 이스케이프 처리
 */
function escapeCsvContent(content: string): string {
  // BOM 제거
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  // 백틱 내부에서 특수문자 이스케이프
  return content.replace(/`/g, '\\`').replace(/\${/g, '\\${');
}

/**
 * 예상손익 CSV 파일들을 읽어서 targets.ts 생성
 */
function generateTargetsFile(): void {
  console.log(`[예상손익] 폴더 확인: ${TARGET_DIR}`);
  
  if (!fs.existsSync(TARGET_DIR)) {
    console.error(`[예상손익] 폴더가 존재하지 않습니다: ${TARGET_DIR}`);
    return;
  }

  const files = fs.readdirSync(TARGET_DIR);
  const csvFiles = files.filter(f => f.endsWith('.csv') && /^\d{4}-\d{2}\.csv$/.test(f));
  
  if (csvFiles.length === 0) {
    console.warn(`[예상손익] CSV 파일을 찾을 수 없습니다: ${TARGET_DIR}`);
    return;
  }

  console.log(`[예상손익] 발견된 CSV 파일: ${csvFiles.length}개`);

  const csvMap: Array<{ fullYm: string; variableName: string; content: string }> = [];

  for (const file of csvFiles.sort()) {
    const fullYm = file.replace('.csv', ''); // 2025-12
    const variableName = getVariableName(fullYm, 'target'); // target_2025_12
    const filePath = path.join(TARGET_DIR, file);
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const escapedContent = escapeCsvContent(content);
      csvMap.push({ fullYm, variableName, content: escapedContent });
      console.log(`[예상손익] 읽음: ${file} -> ${fullYm}`);
    } catch (error) {
      console.error(`[예상손익] 파일 읽기 실패: ${file}`, error);
    }
  }

  // TypeScript 파일 생성
  const constants = csvMap.map(
    ({ variableName, content }) => `const ${variableName} = \`${content}\`;`
  ).join('\n\n');

  const mapEntries = csvMap.map(
    ({ fullYm, variableName }) => `  '${fullYm}': ${variableName},`
  ).join('\n');

  // 범례 생성
  const legend = `/*
 * ========================================
 * 범례 (Legend)
 * ========================================
 * CSV 파일 경로: ${TARGET_DIR}
 * 생성 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
 * 포함된 월: ${csvMap.map(({ fullYm }) => `${fullYm}.csv`).join(', ')}
 * 총 파일 수: ${csvMap.length}개
 * 
 * 파일명 형식: YYYY-MM.csv (예: 2025-12.csv, 2026-01.csv)
 * 업데이트 방법: CSV 파일 추가 후 npm run update-csv 실행
 * ========================================
 */`;

  const tsContent = `// 이 파일은 자동 생성됩니다. 수정하지 마세요.
// CSV 파일을 업데이트한 후 npm run update-csv 를 실행하세요.

// 월별 목표 CSV 데이터 (명시적 매핑) - 채널별 데이터 포함

${constants}

// 월별 목표 CSV 매핑
const targetCsvMap: Record<string, string> = {
${mapEntries}
};

/**
 * 기준월에 해당하는 목표 CSV 반환
 */
export function getTargetCsv(ym: string): string | null {
  const result = targetCsvMap[ym] || null;
  console.log(\`[getTargetCsv] Requested: \${ym}, Found: \${result ? \`yes (\${result.length} chars)\` : 'no'}, Available keys:\`, Object.keys(targetCsvMap));
  return result;
}

${legend}
`;

  fs.writeFileSync(OUTPUT_TARGETS_FILE, tsContent, 'utf-8');
  console.log(`[예상손익] ✅ 생성 완료: ${OUTPUT_TARGETS_FILE}`);
}

/**
 * 목표판매매출 CSV 파일들을 읽어서 retailPlan.ts 생성
 */
function generateRetailPlanFile(): void {
  console.log(`[목표판매매출] 폴더 확인: ${RETAIL_PLAN_DIR}`);
  
  if (!fs.existsSync(RETAIL_PLAN_DIR)) {
    console.error(`[목표판매매출] 폴더가 존재하지 않습니다: ${RETAIL_PLAN_DIR}`);
    return;
  }

  const files = fs.readdirSync(RETAIL_PLAN_DIR);
  const csvFiles = files.filter(f => f.endsWith('.csv') && /^\d{4}-\d{2}\.csv$/.test(f));
  
  if (csvFiles.length === 0) {
    console.warn(`[목표판매매출] CSV 파일을 찾을 수 없습니다: ${RETAIL_PLAN_DIR}`);
    return;
  }

  console.log(`[목표판매매출] 발견된 CSV 파일: ${csvFiles.length}개`);

  const csvMap: Array<{ fullYm: string; variableName: string; content: string }> = [];

  for (const file of csvFiles.sort()) {
    const fullYm = file.replace('.csv', ''); // 2025-12
    const variableName = getVariableName(fullYm, 'retailPlan'); // retailPlan_2025_12
    const filePath = path.join(RETAIL_PLAN_DIR, file);
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const escapedContent = escapeCsvContent(content);
      csvMap.push({ fullYm, variableName, content: escapedContent });
      console.log(`[목표판매매출] 읽음: ${file} -> ${fullYm}`);
    } catch (error) {
      console.error(`[목표판매매출] 파일 읽기 실패: ${file}`, error);
    }
  }

  // TypeScript 파일 생성
  const constants = csvMap.map(
    ({ variableName, content }) => `const ${variableName} = \`${content}\`;`
  ).join('\n\n');

  const mapEntries = csvMap.map(
    ({ fullYm, variableName }) => `  '${fullYm}': ${variableName},`
  ).join('\n');

  // 범례 생성
  const legend = `/*
 * ========================================
 * 범례 (Legend)
 * ========================================
 * CSV 파일 경로: ${RETAIL_PLAN_DIR}
 * 생성 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
 * 포함된 월: ${csvMap.map(({ fullYm }) => `${fullYm}.csv`).join(', ')}
 * 총 파일 수: ${csvMap.length}개
 * 
 * 파일명 형식: YYYY-MM.csv (예: 2025-12.csv, 2026-01.csv)
 * 업데이트 방법: CSV 파일 추가 후 npm run update-csv 실행
 * ========================================
 */`;

  const tsContent = `// 이 파일은 자동 생성됩니다. 수정하지 마세요.
// CSV 파일을 업데이트한 후 npm run update-csv 를 실행하세요.

// 목표판매매출 CSV 데이터 (대리상 오프라인)

${constants}

// 월별 목표 CSV 매핑
const retailPlanCsvMap: Record<string, string> = {
${mapEntries}
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
  
  const lines = csv.trim().split('\\n');
  if (lines.length < 2) return null;
  
  // 헤더 파싱
  const headers = lines[0].split(',').map(h => h.trim());
  const brandIndex = headers.indexOf('brand');
  const onoffIndex = headers.indexOf('onoff');
  const frOrClsIndex = headers.indexOf('fr_or_cls');
  const shopIdIndex = headers.indexOf('oa_shop_id');
  const saleAmtIndex = headers.indexOf('sale_amt');
  
  if (brandIndex === -1 || onoffIndex === -1 || frOrClsIndex === -1 || 
      shopIdIndex === -1 || saleAmtIndex === -1) {
    return null;
  }
  
  // 브랜드별 집계
  let totalSalesAmt = 0;
  const uniqueShopIds = new Set<string>();
  
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const brand = cols[brandIndex];
    const onoff = cols[onoffIndex];
    const frOrCls = cols[frOrClsIndex];
    const shopId = cols[shopIdIndex];
    const saleAmtStr = cols[saleAmtIndex];
    
    // 필터링 조건: 해당 브랜드, OFFLINE, FR
    if (brand === brandName && onoff === 'OFFLINE' && frOrCls === 'FR') {
      // 판매매출 합산
      const saleAmt = saleAmtStr ? parseFloat(saleAmtStr.replace(/,/g, '')) : 0;
      if (!isNaN(saleAmt)) {
        totalSalesAmt += saleAmt;
      }
      // 고유 매장수 집계
      if (shopId) {
        uniqueShopIds.add(shopId);
      }
    }
  }
  
  return {
    salesAmt: totalSalesAmt > 0 ? totalSalesAmt : null,
    shopCnt: uniqueShopIds.size > 0 ? uniqueShopIds.size : null
  };
}

/**
 * 점당매출 표시 대상 브랜드인지 확인 (M, I, X만)
 */
export function isRetailSalesBrand(brandCode: string): boolean {
  return ['M', 'I', 'X'].includes(brandCode);
}

${legend}
`;

  fs.writeFileSync(OUTPUT_RETAIL_PLAN_FILE, tsContent, 'utf-8');
  console.log(`[목표판매매출] ✅ 생성 완료: ${OUTPUT_RETAIL_PLAN_FILE}`);
}

/**
 * 실적 CSV 파일들을 읽어서 src/data/plforecast/actuals/ 하위에 월별 파일과 index.ts 생성
 * @returns 업데이트된 월 목록 (YYYY-MM 형식)
 */
function generateActualsFile(): string[] {
  console.log(`[실적] 폴더 확인: ${ACTUALS_DIR}`);
  
  if (!fs.existsSync(ACTUALS_DIR)) {
    console.error(`[실적] 폴더가 존재하지 않습니다: ${ACTUALS_DIR}`);
    return [];
  }

  // 월별 폴더 스캔 (YYYY-MM 형식) - 동적으로 모든 폴더 스캔
  const monthFolders = fs.readdirSync(ACTUALS_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && /^\d{4}-\d{2}$/.test(dirent.name))
    .map(dirent => dirent.name)
    .sort();

  if (monthFolders.length === 0) {
    console.warn(`[실적] 월별 폴더를 찾을 수 없습니다: ${ACTUALS_DIR}`);
    return [];
  }

  console.log(`[실적] 발견된 월별 폴더: ${monthFolders.length}개`);

  const csvMap: Array<{ fullYm: string; fullYmd: string; variableName: string; content: string }> = [];

  for (const monthFolder of monthFolders) {
    const folderPath = path.join(ACTUALS_DIR, monthFolder);
    const files = fs.readdirSync(folderPath);
    // 파일명은 YYYY-MM-DD.csv 형식
    const csvFiles = files.filter(f => f.endsWith('.csv') && /^\d{4}-\d{2}-\d{2}\.csv$/.test(f));
    
    if (csvFiles.length === 0) {
      console.warn(`[실적] ${monthFolder} 폴더에 CSV 파일이 없습니다`);
      continue;
    }

    // 가장 최근 파일 선택 (파일명 기준 정렬)
    const latestFile = csvFiles.sort().reverse()[0];
    const fullYmd = latestFile.replace('.csv', ''); // 2026-01-04
    const fullYm = monthFolder; // 2026-01 (이미 YYYY-MM 형식)
    const variableName = getVariableName(fullYmd, 'actuals'); // actuals_2026_01_04
    const filePath = path.join(folderPath, latestFile);
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const escapedContent = escapeCsvContent(content);
      csvMap.push({ fullYm, fullYmd, variableName, content: escapedContent });
      console.log(`[실적] 읽음: ${monthFolder}/${latestFile} -> ${fullYmd}`);
    } catch (error) {
      console.error(`[실적] 파일 읽기 실패: ${monthFolder}/${latestFile}`, error);
    }
  }

  if (csvMap.length === 0) {
    console.warn(`[실적] 읽을 수 있는 CSV 파일이 없습니다`);
    return [];
  }

  // 출력 디렉토리 준비
  if (!fs.existsSync(OUTPUT_ACTUALS_DIR)) {
    fs.mkdirSync(OUTPUT_ACTUALS_DIR, { recursive: true });
  }

  // 월별 파일 생성 (각 ym에 해당하는 단일 const export)
  for (const item of csvMap) {
    const monthFile = path.join(OUTPUT_ACTUALS_DIR, `${item.fullYm}.ts`);
    const monthTs = `// 자동 생성 — 수정하지 마세요. npm run update-csv 로 재생성됩니다.\nexport const ${item.variableName} = \`${item.content}\`;\n`;
    fs.writeFileSync(monthFile, monthTs, 'utf-8');
    console.log(`[실적] ${item.fullYm}.ts 생성 (${item.fullYmd})`);
  }

  // 현재 월별 파일 목록 (이번 실행에 포함되지 않은 옛 월 파일은 그대로 유지)
  // 다만 generateActualsFile은 ACTUALS_DIR 폴더를 모두 스캔하므로 csvMap이 곧 전체임
  // → index.ts는 csvMap 기준으로 작성

  const dateMap = new Map<string, { ym: string; varName: string }>();
  for (const item of csvMap) {
    dateMap.set(item.fullYmd, { ym: item.fullYm, varName: item.variableName });
  }
  const sortedDates = Array.from(dateMap.entries()).sort();

  const loaderEntries = sortedDates.map(
    ([ymd, { ym }]) => `  '${ymd}': () => import('./${ym}'),`
  ).join('\n');
  const varNameEntries = sortedDates.map(
    ([ymd, { varName }]) => `  '${ymd}': '${varName}',`
  ).join('\n');

  const indexTs = `// 자동 생성 — 수정하지 마세요. npm run update-csv 로 재생성됩니다.
// 생성 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
// CSV 경로: ${ACTUALS_DIR}
// 총 ${csvMap.length}개월: ${csvMap.map(({ fullYm }) => fullYm).join(', ')}

// 날짜별 동적 import 로더 (월별 파일을 lazy load)
const loaders: Record<string, () => Promise<Record<string, string>>> = {
${loaderEntries}
};

const varNames: Record<string, string> = {
${varNameEntries}
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
`;

  fs.writeFileSync(path.join(OUTPUT_ACTUALS_DIR, 'index.ts'), indexTs, 'utf-8');
  console.log(`[실적] ✅ index.ts 생성 완료 (${csvMap.length}개월)`);

  return [...new Set(csvMap.map((item) => item.fullYm))].sort();
}

// pl-forecast seasonCacheKey 계산 (route.ts와 동일 로직)
function getDefaultClothingSeason(ym: string): string {
  const month = parseInt(ym.substring(5, 7));
  const year = parseInt(ym.substring(0, 4));
  if (month >= 1 && month <= 6) {
    return `${(year - 1).toString().substring(2)}F`;
  }
  return `${year.toString().substring(2)}S`;
}
function getPreviousClothingSeason(currentSeason: string): string {
  const year = parseInt(currentSeason.substring(0, 2));
  const season = currentSeason.substring(2);
  return `${(year - 1).toString().padStart(2, '0')}${season}`;
}

/**
 * pl-forecast Redis 캐시 삭제 (업데이트된 월 기준)
 */
async function clearPlForecastCacheForMonths(months: string[]): Promise<void> {
  if (months.length === 0) return;

  if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) {
    console.warn('[캐시 삭제] Redis 미설정 - KV_REST_API_* 또는 UPSTASH_REDIS_REST_* 필요. 캐시 삭제 건너뜀.');
    return;
  }

  const { deleteCacheByYm, deleteDailyCache } = await import('@/lib/redis/cache');

  for (const ym of months) {
    await deleteCacheByYm(ym);
    const cySeason = getDefaultClothingSeason(ym);
    const pySeason = getPreviousClothingSeason(cySeason);
    const seasonCacheKey = `${cySeason}_${pySeason}`;
    for (const brand of ['all', 'M', 'K', 'I', 'X']) {
      await deleteDailyCache(ym, brand, seasonCacheKey);
    }
    console.log(`[캐시 삭제] pl-forecast ${ym}`);
  }
  console.log(`[캐시 삭제] ✅ pl-forecast 캐시 삭제 완료: ${months.join(', ')}`);
}

// 메인 실행
(async () => {
  console.log('=== CSV 데이터 업데이트 시작 ===\n');
  generateTargetsFile();
  console.log('');
  generateRetailPlanFile();
  console.log('');
  const actualsMonths = generateActualsFile();
  if (actualsMonths.length > 0) {
    console.log('');
    await clearPlForecastCacheForMonths(actualsMonths);
  }
  console.log('\n=== CSV 데이터 업데이트 완료 ===');
})();

