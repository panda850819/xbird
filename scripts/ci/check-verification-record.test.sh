#!/usr/bin/env bash
set -euo pipefail
unset PR_NUMBER GITHUB_ACTIONS

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checker="${script_dir}/check-verification-record.sh"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

passed=0
failed=0
case_no=0

new_repo() {
  case_no=$((case_no + 1))
  repo="${fixture_root}/case-${case_no}"
  mkdir -p "$repo"
  git -C "$repo" init --quiet
  git -C "$repo" config user.name fixture
  git -C "$repo" config user.email fixture@example.invalid
  git -C "$repo" config commit.gpgsign false
  printf 'base\n' >"${repo}/README.md"
  mkdir -p "${repo}/verifications"
  printf '# Verification records\n' >"${repo}/verifications/README.md"
  git -C "$repo" add -A
  git -C "$repo" commit --quiet -m base
  git -C "$repo" branch -M main
  git -C "$repo" checkout --quiet -b pr
}

put() {
  mkdir -p "$(dirname "${repo}/$1")"
  printf '%s' "$2" >"${repo}/$1"
}

commit_pr() {
  git -C "$repo" add -A
  git -C "$repo" commit --quiet --allow-empty -m pr
}

expect() {
  local name="$1" want="$2" output status pattern ok=1
  shift 2
  set +e
  output="$(cd "$repo" && bash "$checker" --base main 2>&1)"
  status=$?
  set -e
  [ "$status" = "$want" ] || ok=0
  for pattern in "$@"; do
    printf '%s\n' "$output" | grep -Fq -- "$pattern" || ok=0
  done
  if [ "$ok" -eq 1 ]; then
    passed=$((passed + 1))
    printf 'ok   %s\n' "$name"
  else
    failed=$((failed + 1))
    printf 'FAIL %s (exit %s, want %s)\n%s\n' "$name" "$status" "$want" "$output" | sed '2,$s/^/     | /'
  fi
}

valid_record='# Verification for #42

## What was verified
The gate rejects code PRs without a record.

## Command
```bash
# run the fixtures
bash scripts/ci/check-verification-record.test.sh
```

## Result
All fixture cases pass.

## When
2026-11-27 16:40 Asia/Taipei
'

zh_record='## 驗證項目
門檻會擋下沒有驗證紀錄的程式 PR。

## 指令
bash scripts/ci/check-verification-record.test.sh

## 結果
全部通過。

## 時間或 commit
1a2b3c4d
'

bilingual_record='## 1. What was verified ／ 驗證項目
gate behaviour
## Command / 指令
`make test`
## Result ／ 結果
pass
## When ／ 時間或 commit
2026-11-27T08:40:00Z
'

record_with() {
  local section="$1" body="$2"
  printf '## What was verified\n%s\n\n## Command\n%s\n\n## Result\n%s\n\n## When\n%s\n' \
    "$([ "$section" = verified ] && printf '%s' "$body" || printf 'gate behaviour')" \
    "$([ "$section" = command ] && printf '%s' "$body" || printf 'bash test.sh')" \
    "$([ "$section" = result ] && printf '%s' "$body" || printf 'all pass')" \
    "$([ "$section" = when ] && printf '%s' "$body" || printf '2026-11-27 16:40 Asia/Taipei')"
}

new_repo
put src/app.ts 'export const x = 1;\n'
commit_pr
expect "code PR without record fails with actionable message" 1 \
  "adds no verifications/*.md record" "src/app.ts" "verifications/<pr-number>.md" \
  "## Command ／ 指令" "Docs-only exemption" "docs/, daily/ or inbox/fleet/"

new_repo
put .github/workflows/ci.yml 'on: pull_request\n'
put docs/notes.md 'notes\n'
commit_pr
expect "workflow plus docs change still needs a record" 1 ".github/workflows/ci.yml"

new_repo
put scripts/deploy.sh 'echo hi\n'
put verifications/README.md '# Verification records (edited)\n'
commit_pr
expect "verifications/README.md does not count as a record" 1 "adds no verifications/*.md record"

new_repo
put app.py 'print(1)\n'
put verifications/nested/42.md "$valid_record"
commit_pr
expect "record in a subdirectory does not count" 1 "adds no verifications/*.md record"

new_repo
put app.py 'print(1)\n'
commit_pr
output="$(cd "$repo" && PR_NUMBER=77 bash "$checker" --base main 2>&1 || true)"
if printf '%s\n' "$output" | grep -Fq "add verifications/77.md"; then
  passed=$((passed + 1)); printf 'ok   %s\n' "PR_NUMBER names the expected record path"
else
  failed=$((failed + 1)); printf 'FAIL %s\n%s\n' "PR_NUMBER names the expected record path" "$output"
fi

new_repo
put app.js 'x\n'
put verifications/42.md ''
commit_pr
expect "empty record fails" 1 "verifications/42.md:" "file is empty"

new_repo
put app.js 'x\n'
put verifications/42.md $'   \n\t\n'
commit_pr
expect "whitespace-only record fails" 1 "file is empty"

