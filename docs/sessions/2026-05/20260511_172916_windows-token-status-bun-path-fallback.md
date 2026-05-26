# Windows token status Bun PATH fallback

## Summary
- Diagnosed menu option 6 (Show proxy/server status) failing with un command not found in PATH.
- Option 6 calls .codex/scripts/rotate-service-token.ps1 -Action status, which runs .codex/scripts/token-rotator.js --status through Bun.
- Updated Get-BunCommand to resolve un.exe from PATH first, then common Windows install locations.

## Verification
- .codex\launchers\manage-tokens.bat status completed and printed token rotator status, service status, and health JSON.
- un run format-and-lint still fails on pre-existing TypeScript lint issues outside this change.
- un run typecheck still fails on pre-existing Node type resolution errors outside this change.
- PowerShell LSP diagnostics are unavailable in this environment for .ps1 files.
