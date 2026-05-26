param(
	[ValidateSet("menu", "tokens", "list", "new", "stop", "restart", "change-token", "env", "health", "cleanup", "help")]
	[string]$Action = "menu",
	[string]$SessionId,
	[string]$Token,
	[int]$Port = 0,
	[string]$Label,
	[switch]$DevMode,
	[switch]$Force
)

$ErrorActionPreference = "Stop"

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$SourceCodexHome = if ($env:CODEX_HOME) { [System.IO.Path]::GetFullPath($env:CODEX_HOME) } else { Join-Path $env:USERPROFILE ".codex" }
$VaultDir = Join-Path $SourceCodexHome "vault"
$ConfigPath = Join-Path $SourceCodexHome "token-rotator-config.json"
$ManagerRoot = Join-Path $SourceCodexHome "openai-oauth-proxies"
$SessionsRoot = Join-Path $ManagerRoot "sessions"
$StatePath = Join-Path $ManagerRoot "proxy-sessions.json"
$LockPath = Join-Path $ManagerRoot "proxy-sessions.lock"
$DefaultHost = "127.0.0.1"
$DefaultStartPort = 10532
$ProtectedPort = if ($env:PORT -and $env:PORT -match '^\d+$') { [int]$env:PORT } else { 10531 }
$HealthTimeoutSeconds = 3

function Write-Info([string]$Message) {
	Write-Host $Message -ForegroundColor Cyan
}

function Write-Warn([string]$Message) {
	Write-Host $Message -ForegroundColor Yellow
}

function Write-Fail([string]$Message) {
	Write-Host $Message -ForegroundColor Red
}

function Use-ManagerLock([scriptblock]$Body) {
	Ensure-ManagerDirs
	$stream = $null
	try {
		$stream = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
		return & $Body
	} catch [System.IO.IOException] {
		throw "Another session proxy manager is already running. Retry after it exits."
	} finally {
		if ($stream) {
			$stream.Dispose()
		}
	}
}

function Assert-SafeTokenFilename([string]$FileName) {
	if ([string]::IsNullOrWhiteSpace($FileName) -or $FileName -notmatch '^auth(?:-alt\d+)?\.json$') {
		throw "Unsafe token filename in config: $FileName"
	}
}

function Ensure-ManagerDirs {
	foreach ($dir in @($ManagerRoot, $SessionsRoot)) {
		if (-not (Test-Path -LiteralPath $dir)) {
			New-Item -ItemType Directory -Path $dir -Force | Out-Null
		}
	}
}

function New-EmptyState {
	return [pscustomobject]@{
		version = 1
		nextPort = $DefaultStartPort
		sessions = @()
	}
}

function Read-State {
	Ensure-ManagerDirs
	if (-not (Test-Path -LiteralPath $StatePath)) {
		return (New-EmptyState)
	}

	try {
		$state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
		if (-not $state.sessions) {
			$state | Add-Member -NotePropertyName sessions -NotePropertyValue @() -Force
		}
		if (-not $state.nextPort) {
			$state | Add-Member -NotePropertyName nextPort -NotePropertyValue $DefaultStartPort -Force
		}
		return $state
	} catch {
		$backup = "$StatePath.broken-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
		Move-Item -LiteralPath $StatePath -Destination $backup -Force
		Write-Warn "State file was invalid and was moved to: $backup"
		return (New-EmptyState)
	}
}

function Write-State($State) {
	Ensure-ManagerDirs
	$tmp = "$StatePath.tmp"
	$State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $tmp -Encoding UTF8
	Move-Item -LiteralPath $tmp -Destination $StatePath -Force
}

function Read-TokenConfig {
	if (-not (Test-Path -LiteralPath $ConfigPath)) {
		throw "Token rotator config not found: $ConfigPath. Run .codex\launchers\manage-tokens.bat first."
	}

	$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
	foreach ($token in @($config.tokens)) {
		Assert-SafeTokenFilename $token.file
	}
	return $config
}

