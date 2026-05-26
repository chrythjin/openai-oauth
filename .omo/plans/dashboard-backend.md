# Dashboard Backend and Token Management Hardening Plan

## TL;DR
> **Summary**: Implement the local dashboard backend for usage persistence, analytics APIs, and token management hardening while keeping the dashboard served by the existing proxy only. The MVP uses `bun:sqlite`, existing Vitest/Bun/Turbo verification, localhost-only security, 1-day log retention, and no self-restart/login/logout/browser-popup flows.
> **Deliverables**:
> - SQLite-backed 24-hour request log persistence at `CODEX_HOME/openai-oauth/usage.sqlite`.
> - Working `/api/dashboard/summary`, `/api/dashboard/hourly`, `/api/dashboard/logs`, and `/api/dashboard/status` contracts for the existing React dashboard.
> - Hardened `/api/tokens/*` routes with exact same-origin validation, redacted responses, no wildcard CORS, mutex-protected mutations, and restart-required responses.
> - Minimal frontend contract alignment where current API response semantics are wrong or ambiguous.
> - Vitest coverage for persistence, analytics, security, redaction, token mutations, and route wiring.
> **Effort**: Medium
> **Parallel**: YES - 3 waves
> **Critical Path**: Task 1 → Tasks 2/3/4/5 → Task 6 → Final Verification Wave

## Context

### Original Request
The user asked to review `docs/plans/dashboard-backend-plan.md` and write a proper plan: `docs\plans\dashboard-backend-plan.md 검토해서 제대로 된 계획서 작성`.

### Interview Summary
- The existing plan is only 47 lines and lacks concrete contracts, exact file references, task dependencies, QA scenarios, acceptance criteria, and security edge-case tests.
- Known project directives require replacing `.codex` CLI scripts with a localhost web UI, preserving single-user localhost scope, using Apple HIG style for UI, and using subagents/team mode during implementation.
- This planning session is restricted to producing a `.sisyphus/plans/*.md` work plan, not implementation.

### Research Findings
- `packages/openai-oauth/src/server.ts:57-87` already routes `/dashboard`, `/api/dashboard/*`, and `/api/tokens/*` from the existing proxy.
- `packages/openai-oauth/src/dashboard-api.ts:31-54` currently returns stub summary/logs/hourly data and status.
- `packages/openai-oauth/src/logging.ts:6-35` currently supports a request logger only via options or console env flag; no SQLite persistence exists.
- `packages/openai-oauth/src/responses.ts:40-159` and `packages/openai-oauth/src/chat-completions.ts:62-147` already emit `OpenAIOAuthServerLogEvent` events for request/response/error lifecycle points.
- `packages/openai-oauth/src/types.ts:90-112` defines the `OpenAIOAuthServerLogEvent` union and `UsageLike`; `types.ts:123-134` defines server options.
- `packages/openai-oauth/src/token-vault-api.ts:102-175` already exposes slots/switch/rotate/delete/add, but `POST /api/tokens/add` accepts `sourcePath`, which is excluded from MVP because it creates file-path and local-file access risk.
- `packages/openai-oauth/src/dashboard-security.ts:31-56` implements Origin/Referer validation and security headers, but CSP/CORS behavior must be made exact.
- `packages/openai-oauth/src/vault-ops.ts:54-70` has an in-process mutex, but `addTokenToVault` and `deleteTokenSlot` are not currently locked; `vault-ops.ts:114-140` writes config directly; `vault-ops.ts:265-364` switch/rotate use the mutex; `vault-ops.ts:366-445` add/delete need hardening or exclusion.
- `packages/openai-oauth-dashboard/src/types.ts:1-36`, `UsageTab.tsx:76-84`, and `TokensTab.tsx:24-67` define the frontend contracts that backend responses must satisfy.
- Test infrastructure exists through Vitest/Bun/Turbo. There are no dashboard/token API tests, no frontend test script, no Playwright setup, and no CI in this workspace.

### Metis Review (gaps addressed)
- Exact dashboard endpoint contracts, SQLite schema, retention timing, aggregation semantics, redaction requirements, CORS behavior, Origin/Referer failure modes, sourcePath token-add exclusion, restart semantics, and acceptance criteria are specified below.
- Scope creep is explicitly blocked for login/logout/browser popup support, self-restart/service control, multi-user auth, remote dashboard access, Playwright-as-required-dependency, and CI setup.

## Work Objectives

### Core Objective
Convert the high-level dashboard backend idea into a safe, tested local backend integrated with the existing proxy and existing React dashboard, without introducing a second service or exposing sensitive token/account data.

### Deliverables
- `packages/openai-oauth/src/db.ts` small persistence module using `bun:sqlite`.
- Updated `packages/openai-oauth/src/logging.ts` and route handlers to persist request lifecycle events.
- Updated `packages/openai-oauth/src/dashboard-api.ts` returning real summary/hourly/logs/status data.
- Updated `packages/openai-oauth/src/token-vault-api.ts`, `dashboard-security.ts`, and `vault-ops.ts` for token API security and mutation safety.
- Minimal updates to `packages/openai-oauth-dashboard/src/types.ts`, `UsageTab.tsx`, or `TokensTab.tsx` only if needed to match backend response contracts.
- New Vitest tests under `packages/openai-oauth/test/` for dashboard persistence/API and token API security/hardening.

