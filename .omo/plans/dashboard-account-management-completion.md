# Dashboard Account Management Completion Plan

## TL;DR
> **Summary**: Complete the Dashboard/Account Management backlog that remains after the May 18 MVP: add token-save UI, action feedback, dashboard API CORS hardening, Usage polish, tests, docs, and verification evidence. Current checkout does **not** show Hephaestus completion beyond the MVP; `docs/plans/dashboard-account-management-remaining-work.md` is backlog input, not completion evidence.
> **Deliverables**:
> - Tested `POST /api/tokens/add` behavior and redaction/security coverage.
> - Tokens tab Add/pending/result UX for saving the current default auth snapshot as a slot.
> - Usage tab token-aware chart/tooltip and API failure/log/null-state polish.
> - Dashboard API CORS aligned with localhost same-origin posture; no wildcard CORS for dashboard JSON endpoints.
> - Updated operations/token-management/dashboard docs and session evidence.
> - Full static, unit, HTTP/CORS, and browser QA evidence.
> **Effort**: Medium
> **Parallel**: YES - 4 waves
> **Critical Path**: Task 1 API contract tests -> Task 2 Add UX -> Task 6 browser/live verification -> Final Verification Wave

## Context

### Original Request
- User asked: “헤파스토 작업완료하면 계획서 검토하고 재작성해” and then “바로 진행해 작업다 했어”.
- Prometheus inspected current repository state through read-only exploration before rewriting the plan.

### Current Repo Evidence
- Repo: `C:\NEW PRG\openai-oauth`
- Branch: `main`, HEAD reported by exploration as `1cf8d72` (`feat(dashboard, codex): implement sqlite-backed dashboard backend and automated backup token pruning`).
- Working tree evidence from this session: only untracked `docs/plans/dashboard-account-management-remaining-work.md` was reported; no tracked implementation changes proving additional Hephaestus completion.
- Current implementation includes May 18 MVP:
  - Backend dashboard APIs in `packages/openai-oauth/src/dashboard-api.ts`.
  - Token API in `packages/openai-oauth/src/token-vault-api.ts`.
  - Origin helpers in `packages/openai-oauth/src/dashboard-security.ts`.
  - Dashboard routes/static serving in `packages/openai-oauth/src/server.ts` and `packages/openai-oauth/src/dashboard-static.ts`.
  - React UI in `packages/openai-oauth-dashboard/src/components/TokensTab.tsx` and `packages/openai-oauth-dashboard/src/components/UsageTab.tsx`.
- Current gaps from exploration:
  - `TokensTab.tsx` lacks Add UI, shared pending state, success/error result area, and updated empty state copy.
  - `UsageTab.tsx` renders request chart but not token series/tooltips; failed fetches degrade to empty/zero state instead of visible error.
  - `shared.ts` `toJsonResponse` applies wildcard CORS; token API strips CORS with `toTokenApiResponse`, dashboard API does not.
  - `token-vault-api.test.ts` covers slots/switch/rotate/delete but not `POST /api/tokens/add`.
  - Docs do not yet describe dashboard-first token management.
  - No completion session records full typecheck/build/test/format/browser/live POST QA for this backlog.

### Interview Summary
- No additional user decision is required. Oracle phase 1 returned `VERDICT: GO`.
- The plan treats `docs/plans/dashboard-account-management-remaining-work.md` as prior backlog context only.
- Due Prometheus mutation rules, implementation agents should execute from this file: `.sisyphus/plans/dashboard-account-management-completion.md`.

### Metis Review (gaps addressed)
- Metis warned not to treat user-reported completion as repo fact; this plan states current checkout evidence explicitly.
- Metis required scope guardrails against full dashboard redesign, token pooling, periodic health checks, real token exposure, and live quota checks; these are included below.
- Metis required precise CORS expectations, mock/temp auth data only, concrete selectors, agent-executable acceptance criteria, and browser/CORS evidence paths; each task includes those.

## Work Objectives

### Core Objective
Complete the remaining Dashboard/Account Management work for the single-user localhost OpenAI OAuth proxy without expanding into `codex-lb` full functionality or exposing sensitive token material.

