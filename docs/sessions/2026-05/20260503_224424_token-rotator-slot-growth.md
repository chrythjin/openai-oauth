# Token Rotator Slot Growth

## 작업
- `.codex/scripts/token-rotator.js`의 vault add 경로에서 `auth-alt1.json`/`auth-alt2.json`만 선택하던 고정 슬롯 로직을 제거했다.
- `getNextVaultFileName(config)`를 추가해 설정과 vault 디렉터리를 모두 확인하고 `auth.json`, `auth-alt1.json`, `auth-alt2.json`, ... 순서로 다음 빈 슬롯을 찾도록 했다.
- `--use` 도움말을 `<1|2|3>`에서 `<n>`으로 바꿔 임의 개수 슬롯을 반영했다.
- 같은 파일의 기존 Biome 경고를 정리했다: Node builtin `node:` import, 템플릿 리터럴, 미사용 `isPortInUse` 제거.

## 검증
- `bunx biome check .codex/scripts/token-rotator.js`
- `bun --check .codex/scripts/token-rotator.js`
- 임시 `USERPROFILE` 아래 4개 슬롯 상태를 만들고 `bun .codex/scripts/token-rotator.js --vault add` 실행: 5번째 `auth-alt4.json` 및 `Account 5` 생성 확인.

## 참고
- 프로젝트 전역 `bun run typecheck`/`bun run format-and-lint`는 이 작업 전부터 있던 전역 문제로 실패한다. 이번 변경 파일은 별도 검증을 통과했다.
