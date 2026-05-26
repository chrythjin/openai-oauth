# OpenCode 세션별 다중 토큰·다중 프록시 구상서

**작성일:** 2026-05-25  
**대상 저장소:** `C:\NEW PRG\openai-oauth`  
**상태:** **ARCHIVED (2026-05-25)** — 구상서 + 1차 구현 완료, 운영 검증 전 단계에서 보존  
**핵심 원칙:** 안정성 우선. 속도와 자동화는 그다음이다.

---

## 0. 아카이브 메모

이 구상은 1차 구현까지 진행됐고, 추가 작업 없이 현재 상태로 보존한다.

구현된 산출물:

- `.codex/scripts/session-proxy-manager.ps1`
- `.codex/launchers/session-proxies.bat`
- `docs/sessions/20260525_multisession_multiproxy_tui_plan.md`

확인된 범위:

- PowerShell parser 통과
- `help`, `tokens`, `list`, `env`, `cleanup` 비파괴 명령 정상
- primary proxy 보호 (`10531` 또는 `$env:PORT`) 차단 동작 확인
- `new -Token` 누락 차단 동작 확인
- token copy 원자성 (temp + JSON 검증 + atomic replace) 반영
- token-change 시 새 토큰 검증 후 프록시 중단 순서 반영
- mutating action 직렬화 lock 반영
- 숨김 프로세스 stop 경로를 `Stop-Process` + PID identity 검증 기반으로 수정
- 전용 프록시 시작 시 `--models` 하드코딩 제거

의도적으로 보류한 범위:

- 실제 새 프록시 start/stop 운영 검증
- live `10531` 서비스 접근/재시작 검증
- upstream `/v1/*` 호출 검증
- "OpenCode 열 때마다 자동으로 다음 토큰 슬롯 사용" 자동 launcher
- session lifecycle 자동 정리 (OpenCode 종료 감지 후 proxy 자동 stop)

향후 재개 시 진입점:

1. isolated `CODEX_HOME` + `10532+` 임시 포트로 `new` → `/health` → `env` → `stop` 1회 운영 검증
2. 자동 token rotation launcher 추가 (`opencode-with-next-token.bat` 형태)
3. session lifecycle 자동 정리 추가

---

## 1. 결론

가능하다.

현재 구조는 기본적으로 하나의 `OpenAIOAuthProxy` 프록시가 하나의 active token을 사용하고, 토큰 전환 시 프록시 재시작이 필요한 방식이다. 새 구상은 이를 확장해 **OpenCode 세션마다 전용 프록시 프로세스를 띄우고, 각 프록시가 고정된 token slot의 `auth.json`을 사용하게 하는 다중 프록시 구성**이다.

예시:

```text
Token 1 -> Proxy 10531 -> OpenCode Session A
Token 2 -> Proxy 10532 -> OpenCode Session B
Token 3 -> Proxy 10533 -> OpenCode Session C
Token 4 -> Proxy 10534 -> OpenCode Session D
Token 5 -> Proxy 10535 -> OpenCode Session E
```

이 방식은 기존 single-proxy rotation보다 세션 간 토큰 간섭이 적다. 단, 여러 프록시가 같은 mutable active token 파일이나 같은 SQLite usage DB를 동시에 공유하지 않도록 격리해야 한다.

---

## 2. 현재 구현에서 확인한 근거

### 2.1 CLI는 포트 지정과 auth 파일 지정이 가능하다

`packages/openai-oauth/src/cli-app.ts`는 다음 옵션을 지원한다.

- `--port <port>`
- `--host <host>`
- `--oauth-file <path>`
- `--dashboard-dist <path>`

따라서 별도 포트와 별도 auth 파일을 지정해 프록시를 여러 개 띄우는 기본 실행 모델은 이미 가능하다.

개념 예시:

```powershell
bun packages/openai-oauth/src/cli.ts --port 10531 --oauth-file C:\...\token-1\auth.json
bun packages/openai-oauth/src/cli.ts --port 10532 --oauth-file C:\...\token-2\auth.json
bun packages/openai-oauth/src/cli.ts --port 10533 --oauth-file C:\...\token-3\auth.json
```

