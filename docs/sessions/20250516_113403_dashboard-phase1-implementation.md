# 2025-05-16 Dashboard Phase 1 구현 세션

## 완료된 작업

### 1. 백엔드 API 파일들 (Phase 1)

| 파일 | 설명 |
|------|------|
| `packages/openai-oauth/src/vault-ops.ts` | 토큰 금고 핵심 ops (extract from `token-rotator.js`) |
| `packages/openai-oauth/src/sqlite-logger.ts` | Bun:sqlite 로깅 + 1일 auto-prune |
| `packages/openai-oauth/src/dashboard-security.ts` | CSRF/Origin 방어 + security headers |
| `packages/openai-oauth/src/dashboard-api.ts` | `/api/dashboard/summary`, `/logs`, `/hourly`, `/status` |
| `packages/openai-oauth/src/token-vault-api.ts` | `/api/tokens/*` (slots, switch, rotate, delete, add) |
| `packages/openai-oauth/src/dashboard-static.ts` | `/dashboard/*` 정적 파일 서빙 |

### 2. server.ts 라우트 통합
- `/dashboard/*` → 정적 파일 서비스 (dashboardDistPath 설정 시)
- `/api/dashboard/*` → dashboard-api.ts (security headers 포함)
- `/api/tokens/*` → token-vault-api.ts (security headers 포함)
- `/v1/responses` 로깅 추가 (기존 chat/completions만 로깅됨)

### 3. 대시보드 프론트엔드 (Phase 2)
- `packages/openai-oauth-dashboard/` — Vite + React 19 + Recharts only
- Apple HIG 스타일: frosted glass, system fonts, auto light/dark
- Usage 탭: summary cards + hourly area chart + logs table
- Tokens 탭: slot cards + proxy status + restart alert

### 4. CLI 연동
- `--dashboard-dist <path>` 옵션 추가
- `dashboardDistPath` → `OpenAIOAuthServerOptions` → 라우트 활성화

## 빌드 결과
- `bun run build` → turbo: 3/3 packages 성공
- LSP diagnostics: 모든 새 파일 clean

## 동작 확인 필요
현재 Windows 서비스 `OpenAIOAuthProxy` (PID 31736)가旧 dist 실행 중.
아래 명령으로 서비스 재시작 후 확인:

```powershell
sc stop OpenAIOAuthProxy
sc start OpenAIOAuthProxy
curl http://127.0.0.1:10531/dashboard/
curl http://127.0.0.1:10531/api/dashboard/status
curl http://127.0.0.1:10531/api/tokens/slots
```

참고: 서비스는 `C:\Tools\OpenAIOAuthProxy\openai-oauth-proxy.bat` → `node C:\NEW PRG\openai-oauth\packages\openai-oauth\dist\cli.js` 실행.

## 트레이드오프 결정
- `/api/tokens/slots` GET: wildcard CORS 차단 (토큰 메타데이터 노출 방지)
- POST/DELETE: Origin/Referer 검증 + 403 거부
- `rotateToken`/`switchToken`: 응답에 `prev`/`next` 토큰슬롯 포함 (UI 표시용)
- 토큰 응답: raw token, auth.json 내용, 파일 경로, 이메일 제외 (redacted only)
- MVP에서 login/logout POST 제외 (브라우저 팝업 Hang风险 높음)

## 다음 단계 (Phase 3)
- 대시보드 dev server 연결 (vite dev로 별도 실행 후 `--dashboard-dist` 포인트)
- 실제 SQLite 데이터 연동 확인
- 토큰 slots 실제 데이터 확인