function Get-TokenEntries {
	$config = Read-TokenConfig
	$entries = @()
	$index = 1
	foreach ($token in @($config.tokens)) {
		$vaultPath = Join-Path $VaultDir $token.file
		$entries += [pscustomobject]@{
			Index = $index
			File = [string]$token.file
			Label = if ($token.label) { [string]$token.label } else { "Account $index" }
			Active = [bool]$token.active
			Exists = Test-Path -LiteralPath $vaultPath
			Path = $vaultPath
		}
		$index++
	}
	return $entries
}

function Resolve-TokenEntry([string]$Selector) {
	$tokens = Get-TokenEntries
	if (-not $Selector) {
		$entry = $tokens | Where-Object { $_.Exists } | Select-Object -First 1
		if (-not $entry) {
			throw "No token files exist in vault: $VaultDir"
		}
		return $entry
	}

	$entry = $null
	if ($Selector -match '^\d+$') {
		$entry = $tokens | Where-Object { $_.Index -eq [int]$Selector } | Select-Object -First 1
	} else {
		Assert-SafeTokenFilename $Selector
		$entry = $tokens | Where-Object { $_.File -eq $Selector } | Select-Object -First 1
	}

	if (-not $entry) {
		throw "Token not found: $Selector"
	}
	if (-not $entry.Exists) {
		throw "Token file does not exist in vault: $($entry.Path)"
	}
	return $entry
}

function Show-Tokens {
	Write-Host "Token source: $SourceCodexHome"
	Write-Host "Vault: $VaultDir"
	Write-Host ""
	foreach ($token in Get-TokenEntries) {
		$status = if ($token.Exists) { "present" } else { "missing" }
		$active = if ($token.Active) { " active" } else { "" }
		Write-Host ("[{0}] {1} ({2}) - {3}{4}" -f $token.Index, $token.Label, $token.File, $status, $active)
	}
}

function Test-ProcessAlive([int]$ProcessId) {
	if ($ProcessId -le 0) {
		return $false
	}
	try {
		Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
		return $true
	} catch {
		return $false
	}
}

function Test-SessionProcessIdentity($Session) {
	$pid = [int]$Session.pid
	if ($pid -le 0) {
		return $false
	}
	try {
		$process = Get-CimInstance Win32_Process -Filter "ProcessId = $pid" -ErrorAction Stop
		if (-not $process) {
			return $false
		}
		$commandLine = [string]$process.CommandLine
		return $commandLine.Contains([string]$Session.authFile) -or $commandLine.Contains([string]$Session.codexHome)
	} catch {
		return $false
	}
}

function Assert-SessionProcessIdentity($Session) {
	if (-not (Test-SessionProcessIdentity $Session)) {
		$Session.status = "stale"
		$Session.updatedAt = [DateTimeOffset]::Now.ToString("o")
		throw "Refusing to stop pid $($Session.pid) because it no longer matches this session proxy. Marked stale."
	}
}

function Test-PortOpen([int]$TargetPort) {
	$client = [System.Net.Sockets.TcpClient]::new()
	try {
		$result = $client.BeginConnect($DefaultHost, $TargetPort, $null, $null)
		$success = $result.AsyncWaitHandle.WaitOne(500)
		if (-not $success) {
			return $false
		}
		$client.EndConnect($result)
		return $true
	} catch {
		return $false
	} finally {
		$client.Close()
	}
}

function Test-Health([int]$TargetPort) {
	try {
		$response = Invoke-RestMethod -Uri "http://$DefaultHost`:$TargetPort/health" -TimeoutSec $HealthTimeoutSeconds
		return [bool]$response.ok
	} catch {
		return $false
	}
}

function Get-SessionById($State, [string]$Id) {
	if (-not $Id) {
		throw "Missing -SessionId."
	}
	$session = @($State.sessions) | Where-Object { $_.id -eq $Id } | Select-Object -First 1
	if (-not $session) {
		throw "Session proxy not found: $Id"
	}
	return $session
}

function Update-SessionStatus($Session) {
	$pidAlive = Test-ProcessAlive ([int]$Session.pid)
	$portOpen = Test-PortOpen ([int]$Session.port)
	$healthy = if ($portOpen) { Test-Health ([int]$Session.port) } else { $false }
	$Session.status = if ($healthy) { "running" } elseif ($pidAlive -or $portOpen) { "unhealthy" } else { "stopped" }
	$Session.updatedAt = [DateTimeOffset]::Now.ToString("o")
	return $Session
}

