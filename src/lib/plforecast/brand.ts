import type { BrandCode, BrandSlug } from './types';

// 브랜드 슬러그 → 코드 매핑
const slugToCodeMap: Record<BrandSlug, BrandCode> = {
  'mlb': 'M',
  'mlb-kids': 'I',
  'discovery': 'X',
  'duvetica': 'V',
  'supra': 'W',
};

// 브랜드 코드 → 슬러그 매핑
const codeToSlugMap: Record<BrandCode, BrandSlug> = {
  'M': 'mlb',
  'I': 'mlb-kids',
  'X': 'discovery',
  'V': 'duvetica',
  'W': 'supra',
};

// 브랜드 코드 → 표시명 매핑
const codeToLabelMap: Record<BrandCode | 'all', string> = {
  'all': '전체',
  'M': 'MLB',
  'I': 'MLB KIDS',
  'X': 'DISCOVERY',
  'V': 'DUVETICA',
  'W': 'SUPRA',
};

// 탭 표시용 브랜드 목록
export const brandTabs: Array<{ slug: 'all' | BrandSlug; label: string; code: BrandCode | 'all' }> = [
  { slug: 'all', label: '전체', code: 'all' },
  { slug: 'mlb', label: 'MLB', code: 'M' },
  { slug: 'mlb-kids', label: 'MLB KIDS', code: 'I' },
  { slug: 'discovery', label: 'DISCOVERY', code: 'X' },
  { slug: 'duvetica', label: 'DUVETICA', code: 'V' },
  { slug: 'supra', label: 'SUPRA', code: 'W' },
];

export function slugToCode(slug: BrandSlug): BrandCode {
  return slugToCodeMap[slug];
}

export function codeToSlug(code: BrandCode): BrandSlug {
  return codeToSlugMap[code];
}

export function codeToLabel(code: BrandCode | 'all'): string {
  return codeToLabelMap[code];
}

export function isValidBrandSlug(slug: string): slug is BrandSlug {
  return slug in slugToCodeMap;
}

export function isValidBrandCode(code: string): code is BrandCode {
  return code in codeToSlugMap;
}

// 전체 브랜드 코드 목록
export const allBrandCodes: BrandCode[] = ['M', 'I', 'X', 'V', 'W'];

