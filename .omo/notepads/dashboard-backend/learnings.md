# Learnings

## Pattern survey (Wave 1 & 2) — 2026-03-28

### Route dispatch (`server.ts`)
- `handleRoutes` order: OPTIONS → `/dashboard` static → `/api/dashboard/*` → `/api/tokens/*` → `/health` → `/v1/*` (`server.ts:39-125`).
- `createOpenAIOAuthFetchHandler` builds client/provider/models once; passes `createRequestLogger(settings)` into routes (`server.ts:128-160`).
- Dashboard/token responses get `getSecurityHeaders()` merged after handler returns (`server.ts:66-86`).
- Vault paths: `resolveVaultPaths(settings.authFilePath)` — passes through as `authDir`; if CLI gives a file path, vault root may be wrong (plan Task 8 calls this out).

### Dashboard API (`dashboard-api.ts`)
- `handleDashboardApiRequest(request, _logger)` — logger currently unused.
- Stubs: summary zeros + `formatUptime(process.uptime())` (`31-37`); logs `[]` (`40-41`); status `isProxyHealthy()` + `active_token: null` (`44-49`); hourly `[]` (`52-53`).
- `formatUptime` at `12-22` for summary string; status uses raw `process.uptime()` seconds.

### Logging (`logging.ts`)
- `createRequestLogger`: **exclusive** — if `settings.requestLogger` is set, returns it only; no console/SQLite (`6-11`).
- Else `CODEX_OPENAI_SERVER_LOG_REQUESTS === "1"` → console JSON logger (`13-25`).
- `emitRequestLog` try/catch swallows logger throws (`28-35`).
- Event sources: `responses.ts` (`51-157`), `chat-completions.ts` (`72-144`), `chat-stream.ts`.

### Token vault API (`token-vault-api.ts`)
- `handleTokenApiRequest(request, paths)` — POST/DELETE gated by `requireDashboardOrigin` (`109-112`).
- `GET /api/tokens/slots` — no origin gate (`114-118`).
- Switch/rotate use `normalizeOpResult(..., restartRequired=true)` (`121-142`).
- Delete returns `{ success: true }` only (`145-155`).
- `POST /api/tokens/add` accepts `sourcePath` — leaks path in errors via `addTokenToVault` (`158-171`).
- `RedactedSlot` omits `file` (`25-31`); `toRedactedSlotFromToken` fallback can return `slot: 0` (`47-61`).

### Dashboard security (`dashboard-security.ts`)
- Port from `process.env.PORT` only, default 10531 (`3-14`) — **not** `OpenAIOAuthServerOptions.port`.
- Origin: header `origin` else parse `referer` (`16-28`); must match allowlist (`31-36`).
- No explicit `Origin: null` rejection; missing origin+referer → 403 (`38-47`).
- CSP strict: `default-src 'none'` (`50-55`) — may break Vite dashboard static (Task 8).

### Vault ops (`vault-ops.ts`)
- Mutex: `withVaultLock` promise chain (`54-70`); used by `switchToken`/`rotateToken` (`265-364`).
- **Unlocked**: `addTokenToVault` (`366-415`), `deleteTokenSlot` (`417-445`).
- `saveVaultConfig` direct `writeFileSync` (`134-140`); `restoreToActive` `copyFileSync` (`217-235`).
- `resolveVaultPaths(authDir?)`: `authDir ?? CODEX_HOME ?? ~/.codex` (`74-86`).
- `getActiveTokenInfo` includes `file` — must strip before API (`460-471`).
- `isProxyHealthy` hardcodes port `10531` (`447-457`).

### Shared responses / CORS (`shared.ts`)
- `toJsonResponse` / `toErrorResponse` always spread `corsHeaders` (`access-control-allow-origin: *`) (`24-28`, `54-76`).
- **Gotcha**: dashboard/token JSON currently get wildcard CORS via `toJsonResponse`; Task 4/8 need route-specific headers.

### Types (`types.ts`)
- `OpenAIOAuthServerLogEvent` union: `chat_request` (+ `ChatRequestSummary`), `chat_response`, `chat_error` (`90-112`).
- `OpenAIOAuthServerOptions.requestLogger` optional callback (`123-134`).
- DB row mapping: use `requestId` → `request_id`; `durationMs` → `duration_ms`; usage camelCase → snake columns.

### Tests (`packages/openai-oauth/test/`)
- Pattern: `fs.mkdtemp` + write minimal `auth.json` (`server.test.ts:7-24`).
- Handler tests: `createOpenAIOAuthFetchHandler({ models, authFilePath, fetch: vi.fn() })` (`server.test.ts:32+`).
- **No** `dashboard-api`, `token-vault-api`, `vault-ops`, or `db` tests yet; `db.ts` does not exist.