function Show-Sessions {
	$state = Read-State
	if (@($state.sessions).Count -eq 0) {
		Write-Host "No session proxies are recorded."
		return
	}

	foreach ($session in @($state.sessions)) {
		Update-SessionStatus $session | Out-Null
		Write-Host ("{0} [{1}] port={2} pid={3} token={4} label={5}" -f $session.id, $session.status, $session.port, $session.pid, $session.tokenFile, $session.label)
		Write-Host ("  {0}" -f $session.baseUrl)
	}
}

function New-SessionId {
	return "oc-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([Guid]::NewGuid().ToString('N').Substring(0, 6))"
}

function Get-UsedPorts($State) {
	return @($State.sessions | Where-Object { $_.status -ne "stopped" } | ForEach-Object { [int]$_.port })
}

function Find-FreePort($State, [int]$PreferredPort) {
	if ($PreferredPort -gt 0) {
		if ($PreferredPort -eq $ProtectedPort) {
			throw "Port $PreferredPort is reserved for the primary proxy; use $DefaultStartPort or higher."
		}
		if ($PreferredPort -lt $DefaultStartPort) {
			throw "Port $PreferredPort is reserved; use $DefaultStartPort or higher."
		}
		if (Test-PortOpen $PreferredPort) {
			throw "Port is already in use: $PreferredPort"
		}
		return $PreferredPort
	}

	$port = [Math]::Max([int]$State.nextPort, $DefaultStartPort)
	$used = Get-UsedPorts $State
	while ($true) {
		if ($port -ne $ProtectedPort -and -not ($used -contains $port) -and -not (Test-PortOpen $port)) {
			return $port
		}
		$port++
		if ($port -gt 10999) {
			throw "No free proxy port found in 10532-10999."
		}
	}
}

function Resolve-ProxyCommand([bool]$UseDevMode) {
	if ($UseDevMode) {
		$bun = Get-Command "bun" -ErrorAction SilentlyContinue
		if (-not $bun) {
			throw "bun was not found on PATH."
		}
		$cliTs = Join-Path $RepoRoot "packages\openai-oauth\src\cli.ts"
		if (-not (Test-Path -LiteralPath $cliTs)) {
			throw "Source CLI not found: $cliTs"
		}
		return [pscustomobject]@{ FileName = $bun.Source; PrefixArgs = @($cliTs) }
	}

	$distCli = Join-Path $RepoRoot "packages\openai-oauth\dist\cli.js"
	if (-not (Test-Path -LiteralPath $distCli)) {
		throw "Built CLI not found: $distCli. Run bun run build or retry with -DevMode."
	}
	$node = Get-Command "node" -ErrorAction SilentlyContinue
	if (-not $node) {
		throw "node was not found on PATH."
	}
	return [pscustomobject]@{ FileName = $node.Source; PrefixArgs = @($distCli) }
}

function Copy-TokenToSession([object]$TokenEntry, [string]$SessionCodexHome, [string]$DestinationName = "auth.json") {
	if (-not (Test-Path -LiteralPath $SessionCodexHome)) {
		New-Item -ItemType Directory -Path $SessionCodexHome -Force | Out-Null
	}
	$target = Join-Path $SessionCodexHome $DestinationName
	$temp = Join-Path $SessionCodexHome ("{0}.tmp-{1}" -f $DestinationName, [Guid]::NewGuid().ToString("N"))
	for ($attempt = 1; $attempt -le 3; $attempt++) {
		$before = Get-Item -LiteralPath $TokenEntry.Path
		Copy-Item -LiteralPath $TokenEntry.Path -Destination $temp -Force
		Get-Content -LiteralPath $temp -Raw | ConvertFrom-Json | Out-Null
		$after = Get-Item -LiteralPath $TokenEntry.Path
		if ($before.LastWriteTimeUtc -eq $after.LastWriteTimeUtc -and $before.Length -eq $after.Length) {
			[System.IO.File]::Move($temp, $target, $true)
			return $target
		}
		Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
		Start-Sleep -Milliseconds 150
	}
	throw "Token file changed while copying: $($TokenEntry.Path)"
}

