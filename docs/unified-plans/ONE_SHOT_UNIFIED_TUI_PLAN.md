# 원샷 통합(TUI 포함) 실행 구상안

## 1. 목표

이중 운영 기간을 길게 가져가지 않고, 한 번의 릴리즈 사이클에서
`Windows + macOS`를 동시에 지원하는 **통합 CLI/TUI 프로그램**으로 전환한다.

- 사용자 관점: 명령/메뉴 진입점 1개
- 내부 구조: 공통 코어 + OS 서비스 어댑터
- 배포 전략: 짧은 컷오버 + 명확한 롤백

## 2. 전제

- 기존 Windows PowerShell 기반 운영은 이미 검증됨
- 현재 핵심 토큰 로직은 JS/Bun 기반으로 재사용 가능
- 리포는 Bun/Turbo 중심이므로 신규도 TypeScript/Bun으로 통일

## 3. 최종 아키텍처 (한 번에 끝내기 기준)

신규 패키지: `packages/openai-oauth-unified/`

구성:

- `core`
	- token vault/active/backups
	- rotate/switch/status
	- health check 정책
- `service adapters`
	- windows: NSSM/PowerShell 래퍼
	- macos: launchd/launchctl
- `ui`
	- 공용 CLI 명령
	- 공용 TUI 메뉴(텍스트 기반)

핵심 원칙:

1. 토큰 정책 로직은 100% 공통
2. 서비스 제어만 OS별 분기
3. UI는 공통 엔트리에서 호출

## 4. 왜 원샷이 가능한가

- 기존 `token-rotator.js`에 이미 Unix 경로와 Windows 경로가 공존
- Windows 운영 지식(권한/UAC/NSSM)이 문서화되어 있음
- macOS는 PowerShell 대체가 아닌 launchd 어댑터 추가로 해결 가능

즉, 새로 두 번 만드는 문제가 아니라:
"공통 로직 한 번 추출 + OS 어댑터 2개 연결 + UI 한 번 구현" 문제다.

## 5. 기능 범위 (원샷 MVP)

출시 필수 기능:

- `status`
- `rotate`
- `switch <slot>`
- `start | stop | restart`
- `preview-next`
- TUI 메인 메뉴(상태/회전/전환/재시작/종료)

출시 제외(후순위):

- 고급 시각 효과
- 원격 관리
- 다중 프록시 인스턴스

## 6. 구현 상세

### 6.1 공통 인터페이스

`ServiceController`:

- `status()`
- `start()`
- `stop()`
- `restart()`
- `ensureHealthy()`

`TokenController`:

- `showStatus()`
- `rotate(options)`
- `switch(target, options)`
- `previewNext()`

### 6.2 Windows 어댑터

- 기존 `.codex/scripts/rotate-service-token.ps1`를 호출하는 thin wrapper
- 관리자 권한 실패 시 명확 에러 출력
- 기존 서비스명/포트 기본값 재사용

### 6.3 macOS 어댑터

- launch agent label 고정 (예: `dev.openai-oauth.proxy`)
- `launchctl bootstrap/bootout/kickstart` 호출
- 로그 경로 표준화 (`~/Library/Logs/openai-oauth/`)

### 6.4 TUI

- Bun/TypeScript 기반 텍스트 메뉴
- 메뉴 항목:
	- 현재 상태 보기
	- 다음 토큰 회전
	- 특정 슬롯 전환
	- 서비스 시작/중지/재시작
	- 종료
- 모든 액션 완료 후 결과와 실패 원인 즉시 표시

## 7. 일정 (원샷 스프린트)

Day 1:

- 패키지 스캐폴딩
- core/token 로직 이관
- 기본 CLI 연결

Day 2:

- windows adapter 연결
- macOS launchd adapter 연결
- health/restart 검증

Day 3:

- TUI 구현
- 통합 테스트(Windows/macOS)
- 문서/릴리즈 준비

컷오버:

- 동일 릴리즈에서 신규 통합 프로그램을 기본 권장 경로로 전환
- 레거시 경로는 "응급 롤백용"으로만 유지

## 8. 검증 시나리오 (반드시 통과)

1. `rotate` 후 active token 변경 + health OK
2. `switch 2` 후 지정 슬롯 반영 + health OK
3. 서비스 죽은 상태에서 `start` 복구
4. 포트 점유 충돌 시 적절한 오류/복구 안내
5. macOS 재로그인 후 launchd 자동 기동 확인
6. Windows 재부팅 후 NSSM 자동 기동 확인

## 9. 컷오버/롤백 정책

컷오버 조건:

- OS별 핵심 시나리오 100% 통과
- 실제 운영 토큰 1회 이상 실전 전환 성공

롤백 조건:

- health 실패가 연속 2회 이상
- 서비스 재시작 실패 재현
- 토큰 파일 불일치 감지

롤백 방식:

- Windows: 기존 PowerShell 런처로 즉시 복귀
- macOS: launchd label 제거 후 수동 dev 실행 복귀

## 10. 산출물

반드시 남겨야 할 결과물:

1. `packages/openai-oauth-unified/` 코드
2. 통합 CLI/TUI 사용 문서
3. macOS launchd 설치/삭제 가이드
4. 원샷 컷오버 체크리스트
5. 롤백 런북

## 11. 의사결정

결론: **원샷 진행 가능**.  
단, "완전 무중단"이 아니라 "짧은 컷오버 + 즉시 롤백 가능" 전략으로 수행한다.

이 접근이 "이중 개발"을 피하면서도 운영 리스크를 통제하는 가장 현실적인 방법이다.
