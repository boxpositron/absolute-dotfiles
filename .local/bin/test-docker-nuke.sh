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
  # DUMP_DIR and CAPTURE_FAILURES are mutated below with no restore below
  # this point in the original code -- the identical leak Task 7 already
  # fixed one block below in test_restart_and_summary (Fix I3, final
  # review). The stale path then propagates through every later block in
  # this file. Save/restore the same way test_restart_and_summary does.
  local old_dump_dir="$DUMP_DIR" old_capture_failures="$CAPTURE_FAILURES"

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

  DUMP_DIR="$old_dump_dir"
  CAPTURE_FAILURES="$old_capture_failures"
}
test_dump

printf '\n=== kill escalation ===\n'

test_kill() {
  local a b c d rc alive

  sleep 60 & a=$!
  sleep 60 & b=$!
  sleep 1

  alive="$(pids_alive "$a" "$b")"
  assert_contains "pids_alive reports first live pid" " $alive " " $a "
  assert_contains "pids_alive reports second live pid" " $alive " " $b "

  kill_pids TERM "$a"
  sleep 1
  alive="$(pids_alive "$a" "$b")"
  assert_not_contains "SIGTERM kills the target" " $alive " " $a "
  assert_contains "SIGTERM leaves others alone" " $alive " " $b "

  rc=0; wait_for_exit 3 "$a" || rc=$?
  assert_eq "wait_for_exit returns 0 for a dead pid" "0" "$rc"

  rc=0; wait_for_exit 2 "$b" || rc=$?
  assert_eq "wait_for_exit returns 1 while pid lives" "1" "$rc"

  # A third pid, still alive at this point, pairs with the emptiness check
  # below (Fix 5): a pids_alive that always prints nothing would make the
  # emptiness assertion pass for the wrong reason, but this positive
  # assertion over the same call would then fail, since c is genuinely
  # alive right now.
  sleep 60 & c=$!

  kill_pids KILL "$b"
  sleep 1
  assert_eq "SIGKILL clears the last pid" "" "$(pids_alive "$a" "$b")"
  assert_contains "pids_alive still detects a live pid alongside dead ones" \
    " $(pids_alive "$a" "$b" "$c") " " $c "

  # Fix 4: invoking kill_pids inside a `||` list (as this assertion previously
  # did) suppresses set -e throughout the whole function body, so it can
  # never prove the `|| true` guard on the real kill call inside kill_pids
  # does anything at all. A bare invocation under genuinely active set -e is
  # required. Pairing it with a real target in the same call (Fix 5) proves
  # kill_pids is not simply a no-op that trivially "succeeds": if it were, d
  # would still be alive afterward.
  sleep 60 & d=$!
  rc=0
  ( set -e; kill_pids TERM 999999 "$d" ); rc=$?
  assert_eq "killing a nonexistent pid alongside a real one is not an error" "0" "$rc"
  sleep 1
  assert_not_contains "kill_pids still kills the real target in the same call" \
    " $(pids_alive "$d") " " $d "

  wait "$a" 2>/dev/null || true
  wait "$b" 2>/dev/null || true
  kill -9 "$c" 2>/dev/null || true
  wait "$c" 2>/dev/null || true
  kill -9 "$d" 2>/dev/null || true
  wait "$d" 2>/dev/null || true
}
test_kill

printf '\n=== pids_alive zombie handling (Fix 7) ===\n'

test_pids_alive_zombie() {
  # A real zombie is too transient to depend on in a portable test harness
  # (it is reaped almost immediately once bash notices SIGCHLD), so this
  # exercises the same branch deterministically by shadowing `kill` and `ps`
  # inside a subshell rather than relying on a real defunct process. `kill`
  # is an ordinary builtin here (not a special one), so a same-named shell
  # function shadows it for calls made from inside this subshell only.
  local alive

  alive="$(
    # shellcheck disable=SC2329  # invoked indirectly by pids_alive name lookup
    kill() {
      if [ "$1" = "-0" ]; then
        return 0
      fi
      command kill "$@"
    }
    # shellcheck disable=SC2329  # invoked indirectly by pids_alive name lookup
    ps() { printf 'Z+\n'; }
    pids_alive 424242
  )"
  assert_eq "pids_alive treats a zombie as dead" "" "$alive"

  # Pairs with the assertion above (Fix 5): a pids_alive that always prints
  # nothing would make the zombie assertion pass for the wrong reason, but
  # this positive assertion over the same shadowed setup, differing only in
  # the reported process state, would then fail.
  alive="$(
    # shellcheck disable=SC2329  # invoked indirectly by pids_alive name lookup
    kill() {
      if [ "$1" = "-0" ]; then
        return 0
      fi
      command kill "$@"
    }
    # shellcheck disable=SC2329  # invoked indirectly by pids_alive name lookup
    ps() { printf 'R\n'; }
    pids_alive 424242
  )"
  assert_contains "pids_alive still reports a genuinely running process" " $alive " " 424242 "
}
test_pids_alive_zombie

