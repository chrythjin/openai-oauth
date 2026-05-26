# 안정성 우선 지연 개선 설계 근거 보고서

**작성일:** 2026-05-25  
**대상 저장소:** `C:\NEW PRG\openai-oauth`  
**목적:** 기존 성능/지연 병목 보고서의 결론을 재검토하고, 안정성을 최우선으로 하면서 속도를 개선할 수 있는 실행 방향과 현재 설계가 그렇게 된 repo 내부 근거를 정리한다.

---

## 1. 결론 요약

가장 안전하게 빨라지는 방향은 “더 많이 병렬화”하거나 “캐시를 무작정 늘리는 것”이 아니다. 이 프록시의 핵심 사용자 경험은 `/v1/responses`, `/v1/chat/completions`, `/v1/models` 요청이 안정적으로 upstream Codex/OpenAI 호환 응답을 반환하는 것이다. 따라서 최우선 원칙은 다음이다.

> **사용자 요청 경로에서 SQLite 쓰기/삭제, 큰 request body 중복 처리, token refresh 네트워크 왕복, startup/update 네트워크 작업이 직접 대기 시간을 만들지 않게 분리한다.**

최종 권장 우선순위는 다음과 같다.

| 우선순위 | 작업 | 이유 | 안정성 관점 |
|---:|---|---|---|
| P0 | SQLite request logging을 bounded async queue + batch flush로 이동 | 현재 로그 INSERT/DELETE가 요청 경로에서 동기 실행될 수 있음 | DB 장애/lock/fsync가 프록시 성공 경로를 막지 않게 함 |
| P0 | request-log pruning을 요청마다 실행하지 않고 background cadence로 이동 | 1일 retention은 유지하되 반복 DELETE 제거 | retention 보장과 요청 지연 격리의 균형 |
| P1 | token refresh를 proactive/warm-up + single-flight로 보강 | 첫 요청/만료 직전 요청이 refresh 비용을 부담 | 401 실패와 tail latency를 함께 줄임 |
| P1 | request body 중복 materialization 최소화 | 긴 Codex 대화 body에서 CPU/GC 비용 가능 | streaming rewrite 같은 큰 변경은 피하고 중복 처리부터 축소 |
| P2 | Codex version lookup/update check에 timeout/cache 추가 | startup 또는 cold `/v1/models`에서 외부 의존성 대기 가능 | 실패 시 빠른 fallback, 프록시 기능과 분리 |
| 낮춤 | 기본 proxy 경로의 SSE `.tee()` 최적화 | `responsesState: false`라 기본 CLI/proxy path에서는 대체로 비활성 | SDK/stateful 옵션 문제로 분리 취급 |

---

## 2. 이번 조사에서 확인한 핵심 사실

### 2.1 SQLite logging/pruning은 실제 hot path 안정성 리스크다

확인 파일:

- `packages/openai-oauth/src/logging.ts`
- `packages/openai-oauth/src/db.ts`
- `packages/openai-oauth/src/dashboard-api.ts`
- `.omo/plans/dashboard-backend.md`
- `docs/plans/dashboard-backend-plan.md`
- `docs/dashboard/DASHBOARD_APPLIED_PLAN.md`
- `docs/sessions/20260525_performance_latency_bottleneck_report.md`

핵심 관찰:

- `createRequestLogger()`는 SQLite DB를 열고 logger callback에서 `insertRequestLog(db, event)`를 호출한다.
- `insertRequestLog()`는 `pruneOldRequestLogs()`를 insert 전후로 호출한다.
- dashboard read 함수들도 `getUsageSummary()`, `getHourlyUsage()`, `getRecentLogs()` 진입 시 pruning을 호출한다.
- `bun:sqlite` 작업은 synchronous API이므로, logger callback이 요청 처리 흐름 안에서 호출되면 SQLite 작업이 event loop를 점유한다.
- DB write failure는 catch되어 프록시 응답을 500으로 바꾸지 않도록 설계되어 있다. 하지만 **오류 격리만 되어 있고 latency/blocking 격리는 되어 있지 않다.**

정확한 표현:

- “대규모 테이블 스캔이 확정”은 부정확하다. timestamp index가 존재한다.
- 정확한 리스크는 **요청 경로의 synchronous SQLite write/delete/prepare/fsync/checkpoint 가능성**이다.
- 측정 없이 “수십~수백 ms 확정”이라고 쓰면 안 된다. 구조적 tail latency 리스크로 표현해야 한다.

### 2.2 기존 설계 이유: 1일 retention과 MVP 단순성

repo 내부 근거:

