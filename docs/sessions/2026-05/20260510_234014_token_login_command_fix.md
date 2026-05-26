# Token login command hang fix

## Summary

Investigated the Windows token manager menu freezing before opening a browser when option 2, "Create/import a new token", is selected from `.codex/launchers/manage-tokens.bat`.

## Root cause narrowed

- The user confirmed the failing path is the Windows BAT launcher, not the new cross-platform `bun run token` menu.
- The freeze happens before the browser opens.
- `npx @openai/codex --version` works, so Node/npm/Codex CLI are present.
- The likely pre-browser hang was the PowerShell menu resolving bare `npx` through the PowerShell shim or waiting on an `npx` install confirmation prompt.

## Changes

- Added `Resolve-NpxCommand` in `.codex/scripts/token-manager-menu.ps1`.
  - Prefers `npx.cmd` on Windows.
  - Falls back to bare `npx`.
  - Emits a clear PATH error if no `npx` is available.
- Updated the temporary Codex login flow to run:

  ```powershell
  npx.cmd --yes @openai/codex login
  ```

  instead of bare `npx @openai/codex login`.
- Added visible diagnostics before the login command prints:
  - temporary `CODEX_HOME`
  - exact command being run
  - manual retry guidance if the browser does not open
- Added a non-mutating `test-login-command` action to both:
  - `.codex/scripts/token-manager-menu.ps1`
  - `.codex/launchers/manage-tokens.bat`
- Added a cancellable login wait loop for the Windows PowerShell menu.
  - The Codex login process now runs as a child process instead of a fully synchronous `& npx ...` call.
  - While the browser login is pending, the menu shows `Press C here to cancel the Codex login and return to the menu.`
  - Pressing `C` kills the login process tree and returns to the menu without storing a token.
  - The child-process wrapper is OS-aware: Windows uses `cmd.exe /c` for `npx.cmd`; non-Windows `pwsh` runs `npx` directly and cancels via `.Kill($true)`.
  - Temporary login `CODEX_HOME` directories are removed after cancel, failure, discard, or successful vault copy.

## Verification

- PowerShell parser check for `.codex/scripts/token-manager-menu.ps1`: passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .codex/scripts/token-manager-menu.ps1 -Action test-login-command`: passed.
- `.codex/launchers/manage-tokens.bat test-login-command`: passed.
- `npx.cmd --yes @openai/codex --version`: returned `codex-cli 0.130.0`.
- Interactive menu launched and exited with input `0`.
- The cancellable child-process launch mechanism was verified non-mutating with `npx.cmd --yes @openai/codex --version`.
- The Windows `cmd.exe /c` wrapper was verified non-mutating with `npx.cmd --yes @openai/codex --version`.
- LSP diagnostics could not run because this environment has no `.ps1` language server configured.
- A read-only review agent agreed the patch is a reasonable minimal fix and improves diagnosability for the pre-browser hang.

## Not verified

- Did not run live `npx @openai/codex login` because it opens OAuth and mutates local auth state.
- Browser/OAuth callback success and the live `C` cancellation key are therefore still separate live-path verification steps.