빌드 산출물 기준 예시:

```powershell
node packages/openai-oauth/dist/cli.js --port 10531 --oauth-file C:\...\token-1\auth.json
```

### 2.2 OAuth auth는 첫 요청 후 메모리에 캐시된다

`packages/openai-oauth-core/src/transport.ts`의 `AuthManager`는 `loadAuthTokens()` 결과를 `current`에 저장하고, 이후 요청에서는 메모리의 access token/account id를 사용한다. 즉, 실행 중인 프록시의 auth 파일만 바꿔도 즉시 새 토큰이 반영되는 구조가 아니다.

따라서 전용 프록시에서 토큰을 바꾸는 안전한 방식은 **프록시 재시작**이다.

### 2.3 현재 token rotator는 active token 복사 모델이다

`.codex/scripts/token-rotator.js`는 vault token을 `active/auth.json` 및 기본 `auth.json`으로 복사하는 모델이다. 이 방식은 하나의 active token을 하나의 기본 프록시가 사용하는 데 적합하다.

다중 프록시 모델에서는 active token을 계속 바꾸는 것보다, 각 프록시가 token slot별 고정 auth 파일 또는 격리된 `CODEX_HOME`을 사용하게 하는 편이 안전하다.

---

## 3. 목표 사용자 경험

사용자는 TUI에서 다음을 할 수 있다.

1. 현재 token slot 1~5 상태 확인
2. 새 OpenCode 세션용 프록시 생성
3. 세션에 사용할 token slot 선택 또는 자동 배정
4. 전용 포트 자동 할당
5. 해당 token으로 전용 프록시 시작
6. 새 세션에 주입할 환경변수 또는 실행 명령 출력
7. 세션/프록시 상태 확인
8. 전용 프록시의 token 변경
9. 전용 프록시 중지/재시작/정리

예시 출력:

```powershell
$env:OPENAI_BASE_URL="http://127.0.0.1:10532/v1"
$env:OPENAI_API_KEY="dummy"
opencode
```

또는 TUI가 직접 새 셸/프로세스를 열 수 있다.

---

## 4. 권장 아키텍처

### 4.1 핵심 분리

기존 프록시 서버 코어는 최대한 건드리지 않는다.

새 기능은 별도 레이어로 둔다.

```text
OpenCode Session Proxy Manager / TUI
        |
        |-- token slot 조회
        |-- auth 파일 materialize
        |-- 포트 할당
        |-- 프록시 프로세스 start/stop/restart
        |-- 세션용 OPENAI_BASE_URL 출력
        |
        +--> Proxy 10531 --oauth-file slot-1/auth.json
        +--> Proxy 10532 --oauth-file slot-2/auth.json
        +--> Proxy 10533 --oauth-file slot-3/auth.json
```

이렇게 하면 다음을 피할 수 있다.

- 기존 proxy request path 복잡도 증가
- runtime token reload endpoint 추가
- 요청 중 token 교체 경쟁 조건
- token vault mutation과 프록시 요청 처리의 결합

### 4.2 프록시별 token 고정

각 전용 프록시는 시작 시점에 하나의 token slot을 물고 시작한다.

토큰 변경은 다음 순서로 처리한다.

1. 대상 전용 프록시 HTTP server 종료
2. 종료 완료 대기
3. 새 token slot의 auth 파일을 프록시 전용 경로에 준비
4. 같은 포트 또는 새 포트로 프록시 재시작
5. `/health` 확인
6. 세션에 필요한 `OPENAI_BASE_URL` 재출력

무중단 runtime token 변경은 1차 범위에서 제외한다.

### 4.3 프록시별 상태 파일

TUI는 상태 파일을 둔다.

권장 경로:

```text
%USERPROFILE%\.codex\openai-oauth-proxies\proxy-sessions.json
```

예시 구조:

```json
{
  "version": 1,
  "nextPort": 10531,
  "sessions": [
    {
      "id": "oc-20260525-001",
      "label": "OpenCode Session A",
      "tokenFile": "auth.json",
      "port": 10531,
      "pid": 12345,
      "baseUrl": "http://127.0.0.1:10531/v1",
      "createdAt": "2026-05-25T00:00:00.000Z",
      "lastHealthAt": "2026-05-25T00:00:10.000Z"
    }
  ]
}
```

