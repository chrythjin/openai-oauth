# 2026-04-19 Daily Summary - NSSM Service Migration & Manual Synchronization

## 1. 프록시 서버의 Windows 서비스(NSSM) 전환 및 구성
- **배경:** 기존 인터랙티브 방식(`bun run dev`)의 프록시 운영을 시스템 부팅 시 자동 실행되는 안정적인 Windows 서비스로 전환 시도.
- **주요 작업:**
    - NSSM(Non-Sucking Service Manager) 설치 및 서비스 로그 디렉터리(`C:\Logs\OpenAIOAuthProxy`) 준비.
    - **경로 공백 문제 해결:** `C:\NEW PRG\` 경로의 공백으로 인한 실행 오류를 방지하기 위해 전용 배치 파일 래퍼(`openai-oauth-proxy.bat`)를 통해 서비스 실행하도록 구성.
    - **권한 및 환경 변수 설정:** LocalSystem 계정이 사용자의 `auth.json`을 찾지 못하는 문제를 해결하기 위해 배치 파일 내에서 `CODEX_HOME` 환경 변수를 명시적으로 지정.
- **결과:** `OpenAIOAuthProxy` 서비스 등록 완료 및 `delayed-auto` 시작 설정. `127.0.0.1:10531/health`를 통해 정상 작동 확인.

## 2. 매뉴얼 및 문서 실구성 동기화
- **이슈:** `openai-oauth MANUAL` 폴더 내 문서들이 구버전 경로(`~/.opencode/`)나 잘못된 실행 안내를 포함하고 있어 실제 로컬 환경과 불일치함.
- **수정 사항:**
    - `README.md` 및 설정 안내 파일들을 `~/.mcp.json`, `~/.config/opencode/opencode.json` 등 실제 경로 기준으로 전면 갱신.
    - MCP 도구 설명 및 실행 스크립트(`start.sh`) 내의 오타와 실행 명령어를 현재 구현(`node dist/index.js`)과 일치하도록 수정.
- **결과:** 개발 및 운영 가이드의 신뢰성 확보 및 혼선 방지.
