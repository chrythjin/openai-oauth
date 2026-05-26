# Session Log - Server Startup and Active Token Replace

## Date
- 2026-04-30

## Background
- `bun run dev` 실행 시 서버 시작 전에 모델 자동 조회가 먼저 실행되면서, 업스트림 401(`token_invalidated`)로 프로세스가 즉시 종료되는 문제가 재현됨.
- 토큰 관리 메뉴의 `Create / Import New Token` 흐름은 "새 토큰 생성" 후 active 토큰 즉시 교체가 기본이 아니어서 운영 실수 여지가 있었음.

## Changes Made

### 1) Server startup hardening
- File: `packages/openai-oauth/src/cli-app.ts`
- 변경 내용:
  - 서버 시작 순서를 모델 자동 조회보다 먼저 실행하도록 조정.
  - 모델 자동 조회를 `try/catch`로 감싸 실패 시에도 서버 프로세스가 유지되도록 변경.
  - 실패 시 사용자 안내 로그 추가:
    - 모델 자동 조회 실패 사유 출력
    - `npx @openai/codex login` 재로그인 안내
  - 모델 목록 기본값으로 `(model discovery unavailable)` 표시 추가.

### 2) Active token overwrite as default flow
- File: `.codex/scripts/token-manager-menu.ps1`
- 변경 내용:
  - `Create / Import New Token` 메뉴에 기본 동작 추가:
    - `1. Replace current active token now (recommended)`를 기본값으로 설정
    - 엔터 입력 시 자동으로 1번 선택
  - 새 토큰 발급 직후 1번 선택(또는 엔터) 시:
    - 현재 active 슬롯 파일 백업
    - active 슬롯 파일을 새 토큰으로 덮어쓰기
    - `rotate-service-token.ps1 -Action switch -Target <active-index>` 호출로 live `auth.json`/서비스 즉시 재반영

## Verification
- `bun run dev` 재실행 시 서버 기동 메시지 확인:
  - `OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1`
- 토큰 메뉴 스크립트 스모크 테스트:
  - `token-manager-menu.ps1 -Action list` 정상 출력 확인

## Notes
- 인증 토큰 자체가 무효화된 경우(`token_invalidated`), 서버는 기동되더라도 업스트림 호출은 401이 발생할 수 있음.
- 이 경우 `npx @openai/codex login`으로 토큰 재발급 후, 본 세션에서 수정한 기본 플로우(엔터/1번)로 active 토큰 교체하면 즉시 반영 가능.
