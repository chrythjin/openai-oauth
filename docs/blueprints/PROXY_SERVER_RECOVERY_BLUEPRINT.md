# Proxy Server Recovery Blueprint (openai-oauth)

## 문서 목적

이 문서는 **전역 설정/폴더가 날아가도** 이 레포만 보고 프록시 서버를 누구나 재구성·운영할 수 있도록 만든 실행 설계도입니다.

- 대상: 운영자/개발자/후임 엔지니어
- 목표: 로컬 단일 프록시(127.0.0.1:10531) 안정 운영
- 범위: 설정, 실행, 장애 진단, 토큰 전환, Windows 상시 실행

---

## 0) 시스템 개요 (한눈에)

클라이언트(OpenAI SDK/툴) → `http://127.0.0.1:10531/v1/*` → openai-oauth proxy → ChatGPT Codex upstream

핵심 포인트:
- 이 프록시는 OpenAI 호환 API 형태(`/v1/chat/completions`, `/v1/responses`, `/v1/models`)를 제공
- 실제 모델 호출은 Codex OAuth 토큰을 사용해 upstream으로 전달
- 모델 가용성은 계정별로 다름 (`/v1/models`로 확인 필요)

---

## 1) 코드 구조 / 책임 맵

### A. CLI 시작점
- `packages/openai-oauth/src/cli.ts`
- `packages/openai-oauth/src/cli-app.ts`

역할:
1. 옵션 파싱 (`--host`, `--port`, `--oauth-file` 등)
2. auth 파일 존재 확인
3. 모델 목록 확인
4. 서버 시작
5. SIGINT/SIGTERM graceful shutdown

### B. HTTP 서버 / 라우팅
- `packages/openai-oauth/src/server.ts`

역할:
- `/health`
- `/v1/models`
- `/v1/responses`
- `/v1/chat/completions`

### C. Auth/Transport 코어
- `packages/openai-oauth-core/src/auth.ts`
- `packages/openai-oauth-core/src/transport.ts`

역할:
- auth.json 후보 경로 탐색
- access_token 갱신(refresh_token 기반)
- Authorization, account-id 헤더 주입
- upstream 요청 변환 및 전달

### D. Endpoint 핸들러
- `packages/openai-oauth/src/chat-completions.ts`
- `packages/openai-oauth/src/responses.ts`

---

## 2) 필수 사전 조건

1. Bun 설치
2. Codex 로그인 (토큰 파일 생성)
   - `npx @openai/codex login`
3. auth 파일 위치 확인
   - 기본 후보: `~/.codex/auth.json`, `~/.chatgpt-local/auth.json`

보안 원칙:
- auth.json은 패스워드급 민감정보
- git 커밋 금지
- 로그에 토큰/계정 식별자 출력 금지

---

## 3) 로컬 실행 절차 (개발 모드)

레포 루트에서:

```bash
bun install
bun run build
bun run dev
```

정상 기동 메시지 확인 후:
- Base URL: `http://127.0.0.1:10531/v1`

---

## 4) 모델 선택 규칙 (중요)

### 왜 Bad Request가 나는가?
가장 흔한 원인: **계정 미지원 모델 호출**

예:
- 실패 가능: `gpt-4o-mini` (계정 미지원)
- 성공 가능: `gpt-5.2` (계정 지원 시)

### 항상 먼저 확인

```bash
GET /v1/models
```

반환 목록에 있는 모델만 호출한다.

---

## 5) 토큰 전환 운영 절차 (이메일 기준)

### 기본 원칙
- 프록시가 실제로 읽는 파일은 `~/.codex/auth.json` (기본)
- 특정 계정으로 전환하려면 대상 auth 파일 내용을 `~/.codex/auth.json`으로 복사
- 전환 후 프록시 재시작

### 운영 체크리스트
1. 대상 이메일이 들어있는 auth 파일 확인
2. `~/.codex/auth.json` 교체
3. 프록시 재시작
4. `/v1/models` 확인
5. 채팅 1회 smoke test

---

## 6) Windows에서 "PC 하나에 프록시 하나"로 상시 운영