function Join-ProcessArgument([string]$Value) {
	return '"' + $Value.Replace('"', '\"') + '"'
}

function Start-ProxyProcess([object]$Session, [bool]$UseDevMode) {
	$command = Resolve-ProxyCommand $UseDevMode
	$childEnvironment = @{}
	foreach ($key in [System.Environment]::GetEnvironmentVariables().Keys) {
		$childEnvironment[[string]$key] = [string][System.Environment]::GetEnvironmentVariable([string]$key)
	}
	$childEnvironment["CODEX_HOME"] = [string]$Session.codexHome
	$logsDir = Join-Path $Session.sessionRoot "logs"
	if (-not (Test-Path -LiteralPath $logsDir)) {
		New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
	}
	$stdout = Join-Path $logsDir "stdout.log"
	$stderr = Join-Path $logsDir "stderr.log"

	$args = @($command.PrefixArgs) + @(
		"--host", $DefaultHost,
		"--port", [string]$Session.port,
		"--oauth-file", $Session.authFile
	)

	$argumentLine = ($args | ForEach-Object { Join-ProcessArgument ([string]$_) }) -join " "
	$process = Start-Process `
		-FilePath $command.FileName `
		-ArgumentList $argumentLine `
		-WorkingDirectory $RepoRoot `
		-WindowStyle Hidden `
		-PassThru `
		-RedirectStandardOutput $stdout `
		-RedirectStandardError $stderr `
		-Environment $childEnvironment
	$Session.pid = $process.Id
	$Session.status = "starting"
	$Session.updatedAt = [DateTimeOffset]::Now.ToString("o")
	$process.Dispose()
}

function Wait-Healthy([int]$TargetPort, [int]$Seconds = 20) {
	$deadline = [DateTimeOffset]::Now.AddSeconds($Seconds)
	while ([DateTimeOffset]::Now -lt $deadline) {
		if (Test-Health $TargetPort) {
			return $true
		}
		Start-Sleep -Milliseconds 500
	}
	return $false
}

function Stop-SessionProcess($Session) {
	$pid = [int]$Session.pid
	if ($pid -le 0 -or -not (Test-ProcessAlive $pid)) {
		$Session.status = "stopped"
		$Session.pid = 0
		$Session.updatedAt = [DateTimeOffset]::Now.ToString("o")
		return
	}

	try {
		Assert-SessionProcessIdentity $Session
		$process = Get-Process -Id $pid -ErrorAction Stop
		Stop-Process -Id $pid -ErrorAction Stop
		$process.WaitForExit(5000)
		if (-not $process.HasExited) {
			if (-not $Force) {
				throw "Proxy process $pid did not exit after Stop-Process. Re-run with -Force to terminate the process tree."
			}
			$process.Kill($true)
			$process.WaitForExit(5000)
		}
	} catch {
		if (-not $Force) {
			throw
		}
	} finally {
		$Session.status = "stopped"
		$Session.pid = 0
		$Session.updatedAt = [DateTimeOffset]::Now.ToString("o")
	}
}

function New-SessionProxy {
	if (-not $Token) {
		throw "Missing -Token for new session proxy."
	}
	$state = Read-State
	$tokenEntry = Resolve-TokenEntry $Token
	$targetPort = Find-FreePort $state $Port
	$sessionId = New-SessionId
	$sessionRoot = Join-Path $SessionsRoot $sessionId
	$sessionCodexHome = Join-Path $sessionRoot "codex-home"
	$authFile = Copy-TokenToSession $tokenEntry $sessionCodexHome

	$session = [pscustomobject]@{
		id = $sessionId
		label = if ($Label) { $Label } else { $sessionId }
		tokenFile = $tokenEntry.File
		tokenLabel = $tokenEntry.Label
		port = $targetPort
		pid = 0
		status = "created"
		baseUrl = "http://$DefaultHost`:$targetPort/v1"
		sessionRoot = $sessionRoot
		codexHome = $sessionCodexHome
		authFile = $authFile
		createdAt = [DateTimeOffset]::Now.ToString("o")
		updatedAt = [DateTimeOffset]::Now.ToString("o")
	}

	if (-not (Test-Path -LiteralPath $sessionRoot)) {
		New-Item -ItemType Directory -Path $sessionRoot -Force | Out-Null
	}
	$session | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $sessionRoot "session.json") -Encoding UTF8

	Start-ProxyProcess $session ([bool]$DevMode)
	if (-not (Wait-Healthy $targetPort)) {
		$state.sessions = @($state.sessions) + @($session)
		Write-State $state
		throw "Proxy started with pid $($session.pid), but /health did not become ready. Check logs under $sessionRoot\logs."
	}

	$session.status = "running"
	$session.updatedAt = [DateTimeOffset]::Now.ToString("o")
	$state.sessions = @($state.sessions) + @($session)
	$state.nextPort = $targetPort + 1
	Write-State $state

	Write-Info "Session proxy started."
	Print-SessionEnv $session
}

