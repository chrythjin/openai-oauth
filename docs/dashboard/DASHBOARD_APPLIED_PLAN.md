# 대시보드 적용 검토 및 최종 계획

**작성일:** 2026-05-16
**상태:** 승인됨
**대상:** `openai-oauth` 프로젝트 — 로컬 프록시 대시보드

---

## 1. 검토 배경

`docs/dashboard/` 디렉토리에는 `codex-lb`(https://github.com/Soju06/codex-lb) 프로젝트의 대시보드를 분석한 문서가 존재한다. `codex-lb`는 React 19 + FastAPI 기반의 로드밸런서 대시보드로, `openai-oauth`의 단일 프록시와는 목적이 다르다.

### 기존 문서 요약

| 문서                       | 내용                                                      |
| -------------------------- | --------------------------------------------------------- |
| `DASHBOARD_SCRATCHPAD.md`  | `codex-lb` 분석 체크리스트 (React, FastAPI, Recharts 등)  |
| `DASHBOARD_REVIEW.md`      | 호환성 검토 — 직접 복사 대신 **디자인·아키텍처만 포팅** 권장 |
| `DASHBOARD_PLAN.md`        | 4단계 원본 계획 (인프라 → 백엔드 → 프론트엔드 → 통합)      |

### 주요 발견

- **이미 갖춰진 인프라**: `logging.ts`의 구조화된 로그 이벤트(`chat_request`, `chat_response`, `chat_error`)가 이미 존재 — SQLite로 영속화만 하면 됨
- **과도한 범위**: `codex-lb`의 계정관리·방화벽·로드밸런서·API 키 관리 기능은 단일 프록시에 불필요
- **핵심 가치**: 사용량 모니터링 + `.codex/` Vault 토큰 관리 UI

---

## 2. 적용 가능성 판정

| 검토 항목               | 판정     | 사유                                                                 |
| ----------------------- | -------- | -------------------------------------------------------------------- |
| 사용량 대시보드          | ✅ 적용   | 로깅 인프라 이미 존재, SQLite + API 추가로 구현 가능                   |
| 계정관리 UI              | ✅ 적용   | `.codex/` CLI(슬롯·전환·로테이션·추가·삭제)를 웹 UI로 대체              |
| `codex-lb` 전체 포팅     | ❌ 제외   | 로드밸런서 기능(방화벽, API 키 관리) 불필요                            |
| FastAPI → TypeScript 포팅| ❌ 제외   | 필요한 백엔드는 SQLite 쿼리 + 토큰 파일 조작뿐 — 소규모 구현             |
| TanStack Query, Zustand | ❌ 제외   | 의존성 최소화 — 단일 사용자 로컬 도구이므로 순수 React + fetch로 충분    |
| Tailwind CSS             | ❌ 제외   | Apple HIG 스타일 직접 구현 — 간결하고 의존성 없음                       |

---

## 3. 최종 적용 계획

### 3.1 설계 원칙

- **사용자**: 나 혼자 (localhost only, 인증 불필요)
- **로그 보관**: 1일 (24시간 지난 로그 자동 정리)
- **Windows 서비스**: 등록 불필요 (프록시가 대시보드 직접 서빙)
- **디자인**: Apple HIG 스타일 — 시스템 폰트, Frosted glass, Light/Dark, 미세 애니메이션
- **데이터**: `bun:sqlite`, 1개 테이블 (`request_logs`)

### 3.2 패키지 구조

```
packages/openai-oauth-dashboard/
├── src/
│   ├── App.tsx              # 탭 라우팅 (사용량 / 계정관리)
│   ├── pages/
│   │   ├── Usage.tsx         # 📊 사용량 대시보드
│   │   └── Tokens.tsx        # 🔑 계정관리
│   ├── components/           # 재사용 UI (GlassCard, StatusBadge 등)
│   ├── hooks/                # useDashboard, useTokens
│   └── styles/               # Apple-style CSS 변수/테마
├── index.html
├── vite.config.ts
└── package.json
```

### 3.3 Phase 1 — 백엔드 API

#### SQLite 로깅 레이어
- `logging.ts`에 `sqliteLogger` 구현
- 테이블: `request_logs` (id, timestamp, model, tokens_in, tokens_out, duration_ms, finish_reason, stream, status)
- PruneJob: 1일 지난 로그 자동 정리

#### API 엔드포인트 (`server.ts` → `handleRoutes` 확장)

| Method | Endpoint                  | 기능                         |
| ------ | ------------------------- | ---------------------------- |
| GET    | `/api/dashboard/summary`  | 24h 집계 (요청수·토큰·지연·에러율·모델별) |
| GET    | `/api/dashboard/logs`     | `?page=&limit=&model=&status=` 페이징 + 필터 |
| GET    | `/api/dashboard/status`   | 프록시 health, 업타임, 활성토큰 슬롯명   |
| GET    | `/api/tokens/slots`       | Vault 슬롯 목록 (active 표시, 만료일)    |
| POST   | `/api/tokens/switch/:n`   | 슬롯 전환 (재시작 필요 알림)             |
| POST   | `/api/tokens/rotate`      | 다음 토큰으로 로테이션                   |
| POST   | `/api/tokens/login`       | Codex login 트리거 (임시 CODEX_HOME)     |
| DELETE | `/api/tokens/slots/:n`    | 슬롯 삭제                                 |

### 3.4 Phase 2 — 프론트엔드

#### 기술 스택
- Vite + React 19 + TypeScript
- Recharts (차트용, 유일한 UI 의존성)
- CSS 변수 기반 Apple HIG 스타일 직접 구현

#### 탭 1: 📊 사용량
- **Summary Cards**: 24h 요청수 / 토큰합계 / 평균지연 / 에러율
- **Hourly Usage Chart**: 시간별 요청수 + 토큰 (Recharts Area/Bar)
- **Recent Logs Table**: 최근 50건 (모델, 토큰, 지연, 상태)
- **필터**: 모델 선택, 성공/에러

#### 탭 2: 🔑 계정관리
- **Token Slot Cards**: 각 슬롯 (레이블, 파일명, active 표시, 만료일)
- **작업 버튼**: [전환] [로테이션] [새 토큰 추가] [삭제]
- **Proxy Status Bar**: health, port, uptime
- **재시작 필요 알림**: 토큰 전환 후 `.codex\launchers\manage-tokens.bat restart` 실행 안내

### 3.5 Phase 3 — 통합

- `server.ts`에 `/dashboard/*` → 대시보드 `dist/` 정적 서빙 추가
- `turbo.json`에 `openai-oauth-dashboard` 빌드 파이프라인 등록
- `package.json` workspaces에 `packages/openai-oauth-dashboard` 추가
- `docs/OPERATIONS.md`에 대시보드 접근 방법 문서화

---

## 4. 주의사항

### 프록시 재시작 문제
대시보드가 프록시 위에서 동작하므로 "프록시 중지/재시작"은 자기 자신을 죽이는 연산이다.

- **MVP**: 토큰 전환 후 "재시작 필요" 알림 + 수동 재시작 안내
- **추후**: `spawn`으로 detached 재시작 구현 가능 (MVP 범위 밖)

### 의도적 제외 목록 (MVP 이후 검토)

| 제외 항목           | 사유                                    |
| ------------------- | --------------------------------------- |
| 관리자 인증          | 로컬호스트 단독 사용                      |
| 다중 사용자 지원     | 개인 도구                                 |
| 실시간 WebSocket    | 폴링으로 충분 (사용량 변화가 느림)         |
| 알림/Alert 시스템   | UI에서 직접 확인 가능                     |
| 방화벽/IP 관리       | `codex-lb` 전용 기능                     |
| 로드밸런서 통계      | 단일 인스턴스                             |

---

## 5. 3자 서브에이전트 검토 결과 (2026-05-16)

### 검토자: Oracle (아키텍처), Security (보안), Explore (코드 통합)

**공통 판단**: 계획은 타당. 단, 토큰 관리 API에 안전장치 필수.

### 반영된 수정사항

| # | 항목                    | 출처     | 조치                                                                 |
|---|------------------------|----------|----------------------------------------------------------------------|
| 1 | CSRF/Origin 보호        | Security | POST/DELETE `/api/tokens/*`에 Origin 검증 추가                        |
| 2 | 토큰 응답 redact         | Security | raw 토큰·파일경로·이메일 절대 미반환. 슬롯번호·레이블·만료일만          |
| 3 | Atomic 파일 작업         | Oracle   | in-process mutex + temp file + rename 패턴                             |
| 4 | 라우트 모듈화            | Oracle   | `dashboard-static.ts` / `dashboard-api.ts` / `token-vault-api.ts` 분리 |
| 5 | SQLite 위치             | Oracle   | `~/.codex/openai-oauth/usage.sqlite`, `bun:sqlite` + Node 가드         |
| 6 | `/v1/responses` 로깅 추가 | Explore  | 현재 누락 — `handleResponsesRequest`에도 `emitRequestLog` 추가         |
| 7 | "재시작 필요" UI 상태     | Oracle   | 토큰 전환 후 디스크만 갱신되므로 UI에 명시                              |
| 8 | token-rotator 코어 추출  | Oracle   | HTTP 노출 전에 `token-rotator.js`의 vault 로직을 순수 함수로 분리       |

### 범위 결정: **B안 (전체 기능)**

사용자 결정으로 MVP 축소 없이 **전체 계정관리 UI**(슬롯 조회·전환·로테이션·추가·삭제)를 구현한다. 단, 안전장치(CSRF, atomic, redact)를 선행한다.

---

## 6. 변경 이력

| 날짜       | 변경 내용                                |
| ---------- | --------------------------------------- |
| 2026-05-16 | 최초 검토 및 최종 계획 확정               |
| 2026-05-16 | 3자 서브에이전트 검토 반영, B안 확정       |

---

## Account Management Features

Implemented:
- [x] Token slot listing
- [x] Save current auth as slot
- [x] Switch between slots (with restart required)
- [x] Rotate tokens (with restart required)
- [x] Delete inactive slots
- [x] Usage statistics and charts
- [x] API error handling

Out of scope:
- Browser login/logout popup flows
- Custom sourcePath imports
- Self-restart capability
- Multi-user/admin authentication
- Live Codex quota checks
