# Account Management Web UI - Backend Implementation Plan

## 🎯 Goal
Replace the `.codex` CLI scripts with a local web UI by building out the SQLite logging system and connecting the token management APIs to the frontend.

## 📝 Constraints & Rules
- **Database**: `bun:sqlite` located at `~/.codex/openai-oauth/usage.sqlite`.
- **Log Retention**: 1 day (24 hours).
- **Architecture**: Serve everything from the proxy (port 10531). No new Windows service.
- **Security**: 
  - `GET /api/tokens/slots` must block wildcard CORS (prevent token metadata exposure).
  - Mutations (`POST`, `DELETE`) must validate `Origin` header (`127.0.0.1:PORT` or `localhost:PORT`).
  - No raw tokens or email addresses in API responses.
- **Concurrency**: All vault operations must use atomic file ops with an in-process mutex.
- **Service Restart**: Mutations will return `{ restart_required: true }`. The UI will prompt the user to run `.\.codex\launchers\manage-tokens.bat restart`.

---

## 🛠 Implementation Steps

### Step 1: Database Setup (`packages/openai-oauth/src/db.ts`)
- [ ] Implement `usage.sqlite` initialization using `bun:sqlite` under `$CODEX_HOME/openai-oauth/`.
- [ ] Create table `request_logs` (id, timestamp, type, path, model, duration_ms, input_tokens, output_tokens, error_message).
- [ ] Implement pruning logic: delete logs older than 24 hours (executed on insert or interval).

### Step 2: Request Logging Interception (`packages/openai-oauth/src/logging.ts` & `server.ts`)
- [ ] Hook into the proxy request lifecycle to capture metadata (path, model, duration).
- [ ] Extract token usage from OpenAI upstream responses (SSE or JSON).
- [ ] Write captured logs asynchronously to `usage.sqlite`.

### Step 3: Dashboard Analytics APIs (`packages/openai-oauth/src/dashboard-api.ts`)
- [ ] **`GET /api/dashboard/summary`**: Calculate total requests, total tokens, error counts from the last 24h, and current uptime.
- [ ] **`GET /api/dashboard/hourly`**: Aggregate `request_logs` by hour for the Recharts AreaChart.
- [ ] **`GET /api/dashboard/logs`**: Fetch the most recent 20~50 logs for the table display.

### Step 4: Token Management APIs (`packages/openai-oauth/src/token-vault-api.ts`)
- [ ] Implement `Origin` header validation middleware for security.
- [ ] **`GET /api/tokens/slots`**: Wrapper around `vault-ops.ts -> getSlots()`. Filter out sensitive data (emails, paths).
- [ ] **`POST /api/tokens/switch`**: Wrapper around `switchSlot()`. Return `{ restart_required: true }`.
- [ ] **`POST /api/tokens/rotate`**: Wrapper around `rotateToken()`. Return `{ restart_required: true }`.
- [ ] **`DELETE /api/tokens/slots/:id`**: Wrapper around `deleteSlot()`.

### Step 5: Verification & Team Delegation
- [ ] Use `team_mode` to delegate **Step 1 & 2** (Logging) to one agent and **Step 3 & 4** (APIs) to another agent in parallel.
- [ ] Build the project (`bun run build`).
- [ ] Manually restart the Windows service.
- [ ] Test the UI via Playwright/curl to ensure real data is populated and charts render without crashing.
