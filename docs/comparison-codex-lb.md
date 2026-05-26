# Soju06/codex-lb vs openai-oauth 비교 분석

**분석 기준**
- `Soju06/codex-lb`: GitHub README, pyproject.toml, app/ 디렉터리 구조, CHANGELOG
- `openai-oauth`: 로컬 소스, server.ts, token-vault-api.ts, dashboard-api.ts, project memory

---

## 1. 개요

| 항목 | `Soju06/codex-lb` | `openai-oauth` (이 레포) |
|------|-------------------|--------------------------|
| 주 목적 | 여러 ChatGPT 계정 풀링, 로드밸런싱, 사용량 추적 | 단일 ChatGPT OAuth 토큰으로 OpenAI 호환 API 제공 |
| 배포 모델 | Docker/uvx/Helm/Kubernetes | 로컬 PC, Windows 서비스(NSSM) |
| 대상 사용자 | 팀/서버 운영자 | 개인 개발자 |
| 백엔드 | Python 3.13 + FastAPI | TypeScript + Bun/Node HTTP |
| DB | SQLite 기본, PostgreSQL 선택 | bun:sqlite (usage.sqlite) |
| 포트 | 2455(프록시), 1455(일부 경로) | 10531 |
| 공개 규모 | 40+ contributors, Helm chart, Kubernetes 고려 | 단일 유지자 레포, Windows 중심 |

---

## 2. 아키텍처 비교

### codex-lb 구조

```
app/
├── core/          # 핵심 로직 (clients, proxy, routing)
├── db/           # SQLAlchemy 모델, 마이그레이션
├── modules/      # 계정/프록시/설정 모듈
├── main.py       # FastAPI 앱 진입점 (21892 bytes)
└── dependencies.py

frontend/         # 별도 React/Vite 대시보드
config/           # Pydantic 설정
deploy/           # Helm, docker-compose
tests/            # unit/integration/e2e 분리
```

### openai-oauth 구조

```
packages/
├── openai-oauth/           # CLI + localhost proxy
│   └── src/
│       ├── server.ts        # 메인 HTTP 서버, 라우팅
│       ├── vault-ops.ts      # 토큰 vault 핵심 연산
│       ├── token-vault-api.ts # /api/tokens/* 핸들러
│       ├── dashboard-api.ts   # /api/dashboard/* 핸들러
│       ├── dashboard-static.ts # 대시보드 정적 파일
│       ├── dashboard-security.ts # Origin/CORS 보호
│       ├── db.ts            # bun:sqlite persistence
│       └── sqlite-logger.ts  # 로그 저장소
├── openai-oauth-core/      # transport, auth, SSE
├── openai-oauth-provider/  # Vercel AI SDK provider
└── openai-oauth-dashboard/ # (대시보드 프론트엔드, 작업 중)
```

---

## 3. 기능 비교

### 3.1 계정/토큰 관리

| 기능 | codex-lb | openai-oauth |
|------|----------|--------------|
| 다중 계정 풀링 | ✅ 핵심 기능 | ❌ 의도적으로 제외 |
| 계정별 사용량 추적 | ✅ 상세 (토큰/비용/트렌드) | ⚠️总量만 (시간별 차트) |
| 계정간 로드밸런싱 | ✅ | ❌ |
| API 키 발급/관리 | ✅ | ❌ |
| 토큰 slot/vault | ⚠️ 계정 단위 | ✅ (auth.json slot 전환) |
| 토큰 rotation | ✅ (계정 재인증) | ✅ (vault slot 순환) |
| 토큰 만료 관리 | ✅ | ⚠️ 표시만 |

### 3.2 프록시/API

| 기능 | codex-lb | openai-oauth |
|------|----------|--------------|
| `/v1/responses` | ✅ | ✅ |
| `/v1/chat/completions` | ✅ | ✅ |
| `/v1/models` | ✅ | ✅ |
| `/backend-api/codex/*` | ✅ | ❌ |
| Streaming | ✅ (WebSocket/HTTP bridge) | ✅ |
| Tool calls | ✅ | ⚠️ via Chat Completions |
| Reasoning traces | ✅ | ⚠️ via Responses |
| 파일 업로드/처리 | ✅ (input_image inline rewrite) | ❌ |
| WebSocket transport | ✅ (auto-select) | ❌ |

### 3.3 보안