- `docs/plans/dashboard-backend-plan.md`는 `bun:sqlite`를 `~/.codex/openai-oauth/usage.sqlite`에 두는 계획을 명시한다.
- dashboard plan 계열 문서는 dashboard가 단일 사용자 localhost proxy에서 동작하며, 1일 request-log retention을 요구한다.
- `.omo/plans/dashboard-backend.md`에는 pruning trigger를 database initialization, insert, read/aggregation에 opportunistic하게 붙이고 periodic timer를 추가하지 않는 방향이 기록되어 있다.
- `.omo/plans/dashboard-backend.md`의 acceptance 기준에는 DB insertion failure가 성공 handler response를 500으로 바꾸면 안 된다는 기준도 있다.

해석:

- per-call prune은 “성능 최적화”가 아니라 **단순하고 검증하기 쉬운 MVP 유지보수 방식**으로 굳어진 것으로 보인다.
- 그러나 같은 설계 문맥 안에 “DB failure should not break proxy”가 있으므로, 안정성 원칙을 더 엄격하게 적용하면 DB 작업은 오류뿐 아니라 **대기 시간도** 요청 경로에서 격리되어야 한다.
- 따라서 async queue + background pruning은 기존 설계를 뒤집는 것이 아니라, 기존 안정성 의도를 더 완성하는 변경이다.

### 2.3 `responsesState`와 `.tee()`는 기본 proxy 경로의 우선순위가 낮다

확인 파일:

- `packages/openai-oauth/src/server.ts`
- `packages/openai-oauth/src/cli-app.ts`
- `packages/openai-oauth-core/src/transport.ts`
- `packages/openai-oauth-core/src/state.ts`
- `packages/openai-oauth/README.md`

핵심 관찰:

- CLI/proxy server 생성 경로에서 `responsesState: false`가 전달된다.
- `captureResponsesState()`는 `state == null`이면 early return하므로 기본 proxy 경로에서는 `response.body.tee()` 비용이 발생하지 않는 것으로 봐야 한다.
- `CodexResponsesState`는 SDK/미래 stateful replay 용도로 구현되어 있지만, proxy surface는 stateless로 문서화되어 있다.
- `/v1/responses` handler도 `previous_response_id`, `item_reference` 형태의 서버 replay state 사용을 거부하고 full conversation history를 요구한다.

해석:

- 기존 보고서가 “`.tee()`가 기본 스트리밍 병목”이라고 썼다면 과장이다.
- 단, stateful SDK consumer가 `CodexResponsesState`를 넘기는 경우에는 `.tee()`와 SSE state capture 비용이 실제가 될 수 있다.
- 현재 안정성 우선 로드맵에서는 기본 proxy hot path 개선보다 낮은 우선순위로 둔다.

### 2.4 request body double buffering은 실제 후보지만 조심스럽게 접근해야 한다

확인 파일:

- `packages/openai-oauth/src/shared.ts`
- `packages/openai-oauth/src/responses.ts`
- `packages/openai-oauth/src/chat-completions.ts`
- `packages/openai-oauth-core/src/transport.ts`

핵심 관찰:

- Node request를 Web `Request`로 바꾸는 adapter는 request body를 chunk 배열로 모은 뒤 `Buffer.concat`하고 `Blob`으로 감싼다.
- `/v1/responses` 경로에서는 request JSON을 읽고, core transport에서도 `/responses` body normalization을 위해 text decode, JSON parse/stringify가 발생할 수 있다.
- `normalizeCodexResponsesBody()`는 upstream Codex contract에 맞추기 위해 unsupported param 제거, `instructions`/`store`/`stream` 조정 등을 수행한다.

해석:

- 긴 Codex 대화 payload에서는 CPU/GC 비용 후보가 맞다.
- 하지만 `/responses` body normalization은 기능 계약의 일부이므로 “그냥 pass-through”로 바꾸면 안 된다.
- 안정성 우선 변경은 streaming rewrite가 아니라, 이미 읽은 body를 재사용하거나, normalization이 필요 없는 path/body에서는 두 번째 materialization을 피하는 식의 작은 변경부터 시작해야 한다.

### 2.5 token refresh는 correctness가 우선이다

확인 파일:

- `packages/openai-oauth-core/src/auth.ts`
- `packages/openai-oauth-core/src/transport.ts`
- `docs/OPERATIONS.md`
- root `AGENTS.md`

핵심 관찰:

