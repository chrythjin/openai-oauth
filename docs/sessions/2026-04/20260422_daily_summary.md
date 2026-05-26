# 2026-04-22 Daily Summary - Service Recovery, Versioning & Token Normalization

## 1. Windows 서비스 안정화 및 Orphan Listener 문제 해결
- **이슈:** JS 기반 로테이터에서 Windows 서비스를 재시작할 때 UAC(사용자 계정 컨트롤) 승격이 비동기로 처리되어, 서비스 상태와 실제 리스너 상태가 불일치하는 'Orphan Listener' 현상 발생.
- **조치:** 
    - `token-rotator.js`에서 직접 stop/start를 호출하지 않고, PowerShell 워래퍼(`rotate-service-token.ps1`)에 원자적으로 전체 프로세스를 위임하도록 구조 변경.
    - `~/.codex/active/` 디렉터리에 불필요하게 남아있던 `auth-altN.json` 파일들을 정리하고 `auth.json` 하나만 유지하도록 클린업 루틴 추가.
    - NSSM 서비스 설정을 초기화 및 재등록하여 공백 포함 경로(`C:\NEW PRG\...`) 등에서 발생하는 실행 오류 수정.

## 2. 프로젝트 버전 정합성 수정 (v1.0.2)
- `openai-oauth` CLI 패키지 버전을 `1.0.2`로 업그레이드하고, 잘못 포함되어 있던 자기 참조 의존성(self-dependency)을 제거하여 빌드 환경 정상화.
- 전체 monorepo 빌드 및 헬스체크를 통해 버전 업그레이드 후에도 기존 기능(모델 허용 목록 등)이 유지됨을 검증.

## 3. 토큰 식별자 정규화 (ALT{N} 지원)
- **기능 추가:** `ALT1`, `ALT 1`, `alt2` 등 다양한 형식의 입력값을 내부 슬롯 인덱스(`N + 1`)로 자동 변환하는 정규화 로직 구현.
- **적용 범위:** BAT 런처, PowerShell 스크립트, JavaScript 로테이터 등 모든 레이어에 적용하여 `openai-oauth.bat switch ALT 1`과 같은 명령어가 일관되게 동작하도록 보장.

## 4. 기타 운영 개선
- `rotate-service-token.ps1`에 `preview-next` 액션을 추가하여 실제 회전 전에 다음 토큰 정보를 정확히 확인할 수 있도록 개선.
- 토큰 관리 메뉴의 수동 백업 파일명 생성 규칙을 명시적으로 정리하여 파일 관리 편의성 증대.