printf '\n=== OPT_DEEP unbound safety (Fix 2) ===\n'

test_opt_deep_unbound() {
  # [ "$OPT_DEEP" -eq 1 ] aborts under set -u the moment OPT_DEEP is unset --
  # which nuke_docker reaches only AFTER SIGKILL has already been sent. Under
  # the old code this scenario would kill the throwaway process below, then
  # blow up on the OPT_DEEP read before ever logging completion. Prove the
  # fixed read (${OPT_DEEP:-0}) lets nuke_docker run to its normal finish
  # with OPT_DEEP genuinely unset, not merely zero.
  local out rc

  out="$(
    set -u
    unset OPT_DEEP
    GRACEFUL_WAIT=1
    TERM_WAIT=1
    p1=""
    bash -c 'trap "" TERM; sleep 60' & p1=$!
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    docker_pids() {
      if kill -0 "$p1" 2>/dev/null; then printf '%s\n' "$p1"; fi
    }
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    osascript() { return 0; }
    nuke_docker
    rc_inner=$?
    kill -9 "$p1" 2>/dev/null || true
    wait "$p1" 2>/dev/null || true
    exit "$rc_inner"
  )"
  rc=$?
  assert_eq "nuke_docker survives OPT_DEEP unset under set -u" "0" "$rc"
  assert_contains "nuke_docker still logs completion with OPT_DEEP unset" "$out" "all Docker processes terminated"
}
test_opt_deep_unbound

printf '\n=== sudo non-interactive guard (Fix 3) ===\n'

test_sudo_noninteractive() {
  # Simulating an actual hung, non-cached sudo prompt is not something this
  # harness can safely or deterministically drive. This is a static
  # regression guard instead: stop_privileged_helpers must call `sudo -n`
  # (never a plain `sudo`), so a missing credential fails fast into the
  # existing `|| true`-style guard rather than blocking forever on a hidden
  # /dev/tty prompt after Docker has already been SIGKILLed.
  local src
  src="$(cat "$SCRIPT_DIR/docker-nuke")"
  assert_contains "stop_privileged_helpers uses sudo -n for vmnetd" "$src" "sudo -n launchctl stop com.docker.vmnetd"
  assert_contains "stop_privileged_helpers uses sudo -n for socket" "$src" "sudo -n launchctl stop com.docker.socket"
  assert_not_contains "stop_privileged_helpers never calls a plain sudo" "$src" $'\nsudo launchctl'
}
test_sudo_noninteractive

printf '\n=== --deep help text and upfront credential check (Fix I2) ===\n'

test_deep_upfront_check() {
  # Task 6 correctly moved stop_privileged_helpers to `sudo -n` so a missing
  # credential fails fast instead of hanging on a hidden prompt after Docker
  # is already dead (Fix 3, above). But until this fix, usage() still claimed
  # "needs sudo" (never prompts) and main() never checked for a cached
  # credential until AFTER the kill, when it is too late for the user to do
  # anything about it. This is a static regression guard: usage() text must
  # be corrected, and main() must check `sudo -n true` before anything is
  # killed.
  local help_text src
  help_text="$(usage)"
  assert_not_contains "usage no longer claims --deep just needs sudo" "$help_text" "needs sudo"
  assert_contains "usage explains --deep requires a cached credential" "$help_text" "cached sudo credential"
  assert_contains "usage tells the user how to cache it" "$help_text" "sudo -v"

  src="$(cat "$SCRIPT_DIR/docker-nuke")"
  assert_contains "main checks sudo -n true up front" "$src" "sudo -n true"
}
test_deep_upfront_check

printf '\n=== nuke_docker escalation orchestration (Fix 6) ===\n'

