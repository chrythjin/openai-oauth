# 라이브 프록시 재시작 + 백업 정리

**일자:** 2026-05-25 17:04 KST
**브랜치:** main

---

## 핵심 발견

라이브 `OpenAIOAuthProxy` 서비스가 **어중간한 dist 빌드**로 돌고 있어서 멍때리는 시간이 늘어 보였다.

| 항목 | 시간 |
|---|---|
| `dist/chunk-*.js` (이전 빌드) | 2026-05-25 02:42:08 |
| `src/logging.ts` 마지막 수정 | 2026-05-25 02:44:10 ← 빌드보다 나중 |
| 서비스 마지막 시작 | 2026-05-25 14:57:09 |

이전 dist에는 `journal_mode = WAL` + `busy_timeout = 5000`만 들어 있고 비동기 큐(`createSQLiteRequestLogger`, `REQUEST_LOG_QUEUE_LIMIT`, `pruneOldRequestLogs` 등)는 빠져 있었다. 결과적으로 hot path에 **동기 SQLite write + WAL + 5초 busy_timeout**이 동시에 켜져 락 경합 시 한 요청이 최대 5초 멈출 수 있는 상태였다.

WAL 사이드카가 본 DB(약 487 KB)의 약 5배(2.5 MB)까지 누적된 것도 같은 증상의 흔적.

---

## 조치

1. `bun run build` 재실행 → 새 `chunk-DR2HTZBH.js` (mtime 16:55:29) 생성
2. dist 안에 새 마커 모두 확인 (`createSQLiteRequestLogger`, `REQUEST_LOG_*`, `pruneOldRequestLogs`)
3. 서비스 stop → 포트 10531 free → start
4. `/health` 200 OK, latency 6–54 ms

재시작 후 PID:

- service PID: 26040 (NSSM)
- listening PID: 28708 (start 17:04:16)
- usage.sqlite-wal: 0 bytes (재시작으로 깨끗하게 초기화)

---

## 안 건드린 잠재 latency 요인 (이번 commit 무관)

1. `packages/openai-oauth-core/src/transport.ts:146` — `await input.clone().text()`가 큰 request body 전체 메모리 버퍼링
2. `packages/openai-oauth/src/cli-app.ts:199` — `resolveOpenAIOAuthModels()` 업스트림 호출 (cold start 영향만)
3. `packages/openai-oauth/src/server.ts:74` — dashboard 경로 `existsSync` (사소함)

---

## 백업 정리

### 삭제한 것 (오늘 만든 안전한 항목만)

- `%TEMP%\opencode\openai-oauth-dist-backup-20260525-165444\` (1.4 MB) — 새 dist 정상 적용 후 불필요
- `%TEMP%\opencode\openai-oauth-latency-backup-20260525-020425\` (1.5 MB) — 새 dist 정상 적용 후 불필요
- `%TEMP%\opencode\openai-oauth-restart-20260525-170409.log` (2.6 KB)

### 유지한 것

- `~\.codex\backups\` 11개 — 토큰 로테이터 자동 백업, 이 시스템이 관리
- `~\.codex\config.toml.bak` (26 bytes) — 오래됐지만 사소
- `%TEMP%\opencode\` 내 다른 프로젝트 디렉터리 (`magic-context`, `excel-plugin-qa-playwright`, `opencode-kiro-auth-ref`) — 이 작업과 무관

---

## 롤백이 필요해진 경우

새 dist 적용 후 문제가 발생하면 백업이 삭제됐기 때문에 `git checkout` + `bun run build`로 동일 상태를 복원하면 된다.

```powershell
sc.exe stop OpenAIOAuthProxy
git checkout eb07d4d -- packages/openai-oauth/src
bun run build
sc.exe start OpenAIOAuthProxy
```
