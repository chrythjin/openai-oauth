param(
	[ValidateSet("menu", "list", "test-login-command")]
	[string]$Action = "menu"
)

$ErrorActionPreference = "Stop"

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$CodexHome = if ($env:CODEX_HOME) { [System.IO.Path]::GetFullPath($env:CODEX_HOME) } else { Join-Path $env:USERPROFILE ".codex" }
$VaultDir = Join-Path $CodexHome "vault"
$ActiveDir = Join-Path $CodexHome "active"
$BackupDir = Join-Path $CodexHome "backups"
$ConfigPath = Join-Path $CodexHome "token-rotator-config.json"
$RotateServiceScript = Join-Path $PSScriptRoot "rotate-service-token.ps1"

function Resolve-NpxCommand {
	$cmd = Get-Command "npx.cmd" -ErrorAction SilentlyContinue
	if ($cmd) {
		return $cmd.Source
	}

	$cmd = Get-Command "npx" -ErrorAction SilentlyContinue
	if ($cmd) {
		return $cmd.Source
	}

	throw "npx was not found on PATH. Install Node.js or add npm/npx to PATH, then try again."
}

function Test-LoginCommand {
	$npxCommand = Resolve-NpxCommand
	Write-Host ("npx command: {0}" -f $npxCommand)
	Write-Host "Testing non-mutating Codex CLI invocation..."
	& $npxCommand --yes "@openai/codex" --version
	if ($LASTEXITCODE -ne 0) {
		throw "Codex CLI test failed with exit code $LASTEXITCODE"
	}
	Write-Host "Codex CLI invocation test passed."
}

function Test-IsWindows {
	return [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)
}

function Stop-ProcessTree([int]$ProcessId) {
	if (Test-IsWindows) {
		& taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
		return
	}

	try {
		$process = [System.Diagnostics.Process]::GetProcessById($ProcessId)
		$process.Kill($true)
	} catch {
		# Process may have exited between keypress and cancellation.
	}
}

