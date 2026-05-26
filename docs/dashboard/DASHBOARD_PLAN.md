# Dashboard Implementation Plan (변경 계획서)

## Phase 1: Infrastructure Setup
1. **Initialize Dashboard Package**:
   - Create `packages/openai-oauth-dashboard`.
   - Setup Vite + React + TypeScript.
   - Configure `turbo.json` to include the dashboard in the build pipeline.
2. **Database Integration**:
   - Add `bun:sqlite` to `openai-oauth-core` or the main proxy package.
   - Create a migration/schema for `request_logs` (id, timestamp, model, tokens, latency, status).

## Phase 2: Backend API Development
1. **Request Middleware**:
   - Update `packages/openai-oauth/src/chat-completions.ts` to log every request to the SQLite database.
2. **Dashboard API Routes**:
   - Add routes to `packages/openai-oauth/src/server.ts`:
     - `GET /api/dashboard/summary`: Aggregate stats for the last 24h.
     - `GET /api/dashboard/logs`: Paginated log entries.
     - `GET /api/dashboard/status`: Current health of the auth token/client.

## Phase 3: Frontend Implementation
1. **Core UI Structure**:
   - Port the layout and theme from `codex-lb`.
   - Use `recharts` for the usage graphs.
2. **Data Fetching**:
   - Implement `TanStack Query` (React Query) for efficient polling of stats.
3. **Interactive Features**:
   - Add a "Token Status" widget to show refresh status and expiry (if applicable).

## Phase 4: Integration
1. **CLI Updates**:
   - Add a `--dashboard` flag to the CLI to serve the frontend alongside the proxy.
   - Serve the dashboard static files from the proxy server on a specific path (e.g., `/dashboard`).
2. **Documentation**:
   - Update `README.md` and `docs/OPERATIONS.md` with dashboard usage instructions.
