# MANAGE TOKEN 운영 가이드

이 문서는 `openai-oauth` 프로젝트의 토큰 전환 및 프록시 서버 운영을 **`MANAGE TOKEN` 기준으로 한 번에 정리한 실무용 가이드**입니다.

대상 범위:

- 토큰 생성 / 추가 / 덮어쓰기 / 삭제
- 활성 토큰 전환
- 다음 토큰으로 로테이션
- 현재 프록시 상태 확인
- 프록시 시작 / 재시작 / 종료
- 윈도우 부팅 후 자동 시작 문제 점검 및 수정

---

## 1. 핵심 요약

현재 운영 진입점은 아래 세 가지입니다.

1. **공통 CLI**
    - `bun run token <command>`
    - Windows와 macOS에서 같은 명령 형태를 사용
2. **대화형 메뉴**
   - 공통: `bun run token` 또는 `bun run token menu`
   - Windows launcher: `C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat`
3. **Windows 명령형 실행**
   - `C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat <command>`

기존 파일의 역할은 다음처럼 정리되었습니다.

- `manage-tokens.bat`
  - **메인 운영 진입점**
  - 토큰 관리 + 서버 운영 기능을 모두 담당
- `openai-oauth.bat`
  - 하위 호환용 래퍼
  - 내부적으로 `manage-tokens.bat` 로 위임
- `rotate-next-token.bat`
  - 다음 토큰 회전 전용 빠른 실행기
  - preview 후 rotate를 한 창에서 이어서 수행

---

## 2. 가장 자주 쓰는 명령

### 2.1 현재 상태 확인

공통 명령:

```powershell
bun run token status
```

Windows launcher:

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat status
```

확인 가능한 항목:

- 현재 활성 토큰 slot
- vault / active / backups 경로
- 서비스 상태 (`OpenAIOAuthProxy`)
- 헬스체크 결과 (`/health`)

---

### 2.2 서버 시작

공통 명령:

```powershell
bun run token start
```

Windows launcher:

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat start
```

설명:

- `OpenAIOAuthProxy` 서비스를 시작합니다.
- 서비스가 `Running` 상태가 되고 `/health` 체크가 통과할 때까지 기다립니다.

---

### 2.3 서버 재시작

공통 명령:

```powershell
bun run token restart
```

Windows launcher:

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat restart
```

설명:

- 현재 리스닝 중인 잔존 PID 정리
- 서비스 중지
- 필요 시 orphan 프로세스 재정리
- 서비스 재시작
- `/health` 재검증

토큰 변경 후에는 이 명령 또는 `rotate` / `switch` 흐름을 쓰는 것이 안전합니다.

---

### 2.4 서버 종료

공통 명령:

```powershell
bun run token stop
```

Windows launcher:

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat stop
```

설명:

- 서비스만 멈추는 게 아니라, 10531 포트를 점유 중인 lingering PID까지 정리합니다.
- Windows/macOS/Linux 모두 10531을 이 프록시 전용 포트로 간주합니다. 해당 포트를 점유한 listener가 남아 있으면 강제 종료될 수 있으므로 다른 개발 서버에 10531을 쓰지 마십시오.
- Windows의 start/stop/restart/rotate/switch는 관리자 PowerShell에서 실행해야 합니다. 자동 UAC 승격은 비동기 성공처럼 보일 수 있어 사용하지 않습니다.

---

### 2.5 다음 토큰으로 로테이션

공통 명령:

```powershell
bun run token rotate
```

Windows launcher:

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat rotate
```

또는 빠른 실행:

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\rotate-next-token.bat
```

설명:

- 다음 토큰으로 전환
- 서비스 재시작 포함
- 최종 상태까지 검증

`rotate-next-token.bat`는 미리보기 후 실제 로테이션을 이어서 수행하는 운영용 빠른 실행기입니다.

---

### 2.6 특정 slot으로 전환

공통 명령:

```powershell
bun run token switch 2
```

Windows launcher:

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat switch 2
```

설명:

- 지정한 slot으로 토큰을 전환합니다.
- 내부적으로 서비스 중지 → 토큰 전환 → 서비스 재시작 → 헬스체크 순서로 진행됩니다.

---

### 2.7 다음 로테이션 대상 미리보기

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat preview-next
```

