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

# Shared test infrastructure: creates a stub `docker` executable in DIR so
# tests never depend on the real daemon's state. MODE: healthy | broken | hang.
# Reused by this task's docker_healthy tests and by task 7's recovery-polling
# tests, so it lives here with the other harness helpers rather than nested
# inside a single test function.
make_docker_stub() {
  local dir="$1" mode="$2"
  mkdir -p "$dir"
  case "$mode" in
    healthy)
      cat >"$dir/docker" <<'STUB'
#!/usr/bin/env bash
printf 'Server Version: 99.0.0\n'
exit 0
STUB
      ;;
    broken)
      cat >"$dir/docker" <<'STUB'
#!/usr/bin/env bash
printf 'Cannot connect to the Docker daemon\n' >&2
exit 1
STUB
      ;;
    hang)
      cat >"$dir/docker" <<'STUB'
#!/usr/bin/env bash
sleep 300
STUB
      ;;
  esac
  chmod +x "$dir/docker"
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

printf '\n=== run_timeout ===\n'

test_run_timeout() {
  local out rc

  out="$(run_timeout 5 printf 'hello')"
  assert_eq "returns command stdout" "hello" "$out"

  run_timeout 5 true
  assert_eq "propagates success" "0" "$?"

  run_timeout 5 false
  assert_eq "propagates failure" "1" "$?"

  rc=0
  run_timeout 1 sleep 5 || rc=$?
  assert_eq "returns 124 on timeout" "124" "$rc"

  # Force the pure-bash fallback by making bin_exists report nothing available.
  # The override is scoped to a subshell so later tests still see the real one.
  rc=0
  (
    # shellcheck disable=SC2329  # invoked indirectly by run_timeout name lookup
    bin_exists() { return 1; }
    run_timeout 1 sleep 5
  ) || rc=$?
  assert_eq "fallback path also returns 124" "124" "$rc"

  rc=0
  out="$(
    # shellcheck disable=SC2329  # invoked indirectly by run_timeout name lookup
    bin_exists() { return 1; }
    run_timeout 5 printf 'fallback-ok'
  )" || rc=$?
  assert_eq "fallback path returns stdout" "fallback-ok" "$out"
}
test_run_timeout

printf '\n=== docker_pids ===\n'

test_docker_pids() {
  # Keep both forms: newline for counting, space-padded for substring checks.
  # A space-padded haystack is required — searching newline-separated output
  # for " <pid> " can never match, which would make these assertions vacuous.
  local pids_nl pids_sp
  pids_nl="$(docker_pids)"
  pids_sp=" $(printf '%s' "$pids_nl" | tr '\n' ' ') "

  # $$ and $PPID are never real candidates in live output (the harness's own
  # command line does not contain $DOCKER_APP, and its comm is "bash", which
  # matches no exact name), so asserting they are absent from live output
  # proves nothing — it would pass even if the self/parent exclusion were
  # deleted entirely. Kept below only as an additional sanity check; the
  # real safety test stubs discovery so $$ and $PPID genuinely ARE
  # candidates, which exercises the exclusion filter itself.
  assert_not_contains "sanity: live output has no own PID" "$pids_sp" " $$ "
  assert_not_contains "sanity: live output has no parent PID" "$pids_sp" " $PPID "

  local filtered
  filtered="$(
    # shellcheck disable=SC2329  # invoked indirectly by docker_pids name lookup
    pgrep() { printf '%s\n%s\n%s\n' "$$" "$PPID" 99999; }
    # shellcheck disable=SC2329  # invoked indirectly by docker_pids name lookup
    ps() { printf '%s\n' "$DOCKER_APP/Contents/MacOS/com.docker.backend"; }
    docker_pids | tr '\n' ' '
  )"
  assert_eq "excludes own and parent PID, keeps others" "99999 " "$filtered"

  # Guard against a vacuous suite: if Docker is running there must be matches.
  local count
  count="$(printf '%s\n' "$pids_nl" | grep -c . || true)"
  if pgrep -x com.docker.backend >/dev/null 2>&1; then
    if [ "$count" -gt 0 ]; then
      pass "finds Docker processes while Docker is running"
    else
      fail "finds Docker processes while Docker is running" "got 0 pids"
    fi
  fi

  # Every returned PID must be a live process.
  local pid bad=""
  for pid in $pids_nl; do
    if ! kill -0 "$pid" 2>/dev/null; then
      bad="$bad $pid"
    fi
  done
  assert_eq "all returned PIDs are live" "" "$bad"

  # Output must be numeric and deduped.
  local nonnum=""
  for pid in $pids_nl; do
    case "$pid" in
      ''|*[!0-9]*) nonnum="$nonnum [$pid]" ;;
    esac
  done
  assert_eq "all output is numeric" "" "$nonnum"

  local uniq
  uniq="$(printf '%s\n' "$pids_nl" | sort -u | grep -c . || true)"
  assert_eq "output is deduped" "$count" "$uniq"

  # A decoy process whose name contains "docker" but is not Docker Desktop
  # must not be matched.
  local decoy="$TMPROOT/docker-nuke-decoy"
  cat >"$decoy" <<'STUB'
