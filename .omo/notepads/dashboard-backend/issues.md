# Issues

- Task 4 verification: targeted `bun run test -- token-vault-api dashboard-security` passed, but full `bun run test` in `packages/openai-oauth` failed before these tests due `test/dashboard-db.test.ts` importing `bun:sqlite` under the current Vitest runtime (`Cannot find package 'bun:sqlite' imported from src/db.ts`). Token security tests themselves passed.
- Task 4 added regression tests for token API origin/CORS/redaction contracts. These tests required tiny production seams: `dashboard-security.ts` now validates against the request URL port instead of only `process.env.PORT`, and `token-vault-api.ts` strips shared wildcard CORS headers from token API JSON responses. Targeted `bun run test -- token-vault-api dashboard-security` passed afterward.

## Task 5 residual risk — 2026-05-16
- Vault locking is intentionally in-process only; concurrent external scripts or another proxy process can still mutate the same files. Cross-process locking remains out of scope for this MVP.