표시 항목:

- 현재 계정
- 다음 계정
- 각 계정 이메일
- 만료 시각 및 남은 시간

---

## 3. 대화형 메뉴 사용법

아래 명령으로 메뉴를 엽니다.

공통 메뉴:

```bash
bun run token
```

명시적으로 열고 싶을 때:

```bash
bun run token menu
```

Windows launcher:

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat
```

메뉴에서 가능한 작업:

- 토큰 slot 목록 보기
- 새 토큰 생성 / import
- 활성 토큰 전환
- 다음 토큰으로 로테이션
- 비활성 slot 삭제
- 현재 프록시 / 서비스 상태 확인
- 프록시 / 서비스 시작
- 프록시 / 서비스 재시작
- 프록시 / 서비스 종료

메뉴 실행 시에는 창이 바로 닫히지 않도록 pause가 유지됩니다.
반대로 `status`, `start`, `restart` 같은 **명령형 실행**은 자동화에 쓰기 쉽게 바로 종료됩니다.

macOS/Linux에서는 `bun run token` 메뉴가 같은 번호 구성을 제공하며, 프록시는 repo-local `.codex/proxy.pid`와 10531 포트 기준으로 시작/중지됩니다.

---

## 4. 토큰 생성 방식

새 토큰 생성 시에는 live `~/.codex/auth.json`을 바로 덮어쓰지 않습니다.

대신 아래 원칙을 따릅니다.

- 임시 `CODEX_HOME` 생성
- `npx @openai/codex login` 수행
- 생성된 `auth.json`을 검토
- 원하는 vault slot에 저장 또는 새 slot 추가

이 방식의 장점:

- 현재 서비스가 쓰는 live auth 파일을 바로 덮어쓰지 않음
- 잘못 로그인한 토큰을 운영 중 auth에 즉시 반영하지 않음
- 새 토큰을 검토 후 원하는 slot에 배치 가능

명령형 `bun run token vault add`도 vault에 새 slot만 추가합니다. 실제 live `auth.json` 변경은 `bun run token switch <n>` 또는 메뉴의 명시적 전환을 실행할 때만 발생합니다.

---

## Dashboard Token Management

After CLI login, you can also manage tokens via the dashboard:

1. Open `http://127.0.0.1:10531/dashboard`
2. Go to the Tokens tab
3. Click "Save current auth as slot" to store current authentication
4. Use Switch/Rotate/Delete as needed

Note: Switch and rotate operations require restarting the proxy:
```powershell
.codex\launchers\manage-tokens.bat restart
```

---

## 5. 서버 구조와 관련 파일

### 5.1 주요 런처

- `.codex/launchers/manage-tokens.bat`
- `.codex/launchers/openai-oauth.bat`
- `.codex/launchers/rotate-next-token.bat`

### 5.2 핵심 PowerShell / JS 스크립트

- `.codex/scripts/token-manager-menu.ps1`
- `.codex/scripts/rotate-service-token.ps1`
- `.codex/scripts/token-rotator.js`

`token-rotator.js`는 `CODEX_HOME`이 있으면 해당 경로를 auth root로 사용하고, 없으면 사용자 홈의 `.codex`를 사용합니다. vault, active, backups, config 파일은 auth root 아래에 있어야 합니다.

### 5.3 서비스 관련 파일

- `register-service.ps1`
- `C:\Tools\OpenAIOAuthProxy\openai-oauth-proxy.bat`
- `C:\Logs\OpenAIOAuthProxy\stdout.log`
- `C:\Logs\OpenAIOAuthProxy\stderr.log`

### 5.4 실서비스 이름

- 서비스명: `OpenAIOAuthProxy`

---

## 6. 윈도우 부팅 후 자동 시작이 안 될 때

### 6.1 현재 판단한 주요 원인

이번 점검 기준으로, 예전의 대표 원인이던 아래 항목은 이미 해결된 상태였습니다.

- 공백 경로 문제 (`C:\NEW PRG\...`)
- `LocalSystem` 계정에서 `auth.json` 위치를 못 찾는 문제

