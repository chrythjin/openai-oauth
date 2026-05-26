# OpenAI OAuth 프록시 마스터 운영 매뉴얼

이 문서는 시스템의 아키텍처, 구성 상세, 유지보수 절차 및 장애 대응을 위한 통합 가이드입니다. 미래의 AI 에이전트와 운영자가 시스템을 완벽하게 관리할 수 있도록 모든 세부 정보를 기록합니다.

---

## 1. 시스템 아키텍처 및 경로

> [!TIP]
> `MANAGE TOKEN` 중심 운영 절차는 별도 가이드 `docs/MANAGE_TOKEN_GUIDE.md` 를 우선 참고하십시오.

본 프로젝트는 Bun 기반의 모노레포로 구성되어 있으며, 각 패키지는 다음과 같은 역할을 수행합니다.

### 패키지 구성
- **`openai-oauth-core`**: OAuth 인증 로직, SSE 처리, 공통 전송 계층 (핵심 로직).
- **`openai-oauth`**: 실제 HTTP 프록시 서버 및 CLI 엔트리포인트.
- **`openai-oauth-provider`**: Vercel AI SDK와의 통합을 위한 브릿지.

### 핵심 파일 경로 (Default)
- **인증 설정:** `C:\Users\U-N-00658\.codex\auth.json` (가장 중요)
- **서비스 배치 파일:** `C:\Tools\OpenAIOAuthProxy\openai-oauth-proxy.bat`
- **컴파일된 결과물:** `C:\NEW PRG\openai-oauth\packages\openai-oauth\dist\cli.js`
- **로그 저장소:** `C:\Logs\OpenAIOAuthProxy\` (stdout.log, stderr.log)
- **NSSM 바이너리:** `C:\Tools\nssm\nssm-2.24-101-g897c7ad\win64\nssm.exe`

---

## Dashboard

The proxy serves a local dashboard at `http://127.0.0.1:10531/dashboard`.

### Token Management

The dashboard provides a visual interface for managing token slots:

- **Usage tab**: View request statistics, hourly usage charts, and recent logs
- **Tokens tab**: Manage token slots (save, switch, rotate, delete)

#### Saving Current Auth

After logging in via CLI, click "Save current auth as slot" in the Tokens tab to store the current authentication as a vault slot.

#### Switching Tokens

Click "Switch" on an inactive slot to activate it. This requires a proxy restart:

```powershell
.codex\launchers\manage-tokens.bat restart
```

#### Rotating Tokens

Click "Rotate" to cycle to the next available token. This also requires a restart.

#### Deleting Tokens

Click "Delete" on an inactive slot to remove it. Active slots cannot be deleted.

### Security Notes

- Dashboard is localhost-only
- No browser login/logout popup flows
- No custom sourcePath imports
- No self-restart capability
- Token data is redacted in API responses

---

## 2. 윈도우 서비스 (NSSM) 상세 정보

배포 자동화와 상시 실행을 위해 `nssm`을 통해 서비스로 등록되어 있습니다.

### 서비스 요약
- **서비스 이름:** `OpenAIOAuthProxy`
- **실행 방식:** 자동 시작(지연됨)
- **권장 NSSM 옵션:** `AppNoConsole=1` (부팅 시 Session 0 콘솔 초기화 이슈 완화)
- **실행 계정:** `LocalSystem`

### 상세 구성 파라미터 (복구용)
만약 서비스를 재등록해야 한다면 다음 값을 참조하십시오:
- **Application:** `C:\Tools\OpenAIOAuthProxy\openai-oauth-proxy.bat`
- **Startup directory:** `C:\NEW PRG\openai-oauth`
- **I/O Redirect (Logs):**
  - Output (stdout): `C:\Logs\OpenAIOAuthProxy\stdout.log`
  - Error (stderr): `C:\Logs\OpenAIOAuthProxy\stderr.log`
- **AppExit:** 에러 발생 시 1500ms 대기 후 자동 재시작 설정

---

## 3. 핵심 운영 절차 (Step-by-Step)

### A. 인증 키(Token) 교체 시 (필수)
> [!IMPORTANT]
> 모든 `sc` 및 `netstat` 관련 명령은 **관리자 권한의 터미널**에서 실행해야 합니다. 권한이 없으면 "Access Denied(에러 5)"가 발생합니다.

토큰을 새로 발급받았거나 `auth.json`을 수정했다면 **반드시** 아래 절차를 밟아야 합니다.

1.  **터미널 우클릭 -> 관리자 권한으로 실행**.
2.  `sc stop OpenAIOAuthProxy` 실행 (중지에 다소 시간이 걸릴 수 있습니다).
3.  `netstat -ano | findstr :10531` 명령으로 남아있는 프로세스가 없는지 확인. 만약 있다면 `taskkill /F /PID <PID>`로 강제 종료 (서비스가 완벽히 죽지 않는 경우가 있습니다).
4.  `sc start OpenAIOAuthProxy` 실행.
5.  `curl http://127.0.0.1:10531/health`로 상태 확인 (`{"ok":true}`가 나오면 성공).

#### 더 쉬운 방법: 원커맨드 로테이션