#!/usr/bin/env bash
sleep 30
STUB
  chmod +x "$decoy"
  # The decoy's command line must mention $DOCKER_APP so pgrep -f "$DOCKER_APP"
  # actually matches it (the script ignores its args and just sleeps); its
  # comm stays "bash", which the comm filter must then reject. Without this,
  # pgrep -f never matches the decoy at all and the comm filter is untested.
  "$decoy" "$DOCKER_APP/Contents/MacOS/not-really-docker" &
  local decoy_pid=$!
  sleep 1
  pids_sp=" $(docker_pids | tr '\n' ' ') "
  assert_not_contains "ignores decoy named docker-nuke-*" "$pids_sp" " $decoy_pid "

  # Guard against a vacuous pass: with Docker stopped, docker_pids returns
  # empty output and the assertion above passes for the wrong reason.
  # Reuses the anti-vacuous guard pattern used above.
  if pgrep -x com.docker.backend >/dev/null 2>&1; then
    if [ -n "$(printf '%s' "$pids_sp" | tr -d '[:space:]')" ]; then
      pass "decoy check ran against non-empty output while Docker is running"
    else
      fail "decoy check ran against non-empty output while Docker is running" "got empty pids"
    fi
  fi

  kill -9 "$decoy_pid" 2>/dev/null || true
  wait "$decoy_pid" 2>/dev/null || true
}
test_docker_pids

printf '\n=== docker_pids errexit contract ===\n'

test_docker_pids_errexit() {
  # Every call site in docker-nuke invokes docker_pids inside $( ), where bash
  # never applies errexit to the failing command that triggered it — so a
  # regression that lets docker_pids abort under `set -e` would go completely
  # undetected by every other test in this file. Prove the contract with a
  # real script, invoked directly (not inside $( )), that calls docker_pids
  # as a plain statement under `set -euo pipefail`.
  #
  # The specific failure mode is `pgrep -f "$DOCKER_APP"` matching zero
  # processes (pipefail + no trailing `|| true` -> the pipeline itself exits
  # non-zero -> set -e aborts before the exact-name branch ever runs). On a
  # machine where Docker Desktop happens to be live, the real $DOCKER_APP
  # always has matches, so calling docker_pids unmodified would never
  # exercise that zero-match branch and the mutation would go undetected
  # regardless of host state. Override DOCKER_APP after sourcing to a path
  # guaranteed to match nothing, so the zero-match code path is exercised
  # deterministically no matter whether Docker is running on this host.
  local probe="$TMPROOT/errexit-probe.sh"
  cat >"$probe" <<PROBE
#!/usr/bin/env bash
set -euo pipefail
source "$SCRIPT_DIR/docker-nuke"
DOCKER_APP="/nonexistent/docker-nuke-test-probe-guard"
docker_pids >/dev/null
printf 'survived\n'
PROBE
  chmod +x "$probe"
  local probe_out probe_rc=0
  probe_out="$("$probe" 2>&1)" || probe_rc=$?
  assert_eq "docker_pids does not abort a set -euo pipefail caller" "0" "$probe_rc"
  assert_contains "set -e probe ran to completion" "$probe_out" "survived"
}
test_docker_pids_errexit

printf '\n=== bash 3.2 syntax compatibility ===\n'

test_bash32_syntax() {
  # bash 3.2 (stock macOS /bin/bash) has a $( ) scanner that does not skip
  # comments, so an apostrophe inside a comment inside a command substitution
  # opens an unterminated quote and the whole file fails to parse. Guard
  # against that regressing silently by parse-checking both files with the
  # real system bash on every run.
  local out rc

  rc=0
  out="$(/bin/bash -n "$SCRIPT_DIR/docker-nuke" 2>&1)" || rc=$?
  assert_eq "docker-nuke parses under /bin/bash -n" "0" "$rc"
  assert_eq "docker-nuke -n produces no output" "" "$out"

  rc=0
  out="$(/bin/bash -n "$SCRIPT_DIR/test-docker-nuke.sh" 2>&1)" || rc=$?
  assert_eq "test-docker-nuke.sh parses under /bin/bash -n" "0" "$rc"
  assert_eq "test-docker-nuke.sh -n produces no output" "" "$out"
}
test_bash32_syntax

