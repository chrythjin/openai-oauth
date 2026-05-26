# openai-oauth-core

Shared transport layer, auth refresh, SSE parsing, and replay state.

## FILES

| File | Purpose |
|------|---------|
| `auth.ts` | OAuth token loading, JWT parsing, account ID derivation |
| `transport.ts` | Codex OAuth client, fetch wrapper, response normalization |
| `sse.ts` | Server-sent events parsing, response collection |
| `state.ts` | CodexResponsesState for replay support |

## KEY EXPORTS

```typescript
createCodexOAuthClient()  // Create OAuth client with refresh
loadAuthTokens()          // Load tokens from auth.json
iterateServerSentEvents() // Parse SSE stream
CodexResponsesState        // Replay state management
```

## CONVENTIONS

- Uses `node` types in tsconfig (required for Node.js APIs)
- ESM modules with `.js` extensions in imports
- Auth file discovery: `~/.codex/auth.json` via `resolveAuthFileCandidates()`