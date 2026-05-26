# 2026-05-08 Daily Summary - Cross-Platform Token Manager Implementation & Hardening

## 1. 교차 플랫폼(Windows/macOS) 공통 토큰 관리 시스템 설계 및 구현
- **목표:** 서로 다른 운영체제에서도 동일한 명령 체계(`bun run token`)로 토큰 관리 및 프록시 제어가 가능하도록 통합.
- **주요 변경 사항:**
    - `package.json`: `bun run token` 공통 진입점 스크립트 추가.
    - `.codex/scripts/token-rotator.js`: `status`, `rotate`, `switch`, `restart`, `stop`, `start` 등 통합 명령 인자 처리 로직 구현.
    - `CODEX_HOME` 환경 변수 우선 적용 규칙을 전역적으로 일원화하여 로컬 운영 환경 격리 보장.
    - `openai-oauth-core`: 타입 검증 로직 개선 (`types: ["node"]` 추가).

## 2. 보안 및 안정성 강화 (Issue Review & Follow-up)
- **주요 개선 사항:**
    - **프록시 제어 견고화:** 프록시 중지 실패 시 토큰 교체 작업을 중단하도록 하여 `auth.json` 오염 방지.
    - **권한 관리:** Windows UAC 자동 승격 로직을 제거하고, 관리자 권한 세션에서만 실행하도록 변경하여 비동기 실행에 따른 검증 누락 방지.
    - **경로 보안:** 설정 파일로부터 유도된 토큰 파일명에 대해 경로 탐색(Path Traversal) 공격 방지 검증 추가.
    - **Graphify 정화:** 임시 생성 파일(`mcp-temp/`)이 지식 그래프 및 린트 결과에 포함되지 않도록 제외 규칙 강화.

## 3. 대화형 토큰 관리 메뉴 개발
- macOS/Linux 환경에서도 Windows와 동일한 번호 선택 방식의 대화형 메뉴(`bun run token menu`) 사용 가능하도록 구현.
- **메뉴 기능:** 토큰 슬롯 조회, 신규 토큰 생성/가져오기, 활성 토큰 전환, 슬롯 삭제, 프록시 상태 확인 및 시작/재시작/중지 등 10가지 옵션 제공.
- **안전한 토큰 생성:** `npx @openai/codex login` 실행 시 임시 `CODEX_HOME`을 사용하여 기존 실운영 `auth.json`이 덮어씌워지는 현상 방지.

## 4. 문서화
- `docs/MANAGE_TOKEN_GUIDE.md`, `docs/OPERATIONS.md`, `.codex/README.md` 등에 공통 CLI 사용법 및 로컬 인증 루트 운영 규칙 최신화.
