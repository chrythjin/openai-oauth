# Cross-Platform Token Manager 계획서

## 목표

물리적으로 분리된 Windows PC와 macOS PC에서 같은 명령 체계로 로컬 토큰 전환과 프록시 런타임 제어를 수행한다. 코드는 하나로 유지하고, 인증 저장소와 실행 상태는 각 PC의 로컬 `CODEX_HOME` 또는 `~/.codex`에만 둔다.

## 최종 CLI

레포 루트에서 아래 명령을 공통 진입점으로 사용한다.

```bash
bun run token status
bun run token rotate
bun run token switch 2
bun run token restart
bun run token stop
bun run token start
```

기존 하위 호환 명령도 유지한다.

```bash
bun .codex/scripts/token-rotator.js --status
bun .codex/scripts/token-rotator.js --rotate
bun .codex/scripts/token-rotator.js --use 2
```

## 유지/통합 결정

- `.codex/scripts/token-rotator.js`: 공통 CLI 진입점으로 유지하고 `status`, `rotate`, `switch`, `restart`, `stop`, `start` 명령형 인자를 추가한다.
- `.codex/scripts/rotate-service-token.ps1`: Windows 서비스/NSSM 런타임 제어기로 유지한다. Windows에서 재시작이 필요한 명령은 이 스크립트에 위임한다.
- `.codex/scripts/token-manager-menu.ps1`: Windows 대화형 메뉴로 유지한다. auth root 해석은 공통 규칙에 맞춰 `CODEX_HOME` 우선으로 맞춘다.
- `.codex/launchers/*.bat`: Windows 운영 편의 래퍼로 유지한다.

## Auth Root 규칙

1. `CODEX_HOME`이 있으면 해당 경로를 auth root로 사용한다.
2. 없으면 OS의 사용자 홈 아래 `.codex`를 사용한다.
3. `auth.json`, `vault/`, `active/`, `backups/`, `token-rotator-config.json`은 모두 auth root 아래에 둔다.
4. OneDrive, iCloud Drive, Dropbox, 네트워크 드라이브 같은 동기화/공유 경로를 auth root로 쓰지 않는다.

## Windows Branch

- runtime owner: `OpenAIOAuthProxy` Windows/NSSM service
- token command owner: `token-rotator.js`
- service operation owner: `rotate-service-token.ps1`
- restart-required commands: `rotate`, `switch`, `restart`, `stop`, `start`
- validation: service state, port `10531`, `/health`

Windows에서 `bun run token rotate`와 `bun run token switch <n>`은 PowerShell 서비스 스크립트에 작업 전체를 위임한다. 이 경로는 서비스 중지, lingering PID 정리, 토큰 전환, 서비스 시작, `/health` 검증을 하나의 흐름으로 처리한다.

## macOS Branch

- runtime owner: local detached Bun process
- pid file: repo-local `.codex/proxy.pid`
- listener check: `lsof -nP -iTCP:10531 -sTCP:LISTEN -t`
- validation: PID/process, port `10531`, `/health`

macOS에서 `rotate`와 `switch`는 기존 proxy를 멈춘 뒤 auth root의 active token을 바꾸고, `bun run dev`를 detached process로 다시 시작한다. 시작 성공은 `/health` 응답으로만 판단한다.

## 명령별 순서

| 명령 | Windows | macOS |
| --- | --- | --- |
| `status` | 토큰 상태, 서비스 상태, `/health` 출력 | 토큰 상태, PID 파일, listener PID, `/health` 출력 |
| `rotate` | 서비스 중지 → 토큰 회전 → 서비스 시작 → `/health` | 프로세스 중지 → 토큰 회전 → detached 시작 → `/health` |
| `switch <n>` | 서비스 중지 → slot 전환 → 서비스 시작 → `/health` | 프로세스 중지 → slot 전환 → detached 시작 → `/health` |
| `restart` | 서비스 중지 → 서비스 시작 → `/health` | 프로세스 중지 → detached 시작 → `/health` |
| `stop` | 서비스 중지와 port cleanup | PID 파일과 port listener cleanup |
| `start` | 서비스 시작 → `/health` | detached 시작 → `/health` |

## 실패 기준

- 대상 vault entry가 없으면 토큰 전환을 시작하지 않는다.
- stop 후 포트가 비워지지 않으면 Windows 서비스 스크립트는 실패 처리한다.
- start 후 `/health`가 제한 시간 안에 통과하지 않으면 실패 처리한다.
- macOS detached start가 실패하면 생성한 PID 파일을 제거한다.
- 토큰 전환 후 프록시 시작이 실패하면 자동 rollback은 하지 않는다. 이전 active token backup은 `backups/`에 남기고 운영자가 명시적으로 `switch`로 되돌린다.

## 검증 절차

Windows:

```powershell
bun run token status
bun run token restart
bun run token status
```

macOS:

```bash
bun run token status
bun run token restart
bun run token status
```

토큰 변경 검증은 실제 계정 전환이 필요한 운영 작업이므로 `rotate` 또는 `switch <n>` 실행 전에 현재 slot과 vault 상태를 먼저 확인한다.

## 문서 업데이트 범위

- `docs/OPERATIONS.md`: 공통 `bun run token` 명령과 OS별 런타임 소유권을 추가한다.
- `docs/MANAGE_TOKEN_GUIDE.md`: Windows launcher 외에 공통 CLI를 우선 명령으로 명시한다.
- `.codex/README.md`: auth root가 레포 `.codex`가 아니라 로컬 `CODEX_HOME`/`~/.codex`임을 명확히 한다.