- `REFRESH_EXPIRY_MARGIN_MS = 5분`, `REFRESH_INTERVAL_MS = 55분`이 hard-coded되어 있다.
- access token JWT `exp`가 5분 이내이거나 last_refresh가 55분 이상이면 refresh한다.
- refresh 실패 시 기존 token을 즉시 폐기하지 않고 유지하는 설계다.
- `AuthManager`에는 inflight promise dedupe가 있어 동시 요청이 refresh storm을 만들지 않도록 한다.
- auth file hot reload는 기대하지 말고 proxy restart가 필요하다는 운영 제약이 문서화되어 있다.

해석:

- refresh를 무조건 fire-and-forget로 빼면 stale token으로 upstream 401을 만들 수 있다.
- 안정성 우선 방향은 request path에서 필요한 시점에 single-flight refresh를 유지하되, startup 또는 expiry margin 전에 proactive refresh/warm-up을 걸어 사용자가 refresh 비용을 덜 맞게 하는 것이다.
- auth file write는 credential data이므로 batching이나 aggressive write는 부적절하다. 기존 atomic/permission 정책을 보존해야 한다.

### 2.6 Codex version lookup과 update check는 주변 비용이다

확인 파일:

- `packages/openai-oauth/src/models.ts`
- `packages/openai-oauth/src/update-check.ts`
- `packages/openai-oauth/src/cli-app.ts`
- `packages/openai-oauth/README.md`

핵심 관찰:

- Codex client version resolution은 local `codex --version` → npm registry → hardcoded fallback 순서다.
- version은 1시간 cache, model list는 5분 cache, inflight dedupe가 있다.
- update check는 startup 이후 `void checkForOpenAIOAuthUpdates()`로 fire-and-forget 실행된다.
- update check에는 24시간 on-disk timestamp cache나 fetch timeout이 없다.

해석:

- “서버가 이 때문에 요청을 못 받는다”는 표현은 틀리다. server listen 이후 동작이다.
- 다만 slow/offline network에서 불필요한 outstanding fetch가 생길 수 있고, cold `/v1/models`는 version/model discovery 비용을 부담할 수 있다.
- P2로 timeout과 on-disk cache를 넣는 것이 맞다.

---

## 3. 설계 드리프트와 근거 수준

| 항목 | repo 내부 근거 | 의도/드리프트 판정 | 신뢰도 |
|---|---|---|---:|
| 1일 request-log retention | docs/plans, dashboard applied plan, `RETENTION_MS` | 명시 의도 | 높음 |
| `bun:sqlite` 사용 | dashboard review/plan, local single-user dashboard 목표 | 명시 의도 | 높음 |
| periodic timer 없이 opportunistic prune | `.omo/plans/dashboard-backend.md` | 명시 의도지만 MVP 단순성 중심 | 높음 |
| insert 전후 prune 2회 | `db.ts` 구현 | 중복 구현 가능성, 별도 근거 없음 | 중간 |
| DB failure가 proxy를 깨지 않게 함 | `logging.ts` catch/comment, `.omo` acceptance | 명시 의도 | 높음 |
| DB latency를 proxy에서 격리하지 않음 | 현재 구현 | 안정성 의도와 부분 모순 | 높음 |
| token switch/rotate 후 restart required | docs/OPERATIONS, project memory, token API constraints | 명시 의도 | 높음 |
| auth file hot reload 없음 | AGENTS/OPERATIONS | 명시 제약 | 높음 |
| `responsesState: false` stateless proxy | server/cli/README | 명시 의도 | 높음 |
| update check no 24h cache | 구현상 부재 | 명시 근거 없음, 개선 후보 | 중간 |
| Codex version no timeout | 구현상 부재 | 명시 근거 없음, 개선 후보 | 중간 |

---

## 4. 안정성 우선 설계안

### 4.1 Request logging queue

권장 구조:

1. request handler/logger는 redaction/sanitization이 끝난 log event를 bounded in-memory queue에 넣고 즉시 반환한다.
2. single background consumer가 queue를 주기적으로 drain한다.
3. drain은 batch transaction으로 SQLite에 쓴다.
4. queue overflow 시 proxy request를 막지 않고 오래된 로그 또는 새 로그를 drop한다. drop counter는 memory metric이나 dashboard status에 표시할 수 있다.
5. process 종료 시 best-effort flush 후 DB close/checkpoint를 수행한다.

중요 원칙:

- 로그는 관측 데이터이며 프록시 기능의 핵심 데이터가 아니다.
- 로그 유실 가능성은 허용 가능하지만, 토큰/인증 파일 유실은 허용하면 안 된다.
- redaction은 queue에 넣기 전에 끝내야 한다. 민감 경로나 email/token이 queue에 남으면 안 된다.

### 4.2 Pruning cadence

권장 구조:

