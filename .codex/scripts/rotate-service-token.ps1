param(
	[ValidateSet("rotate", "switch", "status", "stop", "start", "restart", "preview-next")]
	[string]$Action = "rotate",
	[string]$Target = "",
	[string]$ServiceName = "OpenAIOAuthProxy",
	[int]$Port = 10531,
	[string]$HealthUrl = "http://127.0.0.1:10531/health",
	[switch]$NoExit
)

$ErrorActionPreference = "Stop"

function Test-IsAdmin {
	$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
	$principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
	return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-AdminForAction {
	param([string]$RequestedAction)

	if (Test-IsAdmin) {
		return
	}

	Write-Warning "Action '$RequestedAction' requires administrator privileges. Requesting elevation..."

	$argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
	if ($Action) { $argList += "-Action"; $argList += $Action }
	if ($Target) { $argList += "-Target"; $argList += $Target }
	if ($ServiceName -ne "OpenAIOAuthProxy") { $argList += "-ServiceName"; $argList += $ServiceName }
	if ($Port -ne 10531) { $argList += "-Port"; $argList += $Port }
	if ($HealthUrl -ne "http://127.0.0.1:10531/health") { $argList += "-HealthUrl"; $argList += $HealthUrl }
	if ($NoExit) { $argList += "-NoExit" }

	# Elevate and wait so the caller sees the outcome in the new admin window.
	Start-Process powershell -ArgumentList $argList -Verb RunAs -Wait
	exit 0
}

function Get-RepoRoot {
	return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
}

function Get-CodexHome {
	if ($env:CODEX_HOME) {
		return [System.IO.Path]::GetFullPath($env:CODEX_HOME)
	}
	return (Join-Path $HOME ".codex")
}

function Get-RotatorPath {
	return Join-Path $PSScriptRoot "token-rotator.js"
}

function Get-BunCommand {
	$command = Get-Command "bun.exe" -ErrorAction SilentlyContinue
	if ($command) {
		return $command.Source
	}

	$command = Get-Command "bun" -ErrorAction SilentlyContinue
	if ($command) {
		return $command.Source
	}

	$candidates = @()
	if ($env:USERPROFILE) {
		$candidates += Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
	}
	if ($env:LOCALAPPDATA) {
		$candidates += Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe\bun.exe"
	}
	$candidates += "C:\Program Files\Bun\bin\bun.exe"

	foreach ($candidate in $candidates) {
		if ($candidate -and (Test-Path -LiteralPath $candidate)) {
			return $candidate
		}
	}

	throw "bun command not found. Install Bun or add bun.exe to PATH, then try again. Checked PATH and common Windows install locations."
}

function Invoke-Rotator {
	param(
		[string[]]$Arguments
	)

	$repoRoot = Get-RepoRoot
	$bun = Get-BunCommand
	$rotator = Get-RotatorPath
	& $bun $rotator @Arguments
	if ($LASTEXITCODE -ne 0) {
		throw "token-rotator failed with exit code $LASTEXITCODE"
	}

	Set-Location $repoRoot
}

function Get-PortProcessIds {
	param([int]$PortNumber)

	$connections = Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction SilentlyContinue
	if (-not $connections) {
		return @()
	}

	return @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Get-AuthSnapshot {
	$authPath = Join-Path (Get-CodexHome) "auth.json"
	if (-not (Test-Path $authPath)) {
		return $null
	}

	try {
		$json = Get-Content $authPath -Raw | ConvertFrom-Json
		$idToken = $json.tokens.id_token
		$accountId = $json.tokens.account_id
		$email = "unknown"
		if ($idToken) {
			$parts = $idToken.Split('.')
			if ($parts.Length -ge 2) {
				$payload = $parts[1].Replace('-', '+').Replace('_', '/')
				switch ($payload.Length % 4) {
					2 { $payload += '==' }
					3 { $payload += '=' }
				}
				$decoded = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
				$claims = ConvertFrom-Json $decoded
				if ($claims.email) {
					$email = $claims.email
				}
			}
		}

		return [pscustomobject]@{
			Path = $authPath
			AccountId = $accountId
			Email = $email
			LastRefresh = $json.last_refresh
		}
	} catch {
		return $null
	}
}

function Write-RuntimeSnapshot {
	param(
		[int]$PortNumber,
		[string]$ServiceName
	)

	$listenerPids = Get-PortProcessIds -PortNumber $PortNumber
	$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
	$auth = Get-AuthSnapshot

	Write-Host "[rotator] runtime snapshot" -ForegroundColor Cyan
	Write-Host "  service : $($service.Status)"
	Write-Host "  port    : $PortNumber"
	Write-Host "  pids    : $($listenerPids -join ', ')"
	if ($auth) {
		Write-Host "  email   : $($auth.Email)"
		Write-Host "  account : $($auth.AccountId)"
		Write-Host "  refresh : $($auth.LastRefresh)"
	}
}

function Stop-LingeringPortProcess {
	param([int]$PortNumber)

	foreach ($processId in Get-PortProcessIds -PortNumber $PortNumber) {
		try {
			Stop-Process -Id $processId -Force -ErrorAction Stop
			Write-Host "[rotator] killed lingering PID $processId on port $PortNumber"
		} catch {
			Write-Warning "[rotator] failed to kill PID ${processId} on port ${PortNumber}: $($_.Exception.Message)"
		}
	}
}

function Wait-ServiceStatus {
	param(
		[string]$Name,
		[string]$DesiredStatus,
		[int]$TimeoutSeconds = 20
	)

	$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
	$warned = $false
	while ((Get-Date) -lt $deadline) {
		$service = Get-Service -Name $Name -ErrorAction SilentlyContinue
		if (-not $service) {
			throw "service '$Name' not found"
		}

		if ($service.Status.ToString() -eq $DesiredStatus) {
			return
		}

		if (-not $warned) {
			Write-Warning "waiting for service '$Name' to reach state '$DesiredStatus' (up to ${TimeoutSeconds}s)..."
			$warned = $true
		}
		Start-Sleep -Milliseconds 500
	}

	$service = Get-Service -Name $Name -ErrorAction SilentlyContinue
	$current = if ($service) { $service.Status } else { "missing" }
	throw "service '$Name' did not reach state '$DesiredStatus' (current: $current)"
}

function Stop-ProxyService {
	param(
		[string]$Name,
		[int]$PortNumber
	)

	# 1. Force-kill ANY process on the port FIRST (including orphans from previous runs)
	# This handles the case where service is already "Stopped" but node.exe is still listening
	Write-Host "[rotator] ensuring port $PortNumber is free..."
	$initialPids = Get-PortProcessIds -PortNumber $PortNumber
	if ($initialPids.Count -gt 0) {
		Write-Host "[rotator] found lingering PIDs $($initialPids -join ', ') on port $PortNumber"
		Stop-LingeringPortProcess -PortNumber $PortNumber
		Start-Sleep -Milliseconds 800
		# Verify port is free; if not, kill again harder
		if ((Get-PortProcessIds -PortNumber $PortNumber).Count -gt 0) {
			Write-Host "[rotator] port not clear, force-killing again..."
			Stop-LingeringPortProcess -PortNumber $PortNumber
			Start-Sleep -Milliseconds 800
		}
	}

	# 2. Now stop the Windows service (if running)
	$service = Get-Service -Name $Name -ErrorAction SilentlyContinue
	if ($service) {
		if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
			Write-Host "[rotator] stopping service $Name..."
			Stop-Service -Name $Name -ErrorAction SilentlyContinue
			try {
				Wait-ServiceStatus -Name $Name -DesiredStatus "Stopped" -TimeoutSeconds 15
			} catch {
				Write-Warning "[rotator] service stop timed out (service may still be stopping in background)"
			}
		}

		# 3. Service stop does NOT kill orphaned node.exe children on Windows
		# After service stop, check again - orphaned child may remain
		Start-Sleep -Milliseconds 500
		$orphanedPids = Get-PortProcessIds -PortNumber $PortNumber
		if ($orphanedPids.Count -gt 0) {
			Write-Host "[rotator] service stopped but PIDs $($orphanedPids -join ', ') still listening"
			Stop-LingeringPortProcess -PortNumber $PortNumber
			Start-Sleep -Milliseconds 800
		}
	}

	# 4. Final verification
	if ((Get-PortProcessIds -PortNumber $PortNumber).Count -gt 0) {
		throw "port $PortNumber still occupied after full cleanup"
	}
	Write-Host "[rotator] port $PortNumber is free"
}

function Wait-ForHealth {
	param(
		[string]$Url,
		[int]$TimeoutSeconds = 20
	)

	$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
	while ((Get-Date) -lt $deadline) {
		try {
			$response = Invoke-RestMethod -Uri $Url -TimeoutSec 2
			if ($response.ok -eq $true) {
				return
			}
		} catch {}

		Start-Sleep -Milliseconds 500
	}

	throw "health check failed for $Url"
}

function Start-ProxyService {
	param(
		[string]$Name,
		[string]$Url,
		[int]$PortNumber
	)

	Write-Host "[rotator] starting service $Name"
	Start-Service -Name $Name
	Wait-ServiceStatus -Name $Name -DesiredStatus "Running" -TimeoutSeconds 20
	Wait-ForHealth -Url $Url -TimeoutSeconds 20

	# Verify the new auth.json account is different from before
	Write-Host "[rotator] verifying new token is active..."
	$newAuth = Get-AuthSnapshot
	if ($newAuth) {
		Write-Host "[rotator] active account after restart:" -ForegroundColor Cyan
		Write-Host "  email   : $($newAuth.Email)"
		Write-Host "  account : $($newAuth.AccountId)"
		Write-Host "  refresh : $($newAuth.LastRefresh)"
	} else {
		Write-Warning "[rotator] could not read auth snapshot"
	}
}

function Get-CodexConfig {
	$configPath = Join-Path (Get-CodexHome) "config.toml"
	if (-not (Test-Path $configPath)) {
		return $null
	}
	try {
		$content = Get-Content $configPath -Raw
		if ($content -match 'cli_auth_credentials_store\s*=\s*"([^"]+)"') {
			return $Matches[1]
		}
		return $null
	} catch {
		return $null
	}
}

function Get-RotatorConfigPath {
	return Join-Path (Get-CodexHome) "token-rotator-config.json"
}

function Load-RotatorConfig {
	$configPath = Get-RotatorConfigPath
	if (-not (Test-Path $configPath)) {
		throw "rotator config not found: $configPath"
	}
	return (Get-Content $configPath -Raw | ConvertFrom-Json)
}

function Get-VaultDir {
	return Join-Path (Get-CodexHome) "vault"
}

function Get-TokenInfoFromVault([string]$FileName) {
	$path = Join-Path (Get-VaultDir) $FileName
	if (-not (Test-Path $path)) {
		return [pscustomobject]@{
			Exists = $false
			Email = "missing"
			ExpiresIn = "missing"
			ExpiresAt = "missing"
			ExpiryState = "missing"
		}
	}
	try {
		$json = Get-Content $path -Raw | ConvertFrom-Json
		$parts = $json.tokens.id_token.Split('.')
		if ($parts.Length -lt 2) {
			return [pscustomobject]@{ Exists = $true; Email = "unknown"; ExpiresIn = "unknown"; ExpiresAt = "unknown"; ExpiryState = "unknown" }
		}
		$payload = $parts[1].Replace('-', '+').Replace('_', '/')
		switch ($payload.Length % 4) {
			2 { $payload += '==' }
			3 { $payload += '=' }
		}
		$decoded = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
		$claims = ConvertFrom-Json $decoded
		$email = if ($claims.email) { $claims.email } else { 'unknown' }
		if ($claims.exp) {
			$expiresAt = [DateTimeOffset]::FromUnixTimeSeconds([int64]$claims.exp).ToLocalTime()
			$delta = $expiresAt - [DateTimeOffset]::Now
			if ($delta.TotalSeconds -lt 0) {
				$expiresIn = 'Expired'; $expiryState = 'expired'
			} elseif ($delta.TotalHours -lt 24) {
				$expiresIn = ('In {0}h {1}m' -f [math]::Floor($delta.TotalHours), $delta.Minutes); $expiryState = 'critical'
			} elseif ($delta.TotalDays -lt 3) {
				$expiresIn = ('In {0}d {1}h' -f [math]::Floor($delta.TotalDays), $delta.Hours); $expiryState = 'warning'
			} else {
				$expiresIn = ('In {0}d {1}h' -f [math]::Floor($delta.TotalDays), $delta.Hours); $expiryState = 'healthy'
			}
			$expiresAtText = $expiresAt.ToString('yyyy-MM-dd HH:mm')
		} else {
			$expiresAtText = 'unknown'; $expiresIn = 'unknown'; $expiryState = 'unknown'
		}
		return [pscustomobject]@{ Exists = $true; Email = $email; ExpiresIn = $expiresIn; ExpiresAt = $expiresAtText; ExpiryState = $expiryState }
	} catch {
		return [pscustomobject]@{ Exists = $true; Email = "invalid"; ExpiresIn = "invalid"; ExpiresAt = "invalid"; ExpiryState = "invalid" }
	}
}

function Get-NextAvailableTokenPair {
	$config = Load-RotatorConfig
	$tokens = @($config.tokens)
	$currentIdx = -1
	for ($i = 0; $i -lt $tokens.Count; $i++) {
		if ($tokens[$i].file -eq $config.current) {
			$currentIdx = $i
			break
		}
	}
	if ($currentIdx -lt 0) {
		for ($i = 0; $i -lt $tokens.Count; $i++) {
			if ([bool]$tokens[$i].active) {
				$currentIdx = $i
				break
			}
		}
		if ($currentIdx -lt 0) { $currentIdx = 0 }
	}
	$nextIdx = $currentIdx
	$attempts = 0
	while ($attempts -lt $tokens.Count) {
		$nextIdx = ($nextIdx + 1) % $tokens.Count
		$nextFile = $tokens[$nextIdx].file
		if ((Test-Path (Join-Path (Get-VaultDir) $nextFile))) {
			break
		}
		$attempts++
	}
	if ($attempts -ge $tokens.Count) {
		throw "No available next token found in vault"
	}
	return [pscustomobject]@{ Current = $tokens[$currentIdx]; Next = $tokens[$nextIdx] }
}

function Write-PreviewValue([string]$Label, [string]$Value, [string]$Color = "White") {
	Write-Host ("  {0,-8}: " -f $Label) -NoNewline -ForegroundColor Gray
	Write-Host $Value -ForegroundColor $Color
}

function Write-PreviewExpiry($Info) {
	$color = switch ($Info.ExpiryState) {
		'expired' { 'Red' }
		'critical' { 'Red' }
		'warning' { 'Yellow' }
		'healthy' { 'Green' }
		'missing' { 'DarkGray' }
		'invalid' { 'Magenta' }
		default { 'White' }
	}
	Write-Host ("  {0,-8}: " -f 'Expires') -NoNewline -ForegroundColor Gray
	Write-Host ("{0} ({1})" -f $Info.ExpiresIn, $Info.ExpiresAt) -ForegroundColor $color
}

function Show-NextRotationPreview {
	$pair = Get-NextAvailableTokenPair
	$currentInfo = Get-TokenInfoFromVault $pair.Current.file
	$nextInfo = Get-TokenInfoFromVault $pair.Next.file

	Write-Host "=======================================================" -ForegroundColor DarkGray
	Write-Host " OPENAI OAUTH TOKEN ROTATOR" -ForegroundColor Cyan
	Write-Host "=======================================================" -ForegroundColor DarkGray
	Write-Host ""
	Write-Host "[ CURRENT ACCOUNT ]" -ForegroundColor White
	Write-PreviewValue "Account" $pair.Current.label "Yellow"
	Write-PreviewValue "File" $pair.Current.file "White"
	Write-PreviewValue "Email" $currentInfo.Email "White"
	Write-PreviewExpiry $currentInfo
	Write-Host ""
	Write-Host "   |" -ForegroundColor Gray
	Write-Host "   V" -ForegroundColor Gray
	Write-Host ""
	Write-Host "[ NEXT IN QUEUE ]" -ForegroundColor White
	Write-PreviewValue "Account" $pair.Next.label "Cyan"
	Write-PreviewValue "File" $pair.Next.file "White"
	Write-PreviewValue "Email" $nextInfo.Email "White"
	Write-PreviewExpiry $nextInfo
	Write-Host ""
	Write-Host "-------------------------------------------------------" -ForegroundColor DarkGray
}

if ($Action -ne "status" -and $Action -ne "preview-next") {
	Assert-AdminForAction -RequestedAction $Action
}

switch ($Action) {
	"status" {
		$codexStore = Get-CodexConfig
		Write-Host "[rotator] === Token Rotation Status ===" -ForegroundColor Cyan
		if ($codexStore) {
			Write-Host "[rotator] Codex auth store : $codexStore"
			if ($codexStore -ne "file") {
				Write-Warning "[rotator] WARNING: Codex is using '$codexStore' mode."
				Write-Warning "[rotator] auth.json changes may be IGNORED if keyring has valid tokens."
				Write-Warning "[rotator] Set 'cli_auth_credentials_store = `"file`"' in $(Join-Path (Get-CodexHome) "config.toml")"
				Write-Host ""
			}
		} else {
			Write-Host "[rotator] Codex auth store : not explicitly set (defaults to 'auto' = keyring)"
			Write-Warning "[rotator] Codex may read from OS keyring, not auth.json"
			Write-Warning "[rotator] Set 'cli_auth_credentials_store = `"file`"' in $(Join-Path (Get-CodexHome) "config.toml")"
			Write-Host ""
		}
		Invoke-Rotator -Arguments @("--status")
		$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
		if ($service) {
			Write-Host "[rotator] service status: $($service.Status)"
		}
		try {
			$response = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
			Write-Host "[rotator] health: $($response | ConvertTo-Json -Compress)"
		} catch {
			Write-Warning "[rotator] health check unavailable"
		}
		exit 0
	}
	"rotate" {
		Stop-ProxyService -Name $ServiceName -PortNumber $Port
		Invoke-Rotator -Arguments @("--rotate", "--no-restart")
		Start-ProxyService -Name $ServiceName -Url $HealthUrl -PortNumber $Port
		Write-Host "[rotator] rotation complete"
		exit 0
	}
	"switch" {
		if (-not $Target) {
			throw "switch action requires -Target <account>"
		}
		# Normalize ALT token references to numeric indices
		if ($Target -match '^ALT\s*(\d+)$') {
			$Target = [int]$matches[1] + 1
		}

		Stop-ProxyService -Name $ServiceName -PortNumber $Port
		Invoke-Rotator -Arguments @("--use", $Target, "--no-restart")
		Start-ProxyService -Name $ServiceName -Url $HealthUrl -PortNumber $Port
		Write-Host "[rotator] switch complete"
		exit 0
	}
	"stop" {
		Stop-ProxyService -Name $ServiceName -PortNumber $Port
		Write-Host "[rotator] stop complete"
		exit 0
	}
	"start" {
		Start-ProxyService -Name $ServiceName -Url $HealthUrl -PortNumber $Port
		Write-Host "[rotator] start complete"
		exit 0
	}
	"restart" {
		Stop-ProxyService -Name $ServiceName -PortNumber $Port
		Start-ProxyService -Name $ServiceName -Url $HealthUrl -PortNumber $Port
		Write-Host "[rotator] restart complete"
		exit 0
	}
	"preview-next" {
		Show-NextRotationPreview
		exit 0
	}
}