function Print-SessionEnv($Session) {
	Write-Host ""
	Write-Host ("Session: {0}" -f $Session.id)
	Write-Host ("Token:   {0}" -f $Session.tokenFile)
	Write-Host ("Port:    {0}" -f $Session.port)
	Write-Host ""
	Write-Host '$env:OPENAI_BASE_URL="' -NoNewline
	Write-Host $Session.baseUrl -NoNewline
	Write-Host '"'
	Write-Host '$env:OPENAI_API_KEY="dummy"'
	Write-Host 'opencode'
}

function Stop-SessionProxy {
	$state = Read-State
	$session = Get-SessionById $state $SessionId
	Stop-SessionProcess $session
	Write-State $state
	Write-Info "Stopped session proxy: $($session.id)"
}

function Restart-SessionProxy {
	$state = Read-State
	$session = Get-SessionById $state $SessionId
	Stop-SessionProcess $session
	if (Test-PortOpen ([int]$session.port)) {
		throw "Port is still in use after stop: $($session.port)"
	}
	Start-ProxyProcess $session ([bool]$DevMode)
	if (-not (Wait-Healthy ([int]$session.port))) {
		Write-State $state
		throw "Proxy restarted with pid $($session.pid), but /health did not become ready."
	}
	$session.status = "running"
	$session.updatedAt = [DateTimeOffset]::Now.ToString("o")
	Write-State $state
	Write-Info "Restarted session proxy: $($session.id)"
	Print-SessionEnv $session
}

function Change-SessionToken {
	if (-not $Token) {
		throw "Missing -Token for change-token."
	}
	$state = Read-State
	$session = Get-SessionById $state $SessionId
	$newToken = Resolve-TokenEntry $Token
	$oldTokenFile = $session.tokenFile
	$oldTokenLabel = $session.tokenLabel
	$backup = "$($session.authFile).bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
	$preparedAuth = $null
	if (Test-Path -LiteralPath $session.authFile) {
		Copy-Item -LiteralPath $session.authFile -Destination $backup -Force
	}

	try {
		$preparedAuth = Copy-TokenToSession $newToken $session.codexHome "auth.next.json"
		Stop-SessionProcess $session
		[System.IO.File]::Move($preparedAuth, $session.authFile, $true)
		$preparedAuth = $null
		$session.tokenFile = $newToken.File
		$session.tokenLabel = $newToken.Label
		Start-ProxyProcess $session ([bool]$DevMode)
		if (-not (Wait-Healthy ([int]$session.port))) {
			throw "Proxy did not become healthy after token change."
		}
		$session.status = "running"
		$session.updatedAt = [DateTimeOffset]::Now.ToString("o")
		Write-State $state
		Write-Info "Changed token and restarted session proxy: $($session.id)"
		Print-SessionEnv $session
	} catch {
		$failure = $_
		if ($preparedAuth -and (Test-Path -LiteralPath $preparedAuth)) {
			Remove-Item -LiteralPath $preparedAuth -Force -ErrorAction SilentlyContinue
		}
		Write-Warn "Token change failed; attempting rollback. $($failure.Exception.Message)"
		try {
			Stop-SessionProcess $session
		} catch {
			Write-State $state
			throw "Token change failed and the failed proxy could not be stopped safely: $($_.Exception.Message)"
		}
		if (Test-PortOpen ([int]$session.port)) {
			Write-State $state
			throw "Token change failed and port $($session.port) is still in use; rollback was not started."
		}
		if (Test-Path -LiteralPath $backup) {
			Copy-Item -LiteralPath $backup -Destination $session.authFile -Force
			$session.tokenFile = $oldTokenFile
			$session.tokenLabel = $oldTokenLabel
			Start-ProxyProcess $session ([bool]$DevMode)
			if (Wait-Healthy ([int]$session.port)) {
				$session.status = "running"
				Write-State $state
				Write-Warn "Rollback proxy restart succeeded."
			}
		}
		throw $failure
	}
}

