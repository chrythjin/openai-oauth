# usage_limit_reached 에러 표출 수정 — 작업 기록

**작성일:** 2026-05-25  
**커밋 대상:** packages/openai-oauth-provider, packages/openai-oauth

---

## 배경

ChatGPT Plus 5시간 사용 한도(primary) 소진 시 프록시가 10분 이상 "말없이 멈춤" 현상 발생.  
원인: Vercel AI SDK가 429를 `isRetryable:true`로 판단해 3회 × 지수 백오프 재시도 후, 에러를 클라이언트가 읽을 수 없는 형태로 처리.

---

## 원인 체인 (수정 전)

1. 업스트림 → `429 usage_limit_reached` (isRetryable: true)
2. AI SDK → 3회 재시도 + 백오프 (수십 초~분)
3. 재시도 소진 → `RetryError("Failed after 3 attempts...")`
4. `stream-text.ts` → SSE 스트림 내부에 `{type:'error'}` part 주입
5. `chat-stream.ts` → `controller.error()` 호출 (이미 200 OK 헤더 전송 후)
6. `shared.ts:writeWebResponse` → 소켓 절단, 서버 stderr에만 로그
7. 클라이언트 → "200 응답인데 본문 없이 끊김" = 무한 대기

---

## 수정 내용

### A1: `packages/openai-oauth-provider/src/provider.ts`

`wrapWithUsageLimitGuard(innerFetch)` 함수 추가.

- provider fetch 래퍼에서 429/402 응답 본문을 읽어 `usage_limit_reached` / `credit_limit_reached` 감지
- 감지 시 `APICallError({ isRetryable: false })` throw → SDK 재시도 즉시 차단
- 감지 안 되면 원본 Response 그대로 반환 (다른 429는 SDK 기본 재시도 유지)

```typescript
// provider.ts 핵심 변경
const guardedFetch = wrapWithUsageLimitGuard(oauthFetch)
// config.fetch = guardedFetch (기존 oauthFetch 대체)
```

### A2: `packages/openai-oauth/src/chat-stream.ts`

스트리밍 경로 재구성. `classifyStreamError` 헬퍼 추가.

**첫 청크 peek 패턴:**
```
streamText() 호출
→ iterator.next() 한 번 await (첫 청크 peek)
  → throw 발생 시: HTTP 4xx JSON 응답 즉시 반환 (SSE 미개방)
  → error part 수신 시: HTTP 4xx JSON 응답 즉시 반환
  → 정상 part 수신 시: SSE 200 응답 개방 후 스트리밍 계속
스트리밍 도중 error part:
  → data: {"error":{...}}\n\n + data: [DONE]\n\n 흘려보내고 정상 종료
```

### A3: `packages/openai-oauth/src/chat-completions.ts`

비스트리밍 경로. `classifyGenerateError` 헬퍼 추가.

- 기존: `throw error` → `server.ts` catch → `500 server_error` (원인 불명)
- 변경: `APICallError` 추출 → status/type 보존 → 클라이언트에 직접 반환
  - `usage_limit_reached` → 429
  - `rate_limit_exceeded` → 429
  - `authentication_error` → 401/403
  - 업스트림 오류 → 502
  - 재시도 소진 → 502

---

## 에러 분류 로직 (공통)

```typescript
// usage_limit_reached 판별 우선순위
1. APICallError.data.upstream_error_type === "usage_limit_reached"  (A1 래퍼가 설정)
2. APICallError.statusCode 기반 분류 (429, 401, 403, 5xx)
3. RetryError 메시지 "Failed after" 접두사 → 502 upstream_error
4. 기타 → 500 server_error
```

---

## 검증 결과

| 항목 | 결과 |
|---|---|
| `bun run typecheck` (4 packages) | ✓ 4/4 통과 |
| `bun run test` | ✓ 74 passed, 1 skipped (라이브 E2E) |
| `bunx biome check` (변경 파일) | ✓ 클린 |
| `bun run build` (4 packages) | ✓ 4/4 통과 |

---

## 라이브 적용 절차

```powershell
# 관리자 권한 필요
sc.exe stop OpenAIOAuthProxy
# 포트 10531 해제 확인
sc.exe start OpenAIOAuthProxy
# 헬스 확인
curl http://127.0.0.1:10531/health
```

**라이브 검증 포인트:**
- 한도 소진 상태에서 요청 → OpenCode UI에 즉시 에러 메시지 표출
- 에러 타입: `usage_limit_reached`, 메시지: "ChatGPT account usage limit reached. Switch to another token slot or wait for the upstream limit to reset."
- 대시보드 로그에 `chat_error` + 정확한 메시지 기록

---

## 관련 문서

- `docs/sessions/20260525_auto_token_rotation_tui_review.md` — B 자동 토큰 로테이션 TUI 설계/리스크 검토
- `docs/sessions/20260525_live_proxy_restart_after_async_logging.md` — 이전 async logging 작업 기록
