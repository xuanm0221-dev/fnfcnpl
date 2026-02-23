import { createClient } from '@vercel/kv';

/**
 * Redis 클라이언트
 * - Vercel KV: KV_REST_API_URL, KV_REST_API_TOKEN
 * - Upstash 연동: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 * 둘 중 하나만 있으면 동작
 */
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const kv = url && token ? createClient({ url, token }) : null;

/**
 * Redis 캐시 유틸리티
 * 
 * Cache Aside 패턴 구현:
 * 1. 캐시 확인
 * 2. 캐시 없으면 Snowflake 조회
 * 3. 결과를 캐시에 저장
 */

/**
 * 캐시 키 생성
 *
 * 형식: dashboard:{ym}:{brand}:{date}:{version}
 * - ym: 분석월 (예: 2026-01)
 * - brand: 브랜드 코드 (예: all, M, K)
 * - date: 오늘 날짜 (KST 기준)
 * - version: VERCEL_GIT_COMMIT_SHA (배포마다 변경 → 재배포 시 새 캐시 사용)
 *
 * 재배포 후 수정본이 바로 반영되도록 버전 포함
 */
function getCacheKey(ym: string, brand: string): string {
  const kstDate = getKstDate();
  const version = process.env.VERCEL_GIT_COMMIT_SHA || 'local';
  return `dashboard:${ym}:${brand}:${kstDate}:${version}`;
}

/**
 * KST 기준 오늘 날짜 (YYYY-MM-DD)
 */
