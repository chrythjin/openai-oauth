# OpenCode 세션별 다중 프록시 TUI 구현 계획서

**작성일:** 2026-05-25  
**대상 저장소:** `C:\NEW PRG\openai-oauth`  
**관련 구상서:** `docs/sessions/20260525_multisession_multiproxy_concept.md`  
**상태:** **ARCHIVED (2026-05-25)** — 1차 구현 완료, 운영 검증 전 단계에서 보존  
**우선순위:** 안정성 > 데이터 보호 > 사용성 > 자동화

---

## 0. 아카이브 메모

이 계획은 정적 구현까지 끝났고, 운영 검증 단계로 넘어가기 전에 보존한다.

구현 산출물은 `docs/sessions/20260525_multisession_multiproxy_concept.md`의 아카이브 메모를 참조한다.

이 문서의 9~12장에 있는 운영 검증, 자동 launcher, lifecycle 자동 정리 항목은 **재개 시 그대로 다음 작업 단위로 사용**한다.

---

## 1. 목표

현재 하나의 프록시와 하나의 active token을 rotation하는 운영 모델을 확장해, **OpenCode 세션마다 전용 프록시를 띄우고 각 전용 프록시에서 token을 restart 방식으로 교체할 수 있는 TUI/매니저**를 만든다.

1차 구현은 proxy core의 request path를 바꾸지 않고, 외부 process manager 레이어로 구현한다.

---

## 2. 핵심 요구사항

### 필수 기능

1. token slot 목록 표시
2. 새 session proxy 생성
3. token slot 선택 또는 기본 자동 선택
4. 사용 가능한 port 자동 할당
5. session-local `CODEX_HOME` 생성
6. 선택 token을 session-local `auth.json`으로 복사
7. 해당 `CODEX_HOME`과 port로 프록시 시작
8. `/health` 확인
9. 세션용 환경변수 출력
10. 실행 중인 session proxy 목록 표시
11. session proxy stop/restart
12. session proxy token 변경
    - stop
    - auth copy 교체
    - start
    - health check
13. stale pid/port 정리
14. 상태 파일 저장

### 명시적 제외

- runtime token hot swap
- auth cache invalidate API
- proxy 내부 session router
- 다중 token load balancing
- quota 기반 자동 분산
- live upstream quota check
- Windows service 다중 설치 자동화
- 원본 vault에 refresh token 결과 자동 merge
- dashboard remote/multi-user 기능

---

## 3. 추천 구현 위치

1차는 기존 `.codex` 운영 스크립트 계층에 둔다.

예상 신규 파일:

```text
.codex/scripts/session-proxy-manager.ps1
.codex/launchers/session-proxies.bat
```

선택적 보조 파일:

```text
.codex/scripts/session-proxy-manager-lib.ps1
```

이유:

- 현재 Windows token menu와 service-control 경험이 `.codex/scripts`와 `.codex/launchers`에 있다.
- 사용자는 이미 `.codex\launchers\manage-tokens.bat` 흐름을 사용한다.
- 프록시 core package와 운영 매니저 책임을 분리할 수 있다.

---

## 4. 데이터 경로 설계

### 4.1 매니저 루트

권장 경로:

```text
%USERPROFILE%\.codex\openai-oauth-proxies
```

하위 구조:

```text
openai-oauth-proxies\
  proxy-sessions.json
  sessions\
    oc-20260525-001\
      codex-home\
        auth.json
        openai-oauth\
          usage.sqlite
          usage.sqlite-wal
          usage.sqlite-shm
      logs\
        stdout.log
        stderr.log
      session.json
```

### 4.2 상태 파일

`proxy-sessions.json` 예시:

```json
{
  "version": 1,
  "nextPort": 10531,
  "sessions": [
    {
      "id": "oc-20260525-001",
      "label": "worktree-a",
      "tokenFile": "auth-alt1.json",
      "port": 10532,
      "pid": 12345,
      "status": "running",
      "baseUrl": "http://127.0.0.1:10532/v1",
      "sessionRoot": "C:\\Users\\...\\.codex\\openai-oauth-proxies\\sessions\\oc-20260525-001",
      "createdAt": "2026-05-25T00:00:00.000Z",
      "updatedAt": "2026-05-25T00:00:10.000Z"
    }
  ]
}
```

상태 파일은 캐시다. TUI 시작 시 항상 다음을 재검증한다.

- pid 생존 여부
- port listen 여부
- `/health` 응답 여부
- session directory 존재 여부

---

## 5. Token source 정책

### 5.1 원본 token source

기존 token rotator의 vault 구조를 사용한다.

기본 위치:

```text
%CODEX_HOME%\vault\auth.json
%CODEX_HOME%\vault\auth-alt1.json
%CODEX_HOME%\vault\auth-alt2.json
...
```

`CODEX_HOME`이 없으면 `%USERPROFILE%\.codex`를 기준으로 한다.

### 5.2 session-local auth copy

