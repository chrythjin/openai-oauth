# Cross-Platform 통합 프로그램 구상서

## 1) 목적

현재 Windows 운영에 최적화된 토큰 전환/프록시 재시작 체계를 유지하면서,  
별도 폴더에서 **macOS + Windows 공용 통합 프로그램**을 신규 개발한다.

- 기존 프로그램/스크립트(`.codex/scripts/*.ps1`, 기존 rotator)는 변경 최소화
- 신규 통합 프로그램은 실험/전환 가능한 독립 경로에서 개발
- 최종적으로 사용자 명령은 1개로 통일하되, 내부는 OS 어댑터 분기

## 2) 범위 및 비범위

- 범위
	- 토큰 vault/active/backups 관리 공용화
	- rotate/switch/status 공용 명령 제공
	- 서비스 제어 계층 OS 어댑터화
	- 운영 문서(Windows/macOS) 분리 + 공통 문서 통합

- 비범위
	- 기존 Windows NSSM 운영 즉시 폐기
	- 기존 PowerShell 스크립트 완전 삭제
	- 기존 운영자의 명령 체계 강제 변경

## 3) 개발 전략 (중요)

### 전략 요약

**기존 코드 유지 + 신규 통합 프로그램 병행 개발**  
레거시 안정성을 보장하면서 통합 프로그램 완성도 확보 후 점진 전환.

### 원칙

1. 기존 Windows 경로는 그대로 유지한다.
2. 신규는 별도 폴더에서 독립적으로 빌드/테스트한다.
3. 인터페이스를 먼저 고정하고 구현은 OS별로 분리한다.
4. 전환은 opt-in 방식으로 수행한다.

## 4) 제안 폴더 구조

레포 루트 기준 신규 디렉터리:

`packages/openai-oauth-unified/`

권장 내부 구조:

- `src/cli.ts`  
	- 단일 사용자 진입점 (`status`, `rotate`, `switch`, `start`, `stop`, `restart`)
- `src/core/token-store.ts`  
	- vault/active/backups, config 로딩/저장, slot 탐색
- `src/core/token-actions.ts`  
	- rotate/switch/add 로직
- `src/service/types.ts`  
	- 서비스 제어 인터페이스 정의
- `src/service/windows-service.ts`  
	- NSSM/PowerShell 연동 어댑터
- `src/service/macos-service.ts`  
	- launchd/launchctl 연동 어댑터
- `src/service/no-service.ts`  
	- 개발 모드(프로세스 직접 spawn) fallback
- `src/platform/detect.ts`  
	- OS 판별 및 어댑터 선택
- `src/config/runtime.ts`  
	- 경로/포트/서비스명 설정
- `README.md`  
	- 통합 프로그램 사용법

## 5) 공통 인터페이스 설계

서비스 제어는 아래 인터페이스를 기준으로 구현:

- `status(): Promise<ServiceStatus>`
- `start(): Promise<void>`
- `stop(): Promise<void>`
- `restart(): Promise<void>`
- `healthCheck(url: string): Promise<boolean>`

`cli.ts`는 이 인터페이스만 의존하고 OS 세부 구현을 직접 호출하지 않는다.

## 6) 운영체제별 구현 방안

### Windows

- 기존 `rotate-service-token.ps1` 재사용 또는 래핑
- NSSM 기반 `OpenAIOAuthProxy` 서비스 제어 유지
- 관리자 권한 이슈(UAC) 처리 경로 유지

### macOS

- launchd plist 기반 서비스 운영
- `launchctl bootstrap/kickstart/bootout` 기반 start/restart/stop
- 로그 경로는 `~/Library/Logs/openai-oauth/` 표준화

## 7) 단계별 실행 계획

### Phase 0 - 준비

- 신규 패키지 뼈대 생성
- 현재 rotator 로직을 core 단위로 복제/정리
- 공통 config 스키마 정의

### Phase 1 - 코어 이식

- vault/active/backups 로직 이식
- rotate/switch/status 기능 구현
- 단위 테스트 작성

### Phase 2 - OS 어댑터 구현

- Windows adapter 구현(기존 스크립트 래핑 중심)
- macOS adapter 구현(launchd 기반)
- health check 공통화

### Phase 3 - 통합 및 검증

- 단일 CLI 명령 체계 연결
- Windows/macOS 각각 E2E 점검
- 장애 시 fallback/no-service 모드 검증

### Phase 4 - 점진 전환

- 문서에 신규 명령 opt-in 추가
- 기존 명령은 유지, deprecation 공지 준비
- 안정화 후 기본 권장 경로 변경

## 8) 테스트 전략

- 단위 테스트
	- 토큰 파일 선택/회전/백업/복구
	- config 파싱/유효성 검증
- 통합 테스트
	- `rotate --no-restart` 동작
	- 서비스 restart 포함 rotate 동작
- 운영 검증
	- 포트 점유/잔존 프로세스/health 실패 시나리오
	- auth.json 교체 후 반영 확인

## 9) 리스크와 대응

- 리스크: Windows 서비스 권한/UAC 차이
	- 대응: Windows adapter는 기존 PS 경로 우선 재사용

- 리스크: macOS launchd 초기 설정 복잡도
	- 대응: plist 자동 생성 + 설치 명령 스크립트 제공

- 리스크: 사용자 명령 혼선(구버전 vs 신규)
	- 대응: 명령 프리픽스 명확화 + 문서 병행 제공

## 10) 마이그레이션 원칙

1. 기존 운영 안정성 최우선
2. 신규 통합 프로그램은 기본 비활성(opt-in)
3. 회귀 없는 기간을 확보한 뒤 기본값 전환
4. 언제든 기존 경로로 롤백 가능해야 함

## 11) 완료 정의 (Definition of Done)

- 신규 패키지에서 Windows/macOS 모두 `status/rotate/switch/restart` 동작
- 기존 Windows 운영 절차 영향 없음
- 운영 문서에 신규/기존 경로 공존 가이드 반영
- 주요 실패 시나리오 테스트 통과

## 12) 즉시 다음 액션

1. `packages/openai-oauth-unified/` 스캐폴딩
2. `token-rotator.js`의 core 로직 모듈 분해
3. `ServiceController` 인터페이스 도입
4. Windows adapter를 기존 PS 래핑으로 먼저 연결
5. macOS launchd adapter 구현
