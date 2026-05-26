# MANAGE TOKEN 통합 및 윈도우 자동 시작 안정화

**완료일:** 2026-04-23
**작업 범위:** `.codex/launchers`, `.codex/scripts`, `register-service.ps1`, `docs/OPERATIONS.md`

## 요약

- 토큰/서버 운영 진입점을 `manage-tokens.bat` 하나로 통합했다.
- `manage-tokens` 메뉴에 현재 상태 확인, 서버 시작, 재시작, 종료 기능을 추가했다.
- 기존 `openai-oauth.bat` 는 새 통합 런처로 위임하도록 단순화했다.
- `rotate-next-token.bat` 는 기존처럼 preview 후 rotate 를 한 창에서 이어서 수행하도록 유지했다.
- 윈도우 부팅 후 자동 시작 불안정의 주요 원인을 Session 0 콘솔 앱 실행 안정성으로 판단했고, `register-service.ps1` 에 NSSM `AppNoConsole=1` 적용을 추가했다.

## 변경 파일

- `.codex/launchers/manage-tokens.bat`
- `.codex/launchers/openai-oauth.bat`
- `.codex/launchers/rotate-next-token.bat`
- `.codex/scripts/token-manager-menu.ps1`
- `.codex/scripts/rotate-service-token.ps1`
- `register-service.ps1`
- `docs/OPERATIONS.md`

## 확인 결과

- `manage-tokens.bat status` 정상 동작 확인
- `openai-oauth.bat status` 하위 호환 정상 동작 확인
- `rotate-service-token.ps1` PowerShell 구문 파싱 통과
- `token-manager-menu.ps1` PowerShell 구문 파싱 통과
- 현재 서비스 상태: `OpenAIOAuthProxy` RUNNING
- 현재 헬스체크: `http://127.0.0.1:10531/health` → `{"ok":true,"replay_state":"stateless"}`

## 운영 메모

- 현재 셸은 관리자 권한이 아니어서 live NSSM 설정에 `AppNoConsole=1` 을 즉시 쓰지는 못했다.
- 대신 `register-service.ps1` 에는 반영 완료했으므로, 관리자 PowerShell 에서 재적용하면 동일 설정이 서비스에 들어간다.
- 수동 적용 명령:

```powershell
& "C:\Tools\nssm\nssm-2.24-101-g897c7ad\win64\nssm.exe" set OpenAIOAuthProxy AppNoConsole 1
```