프록시 생성 시 선택한 vault token을 다음 위치로 복사한다.

```text
%USERPROFILE%\.codex\openai-oauth-proxies\sessions\<session-id>\codex-home\auth.json
```

프록시는 다음 환경으로 실행한다.

```powershell
$env:CODEX_HOME = "...\sessions\<session-id>\codex-home"
```

그리고 가능하면 CLI에도 명시적으로 전달한다.

```powershell
--oauth-file "...\sessions\<session-id>\codex-home\auth.json"
```

이중 지정은 의도를 명확히 하기 위한 것이다.

---

## 6. 프록시 실행 방식

### 6.1 개발 환경

```powershell
bun packages/openai-oauth/src/cli.ts --host 127.0.0.1 --port <port> --oauth-file <session-auth-json>
```

### 6.2 빌드 산출물 우선

운영 안정성 기준으로는 빌드 산출물을 우선 사용한다.

```powershell
node packages/openai-oauth/dist/cli.js --host 127.0.0.1 --port <port> --oauth-file <session-auth-json>
```

단, dist가 없으면 TUI는 다음 중 하나를 선택한다.

1. 사용자에게 `bun run build`를 안내
2. 개발 모드 실행을 명시적으로 선택하게 함

자동 빌드는 1차에서 피한다. 프록시 시작 메뉴가 예기치 않게 빌드 작업을 수행하면 안정성/예측 가능성이 떨어진다.

---

## 7. TUI 메뉴 초안

```text
OpenAI OAuth Session Proxy Manager

1. List token slots
2. List session proxies
3. New session proxy
4. Stop session proxy
5. Restart session proxy
6. Change token for session proxy
7. Print environment for session proxy
8. Health check all
9. Cleanup stale sessions
0. Exit
```

### 7.1 New session proxy

입력:

- label optional
- token slot
- port 자동 또는 수동

처리:

1. token slot 존재 확인
2. port 사용 가능 확인
3. session id 생성
4. session directory 생성
5. vault token을 session-local auth.json으로 복사
6. process start
7. pid/status 저장
8. `/health` 확인
9. env 출력

출력:

```powershell
$env:OPENAI_BASE_URL="http://127.0.0.1:10532/v1"
$env:OPENAI_API_KEY="dummy"
opencode
```

### 7.2 Change token for session proxy

처리:

1. 대상 session proxy 선택
2. 새 token slot 선택
3. 현재 proxy stop
4. session-local auth.json 백업
5. 새 token copy
6. 같은 port로 proxy start
7. `/health` 확인
8. 실패 시 이전 auth copy로 rollback 후 재시작 시도

중요:

- 이미 실행 중인 OpenCode 세션이 같은 base URL을 계속 쓰려면 port는 유지한다.
- token 변경 중 짧은 중단은 허용한다.
- runtime hot swap은 하지 않는다.

### 7.3 Cleanup stale sessions

처리:

- status file에는 running이지만 pid가 없으면 stopped로 표시
- pid는 있으나 port가 다르면 경고
- port는 열려 있으나 `/health`가 실패하면 unhealthy로 표시
- stopped session directory 삭제는 사용자 확인 후 수행

---

## 8. 구현 단계

### Phase 0: 사전 확인

- 현재 `.codex/scripts/token-rotator.js` vault config 구조 확인
- Windows PowerShell 7 실행 가능성 확인
- `node packages/openai-oauth/dist/cli.js --help` 또는 `bun ... --help` 확인
- live `10531` 서비스는 건드리지 않는다

검증:

```powershell
git status --short
node packages/openai-oauth/dist/cli.js --help
```

### Phase 1: 상태/토큰 조회만 구현

파일:

- `.codex/scripts/session-proxy-manager.ps1`
- `.codex/launchers/session-proxies.bat`

기능:

- manager root 생성
- token config 읽기
- token slot 목록 표시
- proxy-sessions.json 읽기/쓰기
- stale 상태 재검증 skeleton

검증:

```powershell
.codex\launchers\session-proxies.bat
```

### Phase 2: 새 session proxy 생성

기능:

- port allocation
- session id 생성
- session-local CODEX_HOME 생성
- auth copy
- proxy process start
- stdout/stderr log 파일 연결
- `/health` 확인
- env 출력

검증:

```powershell
curl http://127.0.0.1:<port>/health
```

주의:

- upstream `/v1/models`는 live Codex 요청일 수 있으므로 기본 검증에서 제외한다.
- health는 로컬 검증으로 충분하다.

### Phase 3: stop/restart/change-token

기능:

- pid 기반 stop
- graceful stop 후 강제 종료 fallback은 사용자 확인 필요
- restart
- token change with rollback

검증:

```powershell
# 변경 전 health OK
# token change
# 같은 port health OK
```

### Phase 4: 안정성 보강

기능:

- stale pid cleanup
- port collision handling
- logs view/tail 안내
- session-local auth backup retention
- config corruption fallback
- invalid token slot 방어

### Phase 5: 문서화