function getKstDate(): string {
  const now = new Date();
  const kstOffset = 9 * 60; // KST = UTC+9
  const kstTime = new Date(now.getTime() + kstOffset * 60 * 1000);
  
  const year = kstTime.getUTCFullYear();
  const month = String(kstTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kstTime.getUTCDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * 자정까지 남은 시간 (초)
 * TTL로 사용하여 자정에 자동 만료
 */
function getSecondsUntilMidnight(): number {
  const now = new Date();
  const kstOffset = 9 * 60; // KST = UTC+9
  const kstTime = new Date(now.getTime() + kstOffset * 60 * 1000);
  
  const midnight = new Date(kstTime);
  midnight.setUTCHours(24, 0, 0, 0); // 다음날 00:00
  
  const secondsUntilMidnight = Math.floor((midnight.getTime() - kstTime.getTime()) / 1000);
  
  // 최소 1시간 보장 (3600초)
  return Math.max(secondsUntilMidnight, 3600);
}

/**
 * 캐시에서 데이터 가져오기
 * 
 * @param ym - 분석월 (예: 2026-01)
 * @param brand - 브랜드 코드 (예: all)
 * @returns 캐시된 데이터 또는 null
 */
export async function getCachedData<T>(ym: string, brand: string): Promise<T | null> {
  if (!kv) {
    console.log('[Cache] Redis 미설정 - KV_REST_API_* 또는 UPSTASH_REDIS_REST_* 환경 변수 필요');
    return null;
  }
  try {
    const key = getCacheKey(ym, brand);
    console.log(`[Cache] 캐시 키 확인: ${key}`);
    
    const cached = await kv.get<T>(key);
    
    if (cached) {
      console.log(`[Cache HIT] Redis에서 데이터 반환`);
      return cached;
    } else {
      console.log(`[Cache MISS] Snowflake 조회 필요`);
      return null;
    }
  } catch (error) {
    console.error('[Cache Error] 캐시 조회 실패:', error);
    // 캐시 오류 시 null 반환하여 Snowflake 조회로 fallback
    return null;
  }
}

/**
 * 데이터를 캐시에 저장
 * 
 * @param ym - 분석월
 * @param brand - 브랜드 코드
 * @param data - 저장할 데이터
 */
export async function setCachedData<T>(ym: string, brand: string, data: T): Promise<void> {
  if (!kv) {
    console.log('[Cache] Redis 미설정 - 캐시 저장 생략');
    return;
  }
  try {
    const key = getCacheKey(ym, brand);
    const ttl = getSecondsUntilMidnight();
    
    await kv.set(key, data, { ex: ttl });
    
    console.log(`[Cache SET] 캐시 저장 완료 (TTL: ${Math.floor(ttl / 3600)}시간)`);
  } catch (error) {
    console.error('[Cache Error] 캐시 저장 실패:', error);
    // 캐시 저장 실패해도 계속 진행 (Snowflake 데이터는 정상 반환)
  }
}

/**
 * 일별 캐시 삭제 (스냅샷 저장/삭제 시 호출하여 충돌 방지)
 */
export async function deleteDailyCache(ym: string, brand: string): Promise<void> {
  if (!kv) return;
  try {
    const key = getCacheKey(ym, brand);
    await kv.del(key);
    console.log(`[Cache DELETE] 일별 캐시 삭제: ${key}`);
  } catch (error) {
    console.error('[Cache Error] 일별 캐시 삭제 실패:', error);
  }
}

// ─────────────────────────────────────────────
// 스냅샷 유틸리티 (영구 저장, TTL 없음)
//
// 키 규칙:
//   snapshot:retail:{ym}:{brand}   - 점당매출/Tier/지역/TradeZone/ShopLevel/카테고리
//   snapshot:clothing:{ym}:{brand} - 의류 판매율
//   snapshot:weekly:{ym}           - 주차별 매출 추이 (전체 페이지)
//   snapshot:dx:{brand}            - 정규매장별 월별 리테일 매출 (월별 맵)
// ─────────────────────────────────────────────

export type SnapshotType = 'retail' | 'clothing' | 'weekly' | 'dx';

function getSnapshotKey(type: SnapshotType, ym: string, brand?: string): string {
  if (type === 'weekly') return `snapshot:weekly:${ym}`;
  if (type === 'dx') return `snapshot:dx:${brand}`;
  return `snapshot:${type}:${ym}:${brand}`;
}

/**
 * 스냅샷 존재 여부 확인
 */
export async function hasSnapshot(type: SnapshotType, ym: string, brand?: string): Promise<boolean> {
  if (!kv) return false;
  try {
    const key = getSnapshotKey(type, ym, brand);
    const val = await kv.exists(key);
    return val === 1;
  } catch {
    return false;
  }
}

/**
 * 스냅샷 조회
 */
export async function getSnapshot<T>(type: SnapshotType, ym: string, brand?: string): Promise<T | null> {
  if (!kv) return null;
  try {
    const key = getSnapshotKey(type, ym, brand);
    const data = await kv.get<T>(key);
    if (data) console.log(`[Snapshot HIT] ${key}`);
    return data ?? null;
  } catch (error) {
    console.error('[Snapshot Error] 조회 실패:', error);
    return null;
  }
}

/**
 * 스냅샷 저장 (영구, TTL 없음)
 * 저장 후 해당 ym/brand의 일별 캐시도 무효화
 */
export async function setSnapshot<T>(type: SnapshotType, ym: string, brand: string | undefined, data: T): Promise<void> {
  if (!kv) {
    console.log('[Snapshot] Redis 미설정 - 저장 생략');
    return;
  }
  try {
    const key = getSnapshotKey(type, ym, brand);
    await kv.set(key, data);
    console.log(`[Snapshot SET] ${key}`);
    // 일별 캐시 무효화 (스냅샷과 충돌 방지)
    if (brand) await deleteDailyCache(ym, brand);
  } catch (error) {
    console.error('[Snapshot Error] 저장 실패:', error);
  }
}

/**
 * 스냅샷 삭제 (재계산 시 호출)
 * 삭제 후 해당 ym/brand의 일별 캐시도 무효화
 */
export async function deleteSnapshot(type: SnapshotType, ym: string, brand?: string): Promise<void> {
  if (!kv) return;
  try {
    const key = getSnapshotKey(type, ym, brand);
    await kv.del(key);
    console.log(`[Snapshot DELETE] ${key}`);
    if (brand) await deleteDailyCache(ym, brand);
  } catch (error) {
    console.error('[Snapshot Error] 삭제 실패:', error);
  }
}

/**
 * DX 스냅샷: 특정 월 데이터 병합 저장
 * 기존 맵에 새 월 데이터를 추가/덮어씀
 */
export async function mergeDxSnapshot<T>(brand: string, ym: string, monthData: T): Promise<void> {
  if (!kv) return;
  try {
    const key = getSnapshotKey('dx', ym, brand);
    const existing = await kv.get<Record<string, T>>(key) ?? {};
    existing[ym] = monthData;
    await kv.set(key, existing);
    console.log(`[Snapshot DX MERGE] ${key} - 월: ${ym}`);
    await deleteDailyCache(ym, brand);
  } catch (error) {
    console.error('[Snapshot DX Error] 병합 저장 실패:', error);
  }
}

/**
 * DX 스냅샷: 월별 맵 전체 조회
 */
export async function getDxSnapshot<T>(brand: string): Promise<Record<string, T> | null> {
  if (!kv) return null;
  try {
    const key = `snapshot:dx:${brand}`;
    return await kv.get<Record<string, T>>(key) ?? null;
  } catch {
    return null;
  }
}