test_nuke_docker() {
  local out rc

  # 1. No processes found -> returns 0, logs accordingly. Nothing spawned,
  # nothing to reap.
  out="$(
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    docker_pids() { :; }
    nuke_docker
  )"
  rc=$?
  assert_eq "no processes: returns 0" "0" "$rc"
  assert_contains "no processes: logs the no-processes message" "$out" "no Docker processes found"

  # 2. All processes exit at the polite-quit stage -> returns 0. The
  # shadowed osascript stands in for Docker actually honoring the quit
  # request; docker_pids re-checks real liveness on every call, just like
  # the real pgrep-backed implementation.
  out="$(
    GRACEFUL_WAIT=2
    p1=""; p2=""
    sleep 60 & p1=$!
    sleep 60 & p2=$!
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    docker_pids() {
      local pid
      for pid in "$p1" "$p2"; do
        if kill -0 "$pid" 2>/dev/null; then printf '%s\n' "$pid"; fi
      done
    }
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    osascript() {
      kill -TERM "$p1" "$p2" 2>/dev/null || true
      return 0
    }
    nuke_docker
    rc_inner=$?
    wait "$p1" 2>/dev/null || true
    wait "$p2" 2>/dev/null || true
    exit "$rc_inner"
  )"
  rc=$?
  assert_eq "polite quit: returns 0" "0" "$rc"
  assert_contains "polite quit: logs clean exit" "$out" "Docker exited cleanly"

  # 3. Survivors reach SIGTERM -> returns 0. osascript no-ops (Docker ignores
  # the polite quit); the throwaway sleeps have no TERM trap, so nuke_docker's
  # own SIGTERM kills them for real.
  out="$(
    GRACEFUL_WAIT=1
    TERM_WAIT=2
    p1=""; p2=""
    sleep 60 & p1=$!
    sleep 60 & p2=$!
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    docker_pids() {
      local pid
      for pid in "$p1" "$p2"; do
        if kill -0 "$pid" 2>/dev/null; then printf '%s\n' "$pid"; fi
      done
    }
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    osascript() { return 0; }
    nuke_docker
    rc_inner=$?
    wait "$p1" 2>/dev/null || true
    wait "$p2" 2>/dev/null || true
    exit "$rc_inner"
  )"
  rc=$?
  assert_eq "SIGTERM stage: returns 0" "0" "$rc"
  assert_contains "SIGTERM stage: logs post-SIGTERM exit" "$out" "Docker exited after SIGTERM"

  # 4. Survivors reach SIGKILL -> returns 0, and stop_privileged_helpers is
  # NOT called when OPT_DEEP=0 (Fix 6's last bullet). Each throwaway process
  # traps and ignores SIGTERM so only SIGKILL can end it.
  out="$(
    OPT_DEEP=0
    GRACEFUL_WAIT=1
    TERM_WAIT=1
    p1=""; p2=""
    bash -c 'trap "" TERM; sleep 60' & p1=$!
    bash -c 'trap "" TERM; sleep 60' & p2=$!
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    docker_pids() {
      local pid
      for pid in "$p1" "$p2"; do
        if kill -0 "$pid" 2>/dev/null; then printf '%s\n' "$pid"; fi
      done
    }
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    osascript() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    stop_privileged_helpers() { printf 'STOP_PRIVILEGED_CALLED\n'; }
    nuke_docker
    rc_inner=$?
    kill -9 "$p1" "$p2" 2>/dev/null || true
    wait "$p1" 2>/dev/null || true
    wait "$p2" 2>/dev/null || true
    exit "$rc_inner"
  )"
  rc=$?
  assert_eq "SIGKILL stage: returns 0" "0" "$rc"
  assert_contains "SIGKILL stage: logs full termination" "$out" "all Docker processes terminated"
  assert_not_contains "SIGKILL stage: stop_privileged_helpers not called when OPT_DEEP=0" "$out" "STOP_PRIVILEGED_CALLED"

  # 4b. Same shape, but OPT_DEEP=1 -- pairs with 4's negative assertion (Fix
  # 5): a stop_privileged_helpers call that is unconditionally skipped (or
  # unconditionally run) would fail one of these two, never both.
  out="$(
    OPT_DEEP=1
    GRACEFUL_WAIT=1
    TERM_WAIT=1
    p1=""; p2=""
    bash -c 'trap "" TERM; sleep 60' & p1=$!
    bash -c 'trap "" TERM; sleep 60' & p2=$!
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    docker_pids() {
      local pid
      for pid in "$p1" "$p2"; do
        if kill -0 "$pid" 2>/dev/null; then printf '%s\n' "$pid"; fi
      done
    }
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    osascript() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    stop_privileged_helpers() { printf 'STOP_PRIVILEGED_CALLED\n'; }
    nuke_docker
    rc_inner=$?
    kill -9 "$p1" "$p2" 2>/dev/null || true
    wait "$p1" 2>/dev/null || true
    wait "$p2" 2>/dev/null || true
    exit "$rc_inner"
  )"
  rc=$?
  assert_eq "SIGKILL stage with --deep: returns 0" "0" "$rc"
  assert_contains "SIGKILL stage with --deep: stop_privileged_helpers is called" "$out" "STOP_PRIVILEGED_CALLED"

  # 5. Something survives everything -> returns 1, and does NOT log success.
  # docker_pids is stubbed to unconditionally keep reporting a fixed,
  # nonexistent pid as live, modeling a process nothing here can actually
  # kill, so the bounded retry loop is guaranteed to exhaust its rounds.
  out="$(
    OPT_DEEP=0
    GRACEFUL_WAIT=1
    TERM_WAIT=1
    KILL_RETRY_ROUNDS=2
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    docker_pids() { printf '%s\n' 555555; }
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    osascript() { return 0; }
    nuke_docker 2>&1
  )"
  rc=$?
  assert_eq "unkillable survivor: returns 1" "1" "$rc"
  assert_not_contains "unkillable survivor: never logs Docker exited cleanly" "$out" "Docker exited cleanly"
  assert_not_contains "unkillable survivor: never logs post-SIGTERM exit" "$out" "Docker exited after SIGTERM"
  assert_not_contains "unkillable survivor: never logs full termination" "$out" "all Docker processes terminated"
  assert_contains "unkillable survivor: warns that processes survived" "$out" "processes survived SIGKILL"

  # 6. Fix 1's respawn scenario. docker_pids returns the real entry-snapshot
  # pids on its FIRST call only; every call after that returns a different,
  # fixed, nonexistent pid, modeling a helper that respawned under a brand
  # new pid after the snapshot pids died. The snapshot pids are killed
  # BEFORE nuke_docker even runs, so wait_for_exit sees them as gone
  # immediately at the very first stage -- exactly the shape that fooled the
  # old stale-snapshot success check. Assert nuke_docker does not report
  # success at any stage.
  out="$(
    OPT_DEEP=0
    # shellcheck disable=SC2034  # read by wait_for_exit (sourced from docker-nuke); the source=/dev/null directive above hides that cross-file read from this analysis
    GRACEFUL_WAIT=1
    # shellcheck disable=SC2034  # read by wait_for_exit (sourced from docker-nuke); the source=/dev/null directive above hides that cross-file read from this analysis
    TERM_WAIT=1
    # shellcheck disable=SC2034  # read by the nuke_docker retry loop (sourced from docker-nuke); the source=/dev/null directive above hides that cross-file read from this analysis
    KILL_RETRY_ROUNDS=2
    p1=""; p2=""
    sleep 60 & p1=$!
    sleep 60 & p2=$!
    kill -9 "$p1" "$p2" 2>/dev/null || true
    wait "$p1" 2>/dev/null || true
    wait "$p2" 2>/dev/null || true
    # docker_pids is always invoked as the first stage of a pipeline inside
    # nuke_docker (`docker_pids | tr ...`), and bash runs every non-last
    # pipeline stage in a forked subshell. A plain shell-variable call
    # counter would therefore reset to its parent value on every single
    # call and never actually advance, silently defeating this stub. A
    # counter file survives across those forks since it lives on disk, not
    # in process memory.
    dp_call_marker="$TMPROOT/respawn-dp-calls"
    printf '0' >"$dp_call_marker"
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    docker_pids() {
      local n
      n="$(cat "$dp_call_marker" 2>/dev/null)"
      n=$((n + 1))
      printf '%s' "$n" >"$dp_call_marker"
      if [ "$n" -eq 1 ]; then
        printf '%s\n%s\n' "$p1" "$p2"
      else
        printf '%s\n' 666666
      fi
    }
    # shellcheck disable=SC2329  # invoked indirectly by nuke_docker name lookup
    osascript() { return 0; }
    nuke_docker 2>&1
  )"
  rc=$?
  assert_eq "respawn scenario: returns 1, not success" "1" "$rc"
  assert_not_contains "respawn scenario: never logs Docker exited cleanly" "$out" "Docker exited cleanly"
  assert_not_contains "respawn scenario: never logs post-SIGTERM exit" "$out" "Docker exited after SIGTERM"
  assert_not_contains "respawn scenario: never logs full termination" "$out" "all Docker processes terminated"
  # Positive counterpart (Fix 5): proves the stub genuinely produced a
  # DIFFERENT pid after the snapshot died, rather than this test vacuously
  # passing because the entry-snapshot pids simply stayed non-empty text for
  # an unrelated reason.
  assert_contains "respawn scenario: nuke_docker discovers the NEW respawned pid" "$out" "666666"
}
test_nuke_docker