업데이트 후보:

- `docs/OPERATIONS.md`
- `docs/sessions/<implementation-verification>.md`

내용:

- 다중 프록시 사용법
- 단일 live service와 병행 시 주의사항
- session-local CODEX_HOME 구조
- token 변경은 restart 방식이라는 점
- cleanup/rollback 방법

---

## 9. 안정성 검증 계획

### 9.1 오프라인/로컬 검증

- TUI token slot 표시
- session-local auth copy 생성
- 프록시 start
- `/health` OK
- stop 후 port 해제 확인
- restart 후 `/health` OK
- token change 후 `/health` OK
- 상태 파일이 실제 pid/port와 일치하는지 확인

### 9.2 실제 프록시 표면 검증

가능한 범위에서 isolated session proxy로만 수행한다.

- live `10531` service restart 금지
- live `~/.codex/openai-oauth/usage.sqlite` 공유 금지
- temporary/session-local `CODEX_HOME` 사용

검증 예:

```powershell
curl http://127.0.0.1:<session-port>/health
```

요청 로그 검증이 필요하면 upstream 성공 요청 대신 local validation failure를 사용한다.

```powershell
curl -X POST http://127.0.0.1:<session-port>/v1/chat/completions -H "Content-Type: application/json" -d "{}"
curl http://127.0.0.1:<session-port>/api/dashboard/logs
```

단, 이 검증은 token quota나 upstream 모델 사용 가능성을 증명하지 않는다.

---

## 10. 롤백 계획

### 10.1 코드 롤백

새 파일 중심 구현이므로 롤백은 다음 파일 제거 또는 git revert로 가능하다.

```text
.codex/scripts/session-proxy-manager.ps1
.codex/launchers/session-proxies.bat
```

기존 proxy core를 수정하지 않는 것이 롤백을 쉽게 만든다.

### 10.2 런타임 롤백

1. TUI에서 모든 session proxy stop
2. 남은 pid/port 확인
3. `openai-oauth-proxies\sessions` 정리
4. 기존 `OpenAIOAuthProxy` service는 그대로 유지

### 10.3 데이터 롤백

session-local auth copy와 usage DB는 운영 원본이 아니다. 삭제 가능하다.

원본 vault는 1차 구현에서 직접 수정하지 않는다.

---

## 11. 구현 시 금지사항

- token vault 원본에 자동 merge하지 않는다.
- 같은 `auth.json`을 여러 proxy가 직접 공유하지 않는다.
- 같은 `CODEX_HOME`을 여러 proxy가 공유하지 않는다.
- runtime token reload endpoint를 만들지 않는다.
- live `10531` 서비스를 자동 stop/restart하지 않는다.
- upstream `/v1/models` 또는 quota성 요청을 기본 health check로 쓰지 않는다.
- 실패한 proxy start를 숨기고 성공처럼 표시하지 않는다.
- `as any`, `@ts-ignore`, `@ts-expect-error`로 타입 오류를 숨기지 않는다.

---

## 12. 완료 기준

구현 완료는 다음이 모두 만족될 때로 본다.

- TUI에서 token slot 목록을 볼 수 있다.
- 새 session proxy를 만들 수 있다.
- session proxy가 별도 port와 별도 `CODEX_HOME`으로 실행된다.
- `/health`가 OK를 반환한다.
- TUI가 해당 세션용 `OPENAI_BASE_URL`을 출력한다.
- session proxy stop/restart가 동작한다.
- token 변경이 stop -> auth copy 교체 -> start 방식으로 동작한다.
- 실패 시 이전 auth copy rollback 또는 명확한 오류를 제공한다.
- live `10531` 서비스와 기본 `~/.codex` 운영 파일을 건드리지 않는다.
- 문서와 검증 기록이 `docs/sessions` 또는 `docs/OPERATIONS.md`에 남는다.

---

## 13. 권장 첫 구현 단위

가장 안전한 첫 PR/커밋은 다음만 포함한다.

1. `.codex/scripts/session-proxy-manager.ps1`
2. `.codex/launchers/session-proxies.bat`
3. 상태 파일 read/write
4. token slot 표시
5. 새 session proxy 생성/중지
6. `/health` 검증
7. docs/sessions 검증 기록

`change token`, `restart`, `cleanup stale`은 같은 커밋에 넣어도 되지만, 안정성을 위해 기능별로 작게 나누는 편이 좋다.

---

## 14. 최종 구현 방향

1차 구현은 **PowerShell 7 TUI/메뉴 + session-local CODEX_HOME + 프록시 프로세스 매니저**로 진행한다.

핵심 프록시 서버는 이미 `--port`와 `--oauth-file`을 지원하므로, 내부 라우팅이나 runtime token reload를 추가하지 않는다.

이 방식이 현재 요구사항인 “OpenCode 세션마다 새로운 프록시를 열고, 그 프록시에서 토큰을 돌리는 다중 프록시 서버 구성”을 가장 안정적으로 충족한다.
