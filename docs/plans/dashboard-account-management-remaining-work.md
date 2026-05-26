# Dashboard Account Management Remaining Work Plan

**작성일:** 2026-05-18  
**대상:** `packages/openai-oauth`, `packages/openai-oauth-dashboard`  
**목표:** 현재 구현된 Dashboard/Token Management MVP를 `.codex` CLI 토큰 스크립트 대체에 더 가깝게 완성한다. `codex-lb` 전체 포팅은 범위가 아니며, 단일 사용자 localhost 프록시 운영에 필요한 기능만 다룬다.

---

## 1. 현재 확인된 상태

### 이미 구현됨

- 프록시가 `/dashboard` 정적 UI를 직접 서빙한다.
- Usage 탭은 summary cards, hourly chart, recent logs table을 렌더링한다.
- Dashboard API가 존재한다.
  - `GET /api/dashboard/summary`
  - `GET /api/dashboard/hourly`
  - `GET /api/dashboard/logs`
  - `GET /api/dashboard/status`
- SQLite 사용량 저장은 `bun:sqlite` 기반이며 1일 보관 정책을 사용한다.
- Tokens 탭은 slot card, active 표시, switch, rotate, inactive delete, proxy status, restart required 안내를 제공한다.
- Token API가 존재한다.
  - `GET /api/tokens/slots`
  - `POST /api/tokens/switch`
  - `POST /api/tokens/rotate`
  - `POST /api/tokens/add`
  - `DELETE /api/tokens/slots/:slot`
- Token API 보안 제약이 일부 반영되어 있다.
  - `GET /api/tokens/slots`는 wildcard CORS를 제거한다.
  - POST/DELETE token API는 Origin/Referer를 검증한다.
  - slot 응답은 raw token, auth.json 내용, 파일 경로, 이메일을 노출하지 않는다.

### 아직 완료라고 볼 수 없는 부분

- Tokens 탭에 `POST /api/tokens/add`를 호출하는 Add UI가 없다.
- `POST /api/tokens/add`를 MVP에 유지할지, UI에서 노출할지, 아니면 제외/비활성화할지 결정이 필요하다.
- Login/logout/browser OAuth 플로우는 MVP 제외로 유지되어 있다.
- Dashboard API 전체 CORS 정책은 token slots보다 느슨하다. 요구사항상 필수 위반은 아니지만 localhost-only 제품 성격에는 더 엄격한 정책이 낫다.
- 브라우저 기반 실제 렌더링/상호작용 QA 기록이 부족하다.
- `.codex` CLI 스크립트 대체 관점의 사용자 문서가 아직 최신 UI 중심으로 정리되지 않았다.

---

## 2. 범위 결정

### 유지할 MVP 제외 항목

아래 항목은 이번 후속 작업에서도 구현하지 않는다.

- 멀티유저/admin auth
- load balancer statistics
- API key management
- Playwright를 제품 의존성으로 추가
- live Codex quota 조회
- self-restart
- login/logout/browser popup OAuth
- `sourcePath` 기반 token import
- CI integration
- Docker/Kubernetes/PostgreSQL/Prometheus/OpenTelemetry

### 이번 계획의 완료 기준

- 사용자가 Dashboard의 Tokens 탭에서 현재 CLI 메뉴의 주요 안전 작업을 수행하거나, UI에서 명확히 “이 작업은 CLI로 유지”됨을 알 수 있다.
- token mutation은 계속 Origin/Referer 검증과 redaction을 만족한다.
- switch/rotate는 restart required 안내를 명확히 보여준다.
- delete는 inactive slot만 허용하고 restart 안내를 띄우지 않는다.
- `bun run build`, `bun run typecheck`, 관련 API surface QA가 통과한다.

---

## 3. 작업 계획

### Phase 1 — Add token 정책 확정 및 API 정리

**결정:** MVP에서 browser login과 `sourcePath` import는 제외한다. `POST /api/tokens/add`는 “현재 기본 `auth.json`을 vault slot으로 저장”하는 로컬 작업으로만 유지하거나, 완전 제외한다.

권장안:

