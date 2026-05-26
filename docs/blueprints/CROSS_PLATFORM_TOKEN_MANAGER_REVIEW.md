# 물리적으로 분리된 Mac/Windows 토큰 관리자 검토서

## 목적

물리적으로 분리된 macOS PC와 Windows PC에서 이 레포의 토큰 관리자/프록시 운영을 같은 명령 체계로 사용할 수 있는지 검토하고, Prometheus가 구현 계획서를 작성할 수 있도록 입력 조건을 고정한다.

## 최종 판단

가능하다. 단, 전제는 **코드는 하나로 유지하되 각 PC의 실행 상태와 인증 저장소는 완전히 로컬로 분리**하는 것이다.

- Windows PC는 Windows 로컬 `~/.codex`와 Windows 서비스/프로세스를 사용한다.
- macOS PC는 macOS 로컬 `~/.codex`와 macOS 로컬 프로세스를 사용한다.
- 두 PC는 물리적으로 분리되어 있고, `auth.json`, `vault/`, `active/`, `backups/`, `token-rotator-config.json`, PID 파일을 공유하지 않는다.
- 같은 포트 번호 `10531`은 각 PC의 `127.0.0.1` 안에서만 의미가 있으므로 충돌하지 않는다.

따라서 목표는 “Mac용 코드와 Windows용 코드를 따로 만드는 것”이 아니라, **공통 CLI 진입점 하나가 OS를 감지해 각 PC의 로컬 상태를 제어**하도록 정리하는 것이다.

## 전제 조건

- 두 PC는 물리적으로 분리되어 있다.
- 두 PC는 같은 디스크, 네트워크 드라이브, Dropbox, OneDrive, iCloud Drive 같은 동기화 폴더를 `CODEX_HOME` 또는 `~/.codex`로 공유하지 않는다.
- 각 PC에서 `npx @openai/codex login`을 별도로 수행할 수 있다.
- 각 PC의 `auth.json`은 로컬 credential로 취급한다.
- Windows 운영 경로는 기존 `OpenAIOAuthProxy` NSSM 서비스와 `rotate-service-token.ps1` 흐름을 우선 활용한다.
- macOS 운영 경로는 별도 서비스가 아직 없다면 로컬 detached process 또는 이후 계획에서 정하는 macOS 전용 process manager를 사용한다.

## 비목표

- 두 PC 간 토큰 파일 동기화.
- 한 PC에서 다른 PC의 프록시를 원격으로 제어.
- 공유 `auth.json`에 대한 분산 락 구현.
- 토큰 풀링 또는 계정/토큰 배포 기능.
- GUI 기반 관리 도구.
- 주기적 health check 기반 감시. 이 레포는 API quota 소비를 피하기 위해 주기적 health check를 피해야 한다.

## 현재 코드에서 확인된 사실

- `.codex/scripts/token-rotator.js`는 `process.platform === "win32"`이면 PowerShell 스크립트에 위임하고, 그 외 OS에서는 Unix 방식으로 `lsof`, `kill`, `bun run dev`, PID 파일을 사용한다.
- `.codex/scripts/rotate-service-token.ps1`은 Windows 서비스 `OpenAIOAuthProxy`, 관리자 권한, 포트 `10531`, `/health` 검증에 의존한다.
- `packages/openai-oauth-core/src/auth.ts`는 `auth.json`을 읽고, refresh가 필요하면 같은 파일에 다시 쓴다.
- 실행 중인 프록시는 인증 상태를 메모리에 캐시하므로 `auth.json` 변경 후 재시작이 필요하다.
- 현재 파일 쓰기에는 cross-process lock이나 atomic write 보장이 없다. 이는 공유 저장소 동시 사용 시 위험하지만, 물리적으로 분리된 PC의 로컬 저장소만 사용한다면 OS 간 충돌 문제는 발생하지 않는다.

## 권장 사용자 경험

최종 목표는 양쪽 OS에서 같은 명령을 쓰는 것이다.

```bash
bun run token status
bun run token rotate
bun run token switch 2
bun run token restart
```

또는 패키지 CLI로 다음처럼 노출할 수 있다.

```bash
openai-oauth token status
openai-oauth token rotate
openai-oauth token switch 2
openai-oauth token restart
```

명령어는 같지만 내부 동작은 OS별로 분기한다.

## OS별 기대 동작

### Windows

- auth root: `%USERPROFILE%\.codex` 또는 명시된 `CODEX_HOME`
- proxy owner: `OpenAIOAuthProxy` Windows/NSSM service
- restart owner: PowerShell service script
- status 확인:
  - 서비스 상태
  - 포트 `10531` listener
  - `http://127.0.0.1:10531/health`

### macOS

