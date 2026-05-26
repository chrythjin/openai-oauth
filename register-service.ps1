$ErrorActionPreference = "Stop"

$svcName = "OpenAIOAuthProxy"
$repoRoot = "C:\NEW PRG\openai-oauth"
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

	throw "bun command not found. Install Bun or add bun.exe to PATH, then try again."
}
$bunExe = Get-BunCommand
$scriptPath = Join-Path $repoRoot "packages\openai-oauth\dist\cli.js"
$wrapperPath = "C:\Tools\OpenAIOAuthProxy\openai-oauth-proxy.bat"
$logsDir = "C:\Logs\OpenAIOAuthProxy"
$stdoutLog = Join-Path $logsDir "stdout.log"
$stderrLog = Join-Path $logsDir "stderr.log"
$nssmExe = "C:\Tools\nssm\nssm-2.24-101-g897c7ad\win64\nssm.exe"
$codexHome = Join-Path $HOME ".codex"
$codexVersion = "0.124.0"
$models = "gpt-5.5,gpt-5.4,gpt-5.4-mini,gpt-5.3-codex,gpt-5.2,codex-auto-review"

function Test-IsAdmin {
	$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
	$principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
	return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-PathExists([string]$Path, [string]$Label) {
	if (-not (Test-Path $Path)) {
		throw "$Label not found: $Path"
	}
}

function Stop-LingeringPortProcess([int]$PortNumber) {
	$connections = Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction SilentlyContinue
	if (-not $connections) {
		return
	}

	$ids = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
	foreach ($processId in $ids) {
		try {
			Write-Host "[KILL] Removing lingering PID $processId on port $PortNumber..." -ForegroundColor Yellow
			Stop-Process -Id $processId -Force -ErrorAction Stop
		} catch {
			Write-Warning "Failed to kill PID ${processId}: $($_.Exception.Message)"
		}
	}

	Start-Sleep -Seconds 2
}

if (-not (Test-IsAdmin)) {
	throw "Administrator privileges are required. Run this script from an elevated PowerShell session."
}

Assert-PathExists $nssmExe "NSSM binary"
Assert-PathExists $bunExe "Bun executable"
Assert-PathExists $scriptPath "Proxy CLI script"

New-Item -ItemType Directory -Force -Path (Split-Path $wrapperPath -Parent) | Out-Null
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$wrapperContent = @"
@echo off
set CODEX_HOME=$codexHome
"$bunExe" "$scriptPath" --codex-version "$codexVersion" --models "$models"
"@
Set-Content -Path $wrapperPath -Value $wrapperContent -Encoding ASCII -NoNewline

$existing = Get-Service -Name $svcName -ErrorAction SilentlyContinue
if ($existing) {
	Write-Host "[INFO] Existing service found: $svcName" -ForegroundColor Yellow
	try {
		if ($existing.Status -ne "Stopped") {
			Write-Host "[STOP] Stopping existing service..." -ForegroundColor Yellow
			Stop-Service -Name $svcName -Force -ErrorAction SilentlyContinue
			Start-Sleep -Seconds 2
		}
	} catch {}

	Write-Host "[DELETE] Removing existing service registration..." -ForegroundColor Yellow
	sc.exe delete $svcName | Out-Null
	Start-Sleep -Seconds 2
}

Stop-LingeringPortProcess -PortNumber 10531

Write-Host "[INSTALL] Installing NSSM-managed service..." -ForegroundColor Cyan
& $nssmExe install $svcName $wrapperPath | Out-Null

Write-Host "[CONFIG] Applying NSSM settings..." -ForegroundColor Cyan
& $nssmExe reset $svcName AppParameters | Out-Null
& $nssmExe set $svcName AppDirectory $repoRoot | Out-Null
& $nssmExe set $svcName AppStdout $stdoutLog | Out-Null
& $nssmExe set $svcName AppStderr $stderrLog | Out-Null
& $nssmExe set $svcName AppRotateFiles 1 | Out-Null
& $nssmExe set $svcName AppRotateOnline 1 | Out-Null
& $nssmExe set $svcName Start SERVICE_AUTO_START | Out-Null
& $nssmExe set $svcName AppStopMethodSkip 0 | Out-Null
& $nssmExe set $svcName AppEnvironmentExtra "CODEX_HOME=$codexHome" | Out-Null
& $nssmExe set $svcName AppNoConsole 1 | Out-Null

Write-Host "[CONFIG] Setting delayed auto-start..." -ForegroundColor Cyan
sc.exe config $svcName start= delayed-auto | Out-Null

Write-Host "[CONFIG] Enabling hidden console mode for Session 0 startup stability..." -ForegroundColor Cyan

Write-Host "[START] Starting service..." -ForegroundColor Green
Start-Service $svcName
Start-Sleep -Seconds 3

$svc = Get-Service -Name $svcName -ErrorAction Stop
Write-Host "[STATUS] Service: $($svc.Status)" -ForegroundColor Green
Write-Host "[STATUS] Health URL: http://127.0.0.1:10531/health" -ForegroundColor Green
Write-Host "[STATUS] Logs: $logsDir" -ForegroundColor Green