### Definition of Done (verifiable conditions with commands)
- `bun run format-and-lint` exits `0`.
- `bun run typecheck` exits `0`.
- `bun run test` exits `0`.
- `bun run build` exits `0`.
- Targeted tests prove dashboard APIs aggregate fixture logs from a temp SQLite database.
- Targeted tests prove token APIs reject unsafe origins, avoid wildcard CORS, never return token/path/email material, and return `restart_required: true` for active-auth-changing mutations.

### Must Have
- SQLite database location: `<CODEX_HOME or resolved ~/.codex>/openai-oauth/usage.sqlite`.
- Retention: only last 24 hours / 1 day; no 7-day behavior.
- Retention trigger: opportunistic on database initialization, insert, and read/aggregation. Do not add periodic timers.
- API contracts must match existing dashboard frontend types unless frontend is minimally updated in the same task.
- All unsafe token routes must validate exact same-origin localhost access server-side.
- All token responses must be redacted by construction.
- All token mutation file writes must be serialized through one in-process mutex; `token-rotator-config.json` and active `auth.json` writes/copies must use same-directory temp-file write, flush/close, rename-over-target, and best-effort temp cleanup on failure.

### Must NOT Have
- No new Windows service or separate dashboard process.
- No login/logout/browser popup implementation.
- No automatic service/process restart or NSSM/sc.exe control.
- No wildcard CORS on `/api/dashboard/*` or `/api/tokens/*`.
- No raw tokens, refresh tokens, authorization headers, auth file contents, `auth.json`, `CODEX_HOME`, filesystem paths, source import paths, or email addresses in API responses, UI state, logs, or error bodies.
- No required Playwright dependency or browser-manual acceptance criterion.
- No CI workflow addition unless separately requested later.
- No multi-user auth, admin auth, remote/LAN dashboard mode, load balancer stats, token pooling, or cloud-sync assumptions.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.