| 기능 | codex-lb | openai-oauth |
|------|----------|--------------|
| 대시보드 인증 | ✅ 비밀번호 + optional TOTP | ❌ (localhost only) |
| API Key 인증 | ✅ Bearer token | ❌ |
| CORS | 명시적 API key 기반 | ✅ Origin/Referer 검사 |
| Origin 검사 | 환경 기반 | ✅ localhost만 허용 |
| 토큰 metadata 노출 방지 | ⚠️ | ✅ (redaction 적용) |
| Trusted proxy header | ✅ | ❌ |
| Rate limit (per-key) | ✅ | ❌ |
| 멀티테넌시 | ✅ | ❌ |

### 3.4 대시보드

| 기능 | codex-lb | openai-oauth |
|------|----------|--------------|
| 계정 목록 UI | ✅ | ⚠️ (slot 카드, 작업 중) |
| 사용량 요약卡片 | ✅ | ✅ (작업 중) |
| 시간별 차트 | ✅ | ✅ (작업 중) |
| 로그 테이블 | ✅ | ✅ (작업 중) |
| API 키 관리 UI | ✅ | ❌ |
| 설정 UI | ✅ | ❌ |
| 라이트/다크 모드 | ✅ | ✅ (Apple HIG, 작업 중) |

### 3.5 배포/운영

| 항목 | codex-lb | openai-oauth |
|------|----------|--------------|
| Docker | ✅ (권장) | ❌ |
| Windows 서비스 | ❌ | ✅ (NSSM) |
| Helm/Kubernetes | ✅ | ❌ |
| PostgreSQL backend | ✅ (선택) | ❌ |
| Prometheus metrics | ✅ (optional) | ❌ |
| Health check | ✅ | ✅ (`/health`) |
| 로그 파일 | ✅ | ✅ |
| uv/uvx 실행 | ✅ | ❌ |

---

## 4. 이 레포의 핵심 제약 (project memory 기준)

```
- CONCURRENT_WRITE_RISK: auth.json 동시 쓰기 → vault 손상 위험
- pool/distribute tokens 금지
- 단일 사용자 localhost only
- admin auth, load balancer stats, multi-user 관리 제외
- Token switch/rotate 후 proxy restart 필요 (self-restart out of scope)
- GET /api/tokens/slots: wildcard CORS 금지
- 토큰 응답에 raw token, auth.json 내용, 파일 경로, 이메일 주소 포함 금지
- CSRF/Origin: POST/DELETE /api/tokens/* Origin 또는 Referer 검사
- MVP 제외: login/logout (브라우저 팝업), Playwright, live Codex quota, self-restart, CI
```

---

## 5. codex-lb에서 참고할 수 있는 부분

### 5.1 대시보드 정보 구조

| codex-lb | 이 레포 (현재 작업) |
|-----------|-------------------|
| summary cards (requests, tokens, cost, 28-day trend) | ✅ summary cards |
| hourly/daily usage chart | ✅ hourly chart |
| account list with status | ✅ slot cards |
| API key management UI | ❌ (MVP 제외) |
| settings page | ❌ (MVP 제외) |

### 5.2 OpenCode 클라이언트 설정 문서화

codex-lb README의 OpenCode 설정 예시는 다음 사항을 명확히 설명:
- `baseURL` override로 Responses API reasoning 보존
- `@ai-sdk/openai-compatible` 사용 시 reasoning 손실 경고
- `model_provider` migration 필요

### 5.3 보안 UX 패턴

- API key 생성 시 “한 번만 표시” 안내
- 원격/로컬 접근 구분 처리
- 민감정보 UI 비노출

---

## 6. codex-lb에서 가져오지 말아야 할 부분

아래는 codex-lb 핵심 기능이지만, 이 레포의 제품 방향과 충돌합니다.

```
- 다중 계정 풀링 / 로드밸런싱
- API 키 발급 / rate limit (per-key)
- 대시보드 비밀번호 / TOTP 인증
- Trusted proxy header 인증
- PostgreSQL backend
- Kubernetes / Helm 배포
- 원격 dashboard 접근 (localhost only)
- /backend-api/codex/* 경로
- WebSocket transport 선택 (auto-select)
- 파일 업로드 처리 / input_image inline rewrite
- 멀티테넌시 / 사용자별 할당량
```

---

## 7. 결론

| 구분 | 적합한 레포 |
|------|------------|
| 팀/서버용 ChatGPT 계정 로드밸런서 | `Soju06/codex-lb` |
| 개인 PC용 로컬 OAuth 프록시 + 토큰 관리 UI | `openai-oauth` (이 레포) |

이 레포의 현재 목표("`.codex` CLI 스크립트를 Apple HIG 웹 UI로 대체")에는 `codex-lb`를 복제하지 말고, 대시보드 정보 구조와 UI 패턴 일부만 참고하는 것이 올바른 접근입니다.
