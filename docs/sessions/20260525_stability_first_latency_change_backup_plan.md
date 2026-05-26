# 안정성 우선 지연 개선 작업 계획서: 백업·검증·롤백 포함

**작성일:** 2026-05-25  
**대상 저장소:** `C:\NEW PRG\openai-oauth`  
**관련 근거:** `docs/sessions/20260525_stability_first_latency_design_rationale_report.md`  
**운영 대상:** Windows 서비스 `OpenAIOAuthProxy` / `http://127.0.0.1:10531`

---

## 1. 목표

프록시 요청 성공 경로에서 SQLite request logging/pruning 작업이 직접 지연을 만들지 않도록 변경한다. 첫 구현 범위는 안정성을 최우선으로 하며, 아래 두 항목만 포함한다.

1. request log 저장을 bounded async queue + single SQLite writer로 이동한다.
2. request-log pruning을 insert/read마다 실행하지 않고 background cadence로 이동한다.

이번 1차 작업에서는 다음 항목을 구현하지 않는다.

- token proactive refresh
- request body streaming rewrite
- Codex version/update check cache
- self-restart 기능
- live Codex quota/health check
- dashboard auth 또는 remote deployment

---

## 2. 성공 기준

### 기능 기준

- `/v1/models`가 정상 응답한다.
- `/health`가 `{"ok":true}`를 반환한다.
- dashboard `/dashboard`가 열린다.
- dashboard usage/logs API가 request log를 계속 조회할 수 있다.
- SQLite logging failure가 proxy API 응답을 실패시키지 않는다.
- request-log retention은 1일 정책을 유지한다. 단, cleanup은 몇 초~몇 분 지연될 수 있다.

### 안정성 기준

- token/auth/vault 파일에는 queue/batch write를 적용하지 않는다.
- `POST /api/tokens/switch`, `POST /api/tokens/rotate`의 `restart_required: true` 계약은 유지한다.
- token API redaction/CORS/Origin 보호 정책은 변경하지 않는다.
- service restart 전까지 현재 실행 중인 프록시는 계속 기존 코드로 동작한다.
- 배포 실패 시 이전 `dist`와 운영 데이터 백업으로 되돌릴 수 있다.

### 검증 기준

최소 검증:

```powershell
bun run typecheck
bun run test
bun run build
curl http://127.0.0.1:10531/health
curl http://127.0.0.1:10531/v1/models
```

가능하면 추가 검증:

```powershell
bun test packages/openai-oauth/test/dashboard-db.test.ts packages/openai-oauth/test/dashboard-logging.test.ts packages/openai-oauth/test/server.test.ts
```

주의: 이전 독립 검토에서 `dashboard-logging > should compose multiple loggers and persist to SQLite` 테스트가 `requestCount` 0으로 실패했다는 보고가 있었다. 구현 전에 현재 상태를 직접 재실행해 pre-existing failure인지 확인한다.

---

## 3. 예상 변경 파일

1차 구현 예상 파일:

- `packages/openai-oauth/src/logging.ts`
- `packages/openai-oauth/src/db.ts`
- `packages/openai-oauth/src/server.ts` 또는 shutdown hook이 있는 인접 파일
- `packages/openai-oauth/test/dashboard-logging.test.ts`
- `packages/openai-oauth/test/dashboard-db.test.ts`

가능한 보조 파일:

- `packages/openai-oauth/src/request-log-queue.ts` 또는 유사 신규 파일
- `docs/OPERATIONS.md` 후속 업데이트

변경하지 않을 파일:

- `packages/openai-oauth-core/src/auth.ts` 1차 범위 제외
- `.codex/scripts/*` 1차 범위 제외
- token vault 파일/운영 auth 파일 직접 수정 금지

---

## 4. 작업 전 백업 계획

### 4.1 백업 디렉터리

작업 시작 시 다음 경로를 만든다.

```powershell
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupRoot = "C:\NEW PRG\openai-oauth\.backups\stability-latency-$stamp"
New-Item -ItemType Directory -Path $backupRoot
```

`.backups/`가 gitignore에 없다면 백업 생성 전 git status로 확인하고, 실수로 stage하지 않는다.

### 4.2 Git 상태 백업

작업 전 현재 branch, HEAD, diff를 저장한다.

```powershell
git status --short | Out-File "$backupRoot\git-status-before.txt" -Encoding utf8
git rev-parse HEAD | Out-File "$backupRoot\git-head-before.txt" -Encoding utf8
git branch --show-current | Out-File "$backupRoot\git-branch-before.txt" -Encoding utf8
git diff --binary > "$backupRoot\worktree-before.patch"
git diff --staged --binary > "$backupRoot\staged-before.patch"
```

