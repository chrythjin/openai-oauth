# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-11
**Branch:** main

## OVERVIEW

OpenAI API via OAuth — uses ChatGPT/Codex auth tokens to provide free OpenAI API access. TypeScript monorepo with Bun + Turbo.

## STRUCTURE

```
openai-oauth/
├── packages/
│   ├── openai-oauth/          # CLI + localhost proxy (port 10531)
│   ├── openai-oauth-core/    # Shared: transport, auth, SSE
│   └── openai-oauth-provider/ # Vercel AI SDK provider
├── .codex/                    # Token rotator scripts and launchers
├── docs/                      # OPERATIONS.md has full Windows service guide
├── graphify-out/              # Knowledge graph (rebuild after code changes)
└── turbo.json                 # Build orchestration
```

## PACKAGES

| Package | Entry point | Build output |
|---------|------------|--------------|
| `openai-oauth` | `src/cli.ts`, `src/index.ts` | `dist/cli.js` (ESM) |
| `openai-oauth-core` | `src/index.ts` (src/.d.ts exports) | Type-checked only, no dist |
| `openai-oauth-provider` | `src/index.ts` | `dist/index.js` (ESM) |

## CONVENTIONS

- **Bun** — package manager and runtime. `packageManager: bun@1.2.18`. Do NOT use npm/pnpm/yarn.
- **Biome** for linting/formatting (NOT ESLint/prettier). Indent: tabs, quotes: double, semicolons: as-needed.
- **ES2022** target, NodeNext modules (`"type": "module"`).
- **Build**: `bun run build` — turbo orchestrates all packages. `openai-oauth-core` has no dist; others use tsup.
- **No .d.ts generation** for `@ai-sdk/provider` compatibility (use `--no-dts` in tsup).

## WHERE TO LOOK

| Task | Location |
|------|----------|
| CLI proxy / server | `packages/openai-oauth/src/server.ts`, `src/cli-app.ts`, `src/cli.ts` |
| Auth / token loading | `packages/openai-oauth-core/src/auth.ts` |
| SSE parsing | `packages/openai-oauth-core/src/sse.ts` |
| Transport / OAuth client | `packages/openai-oauth-core/src/transport.ts` |
| Replay state | `packages/openai-oauth-core/src/state.ts` |
| Vercel AI SDK provider | `packages/openai-oauth-provider/src/provider.ts` |
| Token rotator (JS) | `.codex/scripts/token-rotator.js` |
| Windows token menu | `.codex/scripts/token-manager-menu.ps1` |
| Windows service script | `.codex/scripts/rotate-service-token.ps1` |
| Windows launchers | `.codex/launchers/` |

## ANTI-PATTERNS

- **DO NOT run periodic health checks** — consumes API quota.
- **DO NOT commit `*.json` auth files** — token files are gitignored.
- **DO NOT pool/distribute tokens** — violates OpenAI ToS.
- **DO NOT expect hot-reload for tokens** — proxy MUST be restarted after `auth.json` changes.
- **DO NOT use cloud sync paths** for `CODEX_HOME` (OneDrive, iCloud, Dropbox) — causes token vault corruption from concurrent cross-platform writes.

## COMMANDS

```bash
bun run build          # Build all packages (turbo)
bun run dev            # CLI dev mode (packages/openai-oauth/src/cli.ts)
bun run typecheck      # Type check all packages
bun run test           # Run all tests (Vitest)
bun run format-and-lint   # Biome check
bun run format-and-lint:fix  # Biome auto-fix

# E2E tests (requires live Codex token)
LIVE_CODEX_E2E=1 bun run test

# Single test file
bun test packages/openai-oauth-core/test/auth.test.ts

# Token management (macOS/Linux)
bun run token           # Interactive menu
bun run token status
bun run token rotate
bun run token switch 2
bun run token restart
bun run token stop
bun run token start
```

## WINDOWS TOKEN MANAGEMENT

```powershell
# Full interactive menu (supports cancellable Codex login via C key)
.codex\launchers\manage-tokens.bat

# Smoke test: verify npx + Codex CLI without opening OAuth
.codex\launchers\manage-tokens.bat test-login-command

# One-liner commands
.codex\launchers\manage-tokens.bat status
.codex\launchers\manage-tokens.bat start
.codex\launchers\manage-tokens.bat restart
.codex\launchers\manage-tokens.bat stop
.codex\launchers\manage-tokens.bat rotate
.codex\launchers\manage-tokens.bat switch 2

# Current -> Next preview then confirm
.codex\launchers\rotate-next-token.bat

# PowerShell direct
powershell -NoProfile -ExecutionPolicy Bypass -File .codex/scripts/rotate-service-token.ps1 -Action status
powershell -NoProfile -ExecutionPolicy Bypass -File .codex/scripts/rotate-service-token.ps1 -Action rotate
powershell -NoProfile -ExecutionPolicy Bypass -File .codex/scripts/rotate-service-token.ps1 -Action switch -Target 2
```

The menu (option 2) runs `npx @openai/codex login` under a **temporary `CODEX_HOME`** so live `auth.json` is never overwritten. Press **C** during the browser OAuth wait to cancel and return to the menu. Temporary dirs are cleaned up on cancel/discard/success.

## WINDOWS SERVICE

- **Service name:** `OpenAIOAuthProxy` (NSSM)
- **Start/Stop:** `sc.exe start OpenAIOAuthProxy` / `sc.exe stop OpenAIOAuthProxy` (requires admin)
- **Check:** `sc.exe qc OpenAIOAuthProxy`
- **Logs:** `C:\Logs\OpenAIOAuthProxy\stdout.log`, `stderr.log`
- **After token change:** `sc stop` → verify port 10531 free → `sc start` → `curl http://127.0.0.1:10531/health`

Full service details in `docs/OPERATIONS.md`.

## AUTH FILE DISCOVERY

`CODEX_HOME` if set, else `~/.codex`. Both paths contain:
- `auth.json`, `vault/`, `active/`, `backups/`, `token-rotator-config.json`

## ENVIRONMENT VARIABLES

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `10531` | Proxy listen port |
| `CODEX_HOME` | `~/.codex` | Auth root directory |
| `OPENAI_OAUTH_AUTH_DEBUG` | `0` | Set to `1` for verbose token loading/refresh logs |
| `OPENAI_OAUTH_VERBOSE_ERRORS` | `0` | Set to `1` to expose error details to clients |

## graphify

Knowledge graph at `graphify-out/`. After modifying code files, rebuild:

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Read `graphify-out/GRAPH_REPORT.md` for architecture overview before exploring unfamiliar code areas.

## OPERATIONS

See `docs/OPERATIONS.md` for:
- Full Windows service (NSSM) setup and recovery
- Token rotation step-by-step
- Troubleshooting (`401`, `502`, port conflicts, service auto-start failures)
- Environment variable reference