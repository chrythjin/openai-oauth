@echo off
chcp 65001 >nul

echo [*] Starting process...

:: 1. Administrator check
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] This script must be run as Administrator.
    pause
    goto end
)

:: 2. Ensure the service is running. Do NOT force a restart just to open the
::    dashboard - the dashboard reads live state from the already-running proxy.
::    Only start it if it is not currently RUNNING, and wait for it to come up
::    (sc start is asynchronous, so a naive stop+start races).
sc query OpenAIOAuthProxy | find "RUNNING" >nul
if %errorLevel% equ 0 (
    echo [*] Service already running.
    goto open_dashboard
)

echo [*] Service not running. Starting OpenAIOAuthProxy...
sc start OpenAIOAuthProxy >nul
set "ATTEMPTS=0"

:wait_running
sc query OpenAIOAuthProxy | find "RUNNING" >nul
if %errorLevel% equ 0 goto open_dashboard
set /a ATTEMPTS+=1
if %ATTEMPTS% geq 20 (
    echo [ERROR] Service did not reach RUNNING state in time.
    goto end
)
timeout /t 1 /nobreak >nul
goto wait_running

:open_dashboard
echo [*] Opening Dashboard...
start "Dashboard" "http://127.0.0.1:10531/dashboard"

:end
echo [*] Finished. Press any key to close.
pause