printf '\n=== restart and summary ===\n'

test_restart_and_summary() {
  local stub="$TMPROOT/stub2" oldpath="$PATH" rc
  # DUMP_DIR and CAPTURE_FAILURES are mutated below like PATH is above.
  # Restore all three on the way out (Fix 4, review round 1): this is the
  # last test block in the file today, so nothing currently leaks, but
  # Task 8 appends its own block immediately after this one and would
  # silently inherit whatever non-empty DUMP_DIR/CAPTURE_FAILURES this test
  # left behind if they were not restored, exactly like PATH and
  # HEALTH_TIMEOUT already are elsewhere in this file.
  local old_dump_dir="$DUMP_DIR" old_capture_failures="$CAPTURE_FAILURES"

  make_docker_stub "$stub" healthy
  PATH="$stub:$oldpath"
  rc=0; wait_for_daemon 6 || rc=$?
  assert_eq "wait_for_daemon returns 0 when healthy" "0" "$rc"

  make_docker_stub "$stub" broken
  rc=0; wait_for_daemon 4 || rc=$?
  assert_eq "wait_for_daemon returns 1 when never healthy" "1" "$rc"
  PATH="$oldpath"

  DUMP_DIR="$(new_dump_dir)"
  CAPTURE_FAILURES=" slow.txt"
  write_summary "recovered" "42"
  local s
  s="$(cat "$DUMP_DIR/summary.txt")"
  assert_contains "summary records the verdict" "$s" "recovered"
  assert_contains "summary records elapsed time" "$s" "42"
  assert_contains "summary records capture failures" "$s" "slow.txt"
  assert_not_contains "capture failures line has no double space (Fix 5)" "$s" "failures:  "

  DUMP_DIR="$old_dump_dir"
  CAPTURE_FAILURES="$old_capture_failures"
}
test_restart_and_summary