상태 파일은 편의용이다. 실제 truth는 프로세스 생존 여부와 포트 listen 여부로 재검증해야 한다.

---

## 5. 저장소 및 파일 격리 설계

### 5.1 최소 안전 모델

각 프록시에 `--oauth-file`로 token slot의 auth 파일을 직접 지정한다.

장점:

- CLI가 이미 지원한다.
- 구현량이 작다.
- 프록시별 token source가 명확하다.

주의:

- `loadAuthTokens()`는 access token refresh 시 auth 파일에 갱신 값을 쓴다.
- 같은 token file을 여러 프록시가 동시에 쓰면 refresh write 경쟁이 생길 수 있다.

따라서 같은 token slot을 동시에 여러 프록시에 배정하지 않는 정책이 필요하다.

### 5.2 더 안전한 모델

프록시마다 격리된 runtime auth copy를 만든다.

예시:

```text
%USERPROFILE%\.codex\openai-oauth-proxies\sessions\oc-20260525-001\auth.json
%USERPROFILE%\.codex\openai-oauth-proxies\sessions\oc-20260525-001\data\
```

프록시 시작 시 vault token을 session-local `auth.json`으로 복사하고, 프록시는 그 파일만 refresh/write 한다.

장점:

- 같은 원본 vault token 파일을 여러 프로세스가 동시에 쓰지 않는다.
- 세션 종료 시 session-local copy를 삭제하거나 보존할 수 있다.

주의:

- refresh 결과를 원본 vault에 다시 반영할지 정책이 필요하다.
- 1차 구현에서는 원본 vault에 자동 merge하지 않는 편이 안전하다.

### 5.3 SQLite usage DB 격리

최근 검증에서 live service가 `~/.codex/openai-oauth/usage.sqlite`를 사용 중일 때 별도 프로세스가 같은 DB에 WAL 설정을 시도하면 Windows에서 `SQLITE_IOERR_DELETE`가 발생할 수 있음을 확인했다.

따라서 다중 프록시에서는 다음 중 하나가 필요하다.

권장 1차:

- 프록시별 격리된 `CODEX_HOME`을 지정한다.
- 각 프록시가 자기 session directory 아래 usage DB를 사용한다.

예시:

```text
%USERPROFILE%\.codex\openai-oauth-proxies\sessions\oc-20260525-001\codex-home\auth.json
%USERPROFILE%\.codex\openai-oauth-proxies\sessions\oc-20260525-001\codex-home\openai-oauth\usage.sqlite
```

이 방식은 SQLite lock 위험을 가장 단순하게 줄인다.

---

## 6. 새 세션 감지에 대한 판단

프록시 단독으로는 “새 OpenCode 세션”을 확실히 감지할 수 없다. 프록시는 HTTP 요청만 보며, 요청에 OpenCode session id가 포함된다는 보장이 없다.

자동 감지를 하려면 다음 중 하나가 필요하다.

1. OpenCode 세션 시작 launcher/hook에서 TUI 또는 proxy manager를 호출
2. 클라이언트가 요청마다 `X-Session-Id` 같은 고유 헤더를 전달
3. 사용자가 TUI에서 “새 세션 시작”을 선택하고, TUI가 환경변수가 설정된 셸 또는 command를 출력

1차 구현은 3번이 가장 안전하다.

---

## 7. 안정성 원칙

다음은 지켜야 한다.

- 프록시는 하나의 token slot 또는 session-local auth copy만 사용한다.
- 실행 중 token hot swap은 하지 않는다.
- token 변경은 프록시 재시작으로만 반영한다.
- 같은 token auth 파일을 여러 프록시가 동시에 쓰지 않게 한다.
- 같은 usage.sqlite를 여러 프록시가 공유하지 않게 한다.
- live `10531` 서비스는 기본 운영 프록시로 남겨두고, 실험/세션 프록시는 별도 port와 별도 `CODEX_HOME`을 쓴다.
- token vault 원본 파일은 TUI가 직접 수정하지 않는다. 기존 vault operation 또는 안전한 복사만 사용한다.
- 실패 시 요청 안정성을 우선하고, dashboard logging/usage 통계는 보조 기능으로 취급한다.

