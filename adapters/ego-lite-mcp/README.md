# ego-lite-mcp

Experimental stdio MCP adapter for [Ego Lite](https://github.com/citrolabs/ego-lite).

It converts a small typed MCP tool surface into fixed `ego-browser nodejs` scripts. The adapter is intentionally narrower than Ego Lite itself: V1 does **not** expose arbitrary JavaScript, CDP, shell commands, fetch helpers, file upload, or generic command passthrough.

## Requirements

- macOS with Ego Lite installed and onboarding completed
- `ego-browser` available on `PATH` (normally `~/.local/bin/ego-browser`)
- Bun 1.2+

## Run

From this directory:

```bash
bun src/index.ts
```

The process speaks MCP over stdio. An MCP client can configure it similarly to:

```json
{
  "mcpServers": {
    "ego-lite": {
      "command": "bun",
      "args": ["/absolute/path/to/xbird/adapters/ego-lite-mcp/src/index.ts"]
    }
  }
}
```

If `ego-browser` is not on `PATH`, set:

```bash
EGO_BROWSER_BIN="$HOME/.local/bin/ego-browser"
```

Optional timeout override:

```bash
EGO_LITE_MCP_TIMEOUT_MS=45000
```

## V1 tools

- `browser_list_spaces`
- `browser_list_tabs`
- `browser_open`
- `browser_snapshot`
- `browser_page_info`
- `browser_click`
- `browser_fill`
- `browser_press_key`
- `browser_scroll`

All normal task names are prefixed with `ego-lite-mcp:` before they are sent to Ego Lite. This avoids accidental collisions with unrelated user/agent spaces.

## Security model

The MCP client never receives generic shell access. Each tool validates structured input and generates a fixed Ego Lite helper script. String values are serialized before being embedded in the generated JavaScript.

V1 deliberately excludes:

- `js()` / Runtime.evaluate
- `cdp()`
- `serverFetch()` / `browserFetch()`
- `uploadFile()`
- arbitrary `ego-browser` scripts
- shell execution
- automatic task-space takeover

This is a capability boundary, not a browser sandbox. `browser_click`, `browser_fill`, and keyboard actions can still cause effects on websites when an authenticated session is present, so MCP clients should apply their own approval policy for consequential actions.

## Why an adapter instead of SSH

Ego Lite already provides a local bridge through `ego-browser`. MCP only needs a narrow adapter around that bridge. Giving an agent SSH access to the host would expose unrelated files, credentials, processes, and commands that are unnecessary for browser automation.

## Development

```bash
bun test
```

Tests use an injected runner and validate MCP behavior/script generation without requiring Ego Lite in CI.
