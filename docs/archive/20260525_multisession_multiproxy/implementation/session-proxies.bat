@echo off
setlocal
set "SHOULD_PAUSE=0"
cd /d "%~dp0..\.."

if /I "%~1"=="menu" goto menu
if "%~1"=="" goto menu

goto command

:menu
set "SHOULD_PAUSE=1"
pwsh -NoProfile -ExecutionPolicy Bypass -File ".codex\scripts\session-proxy-manager.ps1" -Action menu
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:command
pwsh -NoProfile -ExecutionPolicy Bypass -File ".codex\scripts\session-proxy-manager.ps1" -Action %*
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:finish
if "%SHOULD_PAUSE%"=="1" (
	echo.
	echo Press any key to close...
	pause >nul
)
exit /b %EXIT_CODE%

