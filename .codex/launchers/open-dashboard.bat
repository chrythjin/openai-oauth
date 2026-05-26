@echo off
chcp 65001 >nul

echo [*] Starting process...

:: 1. 관리자 권한 확인
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] 이 스크립트는 "관리자 권한으로 실행"해야 합니다.
    pause
    goto end
)

:: 2. 서비스 제어
echo [*] Restarting OpenAIOAuthProxy service...
sc stop OpenAIOAuthProxy
sc start OpenAIOAuthProxy

:: 3. 브라우저 실행
echo [*] Opening Dashboard...
start "Dashboard" "http://127.0.0.1:10531/dashboard"

:end
echo [*] Finished. Press any key to close.
pause