- auth root: `$HOME/.codex` 또는 명시된 `CODEX_HOME`
- proxy owner: macOS 로컬 프로세스
- restart owner: macOS branch of the common command
- status 확인:
  - PID 또는 process manager 상태
  - 포트 `10531` listener
  - `http://127.0.0.1:10531/health`

## 설계 원칙

1. **공통 진입점 하나**
   - OS별 스크립트를 사용자가 직접 기억하지 않게 한다.
   - Windows와 macOS 모두 같은 명령어를 사용한다.

2. **로컬 상태 분리**
   - 각 PC의 `CODEX_HOME`/`~/.codex`만 조작한다.
   - 공유 폴더나 동기화 폴더를 auth root로 사용하지 않는다.

3. **OS별 runtime owner 분리**
   - Windows branch는 Windows service만 제어한다.
   - macOS branch는 macOS 로컬 process만 제어한다.

4. **토큰 변경과 재시작을 한 작업으로 취급**
   - rotate/switch 후에는 프록시 재시작과 health 확인까지 수행한다.
   - `--no-restart`는 고급/디버그 옵션으로만 유지하고 기본 경로에서는 쓰지 않는다.

5. **검증 가능한 성공만 성공으로 본다**
   - 로그 출력만으로 성공 처리하지 않는다.
   - 실제 listener와 `/health` 응답으로 확인한다.

## Prometheus 위임 요청

Prometheus는 아래 목표로 구현 계획서를 작성한다.

### 목표

물리적으로 분리된 Windows PC와 macOS PC에서 같은 명령어로 로컬 토큰 전환과 프록시 재시작을 수행하는 cross-platform token manager 계획서를 작성한다.

### 계획서에 반드시 포함할 항목

- 최종 CLI 명령 형태
- 현재 `.codex/scripts/token-rotator.js`, `.codex/scripts/rotate-service-token.ps1`, `.codex/scripts/token-manager-menu.ps1` 중 무엇을 유지/통합/랩핑할지 결정
- `CODEX_HOME`/auth root 해석 규칙
- Windows service branch 설계
- macOS process branch 설계
- `status`, `rotate`, `switch`, `restart`, `stop`, `start`별 동작 순서
- 실패 시 rollback 또는 중단 기준
- Windows 검증 절차
- macOS 검증 절차
- 문서 업데이트 범위

### 계획서에서 피해야 할 방향

- 두 PC 간 auth 파일 공유 설계
- 토큰 동기화 설계
- 분산 락 또는 remote coordinator 설계
- 주기적 health check 설계
- 불필요한 GUI 또는 대형 서비스 프레임워크 도입

## 구현 마일스톤 초안

1. 현재 운영 명령과 파일 경로 목록화
2. 공통 CLI 진입점 결정
3. 플랫폼 감지 및 auth root 해석 함수 설계
4. Windows branch는 기존 PowerShell/NSSM 흐름을 안정적으로 랩핑
5. macOS branch는 Unix 흐름을 명시적으로 정리하고 PID/port 검증을 보강
6. rotate/switch/restart/status 명령을 동일 UX로 통합
7. Windows 실제 실행 검증
8. macOS 실제 실행 검증
9. 운영 문서 업데이트

## 검증 매트릭스

| 항목 | Windows | macOS |
| --- | --- | --- |
| status | 서비스 상태, listener PID, `/health` 확인 | process/PID, listener PID, `/health` 확인 |
| rotate | 토큰 전환, 서비스 재시작, `/health` 확인 | 토큰 전환, 프로세스 재시작, `/health` 확인 |
| switch | 지정 slot 반영, 서비스 재시작 | 지정 slot 반영, 프로세스 재시작 |
| restart | `OpenAIOAuthProxy` stop/start 확인 | 로컬 proxy stop/start 확인 |
| auth path | `%USERPROFILE%\.codex` 또는 `CODEX_HOME` | `$HOME/.codex` 또는 `CODEX_HOME` |
| no sharing | 공유/동기화 폴더 미사용 확인 | 공유/동기화 폴더 미사용 확인 |

## 주요 리스크

- Windows 관리자 권한이 없으면 service restart가 실패할 수 있다.
- macOS에서 process manager를 무엇으로 할지 정하지 않으면 stop/restart 안정성이 낮을 수 있다.
- `auth.json` hot reload는 기대하면 안 된다. 토큰 변경 후 재시작은 기본 동작이어야 한다.
- 한 PC의 `auth.json`을 다른 PC로 복사하는 운영은 보안과 refresh 상태 측면에서 권장하지 않는다.
- `CODEX_HOME`이 OneDrive/iCloud/Dropbox 같은 동기화 폴더를 가리키면 전제가 깨진다.

## 한 줄 결론

물리적으로 분리된 Mac/Windows PC 조건에서는 **공통 코드 1개와 공통 명령어 1개로 운영 가능**하다. 단, 각 PC의 인증 저장소와 프록시 런타임은 반드시 로컬로 분리해야 한다.