### Deliverables
- Backend tests for `POST /api/tokens/add` including success, `sourcePath` rejection, forbidden origin, malformed body, and redaction.
- Minimal token API response helper reuse/generalization where needed without exposing wildcard CORS.
- Tokens tab Add action that saves the current default `auth.json` snapshot as a vault slot via `POST /api/tokens/add`.
- Tokens tab unified pending/result/restart feedback.
- Usage tab error banner, safer null rendering, token-aware chart/tooltip if existing API data supports it.
- Dashboard API CORS hardening for `/api/dashboard/*` so wildcard `Access-Control-Allow-Origin: *` is not emitted.
- Updated docs under `docs/OPERATIONS.md`, `docs/MANAGE_TOKEN_GUIDE.md`, `docs/dashboard/DASHBOARD_APPLIED_PLAN.md`, plus completion session doc under `docs/sessions/`.
- Evidence captured under `.sisyphus/evidence/dashboard-account-management/`.

### Definition of Done (verifiable conditions with commands)
- `bun run typecheck` exits `0`.
- `bun run test` exits `0`, including added `POST /api/tokens/add` coverage.
- `bun run format-and-lint` exits `0`.
- `bun run build` exits `0`.
- `curl.exe -i http://127.0.0.1:10531/api/tokens/slots` does not include `Access-Control-Allow-Origin: *`.
- `curl.exe -i http://127.0.0.1:10531/api/dashboard/summary` does not include `Access-Control-Allow-Origin: *`.
- `curl.exe -i -H "Origin: https://evil.example" http://127.0.0.1:10531/api/dashboard/summary` does not expose wildcard CORS.
- Browser QA confirms `/dashboard` loads, Usage and Tokens tabs render, Add/switch/rotate/delete feedback works with mocked/temp-safe data, and console has no uncaught errors.
- Documentation explicitly says browser login/logout popup, `sourcePath` import, self-restart, multi-user/admin auth, and live quota checks remain out of scope.

### Must Have
- Use Bun/Turbo/Biome conventions already in `package.json`, `turbo.json`, and `biome.json`.
- Keep dashboard single-user localhost only.
- Keep `POST /api/tokens/add` limited to saving the resolved default auth snapshot; no request-provided path or uploaded auth JSON.
- Preserve all token API redaction: no raw tokens, `auth.json` contents, file paths, or email addresses in responses, UI, tests, screenshots, docs, or logs.
- Keep token mutations guarded by localhost `Origin`/`Referer` policy.
- `POST /api/tokens/switch` and `POST /api/tokens/rotate` must return/display `restart_required: true` and instruct `.codex\launchers\manage-tokens.bat restart`.
- `POST /api/tokens/add` and inactive delete must not show restart-required alerts.
- All verification is agent-executed; no acceptance criterion may require user manual confirmation.

### Must NOT Have
- No admin auth, multi-user support, load-balancer stats, API-key management, token pooling/distribution, upstream model sync, circuit breakers, backpressure, Docker/Kubernetes/PostgreSQL/Prometheus infrastructure, or `codex-lb` full port.
- No browser login/logout popup flow.
- No `sourcePath` token import.
- No self-restart implementation.
- No live Codex quota checks or periodic health checks.
- No real auth/token data in fixtures, logs, screenshots, docs, or test snapshots.
- No broad dashboard redesign, new charting library, new routing architecture, or unrelated refactors.
- No npm/pnpm/yarn commands.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + Vitest/Bun for backend/API, browser automation for UI QA, `curl.exe` for HTTP/CORS checks.
- QA policy: Every task has happy-path and failure/edge scenarios.
- Evidence root: `.sisyphus/evidence/dashboard-account-management/`
- Use mock/temp auth data only. If a token mutation QA would touch real `CODEX_HOME`, the agent must first create an isolated temporary `CODEX_HOME` and launch the proxy against it, or mark that live mutation QA blocked with exact reason and complete non-mutating CORS/unit coverage instead.

## Execution Strategy

### Parallel Execution Waves
> Target: 5-8 tasks per wave. This plan has 7 implementation tasks; first wave establishes contracts and then UI/docs can proceed in parallel.

Wave 1: Task 1 API contract tests + Task 4 CORS helper hardening can run in parallel after verifying current response contracts.
Wave 2: Task 2 Tokens UX + Task 3 Usage UX + Task 5 Docs can run in parallel after Wave 1 contract decisions are known.
Wave 3: Task 6 Verification evidence capture after tasks 1-5 are complete.
Wave 4: Task 7 Session/boulder hygiene after verification evidence exists.