핵심:
- 코드 해킹(PID 락 파일 등)보다 **서비스 매니저** 사용
- 단일 서비스 인스턴스 + 고정 포트(10531)로 운영

권장 옵션:
1. NSSM 또는 WinSW로 서비스화
2. 서비스 계정은 auth.json 접근 가능한 계정으로 설정
3. 자동 재시작 정책 적용
4. stdout/stderr 로그 파일 경로 고정

주의:
- 이미 10531 점유 중이면 기동 실패 (정상적인 중복 방지 동작)

---

## 7) 장애 진단 플레이북

### 증상 A: `Bad Request`
1. `/v1/models` 확인 (모델 미지원 여부)
2. 요청 payload 최소화
3. `chat/completions`와 `responses` 각각 독립 테스트

### 증상 B: 서버가 안 뜸
1. 포트 점유 확인 (`netstat -ano | findstr :10531`)
2. auth 파일 존재/권한 확인
3. 로그 확인

### 증상 C: 인증 에러
1. `npx @openai/codex login` 재실행
2. auth.json의 access/refresh 토큰 상태 확인
3. 시스템 시간 오차 확인

---

## 8) 운영 안전 가드레일

1. 기본 로그는 민감정보 비노출
2. 디버그 로그는 env flag로만 활성화
   - 예: `OPENAI_OAUTH_AUTH_DEBUG=1`
3. verbose 에러 로그도 env flag로 제한
   - 예: `OPENAI_OAUTH_VERBOSE_ERRORS=1`
4. 기본 모드는 최소 정보 로그

---

## 9) 복구 절차 (전역 폴더 유실 시)

1. Codex 로그인 재실행으로 auth 재생성
2. 레포 빌드
3. 프록시 실행
4. `/v1/models` 확인
5. 스모크 테스트
6. 서비스 재등록(NSSM/WinSW)

---

## 10) 빠른 체크 명령 모음

```bash
# 빌드
bun run build

# 타입체크
bun run typecheck

# 테스트
bun run test

# 프록시 실행
bun run dev
```

Windows 포트 확인:
```powershell
netstat -ano | findstr :10531
```

---

## 11) 변경 시 금지사항

- auth 토큰/계정 ID를 기본 로그에 출력하지 말 것
- `as any`, `@ts-ignore` 사용 금지
- 테스트 깨진 상태로 배포 금지
- 프록시를 외부 공개 서비스로 운영 금지

---

## 12) 인수인계용 최소 실행 스크립트 (사람 절차)

1. Bun 설치
2. `npx @openai/codex login`
3. 레포 clone + `bun install`
4. `bun run build`
5. `bun run dev`
6. `/v1/models`로 가용 모델 확인
7. 해당 모델로 chat completion 테스트
8. 필요 시 Windows 서비스 등록

이 8단계만 지키면, 전역 설정이 초기화되어도 재구축 가능.

---

## 13) 시시프스 전달용: NSSM 서비스 전환 런북 (무중단 준비 + 짧은 컷오버)

**목표:** 인터랙티브 실행 중인 프록시를 다운타임 최소화로 NSSM 기반 Windows 서비스로 전환  
**대상 리포지토리:** `C:\NEW PRG\openai-oauth`  
**서비스명:** `OpenAIOAuthProxy`  
**현재 유지 대상:** 기존 인터랙티브 프록시 (`127.0.0.1:10531`)  
**중요 금지:** 지금 기존 프록시 stop/restart 금지, auth 파일 수정 금지, 지금 service start/stop 금지

### 13.1 사전 체크 및 상태 확인
```powershell
sc.exe query OpenAIOAuthProxy
where.exe nssm
netstat -ano | findstr 10531
tasklist /FI "PID eq <현재_10531_PID>"
Test-Path "C:\Program Files\nodejs\node.exe"
Test-Path "C:\NEW PRG\openai-oauth\packages\openai-oauth\dist\cli.js"
Get-ChildItem "C:\NEW PRG\openai-oauth\packages\openai-oauth\dist"
Get-ChildItem "$env:USERPROFILE\.codex"
```

### 13.2 Phase A: 준비 단계 (무중단)

