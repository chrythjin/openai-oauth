# 2026-05-12 Daily Summary - OpenCode Model Variants Configuration

## 1. 커스텀 프로바이더 모델 변종(Variants) 활성화
- **목표:** `openai-oauth` 프록시를 사용할 때 OpenCode TUI에서 reasoning effort(high/low 등)를 선택할 수 있도록 설정.
- **트러블슈팅:**
    - **스키마 오류:** `variants`를 배열(`[]`)로 설정 시 오류 발생 -> 객체(`{}`) 형식으로 수정 필요.
    - **미표시 원인:** OpenCode 내부 로직상 모델의 기능 플래그 중 `"reasoning": true`가 설정되어 있어야만 `variants` 창이 활성화됨을 확인.
- **최종 해결책:** 
    - `opencode.json` 모델 설정에 `"reasoning": true` 추가.
    - 자동 생성되는 기본값 오버라이드를 위해 커스텀 `variants` 객체 명시.
- **반영 결과:** `gpt-5.5` 등의 모델 옆에 선택 창이 정상적으로 나타나며, 선택 시 `reasoning_effort` 파라미터가 프록시로 전달됨.

## 2. "Medium" 고정 표시 문제 분석 시작
- 사용자가 "high"를 선택했음에도 TUI 상태바에 "medium"이 고정적으로 표시되는 현상 발견.
- `oh-my-openagent` 플러그인 내부의 카테고리별 기본 설정값이 하드코딩되어 있을 가능성에 대해 초기 분석 수행.