### Dependency Matrix (full, all tasks)
| Task | Depends On | Blocks |
|------|------------|--------|
| 1. Add endpoint tests | None | 2, 6 |
| 2. Tokens tab UX | 1 | 6 |
| 3. Usage tab polish | None | 6 |
| 4. Dashboard API CORS | None | 6 |
| 5. Docs update | 1, 2, 4 preferred | 7 |
| 6. Verification evidence | 1, 2, 3, 4, 5 | 7 |
| 7. Completion session/hygiene | 6 | Final verification |

### Agent Dispatch Summary
| Wave | Task Count | Categories |
|------|------------|------------|
| 1 | 2 | backend-developer/test-automator/security-auditor |
| 2 | 3 | frontend-developer/test-automator/technical-writer |
| 3 | 1 | qa-expert/browser-qa |
| 4 | 1 | technical-writer/project-manager |

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task has Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Add `POST /api/tokens/add` API tests and lock contract

  **What to do**: Add focused tests in `packages/openai-oauth/test/token-vault-api.test.ts` or a sibling test file following existing token API test patterns. Cover `POST /api/tokens/add` with temp/mock auth state only: successful save of the default auth snapshot, rejection of custom `sourcePath` with `400 invalid_request_error`, forbidden external/missing/null origin cases with `403`, malformed body behavior, no `restart_required`, and redaction of token/auth/path/email data. If existing helpers already create temp `CODEX_HOME`, reuse them; otherwise add a minimal local helper inside the test file.
  **Must NOT do**: Do not read or write the operator’s real `~/.codex` or real `CODEX_HOME`. Do not add browser login/upload/import behavior. Do not assert real token contents.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: backend API/security test work with auth-vault constraints.
  - Skills: `test-automator`, `security-review` - Need deterministic tests and redaction/security assertions.
  - Omitted: `payment-integration`, `database-optimizer` - Not payment/database performance work.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 2, 6 | Blocked By: none

  **References**:
  - Pattern: `packages/openai-oauth/test/token-vault-api.test.ts` - Existing slots/switch/rotate/delete security tests.
  - Pattern: `packages/openai-oauth/src/token-vault-api.ts` - Add endpoint contract and `toTokenApiResponse` behavior.
  - Pattern: `packages/openai-oauth/src/vault-ops.ts` - Vault add behavior, temp-file/rename atomic writes, `vaultMutex` serialization.
  - Pattern: `packages/openai-oauth/src/dashboard-security.ts` - Origin/Referer validation helpers.
  - Constraint: token API responses must not include raw tokens, `auth.json` contents, file paths, or email addresses.

  **Acceptance Criteria**:
  - [ ] `bun test packages/openai-oauth/test/token-vault-api.test.ts` exits `0`.
  - [ ] Test suite includes a `POST /api/tokens/add` happy path using temp/mock auth data.
  - [ ] Test suite verifies custom `sourcePath` returns `400` and stable error shape without leaking the path.
  - [ ] Test suite verifies `Origin: https://evil.example` returns `403` for add.
  - [ ] Test suite verifies successful add response includes `{ success: true, slot: ... }` and does not include `restart_required`.
  - [ ] Test suite verifies add response body does not contain `mock-access-token-redacted`, refresh token text, `auth.json`, temp file paths, or `test@example.com`.

  **QA Scenarios**:
  ```
  Scenario: Add default auth snapshot succeeds in temp vault
    Tool: PowerShell-compatible shell
    Steps: Run `bun test packages/openai-oauth/test/token-vault-api.test.ts --runInBand` if supported; otherwise run `bun test packages/openai-oauth/test/token-vault-api.test.ts`.
    Expected: Exit code 0; add happy-path assertion passes; no real CODEX_HOME touched.
    Evidence: .sisyphus/evidence/dashboard-account-management/task-1-add-api-tests.txt

  Scenario: Malicious sourcePath and evil Origin are rejected
    Tool: PowerShell-compatible shell
    Steps: Run the same test file and inspect named test output for `sourcePath` rejection and `Origin: https://evil.example` rejection.
    Expected: 400 for sourcePath, 403 for evil origin, no leaked path/token/email in response snapshots.
    Evidence: .sisyphus/evidence/dashboard-account-management/task-1-add-api-security.txt
  ```

  **Commit**: YES | Message: `test(tokens): cover add endpoint contract` | Files: `packages/openai-oauth/test/token-vault-api.test.ts`, optional local test helper in same package.

- [x] 2. Complete Tokens tab Add/pending/result UX

  **What to do**: Update `packages/openai-oauth-dashboard/src/components/TokensTab.tsx` and related CSS/types to add a `Save current auth as slot` action that calls `POST /api/tokens/add`. Add minimal `data-testid` selectors: `tokens-add-button`, `tokens-action-status`, `tokens-action-error`, `tokens-restart-required`, `tokens-empty-state`. Implement shared action state so add/switch/rotate/delete disable only relevant controls while pending and show sanitized success/error messages. Update empty-state copy to say new login is still performed via CLI, then current auth can be saved from the dashboard. Keep switch/rotate restart alert; do not show restart alert for add/delete. Keep active-slot delete disabled and add visible inactive-only explanation.
  **Must NOT do**: Do not add upload, paste, `sourcePath`, OAuth popup, or self-restart. Do not render email addresses or file paths. Do not redesign the entire dashboard.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: React UI state, interaction behavior, and accessible status messages.
  - Skills: `frontend-developer`, `accessibility-tester` - Need robust component behavior and accessible feedback.
  - Omitted: `ui-ux-pro-max` - Scope is surgical UX completion, not redesign.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 6 | Blocked By: 1

  **References**:
  - Pattern: `packages/openai-oauth-dashboard/src/components/TokensTab.tsx` - Existing slot cards, proxy status, switch/rotate/delete handlers.
  - Pattern: `packages/openai-oauth-dashboard/src/styles/dashboard.css` - Existing Apple HIG/frosted glass styling.
  - API: `packages/openai-oauth/src/token-vault-api.ts` - `POST /api/tokens/add`, switch/rotate/delete response shape.
  - Constraint: `POST /api/tokens/switch` and `POST /api/tokens/rotate` return `restart_required: true`; `add` and delete do not.

  **Acceptance Criteria**:
  - [ ] `TokensTab.tsx` contains a visible `Save current auth as slot` button with `data-testid="tokens-add-button"`.
  - [ ] Add action calls `POST /api/tokens/add` with no `sourcePath` or auth payload.
  - [ ] Add success reloads slots and displays sanitized success in `data-testid="tokens-action-status"`.
  - [ ] Add failure displays sanitized error in `data-testid="tokens-action-error"` without path/token/email.
  - [ ] Switch/rotate display `data-testid="tokens-restart-required"` with `.codex\launchers\manage-tokens.bat restart`.
  - [ ] Add/delete do not display restart-required alert.
  - [ ] Active delete remains disabled; inactive-only delete explanation is visible.
  - [ ] `bun run typecheck` exits `0` after UI changes.

  **QA Scenarios**:
  ```
  Scenario: Add current auth from Tokens tab
    Tool: Playwright
    Steps: Open `http://127.0.0.1:10531/dashboard`; click Tokens tab; click `[data-testid="tokens-add-button"]`; wait for `[data-testid="tokens-action-status"]`.
    Expected: Button disables during request, then sanitized success message appears; slots reload; `[data-testid="tokens-restart-required"]` is not visible.
    Evidence: .sisyphus/evidence/dashboard-account-management/task-2-tokens-add.png

  Scenario: Add failure is sanitized
    Tool: Playwright
    Steps: Mock `/api/tokens/add` to return 400 with a message containing `C:\\Users\\secret\\.codex\\auth.json` and `test@example.com`; click `[data-testid="tokens-add-button"]`.
    Expected: `[data-testid="tokens-action-error"]` is visible but contains neither `auth.json`, file path, nor `test@example.com`; existing slot list remains visible.
    Evidence: .sisyphus/evidence/dashboard-account-management/task-2-tokens-add-error.png
  ```

  **Commit**: YES | Message: `feat(dashboard): complete token action feedback` | Files: `packages/openai-oauth-dashboard/src/components/TokensTab.tsx`, `packages/openai-oauth-dashboard/src/styles/dashboard.css`, optional `packages/openai-oauth-dashboard/src/types.ts`.

- [x] 3. Polish Usage tab token/error/null states

  **What to do**: Update `packages/openai-oauth-dashboard/src/components/UsageTab.tsx` and CSS to use existing `HourlyStat.tokens` safely. If `GET /api/dashboard/hourly` already returns token counts, include token totals in tooltip/legend or a secondary accessible label without adding new charting dependencies. Add an explicit API error banner with `data-testid="usage-error-banner"`. Guard `durationMs`, token usage, and nullable log fields so UI never renders `undefinedms`, `NaN`, or misleading zeros for failed requests. Add row-level styling for error logs while keeping existing `.log-type.chat_error` badge styling.
  **Must NOT do**: Do not add live quota checks, per-account load-balancer stats, new backend tables, or new charting libraries. Do not expose account identifiers.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: Frontend rendering, chart/tooltip, empty/error state polish.
  - Skills: `frontend-developer`, `accessibility-tester` - Need accessible error and chart information.
  - Omitted: `database-optimizer` - No DB schema/performance work unless existing API shape is broken.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 6 | Blocked By: none

  **References**:
  - Pattern: `packages/openai-oauth-dashboard/src/components/UsageTab.tsx` - Current summary/hourly/log rendering and coercion.
  - Pattern: `packages/openai-oauth-dashboard/src/types.ts` - `HourlyStat` includes `tokens`.
  - API: `packages/openai-oauth/src/dashboard-api.ts` - Hourly API source fields.
  - CSS: `packages/openai-oauth-dashboard/src/styles/dashboard.css` - Existing cards, logs, and chart styles.

  **Acceptance Criteria**:
  - [ ] Usage tab displays a visible error banner when any dashboard API request fails.
  - [ ] Hourly chart/tooltip or legend includes token count from existing `HourlyStat.tokens` when present.
  - [ ] Null/undefined `durationMs` renders as `—`, not `undefinedms` or `NaNms`.
  - [ ] Error log rows have row-level visual distinction and retain readable light/dark styling.
  - [ ] Empty data state remains stable and does not show an error unless fetch failed.
  - [ ] `bun run typecheck` exits `0` after changes.

  **QA Scenarios**:
  ```
  Scenario: Usage chart shows request and token information
    Tool: Playwright
    Steps: Mock `/api/dashboard/hourly` with `[{"hour":"2026-05-18T10:00:00.000Z","requests":3,"tokens":1200}]`; open Usage tab; hover/focus chart point or inspect accessible chart summary.
    Expected: UI shows 3 requests and 1,200 tokens with no secret/account labels.
    Evidence: .sisyphus/evidence/dashboard-account-management/task-3-usage-tokens.png

  Scenario: Dashboard API failure shows explicit error
    Tool: Playwright
    Steps: Mock `/api/dashboard/summary` to return 500; open Usage tab.
    Expected: `[data-testid="usage-error-banner"]` is visible; no `undefinedms`, `NaN`, or misleading success-only empty state appears.
    Evidence: .sisyphus/evidence/dashboard-account-management/task-3-usage-error.png
  ```

  **Commit**: YES | Message: `fix(dashboard): clarify usage error and token states` | Files: `packages/openai-oauth-dashboard/src/components/UsageTab.tsx`, `packages/openai-oauth-dashboard/src/styles/dashboard.css`, optional `packages/openai-oauth-dashboard/src/types.ts`.

- [x] 4. Remove wildcard CORS from dashboard API JSON routes

  **What to do**: Add a dashboard-specific JSON response helper or generalize the existing token response pattern so `/api/dashboard/summary`, `/api/dashboard/hourly`, `/api/dashboard/logs`, and `/api/dashboard/status` do not emit `Access-Control-Allow-Origin: *`. Keep same-origin dashboard fetches working. For `OPTIONS` requests, only allow `http://127.0.0.1:PORT` and `http://localhost:PORT` if preflight handling is necessary; otherwise omit CORS headers for dashboard API. Add or update tests to assert no wildcard CORS on dashboard routes.
  **Must NOT do**: Do not weaken token mutation Origin/Referer checks. Do not introduce remote dashboard support. Do not require admin auth.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Security-sensitive HTTP response behavior and tests.
  - Skills: `security-review`, `backend-developer`, `test-automator` - Need safe CORS policy and regression coverage.
  - Omitted: `cloud-architect` - Localhost-only, no cloud architecture.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 6 | Blocked By: none

  **References**:
  - Pattern: `packages/openai-oauth/src/token-vault-api.ts` - `toTokenApiResponse` strips wildcard CORS.
  - Pattern: `packages/openai-oauth/src/shared.ts` - `toJsonResponse` and `corsHeaders` currently add wildcard CORS.
  - Pattern: `packages/openai-oauth/src/dashboard-api.ts` - Dashboard JSON handlers.
  - Pattern: `packages/openai-oauth/test/dashboard-api.test.ts` - Existing dashboard API tests to extend.
  - Pattern: `packages/openai-oauth/src/dashboard-security.ts` - Localhost origin validation.

  **Acceptance Criteria**:
  - [ ] Unit/integration tests assert `/api/dashboard/summary` does not include `Access-Control-Allow-Origin: *`.
  - [ ] Unit/integration tests assert `/api/dashboard/hourly`, `/api/dashboard/logs`, and `/api/dashboard/status` do not include wildcard CORS.
  - [ ] Existing token API CORS stripping tests still pass.
  - [ ] Same-origin dashboard UI fetches still succeed in browser QA.
  - [ ] `bun test packages/openai-oauth/test/dashboard-api.test.ts` exits `0`.

  **QA Scenarios**:
  ```
  Scenario: Dashboard API no longer emits wildcard CORS
    Tool: PowerShell-compatible shell
    Steps: Run `curl.exe -i http://127.0.0.1:10531/api/dashboard/summary` after launching rebuilt proxy.
    Expected: Response status 200; headers do not contain `Access-Control-Allow-Origin: *`.
    Evidence: .sisyphus/evidence/dashboard-account-management/task-4-dashboard-cors-summary.txt

  Scenario: Evil origin cannot use wildcard dashboard CORS
    Tool: PowerShell-compatible shell
    Steps: Run `curl.exe -i -H "Origin: https://evil.example" http://127.0.0.1:10531/api/dashboard/summary`.
    Expected: Headers do not contain `Access-Control-Allow-Origin: *`; body contains normal JSON only if policy keeps read endpoints open without CORS, otherwise documented rejection status. No wildcard CORS in either case.
    Evidence: .sisyphus/evidence/dashboard-account-management/task-4-dashboard-cors-evil-origin.txt
  ```

  **Commit**: YES | Message: `fix(dashboard): remove wildcard cors from api` | Files: `packages/openai-oauth/src/shared.ts` or new helper, `packages/openai-oauth/src/dashboard-api.ts`, `packages/openai-oauth/test/dashboard-api.test.ts`, optional `packages/openai-oauth/test/dashboard-security.test.ts`.

- [x] 5. Update dashboard-first operations documentation

  **What to do**: Update existing docs to describe the dashboard-first local flow and CLI fallback. Required files: `docs/OPERATIONS.md`, `docs/MANAGE_TOKEN_GUIDE.md`, `docs/dashboard/DASHBOARD_APPLIED_PLAN.md`. Explain `/dashboard`, Usage tab, Tokens tab, add/save-current-auth behavior, switch/rotate restart command, inactive delete behavior, security/redaction constraints, and out-of-scope items. Include PowerShell/Windows commands only where commands are shown. Add a note that CLI login remains the path for creating new Codex tokens; dashboard does not launch browser OAuth.
  **Must NOT do**: Do not claim runtime is healthy/running unless verified in Task 6. Do not include real paths beyond documented project/service paths already in repo knowledge. Do not document sourcePath imports, token pooling, or self-restart.

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: Operator/user documentation from implementation facts.
  - Skills: `technical-writer` - Need accurate docs derived from code.
  - Omitted: `content-marketer` - Not marketing copy.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7 | Blocked By: 1, 2, 4 preferred

  **References**:
  - Existing docs: `docs/OPERATIONS.md`, `docs/MANAGE_TOKEN_GUIDE.md`, `docs/dashboard/DASHBOARD_APPLIED_PLAN.md`.
  - Workflow: `.codex\launchers\manage-tokens.bat restart` after switch/rotate.
  - Environment: service wrapper `C:\Tools\OpenAIOAuthProxy\openai-oauth-proxy.bat`, port `10531`.
  - Constraint: Dashboard MVP excludes browser login/logout popup flows and self-restart.

  **Acceptance Criteria**:
  - [ ] `docs/OPERATIONS.md` contains a Dashboard section with URL `http://127.0.0.1:10531/dashboard`.
  - [ ] `docs/MANAGE_TOKEN_GUIDE.md` describes CLI login followed by dashboard save-current-auth flow.
  - [ ] Docs state switch/rotate require `.codex\launchers\manage-tokens.bat restart`.
  - [ ] Docs state add/delete do not require restart-required alert.
  - [ ] Docs list excluded flows: browser OAuth popup, `sourcePath`, self-restart, multi-user/admin auth, live quota checks.
  - [ ] Docs contain no raw token/auth examples.

  **QA Scenarios**:
  ```
  Scenario: Docs describe dashboard-first flow accurately
    Tool: PowerShell-compatible shell
    Steps: Run `git diff -- docs/OPERATIONS.md docs/MANAGE_TOKEN_GUIDE.md docs/dashboard/DASHBOARD_APPLIED_PLAN.md` and inspect changed sections.
    Expected: Dashboard URL, Tokens/Usage tabs, restart command, CLI fallback, and out-of-scope flows are documented.
    Evidence: .sisyphus/evidence/dashboard-account-management/task-5-docs-diff.txt

  Scenario: Docs do not introduce forbidden flows or secrets
    Tool: PowerShell-compatible shell
    Steps: Search changed docs for `sourcePath`, `refresh_token`, `access_token`, `browser login`, `self-restart`, and raw email-like examples.
    Expected: Forbidden flows appear only in “not supported/out of scope” wording; no real secrets or private emails are present.
    Evidence: .sisyphus/evidence/dashboard-account-management/task-5-docs-secret-scan.txt
  ```

  **Commit**: YES | Message: `docs(dashboard): document account management flow` | Files: `docs/OPERATIONS.md`, `docs/MANAGE_TOKEN_GUIDE.md`, `docs/dashboard/DASHBOARD_APPLIED_PLAN.md`.