### Frontend contracts (`openai-oauth-dashboard`)
- Types: `SummaryData`, `HourlyStat`, `LogEntry` (`types.ts:9-36`).
- Fetches: `/api/dashboard/summary|hourly|logs` (`UsageTab.tsx:78-80`).
- `TokensTab` status: `proxyUp = r?.ok` not `healthy` field (`TokensTab.tsx:29-32`); expects `restart_required` on switch/rotate (`45-60`).

### Wave 1 implementation anchors
- New `db.ts`: path `<CODEX_HOME|~/.codex>/openai-oauth/usage.sqlite`; prune on init/insert/read.
- Task 4 tests: origin matrix + no `*` CORS on token routes.
- Task 5: extend mutex to delete; atomic write helper for config/auth copies.

### Wave 2 implementation anchors
- `createRequestLogger` must **compose** caller logger + optional console + SQLite (not replace).
- Wire logger in `createOpenAIOAuthFetchHandler`; dashboard handler may need DB access without using `_logger` param.
- `dashboard-api` replace stubs; status uses `getActiveTokenInfo` redacted (no `file`).
- Token API: disable/add 404|501; pass server port into origin validation.

## Bun SQLite (bun:sqlite) Usage - Plan Task 1 Reference

**Source:** https://github.com/oven-sh/bun/blob/main/docs/runtime/sqlite.mdx


### Import
import { Database } from "bun:sqlite";

### Opening a database
// File-based (auto-creates if missing)
const db = new Database("app.db");
// With options
const db2 = new Database("app.db", {
  create: true, readwrite: true, safeIntegers: false, strict: false
});
// In-memory
const mem = new Database(":memory:");

Windows path: use forward slashes "C:/data/app.db" or escaped backslashes.
Always ensure parent directory exists before new Database(path).

### Core query methods
db.query(sql) / db.prepare(sql) -> Statement<T,P> (prepare once, reuse)
db.run(sql, params?) -> { lastInsertRowid, changes } (immediate execute)
statement.all(params?) -> T[] (all rows)
statement.get(params?) -> T | null (first row)
statement.run(params?) -> { lastInsertRowid, changes }
statement.values(params?) -> unknown[][] (raw values)

Prepared statement pattern:
  const stmt = db.query<{ id: number; name: string }, number>(
    "SELECT id, name FROM users WHERE id = ?"
  );
  const user = stmt.get(1);
  const users = stmt.all(1);

Named params: "SELECT * FROM users WHERE id = $id" -> stmt.get({ $id: 1 })

### Transactions
const insertStmt = db.prepare("INSERT INTO cats (name) VALUES ($name)");
const insertCats = db.transaction(cats => {
  for (const cat of cats) insertStmt.run(cat);
  return cats.length;
});
insertCats([{ $name: "Keanu" }, { $name: "Salem" }]);
// Auto BEGIN + COMMIT; ROLLBACK on throw
// Isolation levels: tx.deferred(), tx.immediate(), tx.exclusive()

### Statement lifecycle
const stmt = db.query("SELECT * FROM items");
stmt.columnNames; stmt.columnTypes; stmt.paramsCount;
stmt.finalize(); // destroy statement and free resources

### Closing the DB
db.close(throwOnError = false);
// No auto-close at process exit - always close explicitly in tests

### Testing best practices
- Use :memory: for isolated test instances (no file cleanup)
- If file-based, use unique temp path per test file
- Always close() in afterAll or finally block
- Ensure parent directory exists before constructing Database(path)

### SQLQueryBindings
string | bigint | TypedArray | number | boolean | null |
Record<string, string | bigint | TypedArray | number | boolean | null>
Objects only for named parameters. NO dollar-digit syntax - use ? or $name.

### Caveats
- NO positional-dollar syntax - only ? and $name
- Windows backslash paths: use / or escape backslash
- db.query() and db.prepare() are identical (both cache)
- safeIntegers: true returns BigInt for large ints
- 2026-05-16 Task 1 corrected: packages/openai-oauth/src/db.ts is now the canonical SQLite usage persistence contract with 24-hour pruning and targeted dashboard-db coverage. Existing sqlite-logger.ts remains a later consolidation risk because its schema still drifts from the dashboard persistence contract.

## Task 5 vault mutation safety — 2026-05-16
- `vault-ops.ts` now routes switch, rotate, delete, and add/import through the same in-process `withVaultLock` mutation path.
- Config and active auth copies use same-directory temp files with explicit write, `fsync`, close, rename-over-target, and best-effort temp cleanup on failure.
- Focused `vault-ops` tests use temp CODEX-like vault fixtures and verify concurrent switch/rotate/delete invariants: parseable config JSON, one active token, active auth copies remain JSON, active delete blocked safely, unsafe filenames rejected.