- startup 시 1회 prune
- 이후 1분 또는 5분 interval prune
- 또는 flush batch N회마다 prune
- dashboard read는 기본적으로 prune하지 않는다. 필요하면 “마지막 prune이 오래됐을 때만” opportunistic하게 한 번 수행한다.

1일 retention 유지:

- retention 요구사항은 “항상 정확히 24시간 이전 row가 0개”가 아니라 “dashboard request-log가 1일 보관 정책을 따른다”로 해석하는 것이 현실적이다.
- 몇 초~몇 분의 cleanup lag는 사용성/안정성 tradeoff상 허용 가능하다.

### 4.3 SQLite WAL/PRAGMA

외부 근거:

- SQLite 공식 WAL 문서: https://www.sqlite.org/wal.html
- SQLite PRAGMA 문서: https://www.sqlite.org/pragma.html
- Bun SQLite 문서: https://github.com/oven-sh/bun/blob/main/docs/runtime/sqlite.mdx

권장:

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

검토 후 적용 가능:

```sql
PRAGMA synchronous = NORMAL;
PRAGMA wal_autocheckpoint = 1000;
```

주의:

- WAL은 readers/writer 간 blocking을 줄이지만 writer는 여전히 하나다.
- `synchronous=NORMAL`은 analytics/request-log에는 적합할 수 있으나, credential/vault state에는 부적합하다.
- WAL sidecar 파일(`-wal`, `-shm`)과 checkpoint 정책을 운영 문서에 반영해야 한다.
- request path에서 동기 insert를 계속 하면 WAL만으로는 충분하지 않다. 핵심은 **WAL + async/batched writer + background checkpoint/prune** 조합이다.

### 4.4 Token proactive refresh

권장:

- AuthManager가 token expiry timestamp를 기억한다.
- expiry margin 전에 background refresh를 예약한다.
- refresh 실패 시 기존 token이 아직 유효하면 계속 사용한다.
- 실제 요청 시 stale이면 single-flight refresh를 await한다.
- switch/rotate 후 restart-required 정책은 유지한다.

하지 말 것:

- auth.json을 매 요청마다 다시 읽지 않는다.
- refresh를 완전히 fire-and-forget로 만들어 stale token을 upstream에 보내지 않는다.
- token/vault 파일 write를 logging queue와 같은 식으로 batch하지 않는다.

### 4.5 Request body 처리 축소

권장:

- `/responses`가 아니거나 JSON normalization이 필요 없는 경우 body text decode/parse를 피한다.
- 이미 materialized된 body를 downstream에서 재사용할 수 있는 구조를 검토한다.
- `normalizeCodexResponsesBody()` 결과가 원문과 동일하면 stringify를 피할 수 있는지 검토한다.

주의:

- `/responses`는 upstream Codex contract 보정이 필요하므로 무조건 pass-through 변경은 위험하다.
- large-body streaming rewrite는 구현 위험이 크므로 후순위다.

### 4.6 Version/update network 비용 격리

권장:

- `codex --version` exec와 npm registry fetch에 timeout을 건다.
- remote lookup 실패 시 빠르게 hardcoded fallback을 사용한다.
- update check는 24시간 on-disk timestamp cache를 둔다.
- update check failure는 지금처럼 warning/no-op이어야 한다.

---

## 5. 구현 순서 제안

### Phase 1: 가장 안전한 즉효 개선

1. request-log async queue 도입
2. `insertRequestLog()`에서 inline pruning 제거
3. background prune scheduler 추가
4. DB open 시 WAL/busy_timeout 적용 검토
5. shutdown flush/checkpoint 추가

검증:

- `bun run typecheck`
- `bun run test`
- `/v1/models` smoke
- `/v1/chat/completions` 또는 `/v1/responses` 최소 요청 smoke
- dashboard `/api/dashboard/summary`, `/api/dashboard/logs`, `/dashboard` smoke

### Phase 2: token tail latency 개선

1. AuthManager expiry metadata 저장
2. proactive refresh 예약
3. single-flight refresh 유지
4. refresh 실패 시 기존 token fallback 경로 확인

검증:

- refresh-needed auth fixture test
- refresh failure fallback test
- token switch/rotate 후 `restart_required: true` 유지 확인

### Phase 3: body 처리 최적화

1. 중복 body materialization 지점 계측
2. `/responses` normalization 필요 조건 축소
3. 동일 body 결과에서 stringify 생략 가능성 검토

검증:

- 긴 payload smoke benchmark
- `/responses` unsupported param stripping regression test
- streaming/non-streaming response 동작 확인

### Phase 4: 주변 startup/network 비용 정리

1. Codex version timeout/fallback
2. update check 24h cache/timeout
3. dashboard static file existence cache 등 작은 sync fs 제거

