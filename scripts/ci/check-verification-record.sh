#!/usr/bin/env bash
set -euo pipefail

RECORD_DIR="verifications"
FORMAT_DOC="${RECORD_DIR}/README.md"

usage() {
  printf 'usage: check-verification-record.sh --base <ref>\n' >&2
  printf '  env PR_NUMBER (optional) names the expected verifications/<pr-number>.md\n' >&2
  exit 2
}

base=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base)
      [ $# -ge 2 ] || usage
      base="$2"
      shift 2
      ;;
    --base=*)
      base="${1#--base=}"
      shift
      ;;
    -h | --help) usage ;;
    *)
      printf 'verification-record: unknown argument: %s\n' "$1" >&2
      usage
      ;;
  esac
done
[ -n "$base" ] || usage

fatal() {
  printf 'verification-record: ERROR: %s\n' "$1" >&2
  exit 2
}

git rev-parse --verify --quiet "${base}^{commit}" >/dev/null \
  || fatal "base ref '${base}' not found; fetch it first (git fetch origin <base-branch>, or actions/checkout with fetch-depth: 0)"
git merge-base "$base" HEAD >/dev/null 2>&1 \
  || fatal "no merge base between '${base}' and HEAD; the clone is too shallow (use fetch-depth: 0)"

lower() { LC_ALL=C tr 'A-Z' 'a-z'; }

is_doc_path() {
  case "$1" in
    *.md | docs/* | daily/* | inbox/fleet/*) return 0 ;;
  esac
  return 1
}

trim_punct() {
  LC_ALL=C sed -E \
    -e 's/^([[:space:][:punct:]]|　|。|，|、|：|；|！|？|（|）|「|」|『|』|…|—|－)+//' \
    -e 's/([[:space:][:punct:]]|　|。|，|、|：|；|！|？|（|）|「|」|『|』|…|—|－)+$//'
}

is_placeholder_line() {
  local norm
  norm="$(printf '%s' "$1" | trim_punct | lower)"
  case "$norm" in
    "" | todo | tbd | fixme | xxx | "n/a" | tbc | 待補 | 稍後 | "lorem ipsum" | "lorem ipsum "*) return 0 ;;
  esac
  return 1
}

section_key() {
  local text part key=""
  text="$(printf '%s' "$1" | LC_ALL=C sed -E -e 's/[[:space:]]*#+[[:space:]]*$//' -e 's/^[0-9]+[.)][[:space:]]*//' | lower)"
  text="$(printf '%s' "$text" | LC_ALL=C sed -e 's#／#/#g' -e 's#｜#/#g' -e 's#|#/#g')"
  while IFS= read -r part || [ -n "$part" ]; do
    part="$(printf '%s' "$part" | trim_punct)"
    case "$part" in
      "what was verified" | verified | 驗證項目) key="verified" ;;
      command | commands | 指令) key="command" ;;
      result | results | 結果) key="result" ;;
      when | 時間 | commit | "時間或 commit" | "時間或commit") key="when" ;;
    esac
    [ -z "$key" ] || break
  done <<EOF
$(printf '%s\n' "$text" | tr '/' '\n')
EOF
  printf '%s' "$key"
}

section_label() {
  case "$1" in
    verified) printf '%s' '## What was verified ／ 驗證項目' ;;
    command) printf '%s' '## Command ／ 指令' ;;
    result) printf '%s' '## Result ／ 結果' ;;
    when) printf '%s' '## When ／ 時間或 commit' ;;
  esac
}

has_timestamp_or_sha() {
  local body="$1" token
  local ts_re='[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}(:[0-9]{2})?[ ]?(Z|[+-][0-9]{2}:?[0-9]{2}|UTC|GMT|[A-Z][A-Za-z_]+/[A-Za-z_]+)'
  if printf '%s\n' "$body" | grep -Eq "$ts_re"; then
    return 0
  fi
  for token in $(printf '%s\n' "$body" | LC_ALL=C tr -c '0-9A-Za-z' ' '); do
    if [[ "$token" =~ ^[0-9a-f]{7,40}$ && "$token" =~ [a-f] ]]; then
      return 0
    fi
  done
  return 1
}

record_problems() {
  local content="$1"
  if [ -z "$(printf '%s' "$content" | tr -d '[:space:]')" ]; then
    printf 'file is empty\n'
    return
  fi

  local body_verified="" body_command="" body_result="" body_when=""
  local seen_verified=0 seen_command=0 seen_result=0 seen_when=0
  local current="" in_fence=0 line key
  local heading_re='^#{1,6}[[:space:]]+(.*)$'
  local fence_re='^[[:space:]]*(```|~~~)'

  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ $fence_re ]]; then
      if [ "$in_fence" -eq 0 ]; then in_fence=1; else in_fence=0; fi
      continue
    fi
    if [ "$in_fence" -eq 0 ] && [[ "$line" =~ $heading_re ]]; then
      key="$(section_key "${BASH_REMATCH[1]}")"
      current="$key"
      case "$key" in
        verified) seen_verified=1 ;;
        command) seen_command=1 ;;
        result) seen_result=1 ;;
        when) seen_when=1 ;;
      esac
      continue
    fi
    case "$current" in
      verified) body_verified="${body_verified}${line}"$'\n' ;;
      command) body_command="${body_command}${line}"$'\n' ;;
      result) body_result="${body_result}${line}"$'\n' ;;
      when) body_when="${body_when}${line}"$'\n' ;;
    esac
  done <<EOF
