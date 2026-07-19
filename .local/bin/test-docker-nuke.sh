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

printf '\n=== summary ===\n'
teardown_tmp
printf 'ran %d, failed %d\n' "$TESTS_RUN" "$TESTS_FAILED"
[ "$TESTS_FAILED" -eq 0 ]