- [x] 6. Capture full verification evidence

  **What to do**: Run the full validation sequence after Tasks 1-5. Capture command outputs and browser/curl evidence under `.sisyphus/evidence/dashboard-account-management/`. Use PowerShell-compatible commands. If the Windows service is used for live checks, classify runtime before claiming it is running: service status, listener PID, listener command line, parent/service ownership, endpoint response. Prefer launching a controlled local proxy with temp `CODEX_HOME` for mutation QA when possible.
  **Must NOT do**: Do not claim “working”, “running”, “safe to close”, or “healthy” without direct verification. Do not run live Codex quota/model calls except non-mutating local proxy route checks. Do not mutate real vault without backup/temp environment.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: End-to-end verification across build, HTTP, browser, and runtime safety.
  - Skills: `qa-expert`, `browser-qa`, `verification-loop` - Need evidence discipline.
  - Omitted: `deployment-engineer` - No deployment change unless service restart is explicitly required by operator.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 7 | Blocked By: 1, 2, 3, 4, 5

  **References**:
  - Commands: root `package.json` scripts `typecheck`, `test`, `format-and-lint`, `build`.
  - Runtime checks: `docs/OPERATIONS.md` Windows service guidance.
  - Local endpoint checks: `/dashboard`, `/api/dashboard/summary`, `/api/dashboard/hourly`, `/api/dashboard/logs`, `/api/tokens/slots`.

  **Acceptance Criteria**:
  - [ ] `bun run typecheck` exits `0` and output saved.
  - [ ] `bun run test` exits `0` and output saved.
  - [ ] `bun run format-and-lint` exits `0` and output saved.
  - [ ] `bun run build` exits `0` and output saved.
  - [ ] Curl evidence confirms token slots and dashboard summary do not emit wildcard CORS.
  - [ ] Browser QA evidence confirms Dashboard loads and no uncaught console errors occur.
  - [ ] Browser QA evidence covers Tokens add/switch/rotate/delete feedback and Usage error/token states.
  - [ ] If any verification cannot run, evidence file states exact blocker and the closest non-mutating alternative that passed.

  **QA Scenarios**:
  ```
  Scenario: Static and unit verification complete
    Tool: PowerShell-compatible shell
    Steps: Run `bun run typecheck`, `bun run test`, `bun run format-and-lint`, `bun run build` from repo root.
    Expected: All commands exit 0; outputs saved to `.sisyphus/evidence/dashboard-account-management/task-6-static-*.txt`.
    Evidence: .sisyphus/evidence/dashboard-account-management/task-6-static-summary.txt

  Scenario: Browser dashboard verification complete
    Tool: Playwright
    Steps: Open `http://127.0.0.1:10531/dashboard`; exercise Usage and Tokens tabs; capture console logs and screenshots.
    Expected: No uncaught console errors; required test IDs visible; Add/switch/rotate/delete and Usage error/token states meet expectations.
    Evidence: .sisyphus/evidence/dashboard-account-management/task-6-browser-dashboard.png
  ```

  **Commit**: YES | Message: `test(dashboard): capture account management verification` | Files: `.sisyphus/evidence/dashboard-account-management/**` if evidence is intended to be committed by project convention; otherwise evidence remains local and session doc summarizes paths.

- [x] 7. Write completion session and clean stale planning state

  **What to do**: Add a completion session under `docs/sessions/YYYYMMDD_HHMMSS_dashboard-account-management-completion.md` summarizing changed files, key decisions, verification outputs, and any unverified items. Update `.sisyphus/boulder.json` or related Sisyphus state only if that is the project’s active tracking mechanism and the current stale `dashboard-backend.md` “running” tasks are clearly safe to close; otherwise document the stale state as a follow-up instead of editing it.
  **Must NOT do**: Do not mark work complete if Final Verification Wave rejects it, if evidence is missing, or if a scope/product decision is newly required. Do not fabricate command outputs.

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: Completion report and plan hygiene.
  - Skills: `technical-writer`, `project-manager` - Need accurate handoff and state cleanup.
  - Omitted: `git-workflow-manager` - No branching/merge strategy needed unless user requests commit/PR.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: Final verification | Blocked By: 6

  **References**:
  - Pattern: `docs/sessions/20260517_190900_dashboard-continuation.md` - Session doc style and prior dashboard notes.
  - State: `.sisyphus/boulder.json` - Exploration reported stale `dashboard-backend.md` running tasks.
  - Evidence: `.sisyphus/evidence/dashboard-account-management/` - Verification outputs from Task 6.

  **Acceptance Criteria**:
  - [ ] New session doc exists under `docs/sessions/` with timestamped filename.
  - [ ] Session doc lists changed files, key decisions, verification commands, evidence paths, and remaining follow-ups.
  - [ ] Session doc states that browser login/logout popup, sourcePath import, self-restart, and live quota checks remain out of scope.
  - [ ] Stale `.sisyphus/boulder.json` state is either safely updated with evidence or documented as unresolved follow-up.

  **QA Scenarios**:
  ```
  Scenario: Completion session accurately reflects evidence
    Tool: PowerShell-compatible shell
    Steps: Compare session doc against `.sisyphus/evidence/dashboard-account-management/` file names and recent git diff.
    Expected: Every claimed verification has a corresponding evidence path; no success claim lacks evidence.
    Evidence: .sisyphus/evidence/dashboard-account-management/task-7-session-audit.txt

  Scenario: No fabricated completion state
    Tool: PowerShell-compatible shell
    Steps: Run `git diff -- docs/sessions .sisyphus/boulder.json` and inspect statements.
    Expected: Completion wording is conditional on verification evidence; stale boulder changes are justified or not made.
    Evidence: .sisyphus/evidence/dashboard-account-management/task-7-state-hygiene.txt
  ```

  **Commit**: YES | Message: `docs(dashboard): record account management completion` | Files: `docs/sessions/YYYYMMDD_HHMMSS_dashboard-account-management-completion.md`, optional `.sisyphus/boulder.json` only if safe.

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE with saved evidence before completion.
> Any rejection triggers fix -> re-run -> saved evidence update. User approval is required only for scope changes, blocked verification with no safe substitute, or a new product decision.
- [x] F1. Plan Compliance Audit — oracle
  - Verify every task in this plan was completed or explicitly deferred with evidence.
  - Verify no excluded scope was added.
- [x] F2. Code Quality Review — unspecified-high
  - Review React state, API helper changes, tests, and docs for maintainability and minimality.
- [x] F3. Real Manual QA — unspecified-high (+ browser automation)
  - Use browser automation for `/dashboard`; capture screenshots/console/network evidence.
- [x] F4. Scope Fidelity Check — deep
  - Confirm result remains single-user localhost dashboard work and not a `codex-lb` port.

## Commit Strategy
- Prefer small, reviewable commits in task order:
  1. `test(tokens): cover add endpoint contract`
  2. `fix(dashboard): remove wildcard cors from api`
  3. `feat(dashboard): complete token action feedback`
  4. `fix(dashboard): clarify usage error and token states`
  5. `docs(dashboard): document account management flow`
  6. `docs(dashboard): record account management completion`
- Do not commit real auth files, token material, local `.codex` content, or private evidence.
- If project convention excludes `.sisyphus/evidence` from commits, keep evidence local and summarize paths in the session doc.

## Success Criteria
- Remaining-work backlog is no longer merely documented; it is implemented, tested, documented, and verified with concrete evidence.
- Dashboard token management supports save-current-auth, switch, rotate, and inactive delete with clear feedback and correct restart semantics.
- Dashboard API and token API do not expose wildcard CORS on sensitive/local dashboard surfaces.
- Usage tab communicates token counts and API failures without misleading empty states.
- All static/unit/build checks pass.
- Browser QA and HTTP/CORS QA have saved evidence.
- Final Verification Wave approves with saved evidence, and any rejection is fixed and re-run before completion.
