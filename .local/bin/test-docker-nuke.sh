#!/usr/bin/env bash
# Test harness for docker-nuke. No external dependencies.
# Run: ./test-docker-nuke.sh

set -uo pipefail  # deliberately not -e: a failing assertion must not abort the run

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_RUN=0
TESTS_FAILED=0
TMPROOT=""

setup_tmp() {
  TMPROOT="$(mktemp -d)"
  export DOCKER_NUKE_DUMP_ROOT="$TMPROOT/dumps"
}

teardown_tmp() {
  if [ -n "$TMPROOT" ] && [ -d "$TMPROOT" ]; then
    rm -rf "$TMPROOT"
  fi
  TMPROOT=""
}

pass() {
  TESTS_RUN=$((TESTS_RUN + 1))
  printf '  ok   %s\n' "$1"
}

fail() {
  TESTS_RUN=$((TESTS_RUN + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  printf '  FAIL %s\n       %s\n' "$1" "$2"
}

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    pass "$desc"
  else
    fail "$desc" "expected [$expected] got [$actual]"
  fi
}

assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  case "$haystack" in
    *"$needle"*) pass "$desc" ;;
    *) fail "$desc" "expected to contain [$needle] got [$haystack]" ;;
  esac
}

assert_not_contains() {
  local desc="$1" haystack="$2" needle="$3"
  case "$haystack" in
    *"$needle"*) fail "$desc" "expected NOT to contain [$needle] got [$haystack]" ;;
    *) pass "$desc" ;;
  esac
}

# Source the script under test. Its trailing BASH_SOURCE/$0 guard means main
# runs only when the script is executed directly, so sourcing it here defines
# the functions without triggering a real nuke.
setup_tmp
# shellcheck source=/dev/null
source "$SCRIPT_DIR/docker-nuke"
set +e  # the sourced script sets -e; undo it for the harness

printf '\n=== argument parsing ===\n'

test_parse_args() {
  parse_args --force
  assert_eq "--force sets OPT_FORCE" "1" "$OPT_FORCE"

  parse_args -n
  assert_eq "-n sets OPT_NO_RESTART" "1" "$OPT_NO_RESTART"

  parse_args --dry-run
  assert_eq "--dry-run sets OPT_DRY_RUN" "1" "$OPT_DRY_RUN"

  parse_args --deep
  assert_eq "--deep sets OPT_DEEP" "1" "$OPT_DEEP"

  parse_args
  assert_eq "no flags leaves OPT_FORCE off" "0" "$OPT_FORCE"

  parse_args --bogus >/dev/null 2>&1
  assert_eq "unknown flag returns 2" "2" "$?"

  local help_text
  help_text="$(usage)"
  assert_contains "usage mentions --dry-run" "$help_text" "--dry-run"
  assert_contains "usage mentions --deep" "$help_text" "--deep"
}
test_parse_args

printf '\n=== summary ===\n'
teardown_tmp
printf 'ran %d, failed %d\n' "$TESTS_RUN" "$TESTS_FAILED"
[ "$TESTS_FAILED" -eq 0 ]