- Test decision: tests-after using existing Vitest/Bun/Turbo infrastructure; add targeted tests before or alongside implementation as each slice is changed.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`. Create these evidence files locally during implementation verification only; do not include them in task commits unless explicitly requested.
- Existing commands:
  - Root: `bun run format-and-lint`, `bun run typecheck`, `bun run test`, `bun run build`.
  - Package targeted: `cd packages/openai-oauth && bun run test`.
- Do not require `LIVE_CODEX_E2E=1` or `test:live` for this MVP because dashboard backend tests must use temp fixtures and mocked events.
- Do not require Playwright because the repository has no Playwright setup.

## Execution Strategy

### Parallel Execution Waves
> This plan has only 8 implementation tasks, so the usual 5-8 tasks-per-wave target is intentionally not applied. Dependencies force a 3-task foundation wave, 3-task implementation wave, and 2-task final integration wave.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1:
- Task 1: SQLite persistence foundation and test fixtures.
- Task 4: Token security rule tests and redaction contract.
- Task 5: Vault mutation safety design and targeted tests.

Wave 2:
- Task 2: Logging ingestion from existing request events into SQLite.
- Task 3: Dashboard analytics APIs from SQLite.
- Task 6: Token API hardening and MVP sourcePath-add exclusion.

Wave 3:
- Task 7: Minimal frontend contract alignment.
- Task 8: Route integration, security headers/CORS finalization, and full verification gate.

### Dependency Matrix (full, all tasks)
| Task | Depends On | Blocks |
| --- | --- | --- |
| 1. SQLite persistence foundation | None | 2, 3 |
| 2. Request logging ingestion | 1 | 3, 8 |
| 3. Dashboard analytics APIs | 1, 2 | 7, 8 |
| 4. Token security/redaction tests | None | 6, 8 |
| 5. Vault mutation safety | None | 6, 8 |
| 6. Token API hardening | 4, 5 | 7, 8 |
| 7. Frontend contract alignment | 3, 6 | 8 |
| 8. Route/security integration and verification | 2, 3, 6, 7 | Final Verification Wave |

### Agent Dispatch Summary (wave → task count → categories)
| Wave | Task Count | Categories |
| --- | ---: | --- |
| 1 | 3 | backend-developer, security-auditor, test-automator |
| 2 | 3 | backend-developer, test-automator, security-auditor |
| 3 | 2 | frontend-developer, build-engineer |
| Final | 4 | oracle, unspecified-high, unspecified-high, deep |

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Add SQLite usage persistence foundation

  **What to do**:
  - Create the persistence module at exactly `packages/openai-oauth/src/db.ts`.
  - Resolve database root as `CODEX_HOME` when set, otherwise `USERPROFILE || HOME` plus `.codex`; database path must be `<codexHome>/openai-oauth/usage.sqlite`.
  - Ensure `<codexHome>/openai-oauth/` is created recursively.
  - Use `bun:sqlite`; do not add an ORM.
  - Create table `request_logs` with at least:
    - `id TEXT PRIMARY KEY`
    - `timestamp TEXT NOT NULL` as ISO-8601 UTC
    - `type TEXT NOT NULL` (`chat_request`, `chat_response`, `chat_error`)
    - `request_id TEXT NOT NULL`
    - `path TEXT NOT NULL`
    - `model TEXT NULL`
    - `status INTEGER NULL`
    - `duration_ms INTEGER NOT NULL DEFAULT 0`
    - `input_tokens INTEGER NOT NULL DEFAULT 0`
    - `output_tokens INTEGER NOT NULL DEFAULT 0`
    - `total_tokens INTEGER NOT NULL DEFAULT 0`
    - `error_message TEXT NULL`
    - `stream INTEGER NOT NULL DEFAULT 0`
  - Create indexes for `timestamp`, `request_id`, and `type`.
  - Provide functions equivalent to `openUsageDatabase`, `insertRequestLog`, `pruneOldRequestLogs`, `getUsageSummary`, `getHourlyUsage`, and `getRecentLogs`.
  - Retention must prune rows with `timestamp < now - 24h` on initialization, insert, and read/aggregation; no interval/timer.
  - Add temp-directory Vitest coverage that stubs `CODEX_HOME`, inserts fixture events, verifies file creation under `openai-oauth/usage.sqlite`, verifies 24-hour pruning, and verifies aggregate totals.

  **Must NOT do**:
  - Do not write to real `~/.codex` in tests.
  - Do not add Prisma, Drizzle, SQLite wrappers, or long-lived background pruning timers.
  - Do not store request bodies, prompts, token values, auth headers, email addresses, or file paths.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: backend persistence plus tests need careful IO and contract handling.
  - Skills: [`backend-developer`, `test-automator`] - backend module and Vitest fixture coverage.
  - Omitted: [`database-optimizer`] - schema is tiny and does not need deep query tuning.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 2, 3 | Blocked By: none

  **References**:
  - Pattern: `packages/openai-oauth/src/logging.ts:6-35` - existing logger injection surface to preserve.
  - API/Type: `packages/openai-oauth/src/types.ts:90-112` - source event union to normalize into rows.
  - Test: `packages/openai-oauth/test/server.test.ts:1-24` - temp file/directory setup pattern.
  - Constraint: `docs/plans/dashboard-backend-plan.md:21-24` - original database setup requirement, corrected to 1-day retention.

  **Acceptance Criteria**:
  - [ ] New Vitest tests in `packages/openai-oauth/test/` create a temp `CODEX_HOME` and assert `openai-oauth/usage.sqlite` exists after inserting logs.
  - [ ] Tests insert one `chat_request`, one `chat_response` with usage, one `chat_error`, and one row older than 24 hours; summary excludes/prunes the old row.
  - [ ] Tests assert missing usage becomes `0`, not `NaN` or omitted numeric fields.
  - [ ] Tests assert serialized recent logs contain no `access_token`, `refresh_token`, `auth.json`, temp directory path, or email-like string.
  - [ ] `cd packages/openai-oauth && bun run test` exits `0`.

  **QA Scenarios**:
  ```
  Scenario: SQLite file and schema are created in temp CODEX_HOME
    Tool: Bash
    Steps: Run `cd packages/openai-oauth && bun run test -- dashboard-db` after adding targeted tests that stub CODEX_HOME to a temp dir and insert fixture events.
    Expected: Exit code 0; test asserts `<temp>/openai-oauth/usage.sqlite` exists and schema accepts all fixture event rows.
    Evidence: .sisyphus/evidence/task-1-sqlite-foundation.txt

  Scenario: 24-hour retention excludes stale events
    Tool: Bash
    Steps: Run the same targeted test suite with one fixture timestamp older than 24 hours.
    Expected: Exit code 0; stale row is deleted or excluded; summary/hourly/recent logs only include rows within 24 hours.
    Evidence: .sisyphus/evidence/task-1-sqlite-retention.txt
  ```

  **Commit**: YES | Message: `feat(dashboard): add usage persistence foundation` | Files: [`packages/openai-oauth/src/db.ts`, `packages/openai-oauth/test/dashboard-db.test.ts`]

- [ ] 2. Persist existing request lifecycle events through the logger

  **What to do**:
  - Update `packages/openai-oauth/src/logging.ts` so `createRequestLogger(settings)` composes existing user-provided `settings.requestLogger`, optional console logging, and the new SQLite insertion logger.
  - Preserve current behavior where a supplied `settings.requestLogger` still receives every event.
  - Normalize `OpenAIOAuthServerLogEvent` into persistence rows using the schema from Task 1.
  - Ensure logging failures never break proxy responses; catch and suppress DB write errors after optionally forwarding to console only when existing env console logging is enabled.
  - Confirm `responses.ts` and `chat-completions.ts` already emit enough events; update only if needed to include status, duration, model, stream, and usage consistently.
  - If stream responses cannot reliably know final token usage, record the existing zero usage and stream flag; do not parse live SSE beyond existing behavior in this task.

  **Must NOT do**:
  - Do not log request bodies, prompts, messages, auth headers, raw upstream bodies, token material, paths, or emails.
  - Do not make DB insertion block or fail API responses.
  - Do not add periodic health checks or polling.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: cross-cuts server lifecycle and must preserve existing API behavior.
  - Skills: [`backend-developer`, `test-automator`] - logger composition and tests.
  - Omitted: [`performance-engineer`] - write volume is local and small for MVP.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 3, 8 | Blocked By: 1

  **References**:
  - Pattern: `packages/openai-oauth/src/logging.ts:6-35` - preserve `settings.requestLogger` and env console logger semantics.
  - Pattern: `packages/openai-oauth/src/responses.ts:46-73`, `103-158` - request/response/error event emission for `/v1/responses`.
  - Pattern: `packages/openai-oauth/src/chat-completions.ts:67-91`, `124-144` - request/response/error event emission for chat completions.
  - API/Type: `packages/openai-oauth/src/types.ts:90-112` - event normalization source.

  **Acceptance Criteria**:
  - [ ] Tests prove `settings.requestLogger` still receives events when SQLite logging is active.
  - [ ] Tests prove DB insertion failure does not change a successful handler response into a 500.
  - [ ] Tests prove persisted rows contain metadata only and no prompt/body/token/path/email material.
  - [ ] Tests prove `chat_response.usage.totalTokens` is persisted when present and defaults to `0` when absent.
  - [ ] `cd packages/openai-oauth && bun run test` exits `0`.

  **QA Scenarios**:
  ```
  Scenario: Logger fans out to caller logger and SQLite
    Tool: Bash
    Steps: Run targeted Vitest test that creates `createOpenAIOAuthFetchHandler({ requestLogger: vi.fn(), ensureFresh: false, fetch: mockedFetch })`, sends a fixture `/v1/responses` request, then queries temp SQLite.
    Expected: Exit code 0; caller logger called; SQLite row exists; HTTP response remains 200.
    Evidence: .sisyphus/evidence/task-2-logger-fanout.txt

  Scenario: SQLite write failure is non-fatal
    Tool: Bash
    Steps: Run targeted test with a mocked persistence function throwing during insert.
    Expected: Exit code 0; proxy response remains expected status; thrown logging error is not exposed in response body.
    Evidence: .sisyphus/evidence/task-2-logger-failure.txt
  ```

  **Commit**: YES | Message: `feat(dashboard): persist proxy request logs` | Files: [`packages/openai-oauth/src/logging.ts`, `packages/openai-oauth/src/responses.ts`, `packages/openai-oauth/src/chat-completions.ts`, `packages/openai-oauth/test/dashboard-logging.test.ts`]

- [ ] 3. Implement dashboard analytics APIs from SQLite

  **What to do**:
  - Replace stubs in `packages/openai-oauth/src/dashboard-api.ts:31-54` with real reads from Task 1 persistence.
  - Exact MVP endpoints:
    - `GET /api/dashboard/summary` → `{ totalRequests: number, totalTokens: number, errorCount: number, uptime: string }`.
    - `GET /api/dashboard/hourly` → array of 24 hourly buckets ordered oldest-to-newest, each `{ hour: string, requests: number, tokens: number }`.
    - `GET /api/dashboard/logs` → recent logs array, default latest 50 max, shape matching frontend `LogEntry`.
    - `GET /api/dashboard/status` → `{ healthy: boolean, uptime: number, active_token: null | { slot: number, label: string, active: true, inVault: boolean, expiry: string | null } }` with no file/path/email fields.
  - Count `totalRequests` as request attempts within 24 hours. Use `chat_request` count when available; if only response/error rows exist, use distinct `request_id` count from all types.
  - Count `errorCount` as `chat_error` rows within 24 hours.
  - Count `totalTokens` from `chat_response.total_tokens` within 24 hours.
  - Format `uptime` using existing `formatUptime` behavior for summary; keep raw seconds in status for existing status semantics unless frontend is updated in Task 7.
  - Add status support for active token by using `getActiveTokenInfo(resolveVaultPaths(...))` without leaking `file`.
  - Preserve route-not-found 404 behavior for unknown dashboard paths.

  **Must NOT do**:
  - Do not return database file paths or vault paths.
  - Do not return raw SQLite rows if they include internal-only fields.
  - Do not use live Codex calls for dashboard status beyond existing local `/health` check.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: API contract implementation and aggregation tests.
  - Skills: [`backend-developer`, `test-automator`] - API implementation with fixture-based tests.
  - Omitted: [`api-designer`] - contracts are fixed in this plan.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7, 8 | Blocked By: 1, 2

  **References**:
  - Pattern: `packages/openai-oauth/src/dashboard-api.ts:24-57` - current handler shape.
  - API/Type: `packages/openai-oauth-dashboard/src/types.ts:9-36` - frontend summary/hourly/log contracts.
  - Pattern: `packages/openai-oauth-dashboard/src/components/UsageTab.tsx:76-84` - exact endpoints fetched by frontend.
  - Pattern: `packages/openai-oauth/src/vault-ops.ts:447-472` - proxy health and active token helpers.

  **Acceptance Criteria**:
  - [ ] Vitest tests call `handleDashboardApiRequest` or `createOpenAIOAuthFetchHandler` with fixture DB rows and assert exact JSON shapes.
  - [ ] Summary test proves totals are computed over the last 24 hours only.
  - [ ] Hourly test proves exactly 24 buckets are returned, ordered oldest-to-newest, with missing hours as zeroes.
  - [ ] Logs test proves max latest 50 records and frontend-compatible `durationMs`/`usage` fields.
  - [ ] Status test proves active token is redacted and contains no `file`, path, token, or email field.
  - [ ] `cd packages/openai-oauth && bun run test` exits `0`.

  **QA Scenarios**:
  ```
  Scenario: Dashboard summary and hourly APIs aggregate fixture logs
    Tool: Bash
    Steps: Run `cd packages/openai-oauth && bun run test -- dashboard-api` with temp CODEX_HOME and known fixture timestamps.
    Expected: Exit code 0; summary totals match fixture data; hourly returns 24 ordered buckets with expected non-zero bucket.
    Evidence: .sisyphus/evidence/task-3-dashboard-analytics.txt

  Scenario: Dashboard logs/status APIs expose no sensitive data
    Tool: Bash
    Steps: Run the same targeted tests and stringify `/api/dashboard/logs` and `/api/dashboard/status` payloads.
    Expected: Exit code 0; payloads do not contain `access_token`, `refresh_token`, `auth.json`, temp paths, `CODEX_HOME`, or email-like strings.
    Evidence: .sisyphus/evidence/task-3-dashboard-redaction.txt
  ```

  **Commit**: YES | Message: `feat(dashboard): implement usage analytics APIs` | Files: [`packages/openai-oauth/src/dashboard-api.ts`, `packages/openai-oauth/test/dashboard-api.test.ts`]

- [ ] 4. Lock token API security and redaction tests

  **What to do**:
  - Add tests before or alongside token API implementation for `packages/openai-oauth/src/dashboard-security.ts` and `token-vault-api.ts`.
  - Exact unsafe route policy for `POST`/`DELETE /api/tokens/*`:
    - If `Origin` is present, it is authoritative.
    - Accept only exact `http://127.0.0.1:<PORT>` and `http://localhost:<PORT>`.
    - Reject `Origin: null` with 403.
    - Reject missing `Origin` with no valid `Referer` with 403.
    - If `Origin` is absent, fall back to `Referer` origin only.
    - Reject malformed `Referer` with 403.
    - If both `Origin` and `Referer` exist and conflict, use `Origin`; reject if `Origin` is invalid.
  - Origin validation must use the actual server port from `OpenAIOAuthServerOptions.port` or the runtime listener address used by `startOpenAIOAuthServer({ port: 0 })` tests. Do not rely only on `process.env.PORT` for dashboard/token API validation.
  - Exact CORS policy:
    - `/api/dashboard/*` and `/api/tokens/*` responses must not include `Access-Control-Allow-Origin: *`.
    - Same-origin dashboard requests do not require CORS headers.
    - Existing OpenAI-compatible `/v1/*` CORS behavior must remain unchanged.
  - Redaction tests must stringify all token API response payloads and assert absence of raw token and path/email patterns.

  **Must NOT do**:
  - Do not permit wildcard CORS on token metadata.
  - Do not weaken `/v1/*` CORS behavior while hardening dashboard/token routes.
  - Do not include real token files or real `CODEX_HOME` in tests.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: security-critical route behavior.
  - Skills: [`security-auditor`, `test-automator`] - exact negative tests and redaction assertions.
  - Omitted: [`penetration-tester`] - scoped unit/integration security coverage is enough.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 6, 8 | Blocked By: none

  **References**:
  - Pattern: `packages/openai-oauth/src/dashboard-security.ts:16-48` - Origin/Referer parsing and 403 response.
  - Pattern: `packages/openai-oauth/src/token-vault-api.ts:109-112` - unsafe method origin gate.
  - Requirement: `docs/plans/dashboard-backend-plan.md:10-15` - original security and restart constraints.
  - Constraint: project memory requires `GET /api/tokens/slots` to block wildcard CORS and mutation routes to validate Origin.

  **Acceptance Criteria**:
  - [ ] Tests for `POST /api/tokens/switch`, `POST /api/tokens/rotate`, and `DELETE /api/tokens/slots/:slot` cover valid localhost origins and invalid/missing/null/malformed origins.
  - [ ] Tests assert `GET /api/tokens/slots` returns 200 for local handler request but does not include `Access-Control-Allow-Origin: *`.
  - [ ] Tests assert every token API response body lacks `access_token`, `refresh_token`, `auth.json`, temp path fragments, `CODEX_HOME`, and email-like strings.
  - [ ] Tests assert forbidden responses use generic body only and do not include internal paths or parsing details.
  - [ ] `cd packages/openai-oauth && bun run test` exits `0`.

  **QA Scenarios**:
  ```
  Scenario: Unsafe token routes reject cross-site and null origins
    Tool: Bash
    Steps: Run `cd packages/openai-oauth && bun run test -- token-vault-api` with requests containing `Origin: null`, `Origin: http://evil.example`, missing Origin/Referer, and malformed Referer.
    Expected: Exit code 0; all unsafe invalid-origin requests return 403 with generic body.
    Evidence: .sisyphus/evidence/task-4-token-origin-negative.txt

  Scenario: Token metadata route avoids wildcard CORS and leaks nothing sensitive
    Tool: Bash
    Steps: Run targeted test for `GET /api/tokens/slots` with fixture vault containing realistic token-shaped data.
    Expected: Exit code 0; response status 200; no `Access-Control-Allow-Origin: *`; serialized body contains only slot, label, active, inVault, expiry.
    Evidence: .sisyphus/evidence/task-4-token-redaction.txt
  ```

  **Commit**: YES | Message: `test(tokens): lock token api security contracts` | Files: [`packages/openai-oauth/test/token-vault-api.test.ts`, `packages/openai-oauth/test/dashboard-security.test.ts`]

- [ ] 5. Harden vault mutation safety and atomic file operations

  **What to do**:
  - Update `packages/openai-oauth/src/vault-ops.ts` so all vault mutations are serialized by the same in-process mutex: switch, rotate, delete, and any retained add/import operation.
  - Introduce helper(s) for safer JSON/file writes: write to a temp file in the same directory, flush and close using Bun/Node APIs available in this repo, rename over the target, and clean the temp file on failure best-effort.
  - Use this helper for every `token-rotator-config.json` write and every direct write/copy to active `auth.json`.
  - Preserve `assertSafeTokenFilename` restrictions and expand tests for unsafe filenames if needed.
  - Add concurrent mutation tests using a temp vault: start multiple switch/rotate/delete attempts and assert config remains valid JSON, exactly one active token remains, and no partial config file is observed after promises settle.
  - Keep backup behavior, but ensure backup filenames do not leak via API responses.

  **Must NOT do**:
  - Do not touch real vault files in tests.
  - Do not rely on cloud-sync locations or assume OneDrive/iCloud/Dropbox safety.
  - Do not implement cross-process locking; MVP requires in-process mutex only.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: filesystem mutation safety is high-risk.
  - Skills: [`backend-developer`, `security-auditor`, `test-automator`] - safe IO and concurrency coverage.
  - Omitted: [`windows-infra-admin`] - no service-control or Windows admin work is in scope.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 6, 8 | Blocked By: none

  **References**:
  - Pattern: `packages/openai-oauth/src/vault-ops.ts:54-70` - existing mutex to extend.
  - Pattern: `packages/openai-oauth/src/vault-ops.ts:114-140` - config load/save to harden.
  - Pattern: `packages/openai-oauth/src/vault-ops.ts:217-235` - active token restore writes/copies.
  - Pattern: `packages/openai-oauth/src/vault-ops.ts:265-364` - switch/rotate already locked.
  - Gap: `packages/openai-oauth/src/vault-ops.ts:366-445` - add/delete currently not locked.

  **Acceptance Criteria**:
  - [ ] Tests prove switch, rotate, and delete run through the same lock path.
  - [ ] Tests prove concurrent mutations leave parseable config JSON with exactly one active token.
  - [ ] Tests prove active slot deletion still fails with `Cannot delete the active slot. Switch first.` or equivalent non-sensitive message.
  - [ ] Tests prove unsafe filenames are rejected and do not escape vault directories.
  - [ ] `cd packages/openai-oauth && bun run test` exits `0`.

  **QA Scenarios**:
  ```
  Scenario: Concurrent token mutations do not corrupt config
    Tool: Bash
    Steps: Run targeted Vitest test that creates a temp vault with at least three slots and fires concurrent switch/rotate/delete calls.
    Expected: Exit code 0; config remains valid JSON; exactly one slot is active; no partial temp file is treated as config.
    Evidence: .sisyphus/evidence/task-5-vault-concurrency.txt

  Scenario: Active slot deletion remains blocked safely
    Tool: Bash
    Steps: Run targeted test calling `deleteTokenSlot` for the active slot in a temp vault.
    Expected: Exit code 0; operation returns failure; active token remains active; response/error contains no path or token content.
    Evidence: .sisyphus/evidence/task-5-active-delete-blocked.txt
  ```

  **Commit**: YES | Message: `fix(tokens): serialize vault mutations safely` | Files: [`packages/openai-oauth/src/vault-ops.ts`, `packages/openai-oauth/test/vault-ops.test.ts`]

- [ ] 6. Harden token API routes and exclude sourcePath add from MVP

  **What to do**:
  - Update `packages/openai-oauth/src/token-vault-api.ts` to satisfy Task 4 and Task 5 contracts.
  - Keep MVP routes:
    - `GET /api/tokens/slots` → `{ slots: RedactedSlot[] }`.
    - `POST /api/tokens/switch` with `{ slot }` → success response with redacted `prev`, redacted `next`, and `restart_required: true`.
    - `POST /api/tokens/rotate` → success response with redacted `prev`, redacted `next`, and `restart_required: true`.
    - `DELETE /api/tokens/slots/:slot` → success response `{ success: true }`. Active-slot deletion remains blocked, so non-active deletion does not affect the proxy's currently loaded auth and must not return `restart_required`.
  - Explicitly exclude `POST /api/tokens/add` sourcePath import from MVP by returning `404 not_found_error` or `501 not_implemented_error` with generic text. Do not accept `sourcePath` from the dashboard.
  - Ensure all operation errors use generic non-sensitive messages where underlying error might include paths. Replace path-containing errors like `Source file not found: ${sourcePath}` from API surfaces.
  - Ensure redacted slot type never includes `file`.
  - If `normalizeOpResult` cannot map slot reliably, fix it so slot numbers are stable and non-zero when possible.

  **Must NOT do**:
  - Do not expose or accept arbitrary local filesystem paths from HTTP.
  - Do not implement browser login/logout/import UX.
  - Do not restart the proxy.
  - Do not add email/account ID fields.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: security-sensitive API behavior.
  - Skills: [`backend-developer`, `security-auditor`, `test-automator`] - route hardening and tests.
  - Omitted: [`frontend-developer`] - frontend work is separate/minimal in Task 7.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7, 8 | Blocked By: 4, 5

  **References**:
  - Pattern: `packages/openai-oauth/src/token-vault-api.ts:25-43` - redacted slot shape to preserve.
  - Pattern: `packages/openai-oauth/src/token-vault-api.ts:102-175` - current route handler.
  - Security: `packages/openai-oauth/src/dashboard-security.ts:31-48` - same-origin validation.
  - Risk: `packages/openai-oauth/src/token-vault-api.ts:158-171` - sourcePath add route to exclude or redesign later.

  **Acceptance Criteria**:
  - [ ] Token API tests from Task 4 pass without weakening assertions.
  - [ ] `POST /api/tokens/add` with a `sourcePath` body does not import the file and returns 404 or 501 with no path echo.
  - [ ] Switch/rotate success responses include `restart_required: true` and no `file` field.
  - [ ] Invalid slot inputs return 400 with generic non-sensitive JSON error.
  - [ ] `cd packages/openai-oauth && bun run test` exits `0`.

  **QA Scenarios**:
  ```
  Scenario: Source-path token add is excluded from MVP
    Tool: Bash
    Steps: Run targeted test calling `POST /api/tokens/add` with valid same-origin header and body `{ "sourcePath": "C:\\secret\\auth.json" }`.
    Expected: Exit code 0; response is 404 or 501; body does not contain the submitted path; no vault file is created from that source.
    Evidence: .sisyphus/evidence/task-6-token-add-excluded.txt

  Scenario: Switch and rotate return restart-required redacted responses
    Tool: Bash
    Steps: Run targeted tests for same-origin switch and rotate against temp vault fixtures.
    Expected: Exit code 0; responses include `restart_required: true`; responses contain redacted slot metadata only.
    Evidence: .sisyphus/evidence/task-6-restart-required.txt
  ```

  **Commit**: YES | Message: `fix(tokens): harden token management api` | Files: [`packages/openai-oauth/src/token-vault-api.ts`, `packages/openai-oauth/test/token-vault-api.test.ts`]

- [ ] 7. Align existing dashboard frontend contracts minimally

  **What to do**:
  - Review `packages/openai-oauth-dashboard/src/types.ts`, `UsageTab.tsx`, and `TokensTab.tsx` against final backend contracts from Tasks 3 and 6.
  - Keep visual design and Apple HIG styling unchanged unless a type/contract issue requires a small update.
  - Fix `TokensTab.tsx:29-32` status handling if needed: parse `/api/dashboard/status` JSON and set `proxyUp` from `healthy`, not merely `response.ok`.
  - Leave delete alert behavior unchanged: delete does not show the restart-required alert because `DELETE /api/tokens/slots/:slot` only deletes non-active slots and returns `{ success: true }`.
  - Ensure TypeScript types include status response only if consumed directly.
  - Preserve same-origin `fetch` calls; do not manually set `Origin` because browsers control it.

  **Must NOT do**:
  - Do not redesign the dashboard UI.
  - Do not add Tailwind, Zustand, TanStack Query, Radix, Playwright, or Testing Library.
  - Do not add login/logout/add-token browser flows.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: small React contract alignment needs TypeScript correctness but no visual redesign.
  - Skills: [`frontend-developer`, `typescript-pro`] - React/TypeScript contract fixes.
  - Omitted: [`ui-designer`] - no design changes are requested.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 8 | Blocked By: 3, 6

  **References**:
  - API/Type: `packages/openai-oauth-dashboard/src/types.ts:1-36` - frontend data contracts.
  - Pattern: `packages/openai-oauth-dashboard/src/components/UsageTab.tsx:76-84` - dashboard API fetches.
  - Gap: `packages/openai-oauth-dashboard/src/components/TokensTab.tsx:29-32` - currently treats HTTP 200 as proxy healthy.
  - Pattern: `packages/openai-oauth-dashboard/src/components/TokensTab.tsx:45-67` - mutation fetches and restart alert behavior.

  **Acceptance Criteria**:
  - [ ] `cd packages/openai-oauth-dashboard && bun run typecheck` exits `0`.
  - [ ] `cd packages/openai-oauth-dashboard && bun run build` exits `0`.
  - [ ] No new dashboard package dependencies are added unless required for compile correctness.
  - [ ] The dashboard still fetches existing endpoints: `/api/dashboard/summary`, `/api/dashboard/hourly`, `/api/dashboard/logs`, `/api/dashboard/status`, `/api/tokens/slots`, `/api/tokens/switch`, `/api/tokens/rotate`, `/api/tokens/slots/:slot`.
  - [ ] No frontend code displays token files, local paths, emails, or raw token fields.

  **QA Scenarios**:
  ```
  Scenario: Dashboard frontend compiles against backend contracts
    Tool: Bash
    Steps: Run `cd packages/openai-oauth-dashboard && bun run typecheck`.
    Expected: Exit code 0; TypeScript accepts SummaryData, HourlyStat, LogEntry, TokenSlot, and status handling.
    Evidence: .sisyphus/evidence/task-7-dashboard-typecheck.txt

  Scenario: Dashboard production build succeeds without new test/browser tooling
    Tool: Bash
    Steps: Run `cd packages/openai-oauth-dashboard && bun run build`.
    Expected: Exit code 0; Vite build completes; no Playwright dependency or test script is required.
    Evidence: .sisyphus/evidence/task-7-dashboard-build.txt
  ```

  **Commit**: YES | Message: `fix(dashboard): align frontend api contracts` | Files: [`packages/openai-oauth-dashboard/src/types.ts`, `packages/openai-oauth-dashboard/src/components/UsageTab.tsx`, `packages/openai-oauth-dashboard/src/components/TokensTab.tsx`]

- [ ] 8. Finalize route integration, security headers, and full verification gate

  **What to do**:
  - Verify `packages/openai-oauth/src/server.ts:57-87` uses the new dashboard/token handlers correctly.
  - Verify with tests that `resolveVaultPaths` receives the Codex home/auth directory, not an `auth.json` file path. If `settings.authFilePath` points to a file, derive its parent directory or use `CODEX_HOME`/default Codex home according to existing auth discovery rules. Do not treat `.../auth.json` as the vault root.
  - Apply dashboard/token security headers without breaking static dashboard assets. If `getSecurityHeaders()` is used for static dashboard too, use a CSP compatible with the Vite build:
    - `default-src 'self'`
    - `script-src 'self'`
    - `style-src 'self' 'unsafe-inline'` only if current built CSS/style injection requires it
    - `connect-src 'self'`
    - `img-src 'self' data:`
    - `object-src 'none'`
    - `base-uri 'none'`
    - `frame-ancestors 'none'`
  - Keep API JSON responses compatible with frontend fetches.
  - Add/extend route-level integration tests with `createOpenAIOAuthFetchHandler` for `/api/dashboard/*` and `/api/tokens/*`.
  - Run full root verification commands.

  **Must NOT do**:
  - Do not break existing `/v1/models`, `/v1/responses`, `/v1/chat/completions`, or `/health` tests.
  - Do not add manual browser verification as a pass/fail gate.
  - Do not modify Windows service scripts for this MVP.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: cross-route integration and full build/test gate.
  - Skills: [`build-engineer`, `test-automator`, `security-auditor`] - integration, gates, and security headers.
  - Omitted: [`deployment-engineer`] - no deployment/service change is in scope.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Final Verification Wave | Blocked By: 2, 3, 6, 7

  **References**:
  - Pattern: `packages/openai-oauth/src/server.ts:39-87` - route dispatch order.
  - Pattern: `packages/openai-oauth/src/server.ts:128-160` - `createOpenAIOAuthFetchHandler` testable handler factory.
  - Test: `packages/openai-oauth/test/server.test.ts:32-127` - route-level handler testing style.
  - Test: `packages/openai-oauth/test/node-server.test.ts` - real HTTP server test pattern if needed.
  - Security: `packages/openai-oauth/src/dashboard-security.ts:50-56` - current security headers to adjust.

  **Acceptance Criteria**:
  - [ ] Route integration tests prove `/api/dashboard/summary`, `/api/dashboard/hourly`, `/api/dashboard/logs`, `/api/dashboard/status`, and `/api/tokens/slots` are reachable through `createOpenAIOAuthFetchHandler`.
  - [ ] Route integration tests prove unknown dashboard/token API paths return 404 JSON errors.
  - [ ] Route integration tests prove `/v1/models` behavior remains compatible with existing tests.
  - [ ] `bun run format-and-lint` exits `0`.
  - [ ] `bun run typecheck` exits `0`.
  - [ ] `bun run test` exits `0`.
  - [ ] `bun run build` exits `0`.

  **QA Scenarios**:
  ```
  Scenario: API routes are wired through the proxy handler
    Tool: Bash
    Steps: Run `cd packages/openai-oauth && bun run test -- server` after adding dashboard/token route assertions.
    Expected: Exit code 0; all dashboard/token API routes return expected status/body through `createOpenAIOAuthFetchHandler`.
    Evidence: .sisyphus/evidence/task-8-route-integration.txt

  Scenario: Full repository verification gate passes
    Tool: Bash
    Steps: Run `bun run format-and-lint`, `bun run typecheck`, `bun run test`, and `bun run build` from repository root.
    Expected: Each command exits 0; no live Codex auth or Playwright is required.
    Evidence: .sisyphus/evidence/task-8-full-gate.txt
  ```

  **Commit**: YES | Message: `feat(dashboard): wire backend dashboard verification` | Files: [`packages/openai-oauth/src/server.ts`, `packages/openai-oauth/src/dashboard-security.ts`, `packages/openai-oauth/test/server.test.ts`, related test files]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [ ] F1. Plan Compliance Audit — oracle
  - Verify every deliverable in this plan is implemented or explicitly marked out of scope with justification.
  - Verify sourcePath-based token add remains excluded or safely redesigned by explicit later decision.
  - Verify no task added login/logout/browser popup, self-restart, required Playwright, CI, or remote/multi-user scope.

- [ ] F2. Code Quality Review — unspecified-high
  - Review SQLite module size, route handler clarity, error handling, and preservation of existing `/v1/*` behavior.
  - Reject broad rewrites, unrelated formatting churn, or large mixed-responsibility files.

- [ ] F3. Real Manual QA — unspecified-high
  - Agent-executed only, no human browser confirmation.
  - Use local build/test commands and HTTP route checks against an ephemeral `startOpenAIOAuthServer({ port: 0 })` test or equivalent automated script.
  - Do not use live Codex quota.

- [ ] F4. Scope Fidelity Check — deep
  - Confirm final work stays within single-user localhost MVP.
  - Confirm no sensitive token/auth/path/email data is exposed in responses, logs, UI state, test snapshots, or error messages.

## Commit Strategy
- Commit after each task if the repository remains green for the task-specific test command.
- Use small conventional messages listed in each task.
- Do not commit generated `usage.sqlite`, temp vault files, auth files, or `.sisyphus/evidence/*` unless the repository convention explicitly tracks evidence. If evidence is untracked and not normally committed, leave it local.
- Do not commit `.codex/**/*.json` auth material.

## Success Criteria
- Dashboard Usage tab receives non-stub summary/hourly/log data from SQLite-backed APIs.
- Dashboard Tokens tab receives redacted token slot metadata and mutation responses that trigger restart-required UI where applicable.
- Token APIs reject unsafe origins and never use wildcard CORS for token metadata.
- Token mutations are serialized and safer against local auth/vault corruption within the process.
- The implementation is validated entirely with existing Bun/Vitest/Turbo commands and requires no live Codex auth, Playwright, CI, service restart, or human browser confirmation.