Windows와 macOS 모두 레포 루트에서 같은 명령 체계를 사용할 수 있습니다.

```powershell
bun run token status
bun run token rotate
bun run token switch 2
bun run token restart
bun run token stop
bun run token start
```

Windows에서는 내부적으로 `OpenAIOAuthProxy` 서비스와 `rotate-service-token.ps1` 흐름을 사용합니다. macOS에서는 `packages/openai-oauth`의 로컬 detached Bun process와 repo-local `.codex/proxy.pid`를 사용합니다. 양쪽 모두 `CODEX_HOME`이 있으면 해당 디렉터리를, 없으면 `~/.codex`를 auth root로 사용합니다.

Windows/macOS/Linux의 stop/restart 흐름은 10531을 이 프록시 전용 포트로 간주합니다. 서비스 또는 PID 파일 정리 후에도 10531 listener가 남아 있으면 해당 listener를 강제 종료할 수 있으므로, 다른 개발 서버에 10531을 배정하지 마십시오.

Windows의 start/stop/restart/rotate/switch 명령은 관리자 PowerShell에서 실행해야 합니다. 자동 UAC 승격은 부모 프로세스가 실제 서비스 제어와 헬스체크 결과를 기다릴 수 없어, 검증 가능한 성공을 보장하지 못합니다.

관리자 권한 PowerShell에서 아래 명령 하나로 서비스 중지 → 토큰 교체 → lingering PID 정리 → 서비스 재시작 → 헬스체크까지 한 번에 처리할 수도 있습니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\NEW PRG\openai-oauth\.codex\scripts\rotate-service-token.ps1" -Action rotate
```

가장 짧은 실행 방법(다음 계정으로 바로 회전):

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\rotate-next-token.bat
```

배치 파일은 `Current -> Next` 미리보기를 먼저 보여주고, 확인 후에만 실제 로테이션을 수행합니다. 실행 결과를 보여준 뒤 자동으로 닫히지 않고, 키 입력 후 종료됩니다.

#### 전체 토큰 관리 메뉴

토큰 생성/추가/덮어쓰기/삭제/전환을 한 번에 관리하려면 아래 메뉴를 사용합니다.

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat
```

메뉴 기능:
- 새 토큰 생성 (`npx @openai/codex login`을 임시 `CODEX_HOME`으로 실행)
- 기존 vault slot 덮어쓰기
- 새 vault slot 추가
- 활성 토큰 전환
- 다음 토큰으로 로테이션
- 비활성 slot 삭제
- 현재 프록시/서비스 상태 확인
- 프록시/서비스 시작
- 프록시/서비스 재시작
- 프록시/서비스 종료

명령형 실행도 지원합니다.

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat status
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat start
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat restart
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat stop
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat rotate
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat switch 2
```

새 토큰 생성 시에는 **임시 `CODEX_HOME`** 을 사용하므로 live `~/.codex/auth.json`을 바로 덮어쓰지 않고, 로그인 완료 후 어느 slot에 저장할지 선택할 수 있습니다.

특정 계정으로 전환:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\NEW PRG\openai-oauth\.codex\scripts\rotate-service-token.ps1" -Action switch -Target 2
```

상태 확인:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\NEW PRG\openai-oauth\.codex\scripts\rotate-service-token.ps1" -Action status
```

---

### B. 소스 코드 수정 및 업데이트 시
코드를 수정했다면 TypeScript를 컴파일하여 `dist`를 업데이트해야 서비스에 반영됩니다.
1.  `bun run build` 실행.
2.  **관리자 권한**으로 `sc stop OpenAIOAuthProxy` 후 `sc start OpenAIOAuthProxy`.

---

## 4. 환경 변수 가이드

동작을 세밀하게 제어하기 위해 다음 환경 변수를 활용할 수 있습니다.

| 변수명 | 기본값 | 설명 |
| :--- | :--- | :--- |
| `OPENAI_OAUTH_AUTH_DEBUG` | `0` | `1`일 때 토큰 로드/갱신 상태를 상세히 기록합니다. |
| `OPENAI_OAUTH_VERBOSE_ERRORS` | `0` | `1`일 때 서버 에러 발생 시 상세 메시지를 노출합니다. |
| `PORT` | `10531` | 프록시가 대기할 포트 번호입니다. (환경변수 설정 시 우선 적용) |
| `CODEX_HOME` | `~/.codex` | `auth.json`을 찾을 기준 디렉토리 경로입니다. |

`CODEX_HOME`에는 각 PC의 로컬 디렉터리만 지정하십시오. OneDrive, iCloud Drive, Dropbox, 네트워크 드라이브 같은 공유/동기화 경로를 지정하면 `auth.json`과 vault 상태가 충돌할 수 있습니다.

---

## 5. 상세 장애 대응 (Troubleshooting Mastery)

### 🚨 사례 1: `401 Unauthorized` 또는 "Access Token Not Found"
- **현상:** API 요청 시 인증 에러가 발생함.
- **원인:** 
  1. `auth.json` 파일이 유실되었거나 형식이 잘못됨.
  2. 프록시가 파일 변경을 감지하지 못함 (재시작 안 함).