#### nssm 설치 확인
```powershell
Test-Path "C:\Tools\nssm\win64\nssm.exe"
& "C:\Tools\nssm\win64\nssm.exe" version
```

#### 로그 디렉터리 생성
```powershell
New-Item -ItemType Directory -Force -Path "C:\Logs\OpenAIOAuthProxy"
```

#### 서비스 초기화 및 재생성
```powershell
sc.exe query OpenAIOAuthProxy
sc.exe delete OpenAIOAuthProxy
sc.exe query OpenAIOAuthProxy
& "C:\Tools\nssm\win64\nssm.exe" install OpenAIOAuthProxy "C:\Program Files\nodejs\node.exe" "C:\NEW PRG\openai-oauth\packages\openai-oauth\dist\cli.js"
```

#### 서비스 파라미터 및 로그 설정
```powershell
& "C:\Tools\nssm\win64\nssm.exe" set OpenAIOAuthProxy AppDirectory "C:\NEW PRG\openai-oauth"
& "C:\Tools\nssm\win64\nssm.exe" set OpenAIOAuthProxy AppStdout "C:\Logs\OpenAIOAuthProxy\stdout.log"
& "C:\Tools\nssm\win64\nssm.exe" set OpenAIOAuthProxy AppStderr "C:\Logs\OpenAIOAuthProxy\stderr.log"
& "C:\Tools\nssm\win64\nssm.exe" set OpenAIOAuthProxy AppRotateFiles 1
& "C:\Tools\nssm\win64\nssm.exe" set OpenAIOAuthProxy AppRotateOnline 1
```

#### 시작 유형 설정
```powershell
& "C:\Tools\nssm\win64\nssm.exe" set OpenAIOAuthProxy Start SERVICE_AUTO_START
& "C:\Tools\nssm\win64\nssm.exe" set OpenAIOAuthProxy AppStopMethodSkip 0
sc.exe config OpenAIOAuthProxy start= delayed-auto
sc.exe qc OpenAIOAuthProxy
```

#### 컷오버 전 최종 검증 (아직 start 금지)
```powershell
sc.exe qc OpenAIOAuthProxy
reg query "HKLM\SYSTEM\CurrentControlSet\Services\OpenAIOAuthProxy"
Test-Path "C:\Logs\OpenAIOAuthProxy\stdout.log"
Test-Path "C:\Logs\OpenAIOAuthProxy\stderr.log"
netstat -ano | findstr 10531
```

### 13.3 Phase B: 컷오버 단계 (짧은 제어 전환)

#### 전환 직전 상태 점검
```powershell
netstat -ano | findstr 10531
tasklist /FI "PID eq <현재_10531_PID>"
sc.exe query OpenAIOAuthProxy
```

#### 기존 프로세스 종료 및 포트 확인
```powershell
# 기존 인터랙티브 프록시(콘솔)를 수동으로 종료(Ctrl+C)한 후 확인
netstat -ano | findstr 10531
```

#### nssm 서비스 시작 및 헬스체크
```powershell
sc.exe start OpenAIOAuthProxy
# 또는 & "C:\Tools\nssm\win64\nssm.exe" start OpenAIOAuthProxy

sc.exe query OpenAIOAuthProxy
netstat -ano | findstr 10531
Get-Content "C:\Logs\OpenAIOAuthProxy\stdout.log" -Tail 50
Get-Content "C:\Logs\OpenAIOAuthProxy\stderr.log" -Tail 50
curl.exe http://127.0.0.1:10531
```

### 13.4 장애 대응 및 롤백

#### 트리아지 명령어
```powershell
Get-Content "C:\Logs\OpenAIOAuthProxy\stderr.log" -Tail 100
Get-Content "C:\Logs\OpenAIOAuthProxy\stdout.log" -Tail 100
sc.exe query OpenAIOAuthProxy
sc.exe qc OpenAIOAuthProxy
netstat -ano | findstr 10531
curl.exe -v http://127.0.0.1:10531
```

