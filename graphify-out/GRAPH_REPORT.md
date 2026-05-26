# Graph Report - .  (2026-05-13)

## Corpus Check
- 42 files · ~31,587 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 384 nodes · 514 edges · 37 communities detected
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]

## God Nodes (most connected - your core abstractions)
1. `ProxyManager` - 19 edges
2. `Proxy Server Recovery Blueprint` - 18 edges
3. `openai-oauth-core` - 18 edges
4. `OpenAI OAuth Proxy Operations Manual` - 16 edges
5. `openai-oauth-provider README` - 16 edges
6. `openai-oauth Project` - 12 edges
7. `CodexResponsesState` - 10 edges
8. `loadAuthTokens()` - 9 edges
9. `runCli()` - 8 edges
10. `openai-oauth` - 8 edges

## Surprising Connections (you probably didn't know these)
- `openai-oauth-core Package` --semantically_similar_to--> `openai-oauth-core`  [INFERRED] [semantically similar]
  AGENTS.md → packages/openai-oauth-core/AGENTS.md
- `openai-oauth-core` --semantically_similar_to--> `openai-oauth-core`  [INFERRED] [semantically similar]
  docs/OPERATIONS.md → packages/openai-oauth-core/AGENTS.md
- `openai-oauth Package` --semantically_similar_to--> `openai-oauth Package README`  [INFERRED] [semantically similar]
  AGENTS.md → packages/openai-oauth/README.md
- `openai-oauth-provider Package` --semantically_similar_to--> `openai-oauth-provider README`  [INFERRED] [semantically similar]
  AGENTS.md → packages/openai-oauth-provider/README.md