for placeholder in TODO tbd 'FIXME.' XXX 'N/A' TBC '待補' '稍後。' 'Lorem ipsum dolor sit amet' '.' '-' '...' '- TODO'; do
  new_repo
  put app.js 'x\n'
  put verifications/42.md "$(record_with result "$placeholder")"
  commit_pr
  expect "placeholder result '${placeholder}' fails" 1 "placeholder-only section" "## Result ／ 結果"
done

new_repo
put app.js 'x\n'
put verifications/42.md "$(record_with command $'```\nTODO\n```')"
commit_pr
expect "placeholder inside a code fence fails" 1 "placeholder-only section" "## Command ／ 指令"

new_repo
put app.js 'x\n'
put verifications/42.md "$(record_with verified $'\n   \n')"
commit_pr
expect "blank section fails" 1 "empty section: ## What was verified ／ 驗證項目"

new_repo
put app.js 'x\n'
put verifications/42.md $'## What was verified\nthing\n\n## Command\nrun\n\n## When\n2026-11-27 16:40 Asia/Taipei\n'
commit_pr
expect "missing Result section fails" 1 "missing section: ## Result ／ 結果"

new_repo
put app.js 'x\n'
put verifications/42.md "$(record_with when 'yesterday afternoon')"
commit_pr
expect "When without timestamp or SHA fails" 1 "needs a timestamp with timezone"

new_repo
put app.js 'x\n'
put verifications/42.md "$(record_with when '2026-11-27 16:40')"
commit_pr
expect "When timestamp without timezone fails" 1 "needs a timestamp with timezone"

new_repo
put app.js 'x\n'
put verifications/42.md "$(record_with when '12345678')"
commit_pr
expect "When with a digits-only token is not a SHA" 1 "needs a timestamp with timezone"

new_repo
put src/app.ts 'export const x = 1;\n'
put verifications/42.md "$valid_record"
commit_pr
expect "valid English record passes (fenced shell comment is not a heading)" 0 "verification-record: PASS (verifications/42.md)"

new_repo
put infra/setup.sh 'echo\n'
put verifications/ci-gate.md "$zh_record"
commit_pr
expect "valid Traditional Chinese slug record with SHA passes" 0 "PASS (verifications/ci-gate.md)"

new_repo
put package.json '{}\n'
put verifications/43.md "$bilingual_record"
commit_pr
expect "bilingual numbered headings with UTC timestamp pass" 0 "PASS (verifications/43.md)"

new_repo
put package.json '{}\n'
put verifications/43.md "$(record_with when '2026-11-27 08:40:00 +0800')"
commit_pr
expect "numeric UTC offset passes" 0 "PASS"

new_repo
put app.go 'package main\n'
put verifications/bad.md 'TODO'
put verifications/good.md "$valid_record"
commit_pr
expect "one valid record is enough beside an invalid one" 0 "PASS (verifications/good.md)"

new_repo
put app.go 'package main\n'
put verifications/slug.md "$valid_record"
commit_pr
output="$(cd "$repo" && PR_NUMBER=9 bash "$checker" --base main 2>&1)" && status=0 || status=$?
if [ "$status" = 0 ] && printf '%s\n' "$output" | grep -Fq "prefer naming the record verifications/9.md"; then
  passed=$((passed + 1)); printf 'ok   %s\n' "slug record passes with a naming note when PR_NUMBER differs"
else
  failed=$((failed + 1)); printf 'FAIL %s (exit %s)\n%s\n' "slug record passes with a naming note when PR_NUMBER differs" "$status" "$output"
fi

new_repo
put app.go 'package main\n'
put verifications/42.md "$valid_record"
commit_pr
git -C "$repo" mv verifications/42.md verifications/44.md
commit_pr
expect "renamed record still counts" 0 "PASS (verifications/44.md)"

new_repo
put README.md 'changed\n'
put docs/guide.txt 'guide\n'
put daily/2026-11-27.json '{}\n'
put inbox/fleet/report.yml 'a: 1\n'
put changes/481.md '- note (#481)\n'
commit_pr
expect "docs-only PR passes without a record" 0 "docs-only exemption"

new_repo
put daily/2026-11-27/brief.html '<p>brief</p>\n'
commit_pr
expect "automated daily output passes without a record" 0 "docs-only exemption"

new_repo
commit_pr
expect "PR with no changes passes" 0 "no changes against main"

new_repo
output="$(cd "$repo" && bash "$checker" --base origin/missing 2>&1)" && status=0 || status=$?
if [ "$status" = 2 ] && printf '%s\n' "$output" | grep -Fq "fetch-depth: 0"; then
  passed=$((passed + 1)); printf 'ok   %s\n' "unknown base ref exits 2 with a fetch hint"
else
  failed=$((failed + 1)); printf 'FAIL %s (exit %s)\n%s\n' "unknown base ref exits 2 with a fetch hint" "$status" "$output"
fi

output="$(cd "$repo" && bash "$checker" 2>&1)" && status=0 || status=$?
if [ "$status" = 2 ] && printf '%s\n' "$output" | grep -Fq "usage:"; then
  passed=$((passed + 1)); printf 'ok   %s\n' "missing --base prints usage"
else
  failed=$((failed + 1)); printf 'FAIL %s (exit %s)\n%s\n' "missing --base prints usage" "$status" "$output"
fi

printf '\n%s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