#### 롤백 실행
```powershell
sc.exe stop OpenAIOAuthProxy
sc.exe query OpenAIOAuthProxy

# 기존 인터랙티브 방식으로 직접 재기동
Set-Location "C:\NEW PRG\openai-oauth"
& "C:\Program Files\nodejs\node.exe" "C:\NEW PRG\openai-oauth\packages\openai-oauth\dist\cli.js"

# 롤백 검증
netstat -ano | findstr 10531
curl.exe http://127.0.0.1:10531
```

### 13.5 Sisyphus 한 줄 원칙
- 지금은 아무 것도 끊지 않는다
- 준비는 전부 무중단으로 끝낸다
- 컷오버 순간에만 기존 프로세스를 내리고 즉시 NSSM 서비스를 올린다
- 실패하면 즉시 기존 인터랙티브 node 실행으로 롤백한다

---

## 14) 검증 완료: 실제 작동하는 NSSM 서비스 설정

### 14.1 발생했던 문제들

**문제 1: 경로 공백 (`C:\NEW PRG\`)**
- 증상: `Error: Cannot find module 'C:\NEW'`
- 원인: NSSM이 공백 경로를 인수를 나눠서 받음
- 해결: **래퍼 배치 파일 사용**

**문제 2: LocalSystem 계정이 auth.json을 못 찾음**
- 증상: `No auth file was found in the default search paths: C:\WINDOWS\system32\config\systemprofile\.codex\auth.json`
- 원인: LocalSystem은 시스템 프로필에서 찾음, 실제 사용자인 `U-N-00658` 프로필의 `auth.json`을 못 봄
- 해결: **배치 파일에서 `CODEX_HOME` 환경변수 설정**

### 14.2 최종 작동 구성

**래퍼 배치 파일** (`C:\Tools\OpenAIOAuthProxy\openai-oauth-proxy.bat`):
```batch
@echo off
set CODEX_HOME=C:\Users\U-N-00658\.codex
"C:\Program Files\nodejs\node.exe" "C:\NEW PRG\openai-oauth\packages\openai-oauth\dist\cli.js"
```

**NSSM 설정:**
- Application: `C:\Tools\OpenAIOAuthProxy\openai-oauth-proxy.bat`
- AppDirectory: `C:\NEW PRG\openai-oauth`
- AppStdout: `C:\Logs\OpenAIOAuthProxy\stdout.log`
- AppStderr: `C:\Logs\OpenAIOAuthProxy\stderr.log`
- AppRotateFiles: 1
- AppRotateOnline: 1
- Start: `delayed-auto`

**서비스 계정:** LocalSystem (배치 파일의 `CODEX_HOME`으로 해결)

### 14.3 현재 상태 (2026-04-19 검증 완료)

| 항목 | 상태 |
|------|------|
| 서비스 | **RUNNING** ✅ |
| 포트 10531 | **LISTENING** ✅ |
| Health | `{"ok":true}` ✅ |
| Models | 5개 모델 응답 ✅ |
| 재부팅 시 자동 시작 | **delayed-auto** ✅ |
| 로그 로테이션 | **활성** ✅ |

### 14.4 서비스 관리 명령어

```powershell
# 상태 확인
sc.exe query OpenAIOAuthProxy

# 중지
sc.exe stop OpenAIOAuthProxy

# 시작
sc.exe start OpenAIOAuthProxy

# 로그 확인
Get-Content "C:\Logs\OpenAIOAuthProxy\stderr.log" -Tail 30
Get-Content "C:\Logs\OpenAIOAuthProxy\stdout.log" -Tail 30

# 헬스체크
curl.exe http://127.0.0.1:10531/health
curl.exe http://127.0.0.1:10531/v1/models
```

### 14.5 재구축 시 체크리스트

- [ ] NSSM 설치: `winget install NSSM` 또는 `choco install nssm`
- [ ] `C:\Tools\OpenAIOAuthProxy\` 디렉터리 생성
- [ ] `openai-oauth-proxy.bat` 배치 파일 생성 (CODEX_HOME 포함)
- [ ] NSSM 서비스 생성 및 설정
- [ ] 로그 디렉터리 권한: `icacls "C:\Logs\OpenAIOAuthProxy" /grant "NT AUTHORITY\SYSTEM:(OI)(CI)RX" /T`
- [ ] `delayed-auto` 시작 타입 설정