$content
EOF

  local name seen body all_placeholder bline
  for name in verified command result when; do
    eval "seen=\$seen_${name}; body=\$body_${name}"
    if [ "$seen" -eq 0 ]; then
      printf 'missing section: %s\n' "$(section_label "$name")"
      continue
    fi
    if [ -z "$(printf '%s' "$body" | tr -d '[:space:]')" ]; then
      printf 'empty section: %s\n' "$(section_label "$name")"
      continue
    fi
    all_placeholder=1
    while IFS= read -r bline || [ -n "$bline" ]; do
      if ! is_placeholder_line "$bline"; then
        all_placeholder=0
        break
      fi
    done <<EOF
$body
EOF
    if [ "$all_placeholder" -eq 1 ]; then
      printf 'placeholder-only section (TODO/TBD/FIXME/XXX/N/A/TBC/待補/稍後/lorem ipsum/punctuation): %s\n' "$(section_label "$name")"
      continue
    fi
    if [ "$name" = "when" ] && ! has_timestamp_or_sha "$body"; then
      printf 'section %s needs a timestamp with timezone (e.g. 2026-11-27 16:40 Asia/Taipei) or a 7-40 character commit SHA\n' "$(section_label when)"
    fi
  done
  return 0
}

print_format_help() {
  local example="verifications/<pr-number>.md"
  if [ -n "${PR_NUMBER:-}" ]; then
    example="verifications/${PR_NUMBER}.md"
  fi
  cat >&2 <<EOF
  Fix: add ${example} (or verifications/<slug>.md before the PR has a number)
  to this PR, with a non-empty body under each heading:
    $(section_label verified)
    $(section_label command)
    $(section_label result)
    $(section_label when)   (timestamp with timezone, e.g. 2026-11-27 16:40 Asia/Taipei, or a 7-40 character commit SHA)
  Bodies that are only TODO/TBD/FIXME/XXX/N/A/TBC/待補/稍後/lorem ipsum or punctuation do not count.
  Format: ${FORMAT_DOC}
  Docs-only exemption: the PR needs no record only when every changed path
  ends in .md or sits under docs/, daily/ or inbox/fleet/.
EOF
}

range="${base}...HEAD"
changed="$(git diff --name-only --no-renames "$range")" || fatal "git diff ${range} failed"

if [ -z "$changed" ]; then
  printf 'verification-record: PASS (no changes against %s)\n' "$base"
  exit 0
fi

non_doc=""
while IFS= read -r path; do
  [ -n "$path" ] || continue
  is_doc_path "$path" || non_doc="${non_doc}${path}"$'\n'
done <<EOF
$changed
EOF

if [ -z "$non_doc" ]; then
  printf 'verification-record: PASS (docs-only exemption: every changed path ends in .md or sits under docs/, daily/ or inbox/fleet/)\n'
  exit 0
fi

candidates="$(git diff --name-only --diff-filter=ACMR "$range" -- "${RECORD_DIR}/")" \
  || fatal "git diff ${range} -- ${RECORD_DIR}/ failed"

valid=""
report=""
while IFS= read -r path; do
  [ -n "$path" ] || continue
  case "$path" in
    "$FORMAT_DOC") continue ;;
    "${RECORD_DIR}"/*/*) continue ;;
    "${RECORD_DIR}"/*.md) ;;
    *) continue ;;
  esac
  problems="$(record_problems "$(git show "HEAD:${path}")")"
  if [ -z "$problems" ]; then
    valid="${valid}${path}"$'\n'
  else
    report="${report}  ${path}:"$'\n'"$(printf '%s\n' "$problems" | sed 's/^/    - /')"$'\n'
  fi
done <<EOF
$candidates
EOF

if [ -n "$valid" ]; then
  first_valid="$(printf '%s' "$valid" | sed -n '1p')"
  printf 'verification-record: PASS (%s)\n' "$(printf '%s' "$valid" | tr '\n' ' ' | sed 's/ $//')"
  if [ -n "${PR_NUMBER:-}" ] && ! printf '%s' "$valid" | grep -qx "${RECORD_DIR}/${PR_NUMBER}.md"; then
    printf 'verification-record: note: prefer naming the record %s/%s.md (found %s)\n' "$RECORD_DIR" "$PR_NUMBER" "$first_valid"
  fi
  exit 0
fi

non_doc_count="$(printf '%s' "$non_doc" | grep -c .)"
{
  if [ -n "$report" ]; then
    printf 'verification-record: FAIL: no valid verification record in this PR.\n'
    printf '  Invalid records:\n%s' "$report"
  else
    printf 'verification-record: FAIL: this PR changes non-doc paths but adds no verifications/*.md record.\n'
  fi
  printf '  Non-doc paths changed (%s, first 10 shown):\n' "$non_doc_count"
  printf '%s' "$non_doc" | sed -n '1,10s/^/    /p'
} >&2
print_format_help
if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  printf '::error::verification-record: add a valid verifications/<pr-number>.md (see %s)\n' "$FORMAT_DOC"
fi
exit 1
