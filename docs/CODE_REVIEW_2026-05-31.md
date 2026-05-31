# Code Review & Fixes — 2026-05-31

**범위:** `.codex/` 운영 스크립트 전체 + TypeScript 패키지 3종 (`openai-oauth`, `openai-oauth-core`, `openai-oauth-provider`)
**방법:** codex 스크립트는 직접 정독, TS 패키지는 explore 에이전트 병렬 스캔 후 교차 검증
**결과:** 12건 수정 적용, 3건 의도적 미적용(오탐/제약 충돌). 전체 검증 통과.

---

## 1. 적용한 수정 (12건)

### codex 스크립트 (7건)

| # | 파일 | 문제 | 수정 |
|---|------|------|------|
| 1 | `.codex/launchers/manage-tokens.bat` | 하드코딩 절대경로 `cd /d "C:\NEW PRG\openai-oauth"` — 레포 이동/클론 시 즉시 깨짐 | `cd /d "%~dp0..\.."` 상대경로로 통일 (다른 런처와 일관) |
| 2 | `.codex/scripts/rotate-service-token.ps1` | 권한 상승 후 elevated 작업 결과와 무관하게 항상 `exit 0` → 실패 은폐 | `Start-Process ... -Wait -PassThru` 후 `exit $elevated.ExitCode` |
| 3 | `.codex/launchers/open-dashboard.bat` | 대시보드 열기용으로 매번 `sc stop`+`sc start` 강제 재시작 + stop/start 비동기 레이스 | RUNNING 확인 후 미실행 시에만 start, RUNNING 도달까지 폴링 대기 (최대 20s) |
| 4 | `.codex/scripts/token-rotator.js` | Windows에서 `execFileSync("npx", ...)` → `npx.cmd` 미해석로 ENOENT | `cmd.exe /d /s /c "npx --yes @openai/codex login"` 경유 |
| 5 | `.codex/scripts/token-rotator.js` | config 파싱 실패 시 백업 없이 조용히 DEFAULT 폴백 → 슬롯 정의 손실 | 손상본을 `backups/broken-config-<ts>-...json`에 백업 후 폴백, 사유 로그 |
| 6 | `.codex/scripts/token-manager-menu.ps1` | `Normalize-Config`가 매 로드마다 라벨을 `"Account N"`으로 덮어씀 → 옵션3의 이메일 기반 라벨 소실 | 라벨이 비어있을 때만 기본값 부여 (사용자 라벨 보존) |
| 7 | `.codex/scripts/session-proxy-manager.ps1` | `$pid = ...` 로 PowerShell 내장 자동변수 `$PID` 섀도잉 (2곳) | `$processId`로 리네임 |

### TypeScript (5건)

| # | 파일 | 문제 | 수정 |
|---|------|------|------|
| 8 | `packages/openai-oauth-core/src/auth.ts` | `readAuthFile`의 `catch {}`가 모든 에러를 삼켜 손상 JSON/EACCES를 "파일 없음"과 구분 못 함 → 오해 소지 "access token not found" | ENOENT(조용히 skip) vs 손상 JSON/권한 오류(경고 표면화) 구분 |
| 8b | 〃 | `ensureDirectory`가 기본 umask로 디렉터리 생성 → POSIX 멀티유저에서 group-readable 가능 | `fs.mkdir(..., { mode: 0o700 })` (Windows는 ACL 우선이라 무해) |
| 8c | 〃 | 에러 메시지가 `codex login`인데 실제 명령은 `npx @openai/codex login` | 메시지 2곳 정정 |
| 9 | `packages/openai-oauth/src/shared.ts` | `writeWebResponse`에서 body lock 시 빈 응답(보통 200) 반환 → 클라이언트는 에러 신호 못 받음 | `headersSent` 아니면 502 JSON 에러 반환 |
| 10 | `packages/openai-oauth/src/server.ts` | 비-localhost 바인딩 시 토큰 vault API 포함 전 엔드포인트 LAN 노출, 런타임 경고 없음 | `127.0.0.1`/`localhost`/`::1` 외 host 바인딩 시 경고 출력 |
| 10b | 〃 | 종료 시 in-flight 요청 드레인 없이 즉시 소켓 종료 | `server.close()` → `closeIdleConnections()` → 10s 드레인 대기 → `closeAllConnections()` |
| 11 | `packages/openai-oauth-core/src/sse.ts` | `collectCompletedResponseFromSse`가 `JSON.stringify(latestError)`로 업스트림 에러 원본 전체를 메시지/로그에 노출 | `type`/`code`/`message`만 추출한 `summarizeUpstreamError`로 교체 |
| 12 | `packages/openai-oauth-core/src/transport.ts` | `(fetch as any).preconnect` 캐스팅 — 타입 안전성 상실 | 타입 가드 duck-type 체크로 교체 + no-timeout 의도 주석 명시 |