1. `POST /api/tokens/add`는 유지한다.
2. custom `sourcePath`는 계속 400으로 거부한다.
3. 응답에는 `{ success: true, slot }`만 반환하고 restart required는 붙이지 않는다.
4. 실패 메시지는 경로를 포함하지 않도록 유지한다.
5. API 주석과 docs에서 “login/import가 아니라 현재 active auth snapshot 저장”으로 명확히 표현한다.

수정 후보:

- `packages/openai-oauth/src/token-vault-api.ts`
- `packages/openai-oauth/src/vault-ops.ts`
- `docs/OPERATIONS.md`
- `docs/MANAGE_TOKEN_GUIDE.md`

검증:

- 정상 Origin으로 `POST /api/tokens/add` 호출 시 raw path/token/email 미노출 확인
- `sourcePath` 포함 요청이 400으로 거부되는지 확인
- null/외부 Origin이 403인지 확인

---

### Phase 2 — Tokens 탭 UX 완성

`packages/openai-oauth-dashboard/src/components/TokensTab.tsx`를 보완한다.

필수 작업:

1. Add token 버튼 추가
   - 버튼 라벨 예: `Save current auth as slot`
   - 설명 문구: “브라우저 로그인은 MVP 제외입니다. 새 로그인은 기존 CLI 메뉴에서 수행한 뒤 이 버튼으로 현재 auth를 vault에 저장하세요.”
   - `POST /api/tokens/add` 호출
   - 성공 시 slot 목록 reload
   - 실패 시 redacted error 표시
2. switch/rotate/delete/add 공통 pending 상태 추가
   - 중복 클릭 방지
   - 작업 중 버튼 disabled
3. 작업 결과 메시지 영역 추가
   - success/error/restart required를 한 영역에서 표시
   - switch/rotate만 restart required 안내
   - delete/add는 restart 안내 없음
4. delete UX 명확화
   - active slot delete 버튼은 disabled 유지
   - inactive slot만 삭제 가능하다는 설명 추가
5. 빈 상태 개선
   - 현재 `Add tokens via the command line.` 문구를 새 정책에 맞게 수정

검증:

- slot 목록 렌더링
- inactive switch 버튼 클릭 후 restart 안내 표시
- rotate 클릭 후 restart 안내 표시
- active delete 불가
- inactive delete 후 restart 안내 없음
- add 버튼 성공/실패 메시지 표시

---

### Phase 3 — Usage 탭 polish 및 데이터 일관성 점검

`packages/openai-oauth-dashboard/src/components/UsageTab.tsx`는 동작하지만 최소 polish가 남아 있다.

작업:

1. API 응답 타입과 frontend coercion을 정리한다.
   - backend 응답 shape가 안정적이면 과도한 fallback을 줄인다.
   - 단, UI crash 방지를 위한 최소 fallback은 유지한다.
2. hourly chart tooltip에서 requests 외 tokens도 표시할지 결정한다.
   - 현재 차트는 requests 중심이다.
   - 계획상 “요청수 + 토큰”이면 tokens series를 추가한다.
3. logs table 상태/에러 표시 개선
   - error row 시각 구분
   - duration/usage null 처리
4. loading/error/empty 상태를 Apple HIG 스타일과 맞춘다.

검증:

- 빈 DB 상태에서 Usage 탭이 crash 없이 empty state 표시
- 실제 로그가 있을 때 summary/hourly/logs 렌더링
- dark/light mode에서 가독성 확인

---

### Phase 4 — Dashboard API CORS/localhost-only hardening

필수 제약은 token slots에만 명시되어 있지만, 제품 성격상 dashboard API도 localhost-only로 일관시키는 것이 낫다.

작업:

1. `/api/dashboard/*` 응답의 wildcard CORS 필요성을 재검토한다.
2. 대시보드 정적 파일과 같은 origin에서만 쓰는 API라면 wildcard CORS를 제거한다.
3. token API의 `toTokenApiResponse` 패턴을 dashboard API에도 적용할지 결정한다.
4. 문서에 “Dashboard는 localhost same-origin 사용”을 명시한다.

검증:

- `/api/tokens/slots`에 `Access-Control-Allow-Origin: *`가 없는지 확인
- `/api/dashboard/summary`의 CORS 정책 확인
- Dashboard UI가 same-origin fetch로 계속 동작하는지 확인

---

### Phase 5 — 문서 최신화

