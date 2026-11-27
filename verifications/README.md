# Verification records

A PR that changes any non-doc path adds `verifications/<pr-number>.md`
(or `verifications/<slug>.md` before the PR has a number) recording what was
actually run. The `verification-record` gate
(`scripts/ci/check-verification-record.sh`) fails the PR without at least one
valid record in its diff. This README is not a record.

Each heading needs a non-empty body. English or Traditional Chinese headings
are accepted, alone or together (`## Command ／ 指令`):

```markdown
## What was verified ／ 驗證項目
The behaviour or contract this PR changes, and how it was exercised.

## Command ／ 指令
The exact commands run.

## Result ／ 結果
Key output lines: pass counts, exit codes, readback.

## When ／ 時間或 commit
2026-11-27 16:40 Asia/Taipei (a timestamp with timezone) or a 7-40 character commit SHA.
```

A body that is only `TODO`, `TBD`, `FIXME`, `XXX`, `N/A`, `TBC`, `待補`,
`稍後`, `lorem ipsum`, or punctuation (`.`, `-`, `...`) does not count.

Docs-only exemption: a PR needs no record when every changed path ends in `.md`
or sits under `docs/`, `daily/` or `inbox/fleet/`.

Run it locally against a PR branch:

```bash
PR_NUMBER=123 bash scripts/ci/check-verification-record.sh --base origin/main
bash scripts/ci/check-verification-record.test.sh
```