- **해결:** `npx @openai/codex login`을 다시 수행하고 프록시를 재시작하십시오.

### 🚨 사례 2: `502 Upstream Error`
- **현상:** 특정 모델(예: gpt-4) 요청 시 발생.
- **원인:** 
  1. 업스트림(OpenAI) 서버의 장애.
  2. 사용 불가능한 모델 슬러그(Slug)를 사용함.
- **해결:** `curl http://127.0.0.1:10531/v1/models`를 호출하여 **Available Models** 목록에 있는지 확인하십시오.

### 🚨 사례 3: 포트 충돌 (Port Already in Use)
- **현상:** 서비스 시작 실패 또는 프록시 실행 실패.
- **원인:** 기존의 `bun` 프로세스나 다른 서버가 10531 포트를 이미 점유함.
- **해결:** `netstat -ano | findstr :10531`로 점유 중인 PID를 찾아 종료하십시오.

### 🚨 사례 4: 윈도우 부팅 후 자동 시작이 안 되는 경우
- **현상:** 수동 `sc start OpenAIOAuthProxy` 는 되지만, 재부팅 직후 자동 시작이 실패하거나 불안정함.
- **원인:** 대체로 다음 세 가지입니다.
  1. `CODEX_HOME` 또는 작업 디렉터리(`AppDirectory`)가 잘못되어 서비스 계정이 `auth.json`을 찾지 못함.
  2. Session 0 에서 콘솔 앱(`node.exe`) 실행 시 콘솔 초기화/창 할당 문제로 시작이 불안정함.
  3. 부팅 직후 포트 점유 잔존 프로세스 또는 초기화 타이밍 경쟁.
- **확인:**
  - `sc.exe qc OpenAIOAuthProxy`
  - `Get-CimInstance Win32_Service -Filter "Name='OpenAIOAuthProxy'" | Format-List *`
  - `nssm get OpenAIOAuthProxy AppDirectory`
  - `nssm get OpenAIOAuthProxy AppEnvironmentExtra`
  - `nssm get OpenAIOAuthProxy AppNoConsole`
- **해결:**
  - `CODEX_HOME=C:\Users\U-N-00658\.codex` 유지
  - `AppDirectory=C:\NEW PRG\openai-oauth` 유지
  - `sc.exe config OpenAIOAuthProxy start= delayed-auto`
  - `nssm set OpenAIOAuthProxy AppNoConsole 1`
  - 필요하면 `register-service.ps1`로 서비스 구성을 다시 적용

### 🚨 사례 5: `curl` 요청이 무한 대기(Hang) 상태인 경우
- **현상:** `curl`을 날려도 응답이 오지 않고 터미널이 멈춤.
- **원인:** 이전 node 프로세스가 포트를 점유한 채로 좀비 프로세스가 되었거나, 이벤트 루프가 차단됨.
- **해결:** `netstat -ano | findstr :10531`로 PID를 찾은 뒤 `taskkill /F /PID <PID>`를 수행하고 서비스를 다시 시작하십시오.

---

## 6. OpenCode 연동 설정

OpenCode AI 에이전트에서 OpenAI OAuth 프록시를 모델 프로바이더로 사용할 수 있습니다.

### 설정 파일

프로젝트 루트에 `opencode.json`을 생성합니다:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openai-oauth": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OpenAI OAuth (ChatGPT)",
      "options": {
        "baseURL": "http://127.0.0.1:10531/v1"
      }
    }
  },
  "model": "openai-oauth/gpt-5.4"
}
```

### 사용 방법

1. **프록시 서버 시작** (아직 실행 중이 아니라면):
   ```bash
   npx openai-oauth
   ```

2. **OpenCode 실행** - 자동으로 `opencode.json`을 읽음

3. **모델 확인/변경**:
   ```
   /models
   ```

4. **다른 모델로 변경**:
   ```
   /model openai-oauth/gpt-5.3-codex
   ```

### 참고

| 항목 | 설명 |
| :--- | :--- |
| API 키 | 불필요 (OAuth 토큰 자동 사용) |
| 기본 모델 | `gpt-5.4` (계정 접근 권한에 따라 다름) |
| 모델 목록 | `/models` 명령어로 확인 가능 |
| 인증 파일 | `~/.codex/auth.json` 사용 |

---

## 7. 에이전트 수칙 (AI Agent Rules)
미래의 AI 에이전트는 다음 수칙을 반드시 지킵니다.
1. 모든 키 변경 작업 후에는 **프로세스 재시작 여부**를 사용자에게 묻지 않고 즉시 수행 또는 안내한다.
2. 서비스 장애 보고 시 가장 먼저 `C:\Logs\OpenAIOAuthProxy\stderr.log`를 읽어 원인을 파악한다.
3. 임시로 수동 실행(`bun run dev`)을 한 경우, 작업 종료 전 반드시 서비스를 원상복구하거나 상태를 명시한다.
4. **관리자 권한**이 필요한 작업(sc 명령 등) 실패 시 즉시 그 이유를 설명하고 사용자에게 고지한다.
