# xbird

`xbird` is an unofficial, script-friendly CLI for using X from the terminal. It reuses your browser session and talks to X's web GraphQL API, so you can read, search, publish, and organize posts without opening the website.

## What it does

- Read posts, replies, and full conversation threads
- Search posts, mentions, and user timelines
- View your home timeline, bookmarks, likes, lists, followers, and following
- Publish posts and replies, including media uploads
- Fetch Explore news and trending topics
- Emit JSON for shell scripts, automations, and agents
- Refresh rotating GraphQL query IDs at runtime

## Disclaimer

`xbird` uses X's **undocumented** web GraphQL API and browser-cookie authentication. X can change endpoints, query IDs, rate limits, or anti-automation behavior at any time. Expect occasional breakage.

## Requirements

- [Bun](https://bun.sh/) 1.2 or newer
- An active X session in Safari, Chrome, or Firefox, or explicit `auth_token` and `ct0` cookies

## Install and quickstart

Install globally from GitHub with Bun:

```bash
bun add -g github:panda850819/xbird
```

Verify the installation and browser-cookie authentication:

```bash
xbird --version
xbird check
xbird whoami
```

Then read or search X:

```bash
xbird read https://x.com/user/status/1234567890123456789
xbird search "from:example" -n 10 --json
```

Run directly from a local checkout:

```bash
git clone https://github.com/panda850819/xbird.git
cd xbird
bun install
bun run dev whoami
```

The installed `xbird` executable uses Bun as its runtime.

## CLI quickstart

```bash
# Read a post by URL or ID
xbird read https://x.com/user/status/1234567890123456789
xbird 1234567890123456789 --json

# Search and browse timelines
xbird search "from:example" -n 10
xbird home --following -n 20
xbird user-tweets @example -n 20

# Read a conversation with bounded pagination
xbird replies 1234567890123456789 --max-pages 3
xbird thread 1234567890123456789 --max-pages 3 --json

# Work with saved content
xbird bookmarks -n 20 --json
xbird likes -n 20
xbird lists

# Preview, publish, or reply
xbird --dry-run --expect-user @example tweet "hello from xbird"
xbird --expect-user @example tweet "hello from xbird"
xbird reply 1234567890123456789 "hello"
xbird tweet "photo" --media image.png --alt "Description"

# Refresh rotating GraphQL query IDs after a query-ID failure
xbird query-ids --fresh
```

Use bounded counts or `--max-pages` before reaching for `--all`. For mutations, use `--expect-user @handle` to reject credentials for the wrong account. Run `xbird --help` or `xbird <command> --help` for the complete command reference.

## JSON and exit codes

`--json` returns one stable envelope on stdout. Diagnostics remain on stderr:

```json
{
  "ok": true,
  "data": [],
  "meta": {
    "partial": false,
    "nextCursor": null
  }
}
```

Errors use `{ "ok": false, "error": { "code", "message" }, "meta" }`. Partial pagination failures may also include the data already fetched and exit with code `5`. Rate-limit errors include `meta.rateLimit.retryAfterSeconds` when X provides `Retry-After`.

| Exit | Meaning |
| ---: | --- |
| `0` | Success |
| `1` | Runtime failure |
| `2` | Invalid usage |
| `3` | Authentication required or account mismatch |
| `4` | Capability unavailable |
| `5` | Partial result |
| `6` | Rate limited |

## Authentication

`xbird` uses your existing X web session. Credentials are resolved in this order:

1. `--auth-token` and `--ct0`
2. `AUTH_TOKEN` and `CT0`, with `TWITTER_AUTH_TOKEN` and `TWITTER_CT0` as fallbacks
3. Browser cookies from Safari, Chrome, or Firefox through `@steipete/sweet-cookie`

Choose a browser explicitly when needed:

```bash
xbird --cookie-source firefox whoami
xbird --cookie-source chrome --chrome-profile Default whoami
```

## Configuration

Precedence is CLI flags, environment variables, project config, then global config.

- Global: `~/.config/xbird/config.json5`
- Project: `./.xbirdrc.json5`

```json5
{
  cookieSource: ["firefox", "safari"],
  firefoxProfile: "default-release",
  cookieTimeoutMs: 30000,
  timeoutMs: 20000,
  quoteDepth: 1,
}
```

Environment variables include:

- `XBIRD_TIMEOUT_MS`
- `XBIRD_COOKIE_TIMEOUT_MS`
- `XBIRD_QUOTE_DEPTH`
- `XBIRD_DISABLE_LIVE_WRITES=1` to block `tweet`, `reply`, `unbookmark`, and media uploads while still allowing `--dry-run`
- `XBIRD_QUERY_IDS_CACHE`
- `XBIRD_FEATURES_CACHE`

## Library

Install the GraphQL client directly from GitHub:

```bash
bun add github:panda850819/xbird
```

Then import it by its package name:

```ts
import { TwitterClient, resolveCredentials } from '@panda850819/xbird';

const { cookies, warnings } = await resolveCredentials({ cookieSource: 'safari' });
if (!cookies.authToken || !cookies.ct0) {
  throw new Error(warnings.join('; '));
}

const client = new TwitterClient({ cookies, timeoutMs: 20_000 });
const result = await client.search('from:example', 20);
if (!result.success) {
  throw new Error(result.error);
}
```

## Agent skill

The package includes an [Agent Skills](https://agentskills.io/) compatible `xbird` skill. It teaches agents when to use the CLI or TypeScript library, how to protect cookies, how to bound pagination, and when external mutations require confirmation.

Install it as a Pi package:

```bash
pi install git:github.com/panda850819/xbird
```

Then invoke it explicitly when needed:

```text
/skill:xbird read this X thread and summarize it
```

Agents may also load [`skills/xbird/SKILL.md`](skills/xbird/SKILL.md) directly. The detailed library guide lives at [`skills/xbird/references/library.md`](skills/xbird/references/library.md).

## Development

```bash
bun install
bun run dev --help
bun run build
bun run test
bun run lint
```

`bun run build` produces both `dist/` and a standalone `./xbird` Bun binary.

## Origin and license

`xbird` is derived from Peter Steinberger's MIT-licensed `bird` project. The original copyright notice is preserved in [`LICENSE`](LICENSE).
