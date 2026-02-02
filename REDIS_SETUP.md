# Redis 캐시 설정 가이드

> Snowflake 데이터를 Redis로 캐시하여 대시보드 로딩 속도 20~100배 개선

## 🎯 효과

- **첫 방문자**: 10초 (기존과 동일)
- **두 번째 이후**: 0.1~0.5초 ⚡ (20~100배 빠름!)
- **비용**: 월 10~100원 정도 (매우 저렴!)

---

## 1단계: Vercel KV 설정 (2분)

### 1.1 Vercel Dashboard 접속

1. https://vercel.com 로그인
2. 프로젝트 선택 (fnfcnpl)

### 1.2 KV Database 생성

1. **상단 탭 > Storage 클릭**
2. **Create Database 버튼 클릭**
3. **KV 선택** (Redis 기반)
4. **설정 입력**:
   - Database Name: `dashboard-cache`
   - Region: `Singapore (sin1)` 또는 `Tokyo (hnd1)` (한국과 가까운 곳)
5. **Create 버튼 클릭**

### 1.3 환경 변수 자동 연결

1. KV 생성 후 "Add to Project" 팝업이 자동으로 표시됨
2. **프로젝트 선택** → **Connect 클릭**
3. 다음 3개 환경 변수가 자동 추가됨:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `KV_REST_API_READ_ONLY_TOKEN`

### 1.4 로컬 환경 변수 설정

**Vercel Dashboard에서 환경 변수 복사:**

1. Vercel Dashboard → Settings → Environment Variables
2. 위 3개 변수의 **Value 복사**
3. 로컬 `.env.local` 파일에 추가:

```env
# Vercel KV (Redis)
KV_REST_API_URL=https://xxxxx.kv.vercel-storage.com
KV_REST_API_TOKEN=xxxxxxxxxxxxxxxx
KV_REST_API_READ_ONLY_TOKEN=xxxxxxxxxxxxxxxx
```

---

## 2단계: 코드 배포 (이미 완료!)

이미 구현되어 있습니다:
- ✅ `@vercel/kv` 패키지 설치됨
- ✅ Redis 캐시 유틸리티 (`src/lib/redis/cache.ts`)
- ✅ API 라우트에 캐시 로직 통합됨

---

## 3단계: 배포 & 테스트

### 로컬 테스트 (환경 변수 설정 후)

```bash
npm run dev
```

**테스트 방법:**
1. 브라우저 열기: http://localhost:3000/pl-forecast
2. 콘솔 확인: `[Cache MISS] Snowflake 조회 시작` (첫 방문)
3. 새로고침
4. 콘솔 확인: `[Cache HIT] Redis에서 반환` (두 번째 방문)
5. 로딩 속도 비교!

### Vercel 배포

```bash
git add .
git commit -m "feat: Redis 캐시 구현으로 대시보드 성능 개선"
git push
```

Vercel에서 자동으로 배포됩니다!

---

## 캐시 동작 방식

### Cache Aside 패턴

```
요청 접수
  ↓
Redis 캐시 확인
  ↓
캐시 있음?
  → YES: Redis에서 반환 (0.1초) ⚡
  → NO: Snowflake 조회 (10초)
         ↓
         Redis에 저장
         ↓
         응답 반환
```

### 캐시 키 구조

```
dashboard:{ym}:{brand}:{date}

예시: dashboard:2026-01:all:2026-01-26
```

- **ym**: 분석월 (2026-01)
- **brand**: 브랜드 코드 (all, M, K 등)
- **date**: KST 기준 오늘 날짜 (2026-01-26)

### TTL (자동 만료)

- **자정까지 남은 시간**으로 설정
- 다음날 00:00에 자동 만료
- 첫 방문자가 새 캐시 생성

---

## 일일 시나리오

### 2026-01-26 (월요일)

```
09:00 - 김철수 방문
        → Cache MISS
        → Snowflake 조회 (10초)
        → Redis 저장
        → 화면 표시

09:30 - 이영희 방문
        → Cache HIT
        → Redis 읽기 (0.1초)
        → 화면 표시 (빠름!)

10:00 - 박민수 방문
        → Cache HIT
        → Redis 읽기 (0.1초)
        → 화면 표시 (빠름!)

...

23:59 - 캐시 유효
```

### 2026-01-27 (화요일)

```
00:00 - 캐시 자동 만료 (TTL)

08:00 - 최지훈 방문
        → Cache MISS (새로운 날짜)
        → Snowflake 조회 (10초)
        → Redis 저장
        → 화면 표시

08:30 - 정수진 방문
        → Cache HIT
        → Redis 읽기 (0.1초)
        → 화면 표시 (빠름!)
```

---

## 비용 계산

### 무료 한도

- **10,000 requests/day** (하루)
- **256MB** 저장 공간

### 예상 사용량

**시나리오: 하루 50명 접속**

```
하루: 50 requests
한 달: 1,500 requests
가격: $0.2 × (1,500 / 100,000) = $0.003
→ 월 약 4원
```

**결론: 매우 저렴합니다!** 💰

---

## 캐시 무효화 (필요 시)

### Vercel Dashboard에서 수동 삭제

1. Storage → KV → dashboard-cache 클릭
2. 키 검색: `dashboard:*`
3. 삭제할 키 선택 → Delete

### 자동 무효화

- 매일 자정 자동 만료 (TTL)
- 날짜가 바뀌면 새 캐시 생성

---

## 문제 해결

### 캐시가 작동하지 않을 때

**1. 환경 변수 확인**

```bash
# .env.local 파일 확인
KV_REST_API_URL=https://...
KV_REST_API_TOKEN=...
KV_REST_API_READ_ONLY_TOKEN=...
```

**2. Vercel Dashboard 확인**

- Storage → KV → dashboard-cache 존재 확인
- Environment Variables → 3개 변수 확인

**3. 콘솔 로그 확인**

```
[Cache] 캐시 키 확인: dashboard:2026-01:all:2026-01-26
[Cache MISS] Snowflake 조회 필요
[Cache SET] 캐시 저장 완료 (TTL: 14시간)
```

### Redis 연결 오류

**오류 메시지:**
```
[Cache Error] 캐시 조회 실패: ...
```

**해결 방법:**
1. 환경 변수가 올바른지 확인
2. Vercel KV가 생성되어 있는지 확인
3. 캐시 오류 발생 시 Snowflake로 자동 fallback됨 (정상 동작)

---

## 참고 자료

- [Vercel KV 문서](https://vercel.com/docs/storage/vercel-kv)
- [Upstash Redis](https://upstash.com/) (Vercel KV 내부 사용)
- [Cache Aside 패턴](https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/cache-aside.html)

---

## 지원

문제가 발생하면:
1. 콘솔 로그 확인
2. Vercel Dashboard → Storage → KV 확인
3. 환경 변수 재확인

**캐시는 실패해도 정상 동작합니다!** (Snowflake로 fallback)