printf '\n=== docker_healthy ===\n'

test_docker_healthy() {
  local stub="$TMPROOT/stub" oldpath="$PATH" rc

  make_docker_stub "$stub" healthy
  PATH="$stub:$oldpath"
  rc=0; docker_healthy || rc=$?
  assert_eq "healthy daemon returns 0" "0" "$rc"

  make_docker_stub "$stub" broken
  rc=0; docker_healthy || rc=$?
  assert_eq "broken daemon returns non-zero" "1" "$rc"

  make_docker_stub "$stub" hang
  HEALTH_TIMEOUT=1
  rc=0; docker_healthy || rc=$?
  assert_eq "hanging daemon returns 124" "124" "$rc"
  # shellcheck disable=SC2034  # restores the value docker_healthy (sourced from docker-nuke) reads; the source=/dev/null directive above hides that cross-file read from this analysis
  HEALTH_TIMEOUT=6

  PATH="$oldpath"
}
test_docker_healthy

printf '\n=== dump ===\n'

test_dump() {
  local d rc

  d="$(new_dump_dir)"
  assert_eq "dump dir is created" "yes" "$([ -d "$d" ] && printf 'yes' || printf 'no')"
  assert_contains "dump dir lives under DUMP_ROOT" "$d" "$DUMP_ROOT"

  # shellcheck disable=SC2034  # DUMP_DIR is read by capture() (sourced from docker-nuke); the source=/dev/null directive above hides that cross-file read from this analysis
  DUMP_DIR="$d"
  CAPTURE_FAILURES=""

  capture "ok.txt" 5 printf 'captured'
  assert_eq "successful capture writes its file" "captured" "$(cat "$d/ok.txt")"
  assert_eq "successful capture records no failure" "" "$CAPTURE_FAILURES"

  rc=0
  capture "slow.txt" 1 sleep 5 || rc=$?
  assert_eq "timed-out capture still returns 0" "0" "$rc"
  assert_contains "timed-out capture is recorded" "$CAPTURE_FAILURES" "slow.txt"
  assert_contains "timed-out capture notes failure in file" "$(cat "$d/slow.txt")" "failed or timed out"

  rc=0
  capture "missing.txt" 5 this-command-does-not-exist || rc=$?
  assert_eq "failed capture still returns 0" "0" "$rc"
  assert_contains "failed capture is recorded" "$CAPTURE_FAILURES" "missing.txt"

  # Regression coverage for the headline run_timeout fix: an external
  # timeout/gtimeout binary can never exec a shell function directly (execvp
  # fails with rc=127), so run_timeout must route shell functions to its
  # pure-bash poller instead. Every capture test above passes an external
  # command (printf, sleep, this-command-does-not-exist), so without this
  # assertion that routing has zero coverage and could regress silently.
  # shellcheck disable=SC2329  # invoked indirectly by capture -> run_timeout name lookup
  that_function() { printf 'shell-function-output\n'; }
  capture "fn.txt" 5 that_function
  assert_contains "capture of a shell function produces its real output" \
    "$(cat "$d/fn.txt")" "shell-function-output"
  assert_not_contains "capture of a shell function is not a failure banner" \
    "$(cat "$d/fn.txt")" "failed or timed out"

  # Retention: 12 dumps in, 10 newest survive.
  rm -rf "${DUMP_ROOT:?}"
  mkdir -p "$DUMP_ROOT"
  local i
  for i in 01 02 03 04 05 06 07 08 09 10 11 12; do
    mkdir -p "$DUMP_ROOT/202601${i}T000000Z"
  done
  prune_dumps 10
  # shellcheck disable=SC2012  # dump dir names are our own generated timestamps, never contain newlines; a plain count needs plain lines, not find -print0
  assert_eq "keeps exactly 10 dumps" "10" "$(ls -1 "$DUMP_ROOT" | wc -l | tr -d ' ')"
  assert_eq "prunes the oldest" "no" \
    "$([ -d "$DUMP_ROOT/20260101T000000Z" ] && printf 'yes' || printf 'no')"
  assert_eq "keeps the newest" "yes" \
    "$([ -d "$DUMP_ROOT/20260112T000000Z" ] && printf 'yes' || printf 'no')"
}
test_dump

printf '\n=== summary ===\n'
teardown_tmp
printf 'ran %d, failed %d\n' "$TESTS_RUN" "$TESTS_FAILED"
[ "$TESTS_FAILED" -eq 0 ]