printf '\n=== wait_for_daemon wall-clock deadline (Fix 2) ===\n'

test_wait_for_daemon_deadline() {
  # Regression coverage for the headline wait_for_daemon fix: the old loop
  # counted only sleeps, never docker_healthy's own cost, so against a
  # daemon that never answers it silently overshoots the requested timeout
  # by roughly (HEALTH_TIMEOUT / POLL_INTERVAL)x. HEALTH_TIMEOUT and
  # POLL_INTERVAL are scaled down here (2s / 1s instead of the real 6s / 2s)
  # purely so this test stays fast; the ratio between them -- the thing that
  # actually exposes the bug -- is preserved.
  local stub="$TMPROOT/stub3" oldpath="$PATH" rc start elapsed
  local old_health="$HEALTH_TIMEOUT" old_poll="$POLL_INTERVAL"

  make_docker_stub "$stub" hang
  PATH="$stub:$oldpath"
  HEALTH_TIMEOUT=2
  POLL_INTERVAL=1

  start="$(date +%s)"
  rc=0; wait_for_daemon 4 || rc=$?
  elapsed=$(( $(date +%s) - start ))

  assert_eq "wait_for_daemon returns 1 against a hung daemon" "1" "$rc"
  # Requested 4s. New deadline-based code bounds the overshoot to at most one
  # in-flight docker_healthy call (~2s here), landing around 6s. The old
  # counting-sleeps code discounted every docker_healthy call and would land
  # around 12s for these constants (see the manual revert-and-measure proof
  # run alongside this fix). 8s cleanly separates "new" from "old" while
  # leaving headroom for process-spawn/date-granularity jitter.
  if [ "$elapsed" -le 8 ]; then
    pass "wait_for_daemon honors the wall-clock deadline against a hung daemon (elapsed=${elapsed}s, requested=4s)"
  else
    fail "wait_for_daemon honors the wall-clock deadline against a hung daemon" \
      "elapsed=${elapsed}s, requested=4s, expected <=8s"
  fi

  HEALTH_TIMEOUT="$old_health"
  POLL_INTERVAL="$old_poll"
  PATH="$oldpath"
}
test_wait_for_daemon_deadline

printf '\n=== write_summary survives an unwritable DUMP_DIR (Fix 1) ===\n'

test_write_summary_survives() {
  # write_summary was previously only ever called with a fresh, valid,
  # writable DUMP_DIR (see test_restart_and_summary above), so the
  # "unset/missing -> no-op" branch -- the entire reason the guard at the
  # top of write_summary exists -- was never exercised, and the write
  # itself (the actual Fix 1 bug: an existing-but-now-unwritable-or-full
  # DUMP_DIR) had zero coverage at all. Each case below runs write_summary
  # in a subshell so a mutated DUMP_DIR/CAPTURE_FAILURES never escapes into
  # the rest of the suite.
  local rc out

  rc=0
  out="$(
    unset DUMP_DIR CAPTURE_FAILURES
    set -u
    write_summary "recovered" "1"
    printf 'survived\n'
  )" || rc=$?
  assert_eq "write_summary no-ops when DUMP_DIR is unset (under set -u)" "0" "$rc"
  assert_contains "caller survives write_summary with DUMP_DIR unset" "$out" "survived"

  rc=0
  out="$(
    DUMP_DIR=""
    write_summary "recovered" "1"
    printf 'survived\n'
  )" || rc=$?
  assert_eq "write_summary no-ops when DUMP_DIR is empty" "0" "$rc"
  assert_contains "caller survives write_summary with DUMP_DIR empty" "$out" "survived"

  rc=0
  out="$(
    DUMP_DIR="$TMPROOT/write-summary-does-not-exist"
    write_summary "recovered" "1"
    printf 'survived\n'
  )" || rc=$?
  assert_eq "write_summary no-ops when DUMP_DIR does not exist" "0" "$rc"
  assert_contains "caller survives write_summary with DUMP_DIR missing" "$out" "survived"

  # The actual Fix 1 bug: DUMP_DIR is a real, valid, existing directory (the
  # guard's "unset or not a directory" check passes it straight through) but
  # is unwritable -- isomorphic to the disk filling between new_dump_dir
  # succeeding and write_summary running. set -e is turned on explicitly
  # inside the subshell so this reproduces the real script's own
  # set -euo pipefail context, not just the harness's relaxed `set +e`.
  local ro_dir="$TMPROOT/write-summary-ro"
  mkdir -p "$ro_dir"
  chmod 555 "$ro_dir"
  rc=0
  out="$(
    set -e
    DUMP_DIR="$ro_dir"
    CAPTURE_FAILURES=""
    write_summary "recovered" "1"
    printf 'survived\n'
  )" || rc=$?
  chmod 755 "$ro_dir"
  assert_eq "write_summary returns 0 on an unwritable DUMP_DIR" "0" "$rc"
  assert_contains "caller survives write_summary on an unwritable DUMP_DIR (Fix 1)" "$out" "survived"
  assert_eq "unwritable DUMP_DIR: no summary.txt was created" "no" \
    "$([ -f "$ro_dir/summary.txt" ] && printf 'yes' || printf 'no')"
}
test_write_summary_survives