---

## 8. 1차 MVP 범위

포함:

- PowerShell 7 기반 TUI 또는 메뉴
- token slot 목록 표시
- session proxy 생성
- 자동 포트 할당
- session-local `CODEX_HOME` 생성
- selected token을 session-local `auth.json`으로 복사
- 전용 프록시 process start/stop/restart
- `/health` 확인
- `OPENAI_BASE_URL` 출력
- 상태 파일 저장 및 stale process 정리
- 전용 프록시 token 변경은 stop -> copy new token -> start 방식

제외:

- runtime token cache invalidation endpoint
- 무중단 token 교체
- 프록시 내부 session-id router
- 여러 토큰에 대한 load balancing
- quota 기반 자동 배정
- live Codex quota check
- remote/multi-user dashboard
- Windows service 다중 등록 자동화
- 원본 vault refresh merge 자동화

---

## 9. 운영 예시

### 새 세션 생성

```text
1. TUI 실행
2. [New session proxy]
3. Token 2 선택
4. Port 10532 자동 할당
5. TUI가 session-local CODEX_HOME 생성
6. Token 2 vault auth를 session-local auth.json으로 복사
7. Proxy 10532 시작
8. /health OK 확인
9. TUI가 아래 명령 출력
```

```powershell
$env:OPENAI_BASE_URL="http://127.0.0.1:10532/v1"
$env:OPENAI_API_KEY="dummy"
opencode
```

### 세션 프록시 token 변경

```text
1. TUI에서 session proxy 선택
2. [Change token]
3. Token 4 선택
4. Proxy stop
5. session-local auth.json 교체
6. Proxy start
7. /health OK 확인
8. 같은 port를 유지했다면 기존 base URL은 유지
```

### 세션 종료

```text
1. TUI에서 session proxy 선택
2. [Stop session proxy]
3. process 종료
4. status file 갱신
5. session-local auth copy 삭제 여부 선택
```

---

## 10. 주요 리스크

### 리스크 1: 같은 token file 동시 write

원인: access token refresh가 auth file에 쓰기 때문이다.

대응:

- 프록시별 session-local auth copy 사용
- 같은 token slot을 동시에 여러 프록시에 배정하지 않거나, 배정하더라도 원본 파일 공유 금지

### 리스크 2: SQLite DB lock

원인: 여러 프로세스가 같은 usage DB/WAL sidecar를 동시에 다룸.

대응:

- 프록시별 `CODEX_HOME` 격리
- 프록시별 usage DB 분리

### 리스크 3: 이미 열린 OpenCode 세션의 환경변수 변경 불가

원인: 부모 프로세스가 자식/이미 실행 중인 프로세스 환경변수를 바꿀 수 없음.

대응:

- TUI가 새 세션 시작 명령을 출력
- 또는 TUI가 새 셸/opencode process를 직접 실행

### 리스크 4: 포트 충돌

대응:

- TUI가 listen 가능 여부를 확인
- 상태 파일보다 실제 port/proc 검증 우선
- 실패 시 다음 포트로 이동

### 리스크 5: token refresh 결과 보존 정책

session-local auth copy가 refresh되면 원본 vault에는 반영되지 않는다.

대응:

- 1차에서는 자동 merge하지 않는다.
- 필요 시 후속 작업으로 “검증된 session auth를 vault slot에 명시적으로 저장” 메뉴를 별도 제공한다.

---

## 11. 최종 판단

이 작업은 가능하다. 다만 핵심은 “프록시 내부를 복잡하게 바꾸는 것”이 아니라, **프록시 프로세스를 여러 개 안전하게 띄우고 세션별 환경변수를 배정하는 외부 TUI/매니저를 만드는 것**이다.

안정성 우선 기준에서 1차 구현은 다음 형태가 맞다.

```text
TUI/Manager owns session lifecycle
Proxy remains simple
Token change means proxy restart
Each proxy gets isolated auth copy and CODEX_HOME
Each OpenCode session receives its own OPENAI_BASE_URL
```
