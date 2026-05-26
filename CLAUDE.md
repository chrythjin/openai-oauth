# openai-oauth

Free OpenAI API access with your ChatGPT account via OAuth.

## 프로젝트 구조

```
openai-oauth/
├── packages/
│   ├── openai-oauth-core/    # 공유 transport, auth refresh, SSE helpers
│   ├── openai-oauth-provider/ # Vercel AI SDK Provider
│   └── openai-oauth/          # CLI + localhost proxy
├── turbo.json                 # Turborepo 설정
├── bun.lock                   # 패키지 매니저 (Bun)
└── biome.json                 # 포맷터/린터
```

## 사용법

### CLI 실행 (로컬 프록시)
```bash
cd packages/openai-oauth
bun run dev
# 또는 npx로:
npx openai-oauth
# 또는 빌드 후:
bun run build
./dist/cli.js
```

### Provider를 AI SDK와 함께 사용
```typescript
import { generateText } from "ai"
import { createOpenAIOAuth } from "openai-oauth-provider"
```

## 개발 명령어

| 명령어 | 설명 |
|--------|------|
| `bun install` | 의존성 설치 |
| `bun run build` | 전체 패키지 빌드 |
| `bun run dev` | CLI dev 모드 실행 |
| `bun run typecheck` | 타입 체크 |
| `bun run test` | 테스트 실행 |
| `bun run format-and-lint` | Biome lint + format |

## 빌드 시 주의사항

- **Bun 사용**: 이 프로젝트는 Bun을 패키지 매니저로 사용 (`bun@1.2.18+`)
- **Turbo**: 빌드 오케스트레이션은 Turbo가 담당
- ** DTS 생성 비활성화**: `@ai-sdk/provider` 버전 호환성 문제로 DTS 생성 생략 (`--no-dts` 사용)
- **Node 타입**: `openai-oauth-core` 빌드 시 `types: ["node"]` 설정 필요

## 사전 요구사항

CLI 사용 전 ChatGPT/codex 로그인 필요:
```bash
npx @openai/codex login
# 또는 ~/.codex/auth.json 파일 준비
```

## 토큰 관리 (메모리 기반)

토큰 인벤토리는 `global/codex-tokens` 메모리에 저장됨.
세션中说 "토큰 변경" 또는 "change token" 하면 해당 메모리를 참조하여 즉시 변경.

자세한 인벤토리는 `.codex-tokens.md` 파일参照.
