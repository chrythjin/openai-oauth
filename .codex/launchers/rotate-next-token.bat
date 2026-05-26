@echo off
setlocal
cd /d "%~dp0..\.."

powershell -NoProfile -ExecutionPolicy Bypass -File ".codex\scripts\rotate-service-token.ps1" -Action preview-next
set "PREVIEW_EXIT=%ERRORLEVEL%"
if not "%PREVIEW_EXIT%"=="0" (
	echo [rotate-next-token] Failed to render preview. Exit code %PREVIEW_EXIT%.
	echo Press any key to close...
	pause >nul
	exit /b %PREVIEW_EXIT%
)

echo [rotate-next-token] Starting token rotation...
powershell -NoProfile -ExecutionPolicy Bypass -File ".codex\scripts\rotate-service-token.ps1" -Action rotate
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
	echo [rotate-next-token] Failed with exit code %EXIT_CODE%.
) else (
	echo [rotate-next-token] Finished.
)
echo Press any key to close...
pause >nul
exit /b %EXIT_CODE%