현재 남은 주요 취약점은 **Session 0에서 콘솔 앱(node.exe) 실행 안정성**입니다.

즉, 수동 시작은 되는데 부팅 직후 자동 시작만 불안정하다면 다음을 우선 의심합니다.

1. `CODEX_HOME`이 잘못됨
2. `AppDirectory`가 잘못됨
3. delayed-auto 미설정
4. 부팅 시 콘솔 앱 실행 안정성 부족 (`AppNoConsole` 미적용)
5. 포트 10531 잔존 점유 프로세스

---

### 6.2 점검 명령

```powershell
sc.exe qc OpenAIOAuthProxy
Get-CimInstance Win32_Service -Filter "Name='OpenAIOAuthProxy'" | Format-List *
& "C:\Tools\nssm\nssm-2.24-101-g897c7ad\win64\nssm.exe" get OpenAIOAuthProxy AppDirectory
& "C:\Tools\nssm\nssm-2.24-101-g897c7ad\win64\nssm.exe" get OpenAIOAuthProxy AppEnvironmentExtra
& "C:\Tools\nssm\nssm-2.24-101-g897c7ad\win64\nssm.exe" get OpenAIOAuthProxy AppNoConsole
```

기대값:

- `AppDirectory = C:\NEW PRG\openai-oauth`
- `AppEnvironmentExtra = CODEX_HOME=C:\Users\U-N-00658\.codex`
- 시작 타입 = `delayed-auto`
- `AppNoConsole = 1`

---

### 6.3 수정 명령

관리자 PowerShell에서 실행:

```powershell
sc.exe config OpenAIOAuthProxy start= delayed-auto
& "C:\Tools\nssm\nssm-2.24-101-g897c7ad\win64\nssm.exe" set OpenAIOAuthProxy AppNoConsole 1
```

필요하면 서비스 구성 전체를 다시 적용:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\NEW PRG\openai-oauth\register-service.ps1"
```

---

### 6.4 수정 후 확인

```powershell
sc.exe query OpenAIOAuthProxy
curl.exe http://127.0.0.1:10531/health
```

정상 기준:

- 서비스 상태: `RUNNING`
- 헬스체크: `{"ok":true}` 또는 `{"ok":true,"replay_state":"stateless"}`

---

## 7. 운영 시 주의사항

### 7.1 관리자 권한이 필요한 작업

다음 작업은 관리자 PowerShell이 안전합니다.

- 서비스 시작 / 중지 / 재시작
- NSSM 설정 변경
- 포트 점유 프로세스 강제 종료
- 서비스 재등록

### 7.2 토큰 변경 후 재시작은 필수

이 프로젝트는 **auth.json hot reload를 기대하면 안 됩니다.**

즉:

- 토큰 파일만 바꾸고 서비스 재시작을 안 하면
- 프록시가 기존 인증 상태를 유지할 수 있습니다.

그래서 토큰 변경은 반드시 아래 흐름 중 하나로 처리해야 합니다.

- `manage-tokens.bat rotate`
- `manage-tokens.bat switch <n>`
- `manage-tokens.bat restart`

### 7.3 로그 확인 위치

문제가 생기면 가장 먼저 볼 파일:

- `C:\Logs\OpenAIOAuthProxy\stderr.log`
- `C:\Logs\OpenAIOAuthProxy\stdout.log`

---

## 8. 추천 운영 흐름

### 평소 점검

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat status
```

### 토큰 만료가 가까울 때

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat preview-next
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat rotate
```

### 특정 계정으로 강제 전환

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat switch 2
```

### 서버만 다시 올리고 싶을 때

```powershell
C:\NEW PRG\openai-oauth\.codex\launchers\manage-tokens.bat restart
```

### 부팅 자동 시작 문제를 손볼 때

```powershell
sc.exe config OpenAIOAuthProxy start= delayed-auto
& "C:\Tools\nssm\nssm-2.24-101-g897c7ad\win64\nssm.exe" set OpenAIOAuthProxy AppNoConsole 1
```

---

## 9. 관련 문서

- `docs/OPERATIONS.md` - 전체 운영 매뉴얼
- `docs/sessions/20260423_165056_manage-token-unification-and-startup-hardening.md` - 이번 통합 작업 기록
