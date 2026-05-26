# Dashboard Account Management - Learnings

## 2026-05-18: POST /api/tokens/add Tests

### Patterns Used
- `createVaultFixture()` sets up temp dirs with auth.json, vault entries, and config
- `tokenRequest()` builds Request objects with proper headers
- `handleTokenApiRequest()` is called directly (no real server) for unit testing
- `readResponse()` asserts no sensitive data leaks (tokens, paths, emails)
- `assertNoSensitiveData()` is used directly for error responses

### Endpoint Behaviors Discovered
- `POST /api/tokens/add` copies `auth.json` from authDir to vault as new slot
- When auth.json and auth-alt1.json already exist in vault, it creates auth-alt2.json and "Account 3"
- Custom `sourcePath` in body is rejected with 400 `invalid_request_error`
- Malformed JSON body is handled gracefully: `readJsonBody` returns null, so default source is used
- Response does NOT include `restart_required` (unlike switch/rotate)
- Origin/Referer validation follows same pattern as other mutation endpoints

### Redaction Requirements
- Responses must not contain: access_token, refresh_token, auth.json, temp dir paths, CODEX_HOME, email addresses
- Error responses from vault-ops that contain paths are redacted to generic message

### Test Results
- 14 tests pass, 0 fail, 328 expect() calls
- All new tests for POST /api/tokens/add pass successfully

## 2026-05-18: Dashboard API CORS Removal

### Patterns Used
- `toDashboardJsonResponse()` and `toDashboardErrorResponse()` in `shared.ts` — JSON responses without CORS headers
- `getExpectedOrigins()` exported from `dashboard-security.ts` for localhost origin validation
- Dashboard API handlers use `toDashboardJsonResponse` instead of `toJsonResponse`
- OPTIONS preflight handled both in `server.ts` (global router) and `dashboard-api.ts` (direct handler)

### CORS Strategy
- Dashboard routes (`/api/dashboard/*`) no longer emit `Access-Control-Allow-Origin: *`
- OPTIONS requests to dashboard routes only allow `http://127.0.0.1:PORT` and `http://localhost:PORT`
- Same-origin dashboard fetches continue to work (no CORS needed for same-origin)
- Token mutation endpoints (`/api/tokens/*`) continue to use `toTokenApiResponse` pattern (strips CORS)

### Files Modified
- `packages/openai-oauth/src/shared.ts` — added `toDashboardJsonResponse` and `toDashboardErrorResponse`
- `packages/openai-oauth/src/dashboard-security.ts` — exported `getExpectedOrigins`
- `packages/openai-oauth/src/dashboard-api.ts` — uses new helpers, added OPTIONS handling
- `packages/openai-oauth/src/server.ts` — dashboard-specific OPTIONS CORS in global handler
- `packages/openai-oauth/test/dashboard-api.test.ts` — 6 new tests for CORS assertions

### Test Results
- 11 tests pass, 0 fail, 21 expect() calls
- New tests verify: no wildcard CORS on summary/logs/status/hourly/404 routes, OPTIONS returns localhost-only origin