---

## 6. 기존 보고서에서 수정해야 할 표현

기존 `docs/sessions/20260525_performance_latency_bottleneck_report.md` 또는 후속 보고서를 고친다면 아래 표현을 바꿔야 한다.

| 기존 표현 유형 | 문제 | 수정 표현 |
|---|---|---|
| “대규모 테이블 스캔” | timestamp index가 있음 | “동기 SQLite DELETE/INSERT/prepare/fsync 가능성이 요청 경로에 있음” |
| “수십~수백 ms 확정” | 측정 없음 | “tail latency와 event-loop blocking 가능성이 있는 구조적 리스크” |
| “Codex version lookup 때문에 서버가 서빙 못함” | server listen 후 실행 | “cold `/v1/models` 또는 startup 후 background 작업에서 외부 의존성 대기 가능” |
| “SSE tee가 기본 proxy 병목” | `responsesState: false` | “stateful SDK/replay 옵션에서만 주요 비용, 기본 proxy path 우선순위 낮음” |
| “P0만 하면 비약 개선” | body/token 등 누락 | “P0는 DB hot-path 격리이며, body/token tail latency는 별도 단계” |

---

## 7. 최종 권장안

이 저장소는 단일 사용자 localhost proxy이고, dashboard/account management도 그 범위 안에서 설계되어 있다. 따라서 대규모 분산 시스템식 최적화보다 다음 기준이 더 중요하다.

1. 프록시 요청 성공 경로를 가장 짧게 유지한다.
2. 관측/대시보드 데이터는 best-effort로 다룬다.
3. token/vault/auth 파일은 best-effort가 아니라 correctness/durability를 우선한다.
4. 외부 네트워크 조회는 timeout/cache/fallback으로 격리한다.
5. periodic live Codex health/quota check는 API quota 때문에 추가하지 않는다.

따라서 첫 구현은 다음 한 문장으로 정리된다.

> **SQLite request logging과 pruning을 요청 경로 밖으로 빼고, bounded async queue + batched SQLite writer + background prune/WAL로 바꾸는 것이 안정성을 가장 덜 해치면서 가장 직접적으로 속도와 tail latency를 개선하는 방법이다.**

---

## 8. 조사에 사용한 주요 근거

### Repo 내부

- `packages/openai-oauth/src/db.ts`
- `packages/openai-oauth/src/logging.ts`
- `packages/openai-oauth/src/dashboard-api.ts`
- `packages/openai-oauth/src/shared.ts`
- `packages/openai-oauth/src/responses.ts`
- `packages/openai-oauth/src/chat-completions.ts`
- `packages/openai-oauth/src/server.ts`
- `packages/openai-oauth/src/cli-app.ts`
- `packages/openai-oauth/src/models.ts`
- `packages/openai-oauth/src/update-check.ts`
- `packages/openai-oauth-core/src/auth.ts`
- `packages/openai-oauth-core/src/transport.ts`
- `packages/openai-oauth-core/src/state.ts`
- `docs/plans/dashboard-backend-plan.md`
- `docs/dashboard/DASHBOARD_APPLIED_PLAN.md`
- `docs/dashboard/DASHBOARD_REVIEW.md`
- `docs/comparison-codex-lb.md`
- `docs/OPERATIONS.md`
- `.omo/plans/dashboard-backend.md`
- `.omo/notepads/dashboard-backend/learnings.md`
- `.omo/notepads/dashboard-backend/issues.md`
- `docs/sessions/20260525_performance_latency_bottleneck_report.md`

### 외부 문서

- SQLite Write-Ahead Logging: https://www.sqlite.org/wal.html
- SQLite PRAGMA: https://www.sqlite.org/pragma.html
- Bun SQLite runtime docs: https://github.com/oven-sh/bun/blob/main/docs/runtime/sqlite.mdx

---

## 9. 미확인/추가 검증 필요

- 실제 개선 수치는 계측 전에는 주장하지 않는다.
- `synchronous=NORMAL` 적용 여부는 request-log DB에 한정해 별도 검토한다.
- body buffering 개선은 `/responses` contract regression test를 먼저 둔 뒤 진행한다.
- proactive refresh는 token/vault restart-required 정책과 충돌하지 않게 설계해야 한다.
- 독립 hot-path 검토에서 `dashboard-logging > should compose multiple loggers and persist to SQLite` 테스트가 `requestCount` 0으로 실패했다는 보고가 있었다. 이번 작업에서는 재현/수정하지 않았으므로, request-log async queue 구현 전에 현재 logging persistence test 상태를 먼저 직접 재확인해야 한다.