printf '\n=== dry run ===\n'

test_dry_run() {
  local out rc before

  # shellcheck disable=SC2012  # dump dir names are our own generated timestamps, never contain newlines; a plain count needs plain lines, not find -print0
  before="$(ls -1 "$DUMP_ROOT" 2>/dev/null | wc -l | tr -d ' ')"
  rc=0
  out="$("$SCRIPT_DIR/docker-nuke" --dry-run 2>&1)" || rc=$?
  assert_eq "dry run exits 0" "0" "$rc"
  assert_contains "dry run says it changed nothing" "$out" "no changes made"
  assert_contains "dry run lists processes it would kill" "$out" "would kill"
  # shellcheck disable=SC2012  # dump dir names are our own generated timestamps, never contain newlines; a plain count needs plain lines, not find -print0
  assert_eq "dry run writes no dump" "$before" \
    "$(ls -1 "$DUMP_ROOT" 2>/dev/null | wc -l | tr -d ' ')"

  rc=0
  out="$("$SCRIPT_DIR/docker-nuke" --help 2>&1)" || rc=$?
  assert_eq "--help exits 0" "0" "$rc"
  assert_contains "--help prints usage" "$out" "Usage:"

  rc=0
  "$SCRIPT_DIR/docker-nuke" --nonsense >/dev/null 2>&1 || rc=$?
  assert_eq "unknown flag exits 2" "2" "$rc"
}
test_dry_run

printf '\n=== main() integration (Fix I1) ===\n'

# Before this block, the only entrypoint coverage was --dry-run / --help /
# --bogus (test_dry_run above), all of which return before run_dump is ever
# called -- so main()'s own composition of run_dump, nuke_docker,
# start_docker, and wait_for_daemon had zero automated coverage. That is
# exactly why the C1 (bare `run_dump` under set -e aborting recovery) and C2
# (a failed nuke_docker silently reported as success) review findings were
# never caught by any earlier per-task test.
#
# Every case below shadows run_dump/nuke_docker/start_docker/wait_for_daemon/
# docker_healthy (never the real Docker) per the standing safety rule for
# this file, plus docker_pids for deterministic survivor lists. Each
# subshell explicitly re-enables `set -euo pipefail` to reproduce the real
# script's own top-of-file directive -- the harness's `set +e` (line 5) would
# otherwise mask the exact class of bug C1 fixes (a bare failing command
# aborting the caller under set -e). stdin is always either piped or
# redirected from /dev/null so a wrong turn in the code under test can never
# block on a real terminal prompt.

printf '\n--- healthy daemon, declines the prompt ---\n'

