# Verification: verification-record gate

## What was verified ／ 驗證項目
The shared `scripts/ci/check-verification-record.sh` (byte-identical to wave-archive/wave-archive#479) against throwaway git fixtures: code PR without a record fails with fix instructions; empty, placeholder-only and incomplete records fail; valid records pass; docs-only PRs pass without a record. CI wiring: `.github/workflows/ci.yml` runs the tests and the gate on `pull_request` only, with `fetch-depth: 0`.

## Command ／ 指令
```bash
/bin/bash scripts/ci/check-verification-record.test.sh
```

## Result ／ 結果
```
GNU bash, version 3.2.57(1)-release (arm64-apple-darwin26)
38 passed, 0 failed
```

## When ／ 時間或 commit
2026-11-27 17:09 Asia/Taipei
