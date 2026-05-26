# 2026-05-13 Daily Summary - OpenCode Variant Display & Model Alias Support

## 1. OpenCode Variant "Medium" 고정 표시 버그 조사
- **증상:** `openai-oauth` 사용 시 TUI에서 variant를 "high"로 설정해도 상태바 및 에이전트 헤더에 항상 "medium"으로 표시되는 현상.
- **분석 결과:** 
    - `oh-my-openagent` 플러그인의 `deep` 카테고리 설정에 `variant: "medium"`이 하드코딩되어 있음.
    - `openai-oauth` 프로바이더가 fallback chain 인식 대상이 아니어서 모델 매칭 실패 시 기본값인 "medium"으로 폴백됨.
- **조치:** `oh-my-openagent` CLI 번들(`dist/cli/index.js`)을 패치하여 `openai-oauth` 프로바이더인 경우 variant 표시를 `null`로 처리하도록 수정 (잘못된 정보 표시 방지).

## 2. openai-oauth 모델 별칭(Alias) 지원 및 자동 생성 로직 구현
- **목표:** OpenCode/OMO의 variant 시스템에 의존하지 않고, 모델 ID 자체에 추론 강도(reasoning effort)를 포함하는 방식(`gpt-5.5-high` 등) 지원.
- **수정 사항:** 
    - `openai-oauth` 프록시 서버 코드(`models.ts`)에 모델 별칭 확장 로직 추가.
    - `gpt-5.*` 형태의 모델에 대해 `minimal`, `low`, `medium`, `high`, `xhigh` 접미사 자동 생성 및 인식.
    - `/v1/chat/completions`, `/v1/responses` 등 모든 엔드포인트에서 별칭 ID를 인식하여 상위 Codex API에 올바른 `reasoning_effort` 파라미터 전달.
- **설정:** `opencode.json`의 모델 리스트에 별칭 ID들을 명시적으로 등록하여 에이전트(Prometheus 등)가 유효한 모델로 인식하도록 조치.

## 3. 문서화 및 가이드 업데이트
- `opencode-cursor` 레포지토리의 `README.md`에 커스텀 프로바이더의 모델 변종 활성화를 위한 `"reasoning": true` 설정 및 모델 별칭 사용 가이드 추가.
- OpenCode 재시작 시 프록시 서버는 재시작되지 않으므로, 모델 별칭 반영을 위해서는 프록시 서비스를 별도로 재시작해야 함을 명시.
