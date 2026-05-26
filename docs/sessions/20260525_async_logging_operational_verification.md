# Async SQLite Request Logging Operational Verification

**Date:** 2026-05-25  
**Repository:** `C:\NEW PRG\openai-oauth`  
**Scope:** Stability-first request-log latency change verification  
**Live service policy:** Did not touch live port `10531`, did not restart `OpenAIOAuthProxy`, and did not send upstream `/v1/*` model requests.

## Summary

The stability-first latency change is verified for the real server surface under an isolated runtime environment.

The implementation moves request-log SQLite writes out of the proxy request hot path and into a bounded asynchronous queue while preserving dashboard log visibility. A temporary operational test confirmed that a real request hitting the modified server produces a queued `chat_error` log, flushes it into SQLite/WAL, and returns it through `GET /api/dashboard/logs`.

## Implementation Record

Changed behavior:

- `packages/openai-oauth/src/logging.ts`
  - Added bounded asynchronous request-log queue.
  - Added batched background flushing.
  - Added lifecycle `flush`/`close` support.
  - Added queue-overflow observability with rate-limited warnings.
- `packages/openai-oauth/src/db.ts`
  - Enabled SQLite WAL mode.
  - Added `PRAGMA busy_timeout = 5000`.
  - Removed request/open-path pruning.
  - Kept pruning isolated to background lifecycle.
- `packages/openai-oauth/src/server.ts`
  - Ensures logger close/flush happens through server lifecycle shutdown.
- `packages/openai-oauth/test/bun-sqlite-mock.ts`
  - Added Vitest-compatible `bun:sqlite` mock support.
- `packages/openai-oauth/vitest.config.ts`
  - Added Vitest aliasing for the SQLite mock.
- `packages/openai-oauth/test/dashboard-db.test.ts`
- `packages/openai-oauth/test/dashboard-logging.test.ts`
  - Updated tests to account for async logging and shared mock behavior.

## Plan Alignment

Verified as satisfied:

- Request hot path no longer performs synchronous SQLite insert/prune work.
- Request logging is queued and flushed asynchronously.
- Queue is bounded to protect process stability.
- SQLite uses WAL and `busy_timeout=5000`.
- Request-log pruning is isolated from request handling and dashboard reads.
- Shutdown path flushes queued logs.
- Live operational service was not disturbed during verification.

Remaining caveat:

- The operational test below proves the single-request logging/read path. It does **not** prove concurrent stress behavior or high-volume lock contention.

## Offline Verification Completed

The following checks were run after implementation and cleanup:

```powershell
bunx vitest run test/dashboard-db.test.ts test/dashboard-logging.test.ts test/server.test.ts test/cli.test.ts
bun run test
bun run typecheck
bunx biome check <changed files>
bun run build
```

Observed results:

- Targeted Vitest suite: `20 passed`.
- Full test suite: `74 passed`, `1 skipped`.
- Typecheck: all 4 packages successful.
- Biome check on changed files: clean.
- Build: all 4 packages successful.

## Operational Verification

Because the live Windows service can use this workspace and the live port/database, the operational test used an isolated runtime:

- Temporary port: `10542` and later recheck on `10543`.
- Temporary `CODEX_HOME`: under `C:\Users\U-N-00~1\AppData\Local\Temp\opencode\...`.
- `auth.json` copied into the temporary `CODEX_HOME` only for isolated startup.
- Temporary runtime was removed after the test.

### Reproduction Shape

1. Start the modified CLI directly with isolated `CODEX_HOME`:

```powershell
$env:CODEX_HOME = "<temp-codex-home>"
bun "C:\NEW PRG\openai-oauth\packages\openai-oauth\src\cli.ts" --port 10543
```

2. Verify server health:

```powershell
curl.exe -s http://127.0.0.1:10543/health
```

Observed:

```json
{"ok":true,"replay_state":"stateless"}
```

3. Confirm logs are initially empty:

```powershell
curl.exe -s http://127.0.0.1:10543/api/dashboard/logs
```

Observed:

```json
[]
```

4. Trigger a deterministic local chat validation error:

```powershell
curl.exe -s -X POST -H "Content-Type: application/json" -d "{}" http://127.0.0.1:10543/v1/chat/completions
```

Observed:

```json
{"error":{"message":"`messages` must be an array.","type":"invalid_request_error"}}
```

5. Wait for the async flush timer, then query dashboard logs:

```powershell
curl.exe -s http://127.0.0.1:10543/api/dashboard/logs
```

Observed:

```json
[
  {
    "id": "8804d277-2b06-4e1d-812f-5dfdbaee209f",
    "timestamp": "2026-05-24T17:51:59.160Z",
    "type": "chat_error",
    "path": "/v1/chat/completions",
    "durationMs": 0,
    "message": "`messages` must be an array.",
    "usage": {
      "inputTokens": 0,
      "outputTokens": 0,
      "totalTokens": 0
    }
  }
]
```

6. Verify isolated SQLite/WAL files were created:

```text
usage.sqlite       4096
usage.sqlite-shm  32768
usage.sqlite-wal  57712
```

7. Cleanup was verified:

```text
cleanup_exists=False
port_10543_listening=False
```

## Important Operational Finding

When the live `OpenAIOAuthProxy` service is running, it can hold locks on:

```text
C:\Users\U-N-00658\.codex\openai-oauth\usage.sqlite
```

A separate process opening the same DB and running `PRAGMA journal_mode = WAL` can fail on Windows with:

```text
SQLiteError: disk I/O error
code: SQLITE_IOERR_DELETE
```

This explained why an earlier non-isolated test server started successfully but returned empty dashboard logs: DB logger initialization was suppressed to protect proxy availability after SQLite open failed.

Future live-style tests should either:

1. Use an isolated temporary `CODEX_HOME`, or
2. Intentionally stop/restart the live service as an explicit operational action.

## Final Judgment

The verified conclusion is:

> In an isolated real server run, async request logging, SQLite/WAL persistence, flush timing, and dashboard log retrieval work correctly for the single-request `chat_error` path.

This is enough to validate the intended request-log persistence behavior without disturbing the live proxy. It is not a substitute for a future concurrency/stress test.