---

## 2. 의도적으로 적용하지 않음 (3건)

> 리뷰 에이전트 권고였으나 코드 직접 확인 결과 적용하면 **안 되는** 항목. 향후 동일 권고가 다시 올 경우 재작업 금지.

### A. `transport.ts` 기본 타임아웃 추가 — **거부 (제약 충돌)**
- 권고: `fetch`에 `AbortSignal.timeout()` 추가 ("operation timed out" 근원이라 주장)
- **거부 사유:** 프로젝트 제약 — *OpenCode `openai-oauth` provider 요청은 긴 추론 모델에서 기본 5분 타임아웃을 쓰면 안 됨. OpenCode가 abort signal을 전달하면 프록시가 `"The operation timed out."` 반환.* 이미 `opencode.json`의 `options.timeout=false`로 해결한 버그를 **코드에 다시 심는 셈**.
- 조치: 타임아웃 추가 대신 no-timeout 의도를 코드 주석으로 명시.

### B. `provider.ts` `doGenerate` 스트림 리더 하드 타임아웃 — **거부**
- 권고: `while(true) { reader.read() }` 루프에 타임아웃 추가
- **거부 사유:** A와 동일. 정상적인 장시간 추론을 중단시킴.

### C. `RETRY_FAILURE_PREFIX` "죽은 코드" — **오탐**
- 권고: `chat-stream.ts`의 상수가 미사용 dead code, retry 에러가 500으로 오분류
- **실제:** `chat-stream.ts:82`, `chat-completions.ts:75`에서 `error.message.startsWith(RETRY_FAILURE_PREFIX)`로 **정상 사용 중**. 수정 불필요.

> 추가 오탐: `state.ts:177` delete-before-set은 "불필요한 Map 연산"이 아니라 **LRU touch** (JS Map은 insertion-order 유지 → 재삽입으로 최신 위치로 이동). 제거 시 오히려 eviction 버그 유발.

---

## 3. 검증 결과

| 단계 | 명령 | 결과 |
|------|------|------|
| Typecheck | `bun run typecheck` | ✅ 4/4 패키지 통과 |
| Build | `bun run build` | ✅ 4/4 패키지 통과 |
| Tests | `bun run test` | ✅ 98 passed / 2 skipped(live E2E) / **0 failed** |
| Lint/Format | `biome check <수정파일>` | ✅ 6 files clean (tabs, double quotes, no semicolons) |

> 참고: `bun run format-and-lint` 전체 실행 시 `.omo/run-continuation/*.json` (OMO 내부 세션 파일)에서 포맷 경고가 나오나 본 변경과 무관.

---

## 4. 양호 사항 (회귀 방지용 기록)

- `assertSafeTokenFilename` / `Assert-SafeTokenFilename` 정규식으로 path traversal 방어 일관 적용
- `session-proxy-manager.ps1`: `Use-ManagerLock` 배타 락 + `Test-SessionProcessIdentity`(엉뚱한 PID kill 방지) + `Copy-TokenToSession` mtime/length 검증 — 방어적 설계 우수
- `token-manager-menu.ps1` cancel 가능 로그인: `UseShellExecute=false` + `KeyAvailable` 폴링으로 Bun interactive 크래시 회피
- 토큰 값 자체는 로그/대시보드/모델 목록 어디에도 노출 안 됨(슬롯 메타데이터만), SQLite 로거 redaction 동작

---

## 5. 향후 후속(미적용 권고, 필요 시 검토)

리뷰에서 식별되었으나 이번 범위에서 미적용 — 우선순위 낮거나 추가 논의 필요:
- `chat-completions.ts`: `request.json()` 바디 크기 제한 없음 (대용량 바디 DoS 가능성)
- `chat-messages.ts`: `image_url` 문자열 단축형 미처리 (객체형만 처리)
- `provider.ts`: usage-limit 가드가 429/402만 처리, 5xx 재시도 분류 누락
- `models.ts`: 모델 캐시 5분 TTL — 토큰 로테이션 후 최대 5분간 stale (서비스 재시작으로 완화됨)
