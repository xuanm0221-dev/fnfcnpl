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
 * 형식: dashboard:{ym}:{brand}:{date}
 * - ym: 분석월 (예: 2026-01)
 * - brand: 브랜드 코드 (예: all, M, K)
 * - date: 오늘 날짜 (KST 기준, 예: 2026-01-26)
 * 
 * 예시: dashboard:2026-01:all:2026-01-26
 */
function getCacheKey(ym: string, brand: string): string {
  const kstDate = getKstDate();
  return `dashboard:${ym}:${brand}:${kstDate}`;
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
 * 특정 키 패턴의 캐시 삭제
 * 
 * @param pattern - 삭제할 키 패턴 (예: dashboard:2026-01:*)
 */
export async function deleteCachedData(pattern: string): Promise<void> {
  try {
    // Vercel KV는 KEYS 명령어를 지원하지 않으므로
    // 개별 키를 명시적으로 삭제해야 함
    console.log(`[Cache DELETE] 캐시 삭제 요청: ${pattern}`);
    // 구현은 필요 시 추가
  } catch (error) {
    console.error('[Cache Error] 캐시 삭제 실패:', error);
  }
}
