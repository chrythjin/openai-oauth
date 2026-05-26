# 2026-04-20 Daily Summary - Chat Completions Fix & Token Refresh Recovery

## 1. Chat Completions 프록시 기능 수정
- **이슈:** Codex API의 `/responses` SSE 응답 형식이 변경되어 `/v1/chat/completions` 프록시가 텍스트를 정상적으로 수집하지 못하거나 스트리밍이 끊기는 문제 발생.
- **분석:** SSE 이벤트 구조가 `parsed.delta`에 직접 텍스트가 들어있는 방식으로 확인됨 (기존의 `output` 배열 구조가 아님).
- **조치:** 
    - `chat-completions.ts` 내의 `collectChatCompletionFromSse` (비스트리밍) 및 `streamChatCompletionsFromResponses` (스트리밍) 로직을 새로운 SSE 데이터 구조에 맞게 수정.
    - Usage 정보 수집 로직 보강.
- **결과:** 비스트리밍 및 스트리밍 응답 모두 정상 작동 확인. 등록된 3개의 토큰 계정에서 모두 교차 검증 완료.

## 2. 토큰 변경 후 프록시 재시작 및 동작 검증
- **이슈:** `auth.json`의 인증 키를 변경했으나 프록시 서버에서 새로운 키가 적용되지 않고 기존 요청이 실패함.
- **원인:** 프록시 서버의 `AuthManager`가 초기화 시점에만 토큰을 로드하고 캐싱하여, 파일 변경 사항을 실시간으로 감지하지 못하는(Hot-Reload 미지원) 구조적 한계.
- **조치:** 
    - 기존 프록시 프로세스를 강제 종료하고 새로운 토큰 정보로 재시작.
    - `OPENAI_OAUTH_AUTH_DEBUG=1` 설정을 통해 토큰 로드 상태를 디버그 로그로 확인.
    - `/v1/models` 및 `/v1/chat/completions` 테스트를 통해 실제 응답 수신 확인.
- **결과:** 새 인증 키가 프록시 서버에 성공적으로 적용되어 정상 운영 상태로 복구됨.