test_main_healthy_decline() {
  local out rc=0
  out="$(
    set -euo pipefail
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_healthy name lookup
    docker_healthy() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via run_dump name lookup
    run_dump() { printf 'RUN_DUMP_CALLED\n'; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via nuke_docker name lookup
    nuke_docker() { printf 'NUKE_DOCKER_CALLED\n'; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via start_docker name lookup
    start_docker() { printf 'START_DOCKER_CALLED\n'; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via wait_for_daemon name lookup
    wait_for_daemon() { return 0; }
    printf 'n\n' | main 2>&1
  )"
  # Deliberately NOT `)" || rc=$?` (final review fix): per the bash manual,
  # "If a compound command or shell function executes in a context where -e
  # is being ignored, none of the commands executed within [it] will be
  # affected by the -e setting, even if -e is set" -- and a command
  # substitution used as the left operand of `||` is exactly such a context.
  # Attaching `|| rc=$?` directly to this assignment would silently defeat
  # the `set -euo pipefail` above for the ENTIRE subshell, no matter how
  # explicitly it is set inside. Capturing $? on its own line next avoids
  # that trap; see test_nuke_docker above for the same established pattern.
  rc=$?
  assert_eq "healthy+decline: rc 2" "2" "$rc"
  assert_not_contains "healthy+decline: run_dump never called" "$out" "RUN_DUMP_CALLED"
  assert_not_contains "healthy+decline: nuke_docker never called" "$out" "NUKE_DOCKER_CALLED"
  assert_not_contains "healthy+decline: start_docker never called" "$out" "START_DOCKER_CALLED"
}
test_main_healthy_decline

printf '\n--- healthy daemon with --force: proceeds without prompting ---\n'

test_main_healthy_force() {
  local out rc=0 dump_dir="$TMPROOT/main-force-dump"
  out="$(
    set -euo pipefail
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_healthy name lookup
    docker_healthy() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via run_dump name lookup
    run_dump() { DUMP_DIR="$dump_dir"; mkdir -p "$DUMP_DIR"; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via nuke_docker name lookup
    nuke_docker() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via start_docker name lookup
    start_docker() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via wait_for_daemon name lookup
    wait_for_daemon() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_pids name lookup
    docker_pids() { :; }
    main --force </dev/null 2>&1
  )"
  rc=$?  # not `|| rc=$?` -- see the note on the first main() test above
  assert_eq "healthy+force: rc 0" "0" "$rc"
  assert_not_contains "healthy+force: does not print the confirmation prompt" "$out" "Proceed anyway"
}
test_main_healthy_force

printf '\n--- wedged daemon: proceeds with no prompt ---\n'

test_main_wedged_no_prompt() {
  local out rc=0 dump_dir="$TMPROOT/main-wedged-dump"
  out="$(
    set -euo pipefail
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_healthy name lookup
    docker_healthy() { return 1; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via run_dump name lookup
    run_dump() { DUMP_DIR="$dump_dir"; mkdir -p "$DUMP_DIR"; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via nuke_docker name lookup
    nuke_docker() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via start_docker name lookup
    start_docker() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via wait_for_daemon name lookup
    wait_for_daemon() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_pids name lookup
    docker_pids() { :; }
    main </dev/null 2>&1
  )"
  rc=$?  # not `|| rc=$?` -- see the note on the first main() test above
  assert_eq "wedged: rc 0" "0" "$rc"
  assert_not_contains "wedged: does not print the confirmation prompt" "$out" "Proceed anyway"
}
test_main_wedged_no_prompt

printf '\n--- C1: run_dump failure never aborts recovery ---\n'

test_main_c1_dump_failure_does_not_abort() {
  # THE headline regression test for Fix C1. Under the pre-fix code, `run_dump`
  # was called bare on its own line under set -euo pipefail; run_dump returns
  # 1 when new_dump_dir fails (dump root unwritable or full), and a bare
  # failing command aborts the whole script right there via set -e -- Docker
  # is never killed, never restarted. Proving this requires `set -e` to
  # genuinely be active in this subshell (see the block-level comment above),
  # not just the harness's relaxed `set +e`.
  local out rc=0
  out="$(
    set -euo pipefail
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_healthy name lookup
    docker_healthy() { return 1; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via run_dump name lookup
    run_dump() { return 1; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via nuke_docker name lookup
    nuke_docker() { printf 'NUKE_DOCKER_CALLED\n'; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via start_docker name lookup
    start_docker() { printf 'START_DOCKER_CALLED\n'; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via wait_for_daemon name lookup
    wait_for_daemon() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_pids name lookup
    docker_pids() { :; }
    main </dev/null 2>&1
  )"
  rc=$?  # not `|| rc=$?` -- see the note on the first main() test above; this
         # one matters most of all, since it is what proves C1
  assert_eq "C1: main still completes (rc 0) after a dump failure" "0" "$rc"
  assert_contains "C1: nuke_docker is still called after a dump failure" "$out" "NUKE_DOCKER_CALLED"
  assert_contains "C1: start_docker is still called after a dump failure" "$out" "START_DOCKER_CALLED"
  assert_contains "C1: warns that diagnostics capture failed" "$out" "diagnostics capture failed"
}
test_main_c1_dump_failure_does_not_abort

printf '\n--- C2: a failed kill is never reported as success ---\n'

test_main_c2_failed_kill_no_restart() {
  # THE headline regression test for Fix C2, --no-restart path. nuke_docker
  # returns 1 only after KILL_RETRY_ROUNDS is exhausted with Docker processes
  # still alive. Under the pre-fix code this was discarded with `|| true` and
  # never consulted again: --no-restart's verdict said "killed, not
  # restarted" and returned 0 even though nothing was actually killed.
  local out rc=0 dump_dir="$TMPROOT/main-c2-norestart-dump"
  out="$(
    set -euo pipefail
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_healthy name lookup
    docker_healthy() { return 1; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via run_dump name lookup
    run_dump() { DUMP_DIR="$dump_dir"; mkdir -p "$DUMP_DIR"; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via nuke_docker name lookup
    nuke_docker() { return 1; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via start_docker name lookup
    start_docker() { printf 'START_DOCKER_CALLED\n'; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via wait_for_daemon name lookup
    wait_for_daemon() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_pids name lookup
    docker_pids() { printf '%s\n' 777777; }
    main --no-restart </dev/null 2>&1
  )"
  rc=$?  # not `|| rc=$?` -- see the note on the first main() test above
  assert_eq "C2 --no-restart: exit code is non-zero when the kill fails" "1" "$rc"
  assert_not_contains "C2 --no-restart: start_docker is never called" "$out" "START_DOCKER_CALLED"
  assert_contains "C2 --no-restart: the survivor pid reaches the log" "$out" "777777"
  assert_contains "C2 --no-restart: summary.txt records the failed kill" \
    "$(cat "$dump_dir/summary.txt" 2>/dev/null)" "777777"
}
test_main_c2_failed_kill_no_restart

test_main_c2_failed_kill_restart() {
  # C2's restart-path counterpart: even when wait_for_daemon subsequently
  # reports the daemon healthy again (a genuinely possible outcome -- a fresh
  # instance can start responding while old zombies from the failed kill
  # still linger), a kill that did not complete must still surface as a
  # failure, not get overwritten by the later "recovered" success.
  local out rc=0 dump_dir="$TMPROOT/main-c2-restart-dump"
  out="$(
    set -euo pipefail
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_healthy name lookup
    docker_healthy() { return 1; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via run_dump name lookup
    run_dump() { DUMP_DIR="$dump_dir"; mkdir -p "$DUMP_DIR"; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via nuke_docker name lookup
    nuke_docker() { return 1; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via start_docker name lookup
    start_docker() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via wait_for_daemon name lookup
    wait_for_daemon() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_pids name lookup
    docker_pids() { printf '%s\n' 888888; }
    main </dev/null 2>&1
  )"
  rc=$?  # not `|| rc=$?` -- see the note on the first main() test above
  assert_eq "C2 restart path: exit code is non-zero despite the daemon coming back" "1" "$rc"
  assert_contains "C2 restart path: the survivor pid reaches the log" "$out" "888888"
  assert_contains "C2 restart path: summary.txt records the failed kill" \
    "$(cat "$dump_dir/summary.txt" 2>/dev/null)" "888888"
}
test_main_c2_failed_kill_restart

printf '\n--- --no-restart: start_docker never called (success path) ---\n'

test_main_no_restart_success() {
  local out rc=0 dump_dir="$TMPROOT/main-norestart-ok-dump"
  out="$(
    set -euo pipefail
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_healthy name lookup
    docker_healthy() { return 1; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via run_dump name lookup
    run_dump() { DUMP_DIR="$dump_dir"; mkdir -p "$DUMP_DIR"; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via nuke_docker name lookup
    nuke_docker() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via start_docker name lookup
    start_docker() { printf 'START_DOCKER_CALLED\n'; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via wait_for_daemon name lookup
    wait_for_daemon() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_pids name lookup
    docker_pids() { :; }
    main --no-restart </dev/null 2>&1
  )"
  rc=$?  # not `|| rc=$?` -- see the note on the first main() test above
  assert_eq "no-restart success: rc 0" "0" "$rc"
  assert_not_contains "no-restart success: start_docker never called" "$out" "START_DOCKER_CALLED"
}
test_main_no_restart_success

printf '\n--- daemon never returns: rc 1 ---\n'

test_main_daemon_never_returns() {
  local out rc=0 dump_dir="$TMPROOT/main-timeout-dump"
  out="$(
    set -euo pipefail
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_healthy name lookup
    docker_healthy() { return 1; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via run_dump name lookup
    run_dump() { DUMP_DIR="$dump_dir"; mkdir -p "$DUMP_DIR"; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via nuke_docker name lookup
    nuke_docker() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via start_docker name lookup
    start_docker() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via wait_for_daemon name lookup
    wait_for_daemon() { return 1; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_pids name lookup
    docker_pids() { :; }
    main </dev/null 2>&1
  )"
  rc=$?  # not `|| rc=$?` -- see the note on the first main() test above
  assert_eq "daemon never returns: rc 1" "1" "$rc"
  assert_contains "daemon never returns: warns it did not return" "$out" "did not return"

  # No surviving Docker processes means the app was relaunched but did not stay
  # up, so the advice must point at a manual Dock launch -- NOT at --deep or at
  # disk space, which is what a real run got wrong in the field.
  assert_contains "no survivors: says Docker did not stay up" "$out" "did not stay up"
  assert_contains "no survivors: advises launching from the Dock" "$out" "Dock or Spotlight"
  assert_not_contains "no survivors: does NOT suggest --deep" "$out" "--deep"
}
test_main_daemon_never_returns

test_main_daemon_never_returns_with_survivors() {
  local rc out dump_dir="$TMPROOT/main-survivors"

  out="$(
    set -euo pipefail
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_healthy name lookup
    docker_healthy() { return 1; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via run_dump name lookup
    run_dump() { DUMP_DIR="$dump_dir"; mkdir -p "$DUMP_DIR"; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via nuke_docker name lookup
    nuke_docker() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via start_docker name lookup
    start_docker() { return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via wait_for_daemon name lookup
    wait_for_daemon() { return 1; }
    # Docker processes ARE alive: it is up but not answering, a different case.
    # shellcheck disable=SC2329  # invoked indirectly by main (sourced from docker-nuke) via docker_pids name lookup
    docker_pids() { printf '4242\n'; }
    main </dev/null 2>&1
  )"
  rc=$?  # not `|| rc=$?` -- see the note on the first main() test above
  assert_eq "survivors: rc 1" "1" "$rc"
  assert_contains "survivors: reports the surviving pid" "$out" "4242"
  assert_contains "survivors: suggests --deep for this case" "$out" "--deep"
  assert_not_contains "survivors: does NOT advise a Dock launch" "$out" "Dock or Spotlight"
}
test_main_daemon_never_returns_with_survivors

printf '\n=== summary ===\n'
teardown_tmp
printf 'ran %d, failed %d\n' "$TESTS_RUN" "$TESTS_FAILED"
[ "$TESTS_FAILED" -eq 0 ]
