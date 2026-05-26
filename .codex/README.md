# .codex - Token Management Scripts

토큰 로테이터와 운영 런처를 보관합니다. 실제 토큰 저장소는 레포 `.codex`가 아니라 각 PC의 로컬 auth root입니다.

Auth root 규칙:

1. `CODEX_HOME`이 있으면 해당 경로를 사용합니다.
2. 없으면 사용자 홈의 `~/.codex`를 사용합니다.
3. `auth.json`, `vault/`, `active/`, `backups/`, `token-rotator-config.json`은 모두 auth root 아래에 둡니다.

## 폴더 구조

```
.codex/
├── scripts/         # 토큰 관리 스크립트
│   ├── token-rotator.js  # 메인 로테이터
│   └── ...
├── launchers/       # Windows 운영 편의 래퍼
├── blueprints/      # 구현 계획서
└── proxy.pid        # macOS/Linux detached proxy PID 파일(실행 중 생성)
```

## 사용법

```bash
# 공통 대화형 메뉴 (Windows/macOS/Linux)
bun run token
bun run token menu

# 공통 CLI (Windows/macOS)
bun run token status
bun run token rotate
bun run token switch 2
bun run token restart
bun run token stop
bun run token start

# 상태 확인
powershell -NoProfile -ExecutionPolicy Bypass -File .codex/scripts/rotate-service-token.ps1 -Action status

# 토큰 전환 (다음 계정으로)
powershell -NoProfile -ExecutionPolicy Bypass -File .codex/scripts/rotate-service-token.ps1 -Action rotate

# 더 짧은 launcher
.codex/launchers/rotate-next-token.bat

# 전체 토큰 관리 메뉴
.codex/launchers/manage-tokens.bat

# Current -> Next 미리보기 후 확인
# 결과 확인 후 창 유지
# (double-click 실행 시 바로 안 꺼짐)

# 특정 계정 사용
powershell -NoProfile -ExecutionPolicy Bypass -File .codex/scripts/rotate-service-token.ps1 -Action switch -Target 2

# 서비스 재시작 없이 토큰만 전환
bun .codex/scripts/token-rotator.js --use 2 --no-restart

# 새 토큰 추가
bun .codex/scripts/token-rotator.js --vault add
```

`bun run token` 공통 메뉴와 `.codex/launchers/manage-tokens.bat` Windows 메뉴에서는 다음 작업을 수행할 수 있습니다.
- 새 토큰 생성 (`npx @openai/codex login`을 임시 CODEX_HOME으로 실행)
- 기존 vault slot 덮어쓰기
- 새 vault slot 추가
- 활성 토큰 전환
- 다음 토큰으로 로테이션
- 비활성 slot 삭제

## 주의

- **토큰 파일 (.json)은 커밋하거나 외부 백업하지 않습니다.** vault slot 교체/삭제 전에는 로컬 `backups/`에 안전 복사본을 만듭니다.
- vault/, active/, backups/ 폴더의 내용은 auth root 로컬에서만 관리
- 실제 토큰은 `CODEX_HOME`이 있으면 그 경로에, 없으면 `~/.codex/`에 있습니다.
- `CODEX_HOME` 또는 `~/.codex/`를 OneDrive, iCloud Drive, Dropbox, 네트워크 드라이브 같은 공유/동기화 폴더로 지정하지 마십시오.
- `vault add`는 vault slot만 추가합니다. live `auth.json` 전환은 `switch` 또는 메뉴의 명시적 전환으로 수행하십시오.
