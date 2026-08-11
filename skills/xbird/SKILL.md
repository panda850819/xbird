---
name: xbird
description: Use the xbird CLI or TypeScript library to read, search, publish, and organize X posts. Use when a task involves X/Twitter posts, threads, timelines, bookmarks, lists, followers, posting, or integrating the @panda850819/xbird library.
license: MIT
compatibility: Requires Bun 1.2+, an installed xbird package, and an authenticated X browser session or AUTH_TOKEN and CT0.
---

# xbird

Use `xbird` as an unofficial interface to X's web GraphQL API. Expect endpoints and query IDs to change without notice.

## First-run check

1. Confirm the tools are available:

```bash
bun --version
command -v xbird
```

2. If `xbird` is missing, install it:

```bash
bun add -g github:panda850819/xbird
```

3. Verify credentials without exposing them:

```bash
xbird check
xbird whoami
```

Never print, log, paste, or commit `auth_token`, `ct0`, `AUTH_TOKEN`, or `CT0`. Prefer browser-cookie discovery over asking the user for cookie values.

## Choose CLI or library

- Use the CLI for one-off reads, shell pipelines, agent actions, and JSON output.
- Use the TypeScript library for application code, repeated calls in one process, custom pagination, and typed results.
- Use `--json` for machine consumption and `--plain` for stable human-readable output.
- Inspect exact flags before guessing: `xbird <command> --help`.

## Safe operating rules

- Read-only commands may run directly when they satisfy the user's request.
- Treat `tweet`, `reply`, and `unbookmark` as external mutations. Show the exact intended action and obtain confirmation unless the user explicitly requested that mutation in the current message.
- Start pagination with a bounded count or `--max-pages`. Do not use `--all` without a clear need.
- On `404` or stale query-ID errors, run `xbird query-ids --fresh` once and retry once.
- On `429`, stop and report rate limiting. Do not create a rapid retry loop.
- Do not claim success from process exit alone when a JSON result contains `success: false`.

## CLI recipes

```bash
# Identity and diagnostics
xbird check
xbird whoami

# Read
xbird read <tweet-id-or-url> --json
xbird thread <tweet-id-or-url> --max-pages 3 --json
xbird replies <tweet-id-or-url> --max-pages 3 --json

# Discover
xbird search "<X search query>" -n 20 --json
xbird mentions -n 20 --json
xbird user-tweets @handle -n 20 --json
xbird home --following -n 20 --json

# Organize
xbird bookmarks -n 20 --json
xbird likes -n 20 --json
xbird lists --json
xbird list-timeline <list-id-or-url> -n 20 --json

# Mutations: require explicit intent
xbird tweet "<text>"
xbird reply <tweet-id-or-url> "<text>"
xbird unbookmark <tweet-id-or-url>
```

When parsing CLI output in code, capture stdout as JSON and keep stderr for diagnostics:

```bash
xbird --plain search "from:example" -n 20 --json > results.json
```

## TypeScript library quickstart

Install in the application:

```bash
bun add github:panda850819/xbird
```

Create one client and reuse it:

```ts
import { TwitterClient, resolveCredentials } from '@panda850819/xbird';

const { cookies, warnings } = await resolveCredentials({
  cookieSource: ['safari', 'chrome', 'firefox'],
  cookieTimeoutMs: 30_000,
});

if (!cookies.authToken || !cookies.ct0) {
  throw new Error(`X credentials unavailable: ${warnings.join('; ')}`);
}

const client = new TwitterClient({
  cookies,
  timeoutMs: 20_000,
  quoteDepth: 1,
});

const result = await client.search('from:example', 20);
if (!result.success) {
  throw new Error(result.error);
}

for (const post of result.tweets) {
  console.log(post.id, post.author.username, post.text);
}
```

Required practices:

- Validate both `cookies.authToken` and `cookies.ct0` before constructing `TwitterClient`.
- Branch on `result.success` before using result data.
- Reuse a client instead of resolving browser cookies before every request.
- Set `timeoutMs` for application code.
- Keep pagination bounded with `count`, `maxPages`, or cursors.
- Request raw GraphQL payloads with `includeRaw: true` only when debugging; raw payloads are unstable.

See [Library reference](references/library.md) for common methods, result handling, pagination, media, and mutation examples.