- `OpenAIOAuthProxy Service` --semantically_similar_to--> `OpenAIOAuthProxy`  [INFERRED] [semantically similar]
  AGENTS.md → docs/OPERATIONS.md

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (49): OpenAIOAuthProxy Service, Auth and Transport Core, Check /v1/models First Rationale, CLI Entrypoint, CODEX_HOME Solution, Endpoint Handlers, HTTP Server Routing, Local Single Proxy (+41 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (21): handleChatCompletionsRequest(), isChatRequest(), toChatCompletionResponse(), coerceToolOutput(), parseToolArguments(), toJsonToolOutput(), toModelMessages(), toTextParts() (+13 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (41): openai-oauth Package, Primary auth.json Path, openai-oauth, openai-oauth-core, openai-oauth-provider, System Architecture, CLI Configuration, CLI Features (+33 more)

### Community 3 - "Community 3"
Cohesion: 0.1
Nodes (13): acquireLease(), formatChildLogLine(), getLeaseDir(), isEnoent(), isLastOwner(), isRecord(), isSafePid(), listActiveLeases() (+5 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (25): Auth Refresh, auth.ts, CodexResponsesState, createCodexOAuthClient, ESM .js Imports, iterateServerSentEvents, loadAuthTokens, Node Types Requirement (+17 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (12): collectCompletedResponseFromSse(), isRecord(), AuthManager, createCodexOAuthClient(), createCodexOAuthFetch(), decodeBody(), getDefaultCodexInstructions(), isRecord() (+4 more)

### Community 6 - "Community 6"
Cohesion: 0.19
Nodes (13): createCliParser(), findExistingAuthFile(), isHelpFlag(), isVersionFlag(), parseCliArgs(), runCli(), toHelpMessage(), toMissingAuthFileMessage() (+5 more)

### Community 7 - "Community 7"
Cohesion: 0.27
Nodes (16): decodeBase64Url(), deriveAccountId(), ensureDirectory(), isRecord(), loadAuthTokens(), normalizeTokens(), parseIsoDate(), parseJwtClaims() (+8 more)

### Community 8 - "Community 8"
Cohesion: 0.24
Nodes (12): expandOpenAIOAuthModelAliases(), fetchAvailableModels(), isRecord(), normalizeVersion(), resolveCodexClientVersion(), resolveLocalCodexClientVersion(), resolveOpenAIOAuthModelAlias(), resolveOpenAIOAuthModels() (+4 more)

### Community 9 - "Community 9"
Cohesion: 0.23
Nodes (4): cloneValue(), CodexResponsesState, isRecord(), trimOldestEntries()

### Community 10 - "Community 10"
Cohesion: 0.15
Nodes (13): Avoid Periodic Health Checks Rationale, Biome, Bun, Codex auth.json, Graphify Knowledge Graph, No DTS Generation for @ai-sdk/provider Compatibility, openai-oauth-core Package, openai-oauth Project (+5 more)

### Community 11 - "Community 11"
Cohesion: 0.17
Nodes (12): AI SDK Provider Usage, Biome, Bun, @openai/codex login, DTS Disabled Rationale, global/codex-tokens Memory, Node Types Required Rationale, openai-oauth (+4 more)

### Community 12 - "Community 12"
Cohesion: 0.18
Nodes (12): OpenAI-compatible Endpoint, /v1/chat/completions, /v1/models, /v1/responses, Chat Completions Fix Session, chat-completions.ts, Codex SSE Format, collectChatCompletionFromSse (+4 more)

### Community 13 - "Community 13"
Cohesion: 0.48
Nodes (4): dim(), toStartupMessage(), underline(), withAnsi()

### Community 14 - "Community 14"
Cohesion: 0.29
Nodes (7): Access Denied Blocker, Administrator Rights Needed, Existing Interactive Proxy, Logs Directory Prepared, NSSM Installed, NSSM Phase A Prep Session, Referenced Recovery Blueprint

### Community 15 - "Community 15"
Cohesion: 0.53
Nodes (3): createJwt(), encodeBase64Url(), writeAuthFile()

### Community 16 - "Community 16"
Cohesion: 0.47
Nodes (3): CodexResponsesLanguageModel, emptyUsage(), mergeProviderMetadata()

### Community 17 - "Community 17"
Cohesion: 0.4
Nodes (6): Build Artifact Regeneration, openai-oauth package.json, Self Dependency, Version Bump to 1.0.2 Session, Version Bump Rationale, Version Consistency

### Community 18 - "Community 18"
Cohesion: 0.5
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 0.5
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (2): OpenAI-compatible API, OpenAI SDK and Tool Clients

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

## Ambiguous Edges - Review These
- `AuthManager` → `loadAuthTokens`  [AMBIGUOUS]
  docs/sessions/20260420_014120_proxy-key-change-fix.md · relation: conceptually_related_to

## Knowledge Gaps
- **101 isolated node(s):** `Project Knowledge Base`, `Bun`, `Turbo`, `Biome`, `Operations Manual` (+96 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 20`** (2 nodes): `server.test.ts`, `createAuthFile()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (2 nodes): `transport.test.ts`, `createAuthFile()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (2 nodes): `main()`, `fetch_models.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (2 nodes): `OpenAI-compatible API`, `OpenAI SDK and Tool Clients`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `test-stream.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `cli-logging.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `cli.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (1 nodes): `live.e2e.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (1 nodes): `models.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `node-server.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `update-check.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `preconnect.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `state.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `auth.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `live.e2e.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `AuthManager` and `loadAuthTokens`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `OpenAI OAuth Proxy Operations Manual` connect `Community 0` to `Community 2`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `openai-oauth-core` connect `Community 4` to `Community 10`, `Community 2`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `Proxy Server Recovery Blueprint` connect `Community 0` to `Community 14`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `openai-oauth-core` (e.g. with `openai-oauth-core Package` and `openai-oauth-core`) actually correct?**
  _`openai-oauth-core` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `openai-oauth-provider README` (e.g. with `openai-oauth-provider Package` and `openai-oauth-provider`) actually correct?**
  _`openai-oauth-provider README` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Project Knowledge Base`, `Bun`, `Turbo` to the rest of the system?**
  _101 weakly-connected nodes found - possible documentation gaps or missing edges._