주의:

- 사용자/다른 에이전트의 변경이 섞여 있을 수 있으므로 `git reset --hard`, `git checkout -- .` 같은 전체 되돌리기 명령은 사용하지 않는다.
- 롤백은 본 작업에서 바꾼 파일만 대상으로 한다.

### 4.3 빌드 결과물 백업

현재 Windows 서비스는 다음 dist를 실행한다.

```text
C:\NEW PRG\openai-oauth\packages\openai-oauth\dist\cli.js
```

서비스 적용 전 현재 dist를 통째로 백업한다.

```powershell
Copy-Item -LiteralPath "C:\NEW PRG\openai-oauth\packages\openai-oauth\dist" -Destination "$backupRoot\dist-openai-oauth" -Recurse -Force
Copy-Item -LiteralPath "C:\NEW PRG\openai-oauth\packages\openai-oauth-provider\dist" -Destination "$backupRoot\dist-openai-oauth-provider" -Recurse -Force -ErrorAction SilentlyContinue
```

### 4.4 운영 데이터 백업

운영 데이터는 `CODEX_HOME`이 있으면 그 경로, 없으면 `~\.codex`를 사용한다.

관리자 PowerShell 또는 일반 PowerShell에서 다음을 실행한다.

```powershell
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$runtimeBackup = Join-Path $backupRoot "codex-runtime"
New-Item -ItemType Directory -Path $runtimeBackup

Copy-Item -LiteralPath (Join-Path $codexHome "auth.json") -Destination $runtimeBackup -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath (Join-Path $codexHome "token-rotator-config.json") -Destination $runtimeBackup -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath (Join-Path $codexHome "vault") -Destination (Join-Path $runtimeBackup "vault") -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath (Join-Path $codexHome "active") -Destination (Join-Path $runtimeBackup "active") -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath (Join-Path $codexHome "openai-oauth") -Destination (Join-Path $runtimeBackup "openai-oauth") -Recurse -Force -ErrorAction SilentlyContinue
```

SQLite WAL 적용 후에는 다음 sidecar도 함께 백업 대상이다.

- `usage.sqlite`
- `usage.sqlite-wal`
- `usage.sqlite-shm`

### 4.5 Windows 서비스 구성 백업

```powershell
sc.exe qc OpenAIOAuthProxy > "$backupRoot\sc-qc-before.txt"
sc.exe query OpenAIOAuthProxy > "$backupRoot\sc-query-before.txt"
Get-Content -LiteralPath "C:\Tools\OpenAIOAuthProxy\openai-oauth-proxy.bat" | Out-File "$backupRoot\openai-oauth-proxy.bat.before.txt" -Encoding utf8
```

가능하면 NSSM 설정도 백업한다.

```powershell
& "C:\Tools\nssm\nssm-2.24-101-g897c7ad\win64\nssm.exe" dump OpenAIOAuthProxy > "$backupRoot\nssm-dump-before.txt"
```

### 4.6 서비스 로그 스냅샷

```powershell
Copy-Item -LiteralPath "C:\Logs\OpenAIOAuthProxy\stdout.log" -Destination "$backupRoot\stdout.before.log" -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath "C:\Logs\OpenAIOAuthProxy\stderr.log" -Destination "$backupRoot\stderr.before.log" -Force -ErrorAction SilentlyContinue
```

---

## 5. 구현 계획

### Phase 0: baseline 확인

1. 현재 worktree 확인

```powershell
git status --short
```

2. pre-existing dashboard logging test 상태 확인

```powershell
bun test packages/openai-oauth/test/dashboard-logging.test.ts
```

3. 전체 typecheck/test baseline

```powershell
bun run typecheck
bun run test
```

실패가 있으면:

- 이번 변경과 무관한 pre-existing failure로 기록한다.
- logging 관련 테스트가 이미 실패하면 구현 전 원인을 먼저 파악한다.

### Phase 1: request-log queue 추가

설계:

- logger callback은 sanitized request event를 queue에 enqueue하고 즉시 반환한다.
- queue는 bounded로 둔다.
- queue overflow 시 proxy 요청은 실패시키지 않고 log drop counter를 증가시킨다.
- single writer만 SQLite에 접근한다.
- writer는 짧은 interval 또는 batch size 기준으로 flush한다.
- flush 실패는 stderr/log warning으로 남기되 proxy 요청은 실패시키지 않는다.

