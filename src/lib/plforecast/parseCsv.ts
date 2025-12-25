import { parse } from 'csv-parse/sync';
import type { AccountMapping, TargetRow, BrandCode } from './types';

/**
 * 계정맵핑.csv 파싱
 */
export function parseAccountMapping(csvContent: string): AccountMapping[] {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;

  return records.map((row) => ({
    level1: row['level1'] || '',
    level2: row['level2'] || '',
    level3: row['level3'] || '',
    item: row['ITEM'] || '',
  }));
}

/**
 * 목표 CSV 파싱 (예상손익_YY.MM.csv)
 * 첫 번째 컬럼은 영문 라벨(무시), 이후 level1/level2/level3, M/I/X/V/W 컬럼
 */
export function parseTargetCsv(csvContent: string): TargetRow[] {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Array<Record<string, string>>;

  return records.map((row) => ({
    level1: row['level1'] || '',
    level2: row['level2'] || '',
    level3: row['level3'] || '',
    M: parseTargetValue(row[' M '] || row['M'] || ''),
    I: parseTargetValue(row['I'] || ''),
    X: parseTargetValue(row['X'] || ''),
    V: parseTargetValue(row['V'] || ''),
    W: parseTargetValue(row['W'] || ''),
  }));
}

/**
 * 목표 값 파싱 (콤마 제거, 숫자 변환)
 */
function parseTargetValue(value: string): number | null {
  if (!value || value.trim() === '' || value.trim() === '-') {
    return null;
  }
  // 콤마, 따옴표 제거
  const cleaned = value.replace(/[",]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * 계정맵핑에서 level1/level2/level3 조건에 맞는 item 목록 반환
 */
export function getItemsByLevel(
  mappings: AccountMapping[],
  level1?: string,
  level2?: string,
  level3?: string
): string[] {
  return mappings
    .filter((m) => {
      if (level1 && m.level1 !== level1) return false;
      if (level2 && m.level2 !== level2) return false;
      if (level3 && m.level3 !== level3) return false;
      return true;
    })
    .map((m) => m.item);
}

/**
 * 목표 CSV에서 특정 level1/level2/level3에 해당하는 목표값 조회
 */
export function getTargetValue(
  targets: TargetRow[],
  brandCode: BrandCode,
  level1?: string,
  level2?: string,
  level3?: string
): number | null {
  const matched = targets.filter((t) => {
    if (level1 && t.level1 !== level1) return false;
    if (level2 && t.level2 !== level2) return false;
    if (level3 && t.level3 !== level3) return false;
    return true;
  });

  if (matched.length === 0) return null;

  // 여러 행이 매칭되면 합산
  let sum = 0;
  let hasValue = false;
  for (const row of matched) {
    const val = row[brandCode];
    if (val !== null) {
      sum += val;
      hasValue = true;
    }
  }
  return hasValue ? sum : null;
}

/**
 * 전체(all) 브랜드의 목표값 조회 (5개 브랜드 합산)
 */
export function getTargetValueAll(
  targets: TargetRow[],
  level1?: string,
  level2?: string,
  level3?: string
): number | null {
  const brandCodes: BrandCode[] = ['M', 'I', 'X', 'V', 'W'];
  let sum = 0;
  let hasValue = false;

  for (const code of brandCodes) {
    const val = getTargetValue(targets, code, level1, level2, level3);
    if (val !== null) {
      sum += val;
      hasValue = true;
    }
  }

  return hasValue ? sum : null;
}

