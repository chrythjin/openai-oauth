# Session: OpenAIOAuthProxy Service Restart & manage-tokens.bat Auto-Elevation

**Date:** 2026-05-17  
**Issues Fixed:** 2  
**Changed Files:** 1  

---

## 1. Service Start Failure — "Service instance could not be started"

### Symptom
- `.codex\launchers\manage-tokens.bat restart` returned start failure error
- `sc.exe start OpenAIOAuthProxy` failed with `1056: An instance of the service is already running`

### Diagnosis
- `Get-Service OpenAIOAuthProxy` showed **Paused** status
- `stderr.log`: `Failed to start server. Is port 10531 in use?`
- `Get-NetTCPConnection` found PID **17656** (`bun.exe`) already bound to `127.0.0.1:10531`

### Root Cause
A terminal-based `bun run dev` (PID 17656) was still holding port `10531`. The NSSM service could not acquire the port and entered a paused state.

### Resolution
```powershell
sc.exe stop OpenAIOAuthProxy
Start-Sleep -Seconds 3
sc.exe start OpenAIOAuthProxy
```
After bun PID exited naturally, service restarted normally: PID 12012 (`nssm`), health `{"ok":true}`.

---

## 2. manage-tokens.bat PowerShell Execution — Admin Elevation

### Symptom
- `& '...manage-tokens.bat' restart` threw:  
  `Action 'restart' requires an Administrator PowerShell session. Re-run this command from an elevated shell...`
- This blocked workflow when calling `.codex` scripts directly from non-elevated PowerShell.

### Fix
Modified `.codex\scripts\rotate-service-token.ps1` — `Assert-AdminForAction` now auto-requests UAC elevation via `Start-Process ... -Verb RunAs -Wait`, preserving all original parameters (`-Action`, `-Target`, etc.).

### Before
```powershell
function Assert-AdminForAction {
    # threw and exited
}
```

### After
```powershell
function Assert-AdminForAction {
    if (Test-IsAdmin) { return }
    Write-Warning "Action '$RequestedAction' requires administrator privileges. Requesting elevation..."
    Start-Process powershell -ArgumentList <all params> -Verb RunAs -Wait
    exit 0
}
```

### Verification
- `& '...manage-tokens.bat' status` → works without admin (unchanged behavior)
- `& '...manage-tokens.bat' restart` → prints elevation warning, then UAC prompt appears
- After elevation, new admin window executes restart successfully.

### Limitation
Elevated commands display output in a **new administrator PowerShell window** (Windows UAC architectural constraint). Status-only commands remain in the original window.

---

## Files Changed

| File | Change |
|------|--------|
| `.codex/scripts/rotate-service-token.ps1` | `Assert-AdminForAction` now auto-elevates instead of throwing |

## Commands of Note

```powershell
# Check proxy health
curl http://127.0.0.1:10531/health

# Check who is on port 10531
Get-NetTCPConnection -LocalPort 10531 | Select-Object LocalAddress, OwningProcess
Get-Process -Id <OwningProcess>

# Stop/start service cleanly
sc.exe stop OpenAIOAuthProxy
sc.exe start OpenAIOAuthProxy
```

## Remaining Items
- Dashboard UI features for token rotation/switch/restart still in progress per project memory; this fix unblocks the underlying service layer.
