# OpenCode 세션별 다중 프록시 시스템 — 아카이브

**아카이브 일자:** 2026-05-25
**상태:** 정적/비파괴 검증까지 완료, 운영 검증 전 단계에서 보존
**원본 위치:** `.codex/`, `docs/sessions/`

---

## 1. 보존 이유

OpenCode 세션마다 전용 프록시를 띄우고 각 프록시가 고정된 token slot을 사용하는 다중 프록시 시스템을 1차 구현까지 진행했다. 추가 작업 없이 현재 상태로 보존한다.

기존 단일 프록시 rotation 시스템(`manage-tokens.bat`, `rotate-service-token.ps1`)은 그대로 유지하고, 본 시스템은 별도 레이어로 추가됐다.

---

## 2. 폴더 구조

```text
docs/archive/20260525_multisession_multiproxy/
├── README.md                                  # 이 문서
├── concept.md                                 # 구상서 사본
├── plan.md                                    # 계획서 사본
└── implementation/
    ├── session-proxy-manager.ps1              # PowerShell 매니저 사본
    └── session-proxies.bat                    # 배치 런처 사본
```

원본은 다음 위치에 그대로 남아 있다.

```text
.codex/scripts/session-proxy-manager.ps1
.codex/launchers/session-proxies.bat
docs/sessions/20260525_multisession_multiproxy_concept.md
docs/sessions/20260525_multisession_multiproxy_tui_plan.md
```

---

## 3. 구현 산출물 요약

- 새 PowerShell 매니저: `session-proxy-manager.ps1`
- 새 배치 런처: `session-proxies.bat`
- 기본 시작 포트 `10532`
- primary proxy 보호 포트: 기본 `10531`, `$env:PORT`가 있으면 해당 포트
- session-local `CODEX_HOME`과 `auth.json` 복사본 사용
- 토큰 변경은 해당 session proxy를 stop → token copy/replace → start 하는 재시작 방식
- token copy: temp 파일 + JSON 파싱 검증 + atomic replace
- token-change 시 새 토큰 검증 후 기존 프록시 중단 순서 보장
- mutating action 직렬화 lock
- read-only 명령은 state 파일 미수정
- stop 경로는 `Stop-Process` + PID identity 검증 기반
- 전용 프록시 시작 시 `--models` 하드코딩 제거

---

## 4. 검증된 범위

- PowerShell parser 통과
- `help`, `tokens`, `list`, `env`, `cleanup` 비파괴 명령 정상
- `new -Token 1 -Port 10531` 차단 확인
- `$env:PORT` 보호 포트 차단 확인
- `new`에서 `-Token` 누락 시 차단 확인
- 없는 session id 조회 차단 확인
- Metis/Momus 검토 결과 반영 (보호 포트 일반화, token copy 원자성, token-change 순서)

---

## 5. 의도적으로 보류한 범위

- 실제 새 프록시 start/stop 운영 검증
- live `10531` 서비스 접근/재시작 검증
- upstream `/v1/*` 호출 검증
- "OpenCode 열 때마다 자동으로 다음 토큰 슬롯 사용" 자동 launcher
- session lifecycle 자동 정리 (OpenCode 종료 감지 후 proxy 자동 stop)

---

## 6. 재개 시 진입점

1. **운영 검증 1회**
   - isolated `CODEX_HOME` + `10532+` 임시 포트로 `new` → `/health` → `env` → `stop`
2. **자동 token rotation launcher**
   - `opencode-with-next-token.bat` 형태 추가
   - 다음 token slot 자동 선택 → session proxy 자동 생성 → 환경변수 설정 → `opencode` 실행
3. **session lifecycle 자동 정리**
   - OpenCode 프로세스 종료 감지 후 해당 session proxy 자동 stop

---

## 7. 운영 모델 다이어그램

```text
기존 (유지):
Token Vault -> active auth.json -> OpenAIOAuthProxy :10531

새 시스템 (이번 작업):
Token Vault slot 1 -> session-local auth copy -> proxy :10532
Token Vault slot 2 -> session-local auth copy -> proxy :10533
Token Vault slot 3 -> session-local auth copy -> proxy :10534
```

---

## 8. 관련 제약 (memory 동기화 항목)

- 같은 `CODEX_HOME`을 여러 프록시 프로세스가 동시에 공유하지 않는다.
- `usage.sqlite` 단일 프로세스 운영 모델은 유지된다.
- 자동 per-session token routing은 외부 launcher 또는 client-supplied session ID가 필요하다.
- multi-token multi-proxy orchestration은 외부 launcher/manager 레이어에 둔다.