권장 기본값 초안:

- queue max: 1,000~10,000 events 사이에서 시작
- flush interval: 250~1,000ms
- batch size: 50~200
- shutdown flush timeout: 1~3초

안정성 조건:

- token/auth/vault write에는 이 queue를 사용하지 않는다.
- raw token/auth/body 전체가 queue에 들어가지 않도록 기존 redaction 경로를 유지한다.

### Phase 2: pruning 이동

설계:

- DB open 시 1회 prune은 유지 가능하다.
- insert 전후 prune은 제거한다.
- dashboard read 함수의 prune은 제거하거나 “마지막 prune 이후 N분 경과 시에만” 실행한다.
- background prune scheduler를 추가한다.

권장 기본값 초안:

- prune interval: 5분
- process start 후 초기 prune: 실행
- shutdown 시 별도 prune 불필요

1일 retention 해석:

- 정확히 24시간 0초에 삭제가 아니라, background cadence 안에서 1일 보관 정책을 유지한다.

### Phase 3: SQLite PRAGMA 검토 적용

request-log DB에만 적용한다.

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

`synchronous=NORMAL`은 1차 구현에서는 보수적으로 보류하거나, 적용 시 request-log DB에만 한정한다.

### Phase 4: shutdown 처리

서비스 재시작/중지 시 best-effort flush를 수행한다.

- `SIGINT`
- `SIGTERM`
- Windows service stop에서 전달되는 종료 흐름

주의:

- shutdown flush가 오래 걸려 서비스 종료를 막으면 안 된다.
- flush 실패 시 로그만 남기고 종료한다.

---

## 6. 검증 계획

### 6.1 정적 검증

```powershell
bun run typecheck
bun run format-and-lint
```

### 6.2 테스트

```powershell
bun test packages/openai-oauth/test/dashboard-db.test.ts packages/openai-oauth/test/dashboard-logging.test.ts packages/openai-oauth/test/server.test.ts
bun run test
```

### 6.3 빌드

```powershell
bun run build
```

### 6.4 로컬 surface smoke

서비스 재시작 전에는 새 dist가 적용되지 않을 수 있다. 적용 후 관리자 PowerShell에서:

```powershell
sc.exe stop OpenAIOAuthProxy
netstat -ano | findstr :10531
sc.exe start OpenAIOAuthProxy
curl http://127.0.0.1:10531/health
curl http://127.0.0.1:10531/v1/models
```

프록시 alias 확인:

```powershell
curl http://127.0.0.1:10531/v1/models
```

Dashboard 확인:

```text
http://127.0.0.1:10531/dashboard
```

수동 확인 항목:

- Usage tab이 열린다.
- Recent logs가 비어 있더라도 API가 오류를 내지 않는다.
- 새 request 후 logs/summary가 짧은 지연 뒤 반영된다.
- stderr에 반복적인 SQLite error가 없다.

---

## 7. 배포 계획

1. 백업 생성 완료 확인
2. 코드 수정
3. 테스트/typecheck/build 통과
4. dist 백업이 존재하는지 재확인
5. 관리자 PowerShell에서 서비스 재시작
6. `/health`, `/v1/models`, dashboard smoke
7. `C:\Logs\OpenAIOAuthProxy\stderr.log` 확인
8. 10~30분 관찰

서비스 재시작 중에는 프록시가 잠깐 내려간다. 코드 수정과 build만으로는 현재 실행 중인 서비스가 자동으로 꺼지지 않는다.

---

## 8. 롤백 계획

### 8.1 즉시 롤백 조건

다음 중 하나라도 발생하면 즉시 롤백한다.

- `/health` 실패
- `/v1/models` 실패
- proxy가 시작 직후 반복 crash
- stderr에 SQLite error가 지속 반복
- token switch/rotate API 계약이 깨짐
- dashboard token metadata redaction/CORS 정책이 깨짐
- 실제 API 요청이 401/500으로 새롭게 실패

### 8.2 dist-only 롤백

소스는 그대로 두고 서비스만 이전 빌드 결과로 되돌리는 빠른 롤백이다.

관리자 PowerShell:

```powershell
sc.exe stop OpenAIOAuthProxy
Remove-Item -LiteralPath "C:\NEW PRG\openai-oauth\packages\openai-oauth\dist" -Recurse -Force
Copy-Item -LiteralPath "$backupRoot\dist-openai-oauth" -Destination "C:\NEW PRG\openai-oauth\packages\openai-oauth\dist" -Recurse -Force
sc.exe start OpenAIOAuthProxy
curl http://127.0.0.1:10531/health
curl http://127.0.0.1:10531/v1/models
```