function Invoke-CancellableCodexLogin([string]$NpxCommand, [string]$TempDir) {
	$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
	if (Test-IsWindows) {
		$startInfo.FileName = "cmd.exe"
		$startInfo.Arguments = ('/d /s /c ""{0}" --yes "@openai/codex" login"' -f $NpxCommand)
	} else {
		$startInfo.FileName = $NpxCommand
		$startInfo.Arguments = "--yes `"@openai/codex`" login"
	}
	$startInfo.WorkingDirectory = $RepoRoot
	$startInfo.UseShellExecute = $false
	$startInfo.EnvironmentVariables["CODEX_HOME"] = $TempDir

	$process = [System.Diagnostics.Process]::new()
	$process.StartInfo = $startInfo

	Write-Host "Press C here to cancel the Codex login and return to the menu." -ForegroundColor Yellow
	Write-Host "Waiting for Codex login to finish..." -ForegroundColor DarkGray

	if (-not $process.Start()) {
		throw "Failed to start Codex login command."
	}

	try {
		while (-not $process.WaitForExit(250)) {
			if ((-not [Console]::IsInputRedirected) -and [Console]::KeyAvailable) {
				$key = [Console]::ReadKey($true)
				if ($key.Key -eq [ConsoleKey]::C) {
					Stop-ProcessTree $process.Id
					Write-Host "Codex login cancelled." -ForegroundColor Yellow
					return $false
				}
			}
		}

		if ($process.ExitCode -ne 0) {
			throw "codex login failed with exit code $($process.ExitCode)"
		}

		return $true
	} finally {
		$process.Dispose()
	}
}

function Ensure-TokenDirs {
	foreach ($dir in @($VaultDir, $ActiveDir, $BackupDir)) {
		if (-not (Test-Path $dir)) {
			New-Item -ItemType Directory -Path $dir -Force | Out-Null
		}
	}
}

function New-DefaultConfig {
	return [pscustomobject]@{
		current = "auth.json"
		tokens = @(
			[pscustomobject]@{ file = "auth.json"; label = "Account 1"; active = $true },
			[pscustomobject]@{ file = "auth-alt1.json"; label = "Account 2"; active = $false }
		)
	}
}

function Normalize-Config($config) {
	$existing = @()
	foreach ($token in @($config.tokens)) {
		if ($token.file) {
			$existing += [pscustomobject]@{
				file = $token.file
				label = $token.label
				active = [bool]$token.active
			}
		}
	}

	# Only assign a default label when one is missing. Preserve user-defined
	# labels (e.g. the email-based labels created when adding a new vault slot)
	# so they survive a reload.
	for ($i = 0; $i -lt $existing.Count; $i++) {
		if ([string]::IsNullOrWhiteSpace($existing[$i].label)) {
			$existing[$i].label = "Account $($i + 1)"
		}
	}

	if ($existing.Count -gt 0 -and -not ($existing | Where-Object { $_.active })) {
		$existing[0].active = $true
	}

	for ($i = 0; $i -lt $existing.Count; $i++) {
		$existing[$i].active = ($existing[$i].file -eq $config.current)
	}

	if ($existing.Count -gt 0 -and -not ($existing | Where-Object { $_.active })) {
		$existing[0].active = $true
		$config.current = $existing[0].file
	} elseif ($existing.Count -eq 0) {
		$config.current = $null
	}

	if ($existing.Count -gt 0) {
		$config.current = ($existing | Where-Object { $_.active } | Select-Object -First 1).file
	}

	$config.tokens = $existing
	return $config
}

function Load-Config {
	Ensure-TokenDirs
	if (-not (Test-Path $ConfigPath)) {
		$config = Normalize-Config (New-DefaultConfig)
		Save-Config $config
		return $config
	}

	try {
		$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
		return (Normalize-Config $config)
	} catch {
		$config = Normalize-Config (New-DefaultConfig)
		Save-Config $config
		return $config
	}
}

function Save-Config($config) {
	$config = Normalize-Config $config
	$config | ConvertTo-Json -Depth 6 | Set-Content -Path $ConfigPath -Encoding UTF8
}

function Get-TokenClaims([string]$Path) {
	if (-not (Test-Path $Path)) {
		return $null
	}
	$json = Get-Content $Path -Raw | ConvertFrom-Json
	if (-not $json.tokens.id_token) {
		return $null
	}
	$parts = $json.tokens.id_token.Split('.')
	if ($parts.Length -lt 2) {
		return $null
	}
	$payload = $parts[1].Replace('-', '+').Replace('_', '/')
	switch ($payload.Length % 4) {
		2 { $payload += '==' }
		3 { $payload += '=' }
	}
	$decoded = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
	return (ConvertFrom-Json $decoded)
}

function Get-ExpiryParts($claims) {
	if (-not $claims -or -not $claims.exp) {
		return [pscustomobject]@{ Text = "unknown"; State = "unknown"; At = "unknown" }
	}
	$expiresAt = [DateTimeOffset]::FromUnixTimeSeconds([int64]$claims.exp).ToLocalTime()
	$delta = $expiresAt - [DateTimeOffset]::Now
	if ($delta.TotalSeconds -lt 0) {
		$text = "Expired"
		$state = "expired"
	} elseif ($delta.TotalHours -lt 24) {
		$text = ("In {0}h {1}m" -f [math]::Floor($delta.TotalHours), $delta.Minutes)
		$state = "critical"
	} elseif ($delta.TotalDays -lt 3) {
		$text = ("In {0}d {1}h" -f [math]::Floor($delta.TotalDays), $delta.Hours)
		$state = "warning"
	} else {
		$text = ("In {0}d {1}h" -f [math]::Floor($delta.TotalDays), $delta.Hours)
		$state = "healthy"
	}
	return [pscustomobject]@{
		Text = $text
		State = $state
		At = $expiresAt.ToString("yyyy-MM-dd HH:mm")
	}
}

function Get-TokenInfo([string]$FileName) {
	$path = Join-Path $VaultDir $FileName
	$claims = Get-TokenClaims $path
	$expiry = Get-ExpiryParts $claims
	return [pscustomobject]@{
		File = $FileName
		Path = $path
		Exists = (Test-Path $path)
		Email = $(if ($claims -and $claims.email) { $claims.email } else { "unknown" })
		ExpiryText = $expiry.Text
		ExpiryAt = $expiry.At
		ExpiryState = $expiry.State
	}
}

function Get-TokensView {
	$config = Load-Config
	$result = @()
	for ($i = 0; $i -lt $config.tokens.Count; $i++) {
		$token = $config.tokens[$i]
		$info = Get-TokenInfo $token.file
		$result += [pscustomobject]@{
			Index = $i + 1
			Label = $token.label
			File = $token.file
			Active = [bool]$token.active
			Email = $info.Email
			ExpiryText = $info.ExpiryText
			ExpiryAt = $info.ExpiryAt
			ExpiryState = $info.ExpiryState
			Exists = $info.Exists
		}
	}
	return $result
}

function Get-ExpiryColor([string]$State) {
	switch ($State) {
		"expired" { return "Red" }
		"critical" { return "Red" }
		"warning" { return "Yellow" }
		"healthy" { return "Green" }
		default { return "DarkGray" }
	}
}

function Write-Value([string]$Label, [string]$Value, [string]$Color = "White") {
	Write-Host ("  {0,-8}: " -f $Label) -NoNewline -ForegroundColor Gray
	Write-Host $Value -ForegroundColor $Color
}

function Write-ExpiryLine($Token) {
	Write-Host ("  {0,-8}: " -f "Expires") -NoNewline -ForegroundColor Gray
	Write-Host ("{0} ({1})" -f $Token.ExpiryText, $Token.ExpiryAt) -ForegroundColor (Get-ExpiryColor $Token.ExpiryState)
}

function Write-Banner([string]$Title) {
	Write-Host "=======================================================" -ForegroundColor DarkGray
	Write-Host (" {0}" -f $Title) -ForegroundColor Cyan
	Write-Host "=======================================================" -ForegroundColor DarkGray
	Write-Host ""
}

function Show-TokenList {
	Write-Banner "OPENAI OAUTH TOKEN MANAGER"
	foreach ($token in Get-TokensView) {
		$section = if ($token.Active) { "[ ACTIVE SLOT ]" } else { "[ VAULT SLOT ]" }
		Write-Host $section -ForegroundColor White
		Write-Value "Slot" ("{0}. {1}" -f $token.Index, $token.Label) "Cyan"
		Write-Value "File" $token.File "White"
		Write-Value "Email" $token.Email "White"
		Write-ExpiryLine $token
		Write-Host ""
	}
	Write-Host "-------------------------------------------------------" -ForegroundColor DarkGray
	Write-Host ""
}

function Pause-Continue([string]$Message = "Press Enter to continue") {
	[void](Read-Host $Message)
}

function Read-MenuChoice([string]$Prompt) {
	return (Read-Host $Prompt).Trim()
}

function Get-SelectedToken($Prompt, [switch]$AllowCancel) {
	$tokens = Get-TokensView
	if ($tokens.Count -eq 0) {
		Write-Host "No token slots available." -ForegroundColor Yellow
		return $null
	}
	Show-TokenList
	$raw = Read-MenuChoice $Prompt
	if ($AllowCancel -and [string]::IsNullOrWhiteSpace($raw)) {
		return $null
	}
	$index = 0
	if (-not [int]::TryParse($raw, [ref]$index)) {
		Write-Host "Invalid selection." -ForegroundColor Red
		return $null
	}
	return ($tokens | Where-Object { $_.Index -eq $index } | Select-Object -First 1)
}

function Get-NextVaultFileName {
	$config = Load-Config
	$used = @($config.tokens | ForEach-Object { $_.file })
	if ($used -notcontains "auth.json") {
		return "auth.json"
	}
	$index = 1
	while ($true) {
		$candidate = "auth-alt{0}.json" -f $index
		if ($used -notcontains $candidate) {
			return $candidate
		}
		$index++
	}
}

function Prune-Backups([int]$MaxKeep = 10) {
	if (-not (Test-Path $BackupDir)) {
		return
	}
	$files = Get-ChildItem -Path $BackupDir -Filter "*.json" | Sort-Object LastWriteTime
	if ($files.Count -le $MaxKeep) {
		return
	}
	$toDeleteCount = $files.Count - $MaxKeep
	for ($i = 0; $i -lt $toDeleteCount; $i++) {
		Remove-Item $files[$i].FullName -Force -ErrorAction SilentlyContinue
	}
}

function Backup-VaultFile([string]$FileName) {
	$path = Join-Path $VaultDir $FileName
	if (-not (Test-Path $path)) {
		return
	}
	$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
	$backupName = "manual-{0}-{1}" -f $timestamp, $FileName
	Copy-Item $path (Join-Path $BackupDir $backupName) -Force
	Prune-Backups
}

function Invoke-LoginToTemp {
	$tempDir = Join-Path $env:TEMP ("openai-oauth-login-" + [guid]::NewGuid().ToString("N"))
	New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
	$previousCodexHome = $env:CODEX_HOME
	$loginCompleted = $false
	try {
		$env:CODEX_HOME = $tempDir
		Set-Location $RepoRoot
		$npxCommand = Resolve-NpxCommand
		Write-Host ("Opening Codex login with temporary CODEX_HOME: {0}" -f $tempDir) -ForegroundColor DarkGray
		Write-Host ("Running: {0} --yes @openai/codex login" -f $npxCommand) -ForegroundColor DarkGray
		Write-Host "If a browser does not open, run the command above manually from a new terminal and report the output." -ForegroundColor Yellow
		$loginCompleted = Invoke-CancellableCodexLogin $npxCommand $tempDir
		if (-not $loginCompleted) {
			return $null
		}
		$tempAuth = Join-Path $tempDir "auth.json"
		if (-not (Test-Path $tempAuth)) {
			throw "No auth.json produced in temporary CODEX_HOME: $tempDir"
		}
		return $tempAuth
	} finally {
		if (-not $loginCompleted -and (Test-Path $tempDir)) {
			Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
		}
		if ($null -eq $previousCodexHome) {
			Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue
		} else {
			$env:CODEX_HOME = $previousCodexHome
		}
		Set-Location $RepoRoot
	}
}

function Remove-TemporaryAuth([string]$Path) {
	if (-not $Path) {
		return
	}
	$tempDir = Split-Path $Path -Parent
	if ($tempDir -and (Test-Path $tempDir)) {
		Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
	}
}

function Get-ArbitraryTokenInfo([string]$Path) {
	$claims = Get-TokenClaims $Path
	$expiry = Get-ExpiryParts $claims
	return [pscustomobject]@{
		Email = $(if ($claims -and $claims.email) { $claims.email } else { "unknown" })
		ExpiryText = $expiry.Text
		ExpiryAt = $expiry.At
		ExpiryState = $expiry.State
	}
}

function Deploy-IfActive($TokenView) {
	if (-not $TokenView.Active) {
		return
	}
	Write-Host "Active slot was updated. Re-applying it to the live proxy..." -ForegroundColor Yellow
	& $RotateServiceScript -Action switch -Target $TokenView.Index
}

function Get-ActiveTokenView {
	$tokens = Get-TokensView
	return ($tokens | Where-Object { $_.Active } | Select-Object -First 1)
}

function Add-NewTokenFlow {
	Write-Banner "CREATE / IMPORT NEW TOKEN"
	Write-Host "A temporary CODEX_HOME will be used so your live auth.json is not overwritten during login." -ForegroundColor DarkGray
	Write-Host ""
	try {
		$tempAuth = Invoke-LoginToTemp
	} catch {
		Write-Host $_.Exception.Message -ForegroundColor Red
		Pause-Continue
		return
	}
	if (-not $tempAuth) {
		Pause-Continue
		return
	}
	$newInfo = Get-ArbitraryTokenInfo $tempAuth
	Write-Host "[ NEW TOKEN ]" -ForegroundColor White
	Write-Value "Email" $newInfo.Email "Cyan"
	Write-Host ("  {0,-8}: " -f "Expires") -NoNewline -ForegroundColor Gray
	Write-Host ("{0} ({1})" -f $newInfo.ExpiryText, $newInfo.ExpiryAt) -ForegroundColor (Get-ExpiryColor $newInfo.ExpiryState)
	Write-Host ""
	$active = Get-ActiveTokenView
	if (-not $active) {
		throw "No active slot found in token config."
	}
	Write-Host "1. Replace current active token now (recommended)" -ForegroundColor White
	Write-Host "2. Overwrite an existing vault slot" -ForegroundColor White
	Write-Host "3. Add as a new vault slot" -ForegroundColor White
	Write-Host "0. Cancel / discard temporary token" -ForegroundColor White
	$choice = Read-MenuChoice ("Choose action [default: 1]")
	if ([string]::IsNullOrWhiteSpace($choice)) {
		$choice = "1"
	}
	if ($choice -eq "1") {
		Backup-VaultFile $active.File
		Copy-Item $tempAuth (Join-Path $VaultDir $active.File) -Force
		Remove-TemporaryAuth $tempAuth
		Write-Host ("Replaced active slot {0} ({1})" -f $active.Label, $active.File) -ForegroundColor Green
		Deploy-IfActive $active
		Pause-Continue
		return
	}
	if ($choice -eq "2") {
		$target = Get-SelectedToken "Select slot number to overwrite (blank to cancel)" -AllowCancel
		if (-not $target) {
			Remove-TemporaryAuth $tempAuth
			return
		}
		Backup-VaultFile $target.File
		Copy-Item $tempAuth (Join-Path $VaultDir $target.File) -Force
		Remove-TemporaryAuth $tempAuth
		Write-Host ("Overwrote {0} ({1})" -f $target.Label, $target.File) -ForegroundColor Green
		Deploy-IfActive $target
		Pause-Continue
		return
	}
	if ($choice -eq "3") {
		$config = Load-Config
		$newFile = Get-NextVaultFileName
		$newEmail = $newInfo.Email
		if ([string]::IsNullOrWhiteSpace($newEmail) -or $newEmail -eq "unknown") {
			$newEmail = "Account " + ($config.tokens.Count + 1)
		}
		Copy-Item $tempAuth (Join-Path $VaultDir $newFile) -Force
		Remove-TemporaryAuth $tempAuth
		$config.tokens += [pscustomobject]@{ file = $newFile; label = $newEmail; active = $false }
		Save-Config $config
		Write-Host ("Added new slot: {0}" -f $newFile) -ForegroundColor Green
		$useNow = Read-MenuChoice "Switch to this new token now? [y/N]"
		if ($useNow -match '^(?i)y(es)?$') {
			$config = Load-Config
			$index = (@($config.tokens) | ForEach-Object { $_.file }).IndexOf($newFile) + 1
			& $RotateServiceScript -Action switch -Target $index
		}
		Pause-Continue
		return
	}
	Remove-TemporaryAuth $tempAuth
	Write-Host "Cancelled. Temporary token discarded." -ForegroundColor Yellow
	Pause-Continue
}

function Delete-TokenFlow {
	$target = Get-SelectedToken "Select slot number to delete (blank to cancel)" -AllowCancel
	if (-not $target) {
		return
	}
	if ($target.Active) {
		Write-Host "Cannot delete the active slot. Switch to another token first." -ForegroundColor Red
		Pause-Continue
		return
	}
	$confirm = Read-MenuChoice ("Delete {0} ({1}, {2})? [y/N]" -f $target.Label, $target.File, $target.Email)
	if ($confirm -notmatch '^(?i)y(es)?$') {
		Write-Host "Delete cancelled." -ForegroundColor Yellow
		Pause-Continue
		return
	}
	$path = Join-Path $VaultDir $target.File
	if (Test-Path $path) {
		Backup-VaultFile $target.File
		Remove-Item $path -Force
	}
	$config = Load-Config
	$config.tokens = @($config.tokens | Where-Object { $_.file -ne $target.File })
	Save-Config $config
	Write-Host ("Deleted slot {0}" -f $target.File) -ForegroundColor Green
	Pause-Continue
}

function Switch-TokenFlow {
	$target = Get-SelectedToken "Select slot number to switch to (blank to cancel)" -AllowCancel
	if (-not $target) {
		return
	}
	& $RotateServiceScript -Action switch -Target $target.Index
	Pause-Continue
}

function Rotate-NextFlow {
	& $RotateServiceScript -Action rotate
	Pause-Continue
}

function Show-ServiceStatusFlow {
	& $RotateServiceScript -Action status
	Pause-Continue
}

function Start-ServiceFlow {
	try {
		& $RotateServiceScript -Action start
	} catch {
		Write-Host ""
		Write-Host "============================================" -ForegroundColor Yellow
		Write-Host "[Pasted Error]" -ForegroundColor White
		$errMsg = $_.Exception.Message.Trim()
		if ($errMsg -match "already running") {
			Write-Host "서비스 이미 실행 중" -ForegroundColor Yellow
		} elseif ($errMsg -match "not found") {
			Write-Host "서비스 미등록" -ForegroundColor Yellow
		} elseif ($errMsg -match "Administrator") {
			Write-Host "관리자 권한 없음" -ForegroundColor Yellow
		} elseif ($errMsg -match "health check failed") {
			Write-Host "health 응답 없음" -ForegroundColor Yellow
		} else {
			Write-Host $errMsg -ForegroundColor Yellow
		}
		Write-Host "============================================" -ForegroundColor Yellow
		Write-Host ""
	}
	Pause-Continue
}

function Restart-ServiceFlow {
	try {
		& $RotateServiceScript -Action restart
	} catch {
		Write-Host ""
		Write-Host "============================================" -ForegroundColor Yellow
		Write-Host "[Pasted Error]" -ForegroundColor White
		$errMsg = $_.Exception.Message.Trim()
		if ($errMsg -match "already running") {
			Write-Host "서비스 이미 실행 중" -ForegroundColor Yellow
		} elseif ($errMsg -match "not found") {
			Write-Host "서비스 미등록" -ForegroundColor Yellow
		} elseif ($errMsg -match "Administrator") {
			Write-Host "관리자 권한 없음" -ForegroundColor Yellow
		} elseif ($errMsg -match "health check failed") {
			Write-Host "health 응답 없음" -ForegroundColor Yellow
		} else {
			Write-Host $errMsg -ForegroundColor Yellow
		}
		Write-Host "============================================" -ForegroundColor Yellow
		Write-Host ""
	}
	Pause-Continue
}

function Stop-ServiceFlow {
	try {
		& $RotateServiceScript -Action stop
	} catch {
		Write-Host ""
		Write-Host "============================================" -ForegroundColor Yellow
		Write-Host "[Pasted Error]" -ForegroundColor White
		$errMsg = $_.Exception.Message.Trim()
		if ($errMsg -match "not found") {
			Write-Host "서비스 미등록" -ForegroundColor Yellow
		} elseif ($errMsg -match "Administrator") {
			Write-Host "관리자 권한 없음" -ForegroundColor Yellow
		} else {
			Write-Host $errMsg -ForegroundColor Yellow
		}
		Write-Host "============================================" -ForegroundColor Yellow
		Write-Host ""
	}
	Pause-Continue
}

function Show-Menu {
	while ($true) {
		Clear-Host
		Show-TokenList
		Write-Host "1. Show token slots" -ForegroundColor White
		Write-Host "2. Create/import a new token" -ForegroundColor White
		Write-Host "3. Switch active token now" -ForegroundColor White
		Write-Host "4. Rotate to next token now" -ForegroundColor White
		Write-Host "5. Delete a token slot" -ForegroundColor White
		Write-Host "6. Show proxy/server status" -ForegroundColor White
		Write-Host "7. Start proxy/server" -ForegroundColor White
		Write-Host "8. Restart proxy/server" -ForegroundColor White
		Write-Host "9. Stop proxy/server" -ForegroundColor White
		Write-Host "0. Exit" -ForegroundColor White
		Write-Host ""
		$choice = Read-MenuChoice "Select menu"
		switch ($choice) {
			"1" { Clear-Host; Show-TokenList; Pause-Continue }
			"2" { Clear-Host; Add-NewTokenFlow }
			"3" { Clear-Host; Switch-TokenFlow }
			"4" { Clear-Host; Rotate-NextFlow }
			"5" { Clear-Host; Delete-TokenFlow }
			"6" { Clear-Host; Show-ServiceStatusFlow }
			"7" { Clear-Host; Start-ServiceFlow }
			"8" { Clear-Host; Restart-ServiceFlow }
			"9" { Clear-Host; Stop-ServiceFlow }
			"0" { return }
			default {
				Write-Host "Invalid choice." -ForegroundColor Red
				Start-Sleep -Seconds 1
			}
		}
	}
}

Set-Location $RepoRoot

if ($Action -eq "list") {
	Show-TokenList
	exit 0
}

if ($Action -eq "test-login-command") {
	Test-LoginCommand
	exit 0
}

Show-Menu

