# Changelog

All notable changes to `xbird` are documented here.

## 0.1.0 — Unreleased

### Added

- Bun-native `xbird` CLI and TypeScript library for X's web GraphQL API.
- Browser-cookie authentication for Safari, Chrome, Brave, and Firefox.
- Commands for posts, replies, threads, search, mentions, home timelines, user timelines, bookmarks, likes, lists, followers, following, news, and trending topics.
- Posting, replying, unbookmarking, and media uploads with alt text.
- Stable JSON envelopes, typed error codes, dedicated exit codes, partial-result metadata, and rate-limit metadata.
- Plain output mode for human-readable scripts and agents.
- Bounded cursor pagination and resumable cursors.
- Runtime refresh and caching for rotating GraphQL query IDs and feature flags.
- Long-form Notes and Articles parsing, quoted posts, and media metadata.
- Agent Skills-compatible usage guide in `skills/xbird`.
- Mutation safeguards with `XBIRD_DISABLE_LIVE_WRITES`, `--dry-run`, and `--expect-user`.
- Bun launcher isolation from working-directory `.env` files.
- Bun build, lint, unit-test, package-installation smoke, live-test, and standalone-binary workflows.