function Show-SessionEnv {
	$state = Read-State
	$session = Get-SessionById $state $SessionId
	Print-SessionEnv $session
}

function Health-All {
	$state = Read-State
	foreach ($session in @($state.sessions)) {
		Update-SessionStatus $session | Out-Null
		Write-Host ("{0}: {1} ({2})" -f $session.id, $session.status, $session.baseUrl)
	}
}

function Cleanup-Stale {
	$state = Read-State
	foreach ($session in @($state.sessions)) {
		Update-SessionStatus $session | Out-Null
	}
	Write-State $state
	Write-Info "Stale session status refreshed. Stopped session directories are kept for safety."
}

function Show-Help {
	Write-Host "Session Proxy Manager"
	Write-Host ""
	Write-Host "Actions:"
	Write-Host "  help                         Show this help"
	Write-Host "  tokens                       List token slots"
	Write-Host "  list                         List session proxies"
	Write-Host "  new -Token <n|file> [-Port n] [-Label name] [-DevMode]"
	Write-Host "  stop -SessionId <id> [-Force]"
	Write-Host "  restart -SessionId <id> [-DevMode] [-Force]"
	Write-Host "  change-token -SessionId <id> -Token <n|file> [-DevMode] [-Force]"
	Write-Host "  env -SessionId <id>          Print OpenCode environment"
	Write-Host "  health                       Health check recorded sessions"
	Write-Host "  cleanup                      Refresh stale statuses"
	Write-Host ""
	Write-Host "Safety defaults: starts from port 10532 and uses session-local CODEX_HOME."
}

function Show-Menu {
	while ($true) {
		Write-Host ""
		Write-Host "OpenAI OAuth Session Proxy Manager" -ForegroundColor Cyan
		Write-Host "1. List token slots"
		Write-Host "2. List session proxies"
		Write-Host "3. New session proxy"
		Write-Host "4. Stop session proxy"
		Write-Host "5. Restart session proxy"
		Write-Host "6. Change token for session proxy"
		Write-Host "7. Print environment for session proxy"
		Write-Host "8. Health check all"
		Write-Host "9. Cleanup stale sessions"
		Write-Host "0. Exit"
		$choice = Read-Host "Select"
		try {
			switch ($choice) {
				"1" { Show-Tokens }
				"2" { Show-Sessions }
				"3" {
					$script:Token = Read-Host "Token slot number or file"
					$script:Label = Read-Host "Label (optional)"
					New-SessionProxy
				}
				"4" { $script:SessionId = Read-Host "Session ID"; Stop-SessionProxy }
				"5" { $script:SessionId = Read-Host "Session ID"; Restart-SessionProxy }
				"6" { $script:SessionId = Read-Host "Session ID"; $script:Token = Read-Host "New token slot number or file"; Change-SessionToken }
				"7" { $script:SessionId = Read-Host "Session ID"; Show-SessionEnv }
				"8" { Health-All }
				"9" { Cleanup-Stale }
				"0" { return }
				default { Write-Warn "Unknown selection." }
			}
		} catch {
			Write-Fail $_.Exception.Message
		}
	}
}

switch ($Action) {
	"help" { Show-Help }
	"tokens" { Show-Tokens }
	"list" { Show-Sessions }
	"env" { Show-SessionEnv }
	"health" { Health-All }
	"new" { Use-ManagerLock { New-SessionProxy } }
	"stop" { Use-ManagerLock { Stop-SessionProxy } }
	"restart" { Use-ManagerLock { Restart-SessionProxy } }
	"change-token" { Use-ManagerLock { Change-SessionToken } }
	"cleanup" { Use-ManagerLock { Cleanup-Stale } }
	"menu" { Use-ManagerLock { Show-Menu } }
}