CLI 스크립트를 완전히 제거하지는 않더라도, 사용자가 Dashboard 우선 흐름을 알 수 있게 문서를 갱신한다.

수정 후보:

- `docs/OPERATIONS.md`
- `docs/MANAGE_TOKEN_GUIDE.md`
- `docs/dashboard/DASHBOARD_APPLIED_PLAN.md`
- 새 세션 기록: `docs/sessions/YYYYMMDD_HHMMSS_dashboard-account-management-completion.md`

포함할 내용:

- Dashboard 접근 URL: `http://127.0.0.1:10531/dashboard`
- Usage 탭 기능
- Tokens 탭 기능
- switch/rotate 후 수동 restart 명령
  - `.codex\launchers\manage-tokens.bat restart`
- Dashboard에서 하지 않는 작업
  - browser login
  - sourcePath import
  - self-restart
  - multi-user/admin auth
- CLI는 fallback/운영 복구 경로로 유지된다는 점

---

## 4. 권장 구현 순서

1. `token-vault-api.ts`의 Add API 의미와 에러 메시지를 확정한다.
2. `TokensTab.tsx`에 Add/pending/result UX를 추가한다.
3. `UsageTab.tsx`의 chart/log polish를 적용한다.
4. dashboard API CORS 정책을 정리한다.
5. 문서를 Dashboard 우선 흐름으로 갱신한다.
6. 빌드, 타입체크, live API, 브라우저 UI QA를 수행한다.
7. 세션 기록을 `docs/sessions/`에 저장한다.

---

## 5. 검증 체크리스트

### 정적 검증

```powershell
bun run typecheck
bun run build
bun run format-and-lint
```

### API surface QA

```powershell
curl.exe -i http://127.0.0.1:10531/api/tokens/slots
curl.exe -i http://127.0.0.1:10531/api/dashboard/summary
curl.exe -i http://127.0.0.1:10531/api/dashboard/hourly
curl.exe -i http://127.0.0.1:10531/api/dashboard/logs
curl.exe -i http://127.0.0.1:10531/dashboard
```

Token mutation QA는 실제 vault 변경을 일으키므로 테스트 슬롯/백업을 확인한 뒤 수행한다.

```powershell
# 정상 Origin 예시
curl.exe -i -X POST http://127.0.0.1:10531/api/tokens/rotate `
  -H "Origin: http://127.0.0.1:10531"

# 거부되어야 하는 Origin 예시
curl.exe -i -X POST http://127.0.0.1:10531/api/tokens/rotate `
  -H "Origin: http://evil.example"
```

### 브라우저 QA

- `/dashboard` 접속
- Usage 탭 로딩/empty/data 상태 확인
- Tokens 탭 slot card 확인
- switch/rotate/add/delete 버튼 상태와 결과 메시지 확인
- restart required 안내 문구 확인
- 콘솔 에러 없음 확인
- light/dark mode에서 주요 텍스트 가독성 확인

---

## 6. 위험과 주의사항

- `auth.json`은 shared read/write target이다. token mutation 테스트 전 백업 상태를 확인한다.
- OneDrive/iCloud/Dropbox 같은 cloud-sync 경로의 `CODEX_HOME`은 vault corruption 위험이 있으므로 피한다.
- token API 응답에 raw token, auth.json 내용, 파일 경로, 이메일이 들어가면 안 된다.
- `DELETE /api/tokens/slots/:slot`은 inactive slot만 삭제해야 한다.
- switch/rotate는 디스크 상태만 바꾸므로 프록시 재시작 전 런타임 토큰이 바뀌었다고 말하면 안 된다.
- self-restart는 이번 범위가 아니다.

---

## 7. 완료 정의

이 계획은 아래가 모두 충족되면 완료로 본다.

- Tokens 탭에서 switch/rotate/add/delete의 정책과 UX가 명확하다.
- Usage 탭이 빈 DB와 실제 로그 상태 모두에서 깨지지 않는다.
- token mutation 보안 검증이 통과한다.
- `bun run typecheck`, `bun run build`, `bun run format-and-lint`가 통과한다.
- live Dashboard를 브라우저에서 조작해 주요 surface가 동작함을 확인했다.
- 운영 문서가 Dashboard 우선 흐름과 CLI fallback 흐름을 모두 설명한다.
