# Configuring OpenCode to Use openai-oauth Proxy Models

This guide explains how to configure OpenCode to recognize and use the models provided by your locally running `openai-oauth` proxy.

## Prerequisites

1. Your `openai-oauth` proxy is running and accessible at `http://127.0.0.1:10531/v1`
2. You have verified the proxy works by running:
   ```bash
   curl http://127.0.0.1:10531/v1/models
   ```
   Expected output:
   ```json
   {
     "object": "list",
     "data": [
       {"id": "gpt-5.4", "object": "model", "created": 0, "owned_by": "codex-oauth"},
       {"id": "gpt-5.4-mini", "object": "model", "created": 0, "owned_by": "codex-oauth"},
       {"id": "gpt-5.3-codex", "object": "model", "created": 0, "owned_by": "codex-oauth"},
       {"id": "gpt-5.2", "object": "model", "created": 0, "owned_by": "codex-oauth"},
       {"id": "codex-auto-review", "object": "model", "created": 0, "owned_by": "codex-oauth"}
     ]
   }
   ```

## Configuration Steps

### 1. Locate Your OpenCode Configuration File

OpenCode configuration is located at:
- **Windows**: `%USERPROFILE%\.config\opencode\opencode.json`
- **macOS/Linux**: `$HOME/.config/opencode/opencode.json`

### 2. Add the openai-oauth Provider Configuration

Edit your `opencode.json` file and add the following provider configuration within the JSON object:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/opencode-ai/opencode/refs/heads/main/schema.json",
  "provider": {
    "openai-oauth": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OpenAI via OAuth",
      "options": {
        "baseURL": "http://127.0.0.1:10531/v1"
      },
      "models": {
        "gpt-5.4": {},
        "gpt-5.4-mini": {},
        "gpt-5.3-codex": {},
        "gpt-5.2": {},
        "codex-auto-review": {}
      }
    }
  },
  "model": "openai-oauth/gpt-5.4",
  "small_model": "openai-oauth/gpt-5.4-mini",
  // ... your existing configuration (plugins, etc.) continues here
}
```

**Important**: 
- If you already have a `provider` section, merge the `"openai-oauth": { ... }` object into it
- If you already have `model` or `small_model` settings, replace them with the values above
- Preserve your existing `plugin`, `lsp`, and other configurations

### 3. Save and Restart OpenCode

1. Save the edited `opencode.json` file
2. Completely quit OpenCode (exit from terminal or close the application)
3. Restart OpenCode by running `opencode` in your terminal

### 4. Verify the Configuration

In OpenCode, run the `/models` command. You should see:

```
/models
> openai-oauth/gpt-5.4
> openai-oauth/gpt-5.4-mini
> openai-oauth/gpt-5.3-codex
> openai-oauth/gpt-5.2
> openai-oauth/codex-auto-review
```

The currently selected model should be `openai-oauth/gpt-5.4` (as set by the `"model"` configuration).

## Troubleshooting

### Models Not Appearing
1. Double-check that your proxy is still running on port 10531
2. Verify the `baseURL` in your config exactly matches `http://127.0.0.1:10531/v1` (no trailing slash issues)
3. Check for JSON syntax errors in your `opencode.json` file
4. Ensure you completely restarted OpenCode after saving the config

### Connection Errors
1. Test the endpoint manually: `curl -v http://127.0.0.1:10531/v1/models`
2. Check if any firewall is blocking local port 10531
3. Verify the openai-oauth proxy logs show incoming requests

## Notes

- The `small_model` setting (`openai-oauth/gpt-5.4-mini`) is used for lightweight tasks like title generation
- You can change the default model by modifying the `"model"` value (e.g., to `"openai-oauth/gpt-5.3-codex"`)
- Additional models from your proxy can be added to the `"models"` object as they become available

## References

- OpenCode Provider Documentation: https://opencode.ai/docs/providers/
- @ai-sdk/openai-compatible adapter: Used for any OpenAI-compatible API endpoint