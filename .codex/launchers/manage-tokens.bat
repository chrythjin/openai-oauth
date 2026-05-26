@echo off
setlocal
set "SHOULD_PAUSE=0"
cd /d "C:\NEW PRG\openai-oauth"

if /I "%~1"=="status" goto service_status
if /I "%~1"=="start" goto service_start
if /I "%~1"=="restart" goto service_restart
if /I "%~1"=="stop" goto service_stop
if /I "%~1"=="rotate" goto token_rotate
if /I "%~1"=="switch" goto token_switch
if /I "%~1"=="preview-next" goto preview_next
if /I "%~1"=="test-login-command" goto test_login_command
if /I "%~1"=="menu" goto menu
if "%~1"=="" goto menu

echo MANAGE TOKEN - Commands
echo.
echo   manage-tokens status        - Show token plus proxy status
echo   manage-tokens start         - Start proxy/server
echo   manage-tokens restart       - Restart proxy/server
echo   manage-tokens stop          - Stop proxy/server
echo   manage-tokens rotate        - Rotate to next token
echo   manage-tokens switch ^<n^>   - Switch to token slot
echo   manage-tokens preview-next  - Preview next token
echo   manage-tokens test-login-command - Verify Codex login command setup without logging in
echo   manage-tokens menu          - Open interactive menu
set "EXIT_CODE=1"
goto finish

:menu
set "SHOULD_PAUSE=1"
pwsh -NoProfile -ExecutionPolicy Bypass -File ".codex\scripts\token-manager-menu.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:service_status
pwsh -NoProfile -ExecutionPolicy Bypass -File ".codex\scripts\rotate-service-token.ps1" -Action status
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:service_start
pwsh -NoProfile -ExecutionPolicy Bypass -File ".codex\scripts\rotate-service-token.ps1" -Action start
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:service_restart
pwsh -NoProfile -ExecutionPolicy Bypass -File ".codex\scripts\rotate-service-token.ps1" -Action restart
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:service_stop
pwsh -NoProfile -ExecutionPolicy Bypass -File ".codex\scripts\rotate-service-token.ps1" -Action stop
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:token_rotate
pwsh -NoProfile -ExecutionPolicy Bypass -File ".codex\scripts\rotate-service-token.ps1" -Action rotate
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:token_switch
if "%~2"=="" (
	echo [manage-tokens] Missing slot number for switch.
	set "EXIT_CODE=1"
	goto finish
)
pwsh -NoProfile -ExecutionPolicy Bypass -File ".codex\scripts\rotate-service-token.ps1" -Action switch -Target "%~2"
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:preview_next
pwsh -NoProfile -ExecutionPolicy Bypass -File ".codex\scripts\rotate-service-token.ps1" -Action preview-next
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:test_login_command
pwsh -NoProfile -ExecutionPolicy Bypass -File ".codex\scripts\token-manager-menu.ps1" -Action test-login-command
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:finish
if "%SHOULD_PAUSE%"=="1" (
	echo.
	echo Press any key to close...
	pause >nul
)
exit /b %EXIT_CODE%