provider dist를 건드린 경우:

```powershell
Remove-Item -LiteralPath "C:\NEW PRG\openai-oauth\packages\openai-oauth-provider\dist" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath "$backupRoot\dist-openai-oauth-provider" -Destination "C:\NEW PRG\openai-oauth\packages\openai-oauth-provider\dist" -Recurse -Force -ErrorAction SilentlyContinue
```

### 8.3 소스 롤백

본 작업에서 수정한 파일만 되돌린다. 전체 reset 금지.

방법 A: 백업 patch 역적용 검토

```powershell
git diff -- packages/openai-oauth/src/logging.ts packages/openai-oauth/src/db.ts packages/openai-oauth/test/dashboard-logging.test.ts > "$backupRoot\worktree-after-failed.patch"
```

그 뒤 수동으로 해당 파일만 이전 상태로 복원하거나, 작업 전 patch를 참고한다.

방법 B: 새 branch에서 작업했다면 branch 폐기

```powershell
git status --short
```

사용자/다른 에이전트 변경이 없는지 확인한 뒤에만 branch 전환/삭제를 고려한다.

### 8.4 운영 데이터 롤백

원칙적으로 1차 구현은 auth/vault 운영 데이터를 변경하지 않는다. 운영 데이터 롤백은 마지막 수단이다.

request-log DB만 문제가 있을 때:

```powershell
sc.exe stop OpenAIOAuthProxy
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
Copy-Item -LiteralPath "$backupRoot\codex-runtime\openai-oauth" -Destination (Join-Path $codexHome "openai-oauth") -Recurse -Force
sc.exe start OpenAIOAuthProxy
curl http://127.0.0.1:10531/health
```

주의:

- `auth.json`, `vault`, `active` 복구는 token 상태까지 되돌리는 작업이므로 사용자가 명시 요청한 경우에만 수행한다.
- cloud sync/network path에는 `CODEX_HOME`을 두지 않는다.

### 8.5 서비스 구성 롤백

이번 작업은 서비스 wrapper를 수정하지 않는다. 만약 운영 중 서비스 구성이 변경되었다면 `sc-qc-before.txt`, `nssm-dump-before.txt`, `openai-oauth-proxy.bat.before.txt`를 기준으로 수동 복구한다.

---

## 9. 위험과 완화책

| 위험 | 원인 | 완화책 |
|---|---|---|
| 최근 request log 유실 | queue에 남은 상태에서 process crash | bounded best-effort log로 명시, shutdown flush |
| dashboard 숫자 반영 지연 | async flush interval | UI/문서에 짧은 지연 가능성 반영 |
| queue memory 증가 | burst traffic | max queue size, drop policy |
| SQLite lock 지속 | writer/prune 동시성 문제 | single writer, WAL, busy_timeout, background prune 단일화 |
| retention test 실패 | exact 24h cleanup 가정 | cadence 기준으로 test 수정 |
| service 재시작 후 새 코드 미적용 | build 누락 또는 dist 롤백 혼선 | build timestamp/status 확인, `/health` smoke |
| token 기능 회귀 | token API 주변 변경 실수 | token 관련 파일 변경 금지, token API tests/smoke 유지 |

---

## 10. 후속 문서 업데이트

구현 완료 후 다음 문서를 업데이트한다.

- `docs/OPERATIONS.md`
  - request logging이 best-effort async임을 명시
  - dashboard usage 반영이 짧게 지연될 수 있음을 명시
  - request-log DB WAL sidecar 파일 운영 주의 추가
- `docs/sessions/20260525_stability_first_latency_design_rationale_report.md`
  - 실제 구현 결과와 검증 결과 링크 추가
- changelog 또는 session report
  - tail latency 안정성 개선, 롤백 경로, 미측정 항목 명시

---

## 11. 최종 작업 순서 요약

```text
1. git/status/test baseline 확인
2. 백업 디렉터리 생성
3. git diff, dist, CODEX_HOME runtime, service config, logs 백업
4. request-log async queue 구현
5. pruning background cadence 구현
6. request-log DB WAL/busy_timeout 검토 적용
7. shutdown best-effort flush 구현
8. typecheck/test/build
9. 서비스 재시작
10. /health, /v1/models, dashboard smoke
11. stderr/stdout 관찰
12. 문제 발생 시 dist-only rollback 우선
```
