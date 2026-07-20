# docker-nuke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `docker-nuke`, a macOS command that captures diagnostics from a wedged Docker Desktop, force-kills it, and restarts it back to a responsive daemon.

**Architecture:** A single self-contained bash script in the dotfiles repo, symlinked into `~/.local/bin`. Every unit of logic is a small named function; `main` runs only when the script is executed, not when sourced, so the test harness can source the file and unit-test functions without triggering a real nuke. Side-effecting behaviour is made testable through injection: `DOCKER_NUKE_DUMP_ROOT` redirects dump output to a temp dir, and a stub `docker` on `PATH` simulates healthy/failing/hanging daemons. Process-killing functions take an explicit PID list so tests can exercise them against throwaway `sleep` processes.

**Tech Stack:** Bash, `pgrep`/`kill`, `sample`, `osascript`, `open`. Lint via `shellcheck`. Tests are a dependency-free bash harness (no `bats` on this machine).

## Global Constraints

- Script style follows `~/dotfiles/.local/bin/claude-tmux`: `#!/usr/bin/env bash`, `set -euo pipefail`, 2-space indent, `snake_case` functions, `printf` over `echo`, `bin_exists()` guard, heredoc help text, `case` dispatch.
- **Write bash 3.2-compatible code.** `/bin/bash` on this machine is 3.2.57. No `mapfile`, no `declare -A`, no `${var,,}`.
- **Never use `pgrep -f docker`.** It matches this script's own name and command line, so the script would kill itself. Match only the app bundle path and exact process names.
- **Never write absolute personal paths (`/Users/<name>/...`) into committed files.** Repo rule from `~/dotfiles/AGENTS.md`. Use `$HOME` or `~`.
- **Never `git add -A` or `git add .`.** The dotfiles repo has unrelated uncommitted changes (modified nvim/zsh/tmux configs, deleted opencode plugins). Stage only the exact files named in each task.
- Commit messages use conventional commits with a scope, matching repo history: `feat(docker-nuke): ...`.
- Exit codes: `0` success, `1` daemon did not return, `2` usage error or user abort.
- Every diagnostic capture runs under its own timeout and records failure instead of aborting. The dump must never block recovery.

---

## File Structure

| File | Responsibility |
|---|---|
| `~/dotfiles/.local/bin/docker-nuke` | The entire tool: config, helpers, dump, kill, restart, `main` |
| `~/dotfiles/.local/bin/test-docker-nuke.sh` | Test harness: assertions, stubs, all unit tests |
| `~/.local/bin/docker-nuke` | Symlink to the dotfiles copy, puts it on `PATH` |
| `~/dotfiles/docs/specs/2026-07-19-docker-nuke-design.md` | Approved spec, moved into the repo |
| `~/dotfiles/docs/plans/2026-07-19-docker-nuke.md` | This plan |

The script stays one file because it must be self-contained to run from `PATH` as a single symlink. Testability comes from the source guard, not from splitting into libraries.

---

### Task 1: Repo scaffold, help text, and argument parsing

**Files:**
- Create: `~/dotfiles/.local/bin/docker-nuke`
- Create: `~/dotfiles/.local/bin/test-docker-nuke.sh`
- Create: `~/dotfiles/docs/specs/2026-07-19-docker-nuke-design.md` (moved from `~/docs/superpowers/specs/`)

**Interfaces:**
- Consumes: nothing
- Produces: `usage()` (prints help to stdout); `parse_args "$@"` setting globals `OPT_FORCE`, `OPT_NO_RESTART`, `OPT_DRY_RUN`, `OPT_DEEP` to `0`/`1`, returning `2` on an unknown flag; `bin_exists NAME`

- [ ] **Step 1: Move the spec into the repo, stripping absolute paths**

```bash
mkdir -p ~/dotfiles/docs/specs ~/dotfiles/docs/plans
mv ~/docs/superpowers/specs/2026-07-19-docker-nuke-design.md \
   ~/dotfiles/docs/specs/2026-07-19-docker-nuke-design.md
rmdir -p ~/docs/superpowers/specs 2>/dev/null || true
sed -i '' "s#/Users/[^/]*/#~/#g" ~/dotfiles/docs/specs/2026-07-19-docker-nuke-design.md
grep -c "/Users/" ~/dotfiles/docs/specs/2026-07-19-docker-nuke-design.md
```

Expected: prints `0`.

- [ ] **Step 2: Write the failing test**

Create `~/dotfiles/.local/bin/test-docker-nuke.sh`:

```bash
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

# Source the script under test. DOCKER_NUKE_LIB stops main from running.
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
```

```bash
chmod +x ~/dotfiles/.local/bin/test-docker-nuke.sh
```

- [ ] **Step 3: Run test to verify it fails**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: FAIL — `docker-nuke: No such file or directory`

- [ ] **Step 4: Write minimal implementation**

Create `~/dotfiles/.local/bin/docker-nuke`:

```bash
#!/usr/bin/env bash
# docker-nuke — capture diagnostics from a wedged Docker Desktop, then
# force-kill and restart it.
#
# Written for bash 3.2 compatibility (macOS /bin/bash).

set -euo pipefail

# --- configuration ----------------------------------------------------------

HEALTH_TIMEOUT=6        # seconds to wait on `docker info` before calling it wedged
GRACEFUL_WAIT=8         # seconds to let Docker quit politely
TERM_WAIT=5             # seconds to wait after SIGTERM before SIGKILL
RESTART_TIMEOUT=90      # seconds to wait for the daemon to come back
POLL_INTERVAL=2         # seconds between daemon health polls
SAMPLE_DURATION=2       # seconds of stack sampling per process
SAMPLE_TIMEOUT=10       # hard cap on a single `sample` invocation
DUMP_RETENTION=10       # how many dump directories to keep
LOG_TAIL_LINES=2000     # lines of Docker log to copy (keeps dumps small)

DOCKER_APP="/Applications/Docker.app"
DOCKER_LOG_DIR="$HOME/Library/Containers/com.docker.docker/Data/log"
DOCKER_RAW="$HOME/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"
CRASH_DIR="$HOME/Library/Logs/DiagnosticReports"

# Overridable so tests never touch real state.
DUMP_ROOT="${DOCKER_NUKE_DUMP_ROOT:-$HOME/.local/state/docker-nuke}"

OPT_FORCE=0
OPT_NO_RESTART=0
OPT_DRY_RUN=0
OPT_DEEP=0

# --- helpers ----------------------------------------------------------------

bin_exists() { command -v "$1" >/dev/null 2>&1; }

log()  { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }

usage() {
  cat <<'EOF'
docker-nuke: force-restart a wedged Docker Desktop, capturing diagnostics first

Usage:
  docker-nuke [options]

Options:
  -f, --force        Skip the confirmation shown when Docker looks healthy
  -n, --no-restart   Kill Docker but do not relaunch it
      --dry-run      Report what would be killed and dumped; change nothing
      --deep         Also stop root launchd helpers (com.docker.vmnetd); needs sudo
  -h, --help         Show this help

Diagnostics are written to ~/.local/state/docker-nuke/<timestamp>/ before
anything is killed. The most recent 10 dumps are kept.

Exit codes:
  0  Docker killed and confirmed responsive again
  1  Daemon did not come back within the restart timeout
  2  Usage error, or aborted at the healthy-daemon prompt
EOF
}

parse_args() {
  OPT_FORCE=0
  OPT_NO_RESTART=0
  OPT_DRY_RUN=0
  OPT_DEEP=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -f|--force)      OPT_FORCE=1 ;;
      -n|--no-restart) OPT_NO_RESTART=1 ;;
      --dry-run)       OPT_DRY_RUN=1 ;;
      --deep)          OPT_DEEP=1 ;;
      -h|--help)       usage; return 3 ;;
      *)
        warn "docker-nuke: unknown option '$1'"
        usage >&2
        return 2
        ;;
    esac
    shift
  done
  return 0
}

# --- entrypoint -------------------------------------------------------------

main() {
  local rc=0
  parse_args "$@" || rc=$?
  if [ "$rc" -eq 3 ]; then return 0; fi
  if [ "$rc" -ne 0 ]; then return "$rc"; fi
  log "docker-nuke: not yet implemented"
  return 0
}

# Only run when executed, not when sourced by the test harness.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
```

```bash
chmod +x ~/dotfiles/.local/bin/docker-nuke
```

- [ ] **Step 5: Run test to verify it passes**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: PASS — `ran 8, failed 0`

- [ ] **Step 6: Lint**

Run: `shellcheck ~/dotfiles/.local/bin/docker-nuke ~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: no output (clean). Fix any warnings before committing.

- [ ] **Step 7: Commit**

```bash
cd ~/dotfiles
git add .local/bin/docker-nuke .local/bin/test-docker-nuke.sh docs/specs/2026-07-19-docker-nuke-design.md
git commit -m "feat(docker-nuke): add script scaffold, arg parsing, and test harness"
```

---

### Task 2: `run_timeout` helper

Everything that touches a wedged Docker must be time-bounded. This wraps `timeout` when available and falls back to a pure-bash implementation, so the tool still works if coreutils disappears.

**Files:**
- Modify: `~/dotfiles/.local/bin/docker-nuke` (add after `bin_exists`)
- Modify: `~/dotfiles/.local/bin/test-docker-nuke.sh` (add test section)

**Interfaces:**
- Consumes: `bin_exists` from Task 1
- Produces: `run_timeout SECONDS CMD [ARGS...]` — runs CMD, returns its exit code, or `124` if it exceeded SECONDS. Callers must invoke it in a conditional (`if run_timeout ...`) so `set -e` does not abort on a non-zero return.

- [ ] **Step 1: Write the failing test**

Add to `test-docker-nuke.sh`, immediately before the `=== summary ===` block:

```bash
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
    bin_exists() { return 1; }
    run_timeout 1 sleep 5
  ) || rc=$?
  assert_eq "fallback path also returns 124" "124" "$rc"

  rc=0
  out="$(
    bin_exists() { return 1; }
    run_timeout 5 printf 'fallback-ok'
  )" || rc=$?
  assert_eq "fallback path returns stdout" "fallback-ok" "$out"
}
test_run_timeout
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: FAIL — `run_timeout: command not found`

- [ ] **Step 3: Write minimal implementation**

In `docker-nuke`, insert directly after the `bin_exists` definition:

```bash
# Run a command with a hard time limit. Returns 124 if it timed out.
# Call inside a conditional so `set -e` does not abort on a non-zero return.
run_timeout() {
  local secs="$1"
  shift
  if bin_exists timeout; then
    timeout "$secs" "$@"
    return $?
  fi
  if bin_exists gtimeout; then
    gtimeout "$secs" "$@"
    return $?
  fi

  # Pure-bash fallback: run in background and poll.
  "$@" &
  local pid=$!
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$secs" ]; then
      kill -9 "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  local rc=0
  wait "$pid" || rc=$?
  return "$rc"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: PASS — `ran 14, failed 0`

- [ ] **Step 5: Lint and commit**

```bash
shellcheck ~/dotfiles/.local/bin/docker-nuke ~/dotfiles/.local/bin/test-docker-nuke.sh
cd ~/dotfiles
git add .local/bin/docker-nuke .local/bin/test-docker-nuke.sh
git commit -m "feat(docker-nuke): add run_timeout helper with pure-bash fallback"
```

---

### Task 3: Process discovery (safety-critical)

This is the task most likely to cause real damage if wrong. A naive `pgrep -f docker` matches this script's own name, so `docker-nuke` would kill itself mid-run. The tests exist specifically to prove it does not.

**Files:**
- Modify: `~/dotfiles/.local/bin/docker-nuke`
- Modify: `~/dotfiles/.local/bin/test-docker-nuke.sh`

**Interfaces:**
- Consumes: `DOCKER_APP` from Task 1
- Produces: `docker_pids` — prints one PID per line, sorted, deduped, never including the current process or its parent

- [ ] **Step 1: Write the failing test**

Add before `=== summary ===`:

```bash
printf '\n=== docker_pids ===\n'

test_docker_pids() {
  # Keep both forms: newline for counting, space-padded for substring checks.
  # A space-padded haystack is required — searching newline-separated output
  # for " <pid> " can never match, which would make these assertions vacuous.
  local pids_nl pids_sp
  pids_nl="$(docker_pids)"
  pids_sp=" $(printf '%s' "$pids_nl" | tr '\n' ' ') "

  assert_not_contains "never returns own PID" "$pids_sp" " $$ "
  assert_not_contains "never returns parent PID" "$pids_sp" " $PPID "

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
  "$decoy" &
  local decoy_pid=$!
  sleep 1
  pids_sp=" $(docker_pids | tr '\n' ' ') "
  assert_not_contains "ignores decoy named docker-nuke-*" "$pids_sp" " $decoy_pid "
  kill -9 "$decoy_pid" 2>/dev/null || true
  wait "$decoy_pid" 2>/dev/null || true
}
test_docker_pids
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: FAIL — `docker_pids: command not found`

- [ ] **Step 3: Write minimal implementation**

Add to `docker-nuke` after `run_timeout`:

```bash
# Exact process names to target, in addition to anything under Docker.app.
# NOTE: never use `pgrep -f docker` here — it matches this script's own
# command line and the tool would kill itself.
DOCKER_PROC_NAMES="com.docker.backend com.docker.build com.docker.krun \
com.docker.vpnkit com.docker.virtualization vpnkit docker"

docker_pids() {
  local self="$$"
  local parent="${PPID:-0}"
  local name pid
  {
    pgrep -f "$DOCKER_APP" 2>/dev/null || true
    for name in $DOCKER_PROC_NAMES; do
      pgrep -x "$name" 2>/dev/null || true
    done
  } | sort -un | while read -r pid; do
    if [ -z "$pid" ]; then continue; fi
    if [ "$pid" = "$self" ]; then continue; fi
    if [ "$pid" = "$parent" ]; then continue; fi
    printf '%s\n' "$pid"
  done
}
```

Note the explicit `if ... then continue; fi` form. The shorter `[ "$pid" = "$self" ] && continue` returns 1 when the test fails, which `set -e` treats as a fatal error.

- [ ] **Step 4: Run test to verify it passes**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: PASS — `ran 20, failed 0`

- [ ] **Step 5: Manually confirm it finds the real Docker processes**

Run: `bash -c 'source ~/dotfiles/.local/bin/docker-nuke; docker_pids | wc -l'`
Expected: a non-zero count while Docker Desktop is running (roughly 9-12 on this machine).

Cross-check against the raw list:

Run: `pgrep -f '/Applications/Docker.app' | wc -l`
Expected: same order of magnitude. If `docker_pids` returns 0 while Docker is running, the matching is broken — stop and fix before continuing.

- [ ] **Step 6: Lint and commit**

```bash
shellcheck ~/dotfiles/.local/bin/docker-nuke ~/dotfiles/.local/bin/test-docker-nuke.sh
cd ~/dotfiles
git add .local/bin/docker-nuke .local/bin/test-docker-nuke.sh
git commit -m "feat(docker-nuke): add self-excluding Docker process discovery"
```

---

### Task 4: Health check

**Files:**
- Modify: `~/dotfiles/.local/bin/docker-nuke`
- Modify: `~/dotfiles/.local/bin/test-docker-nuke.sh`

**Interfaces:**
- Consumes: `run_timeout`, `HEALTH_TIMEOUT`
- Produces: `docker_healthy` — returns 0 if `docker info` answers within `HEALTH_TIMEOUT`, non-zero otherwise. `make_docker_stub DIR MODE` is a test-only helper (lives in the harness, not the script) where MODE is `healthy`, `broken`, or `hang`.

- [ ] **Step 1: Write the failing test**

Add before `=== summary ===`:

```bash
printf '\n=== docker_healthy ===\n'

# Creates a stub `docker` in DIR. MODE: healthy | broken | hang
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
  HEALTH_TIMEOUT=6

  PATH="$oldpath"
}
test_docker_healthy
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: FAIL — `docker_healthy: command not found`

- [ ] **Step 3: Write minimal implementation**

Add to `docker-nuke` after `docker_pids`:

```bash
# Returns 0 if the daemon answers within HEALTH_TIMEOUT, else non-zero
# (124 specifically means it hung rather than errored).
docker_healthy() {
  local rc=0
  run_timeout "$HEALTH_TIMEOUT" docker info >/dev/null 2>&1 || rc=$?
  return "$rc"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: PASS — `ran 23, failed 0`

- [ ] **Step 5: Lint and commit**

```bash
shellcheck ~/dotfiles/.local/bin/docker-nuke ~/dotfiles/.local/bin/test-docker-nuke.sh
cd ~/dotfiles
git add .local/bin/docker-nuke .local/bin/test-docker-nuke.sh
git commit -m "feat(docker-nuke): add timeout-bounded daemon health check"
```

---

### Task 5: Diagnostic dump and retention

**Files:**
- Modify: `~/dotfiles/.local/bin/docker-nuke`
- Modify: `~/dotfiles/.local/bin/test-docker-nuke.sh`

**Interfaces:**
- Consumes: `run_timeout`, `docker_pids`, `DUMP_ROOT`, `DUMP_RETENTION`, `LOG_TAIL_LINES`, `SAMPLE_DURATION`, `SAMPLE_TIMEOUT`, `DOCKER_LOG_DIR`, `DOCKER_RAW`, `CRASH_DIR`
- Produces: `new_dump_dir` (creates and prints a timestamped dir); `capture NAME SECS CMD...` (writes `$DUMP_DIR/NAME`, records failures in `CAPTURE_FAILURES`, always returns 0); `run_dump` (populates the dump, sets global `DUMP_DIR`); `prune_dumps [KEEP]`

- [ ] **Step 1: Write the failing test**

Add before `=== summary ===`:

```bash
printf '\n=== dump ===\n'

test_dump() {
  local d rc

  d="$(new_dump_dir)"
  assert_eq "dump dir is created" "yes" "$([ -d "$d" ] && printf 'yes' || printf 'no')"
  assert_contains "dump dir lives under DUMP_ROOT" "$d" "$DUMP_ROOT"

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

  # Retention: 12 dumps in, 10 newest survive.
  rm -rf "${DUMP_ROOT:?}"
  mkdir -p "$DUMP_ROOT"
  local i
  for i in 01 02 03 04 05 06 07 08 09 10 11 12; do
    mkdir -p "$DUMP_ROOT/2026010${i}T000000Z"
  done
  prune_dumps 10
  assert_eq "keeps exactly 10 dumps" "10" "$(ls -1 "$DUMP_ROOT" | wc -l | tr -d ' ')"
  assert_eq "prunes the oldest" "no" \
    "$([ -d "$DUMP_ROOT/20260101T000000Z" ] && printf 'yes' || printf 'no')"
  assert_eq "keeps the newest" "yes" \
    "$([ -d "$DUMP_ROOT/20260112T000000Z" ] && printf 'yes' || printf 'no')"
}
test_dump
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: FAIL — `new_dump_dir: command not found`

- [ ] **Step 3: Write minimal implementation**

Add to `docker-nuke` after `docker_healthy`:

```bash
DUMP_DIR=""
CAPTURE_FAILURES=""

new_dump_dir() {
  local stamp
  stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
  local dir="$DUMP_ROOT/$stamp"
  mkdir -p "$dir"
  printf '%s\n' "$dir"
}

# capture NAME SECONDS CMD... — write CMD output to $DUMP_DIR/NAME.
# Never fails: a timeout or error is recorded and execution continues, so a
# broken capture can never block recovery.
capture() {
  local name="$1" secs="$2"
  shift 2
  local out="$DUMP_DIR/$name"
  local rc=0
  run_timeout "$secs" "$@" >"$out" 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '\n[docker-nuke] capture "%s" failed or timed out (rc=%s)\n' "$name" "$rc" >>"$out"
    CAPTURE_FAILURES="$CAPTURE_FAILURES $name"
  fi
  return 0
}

# Sample user-space stacks of the daemon-side processes. This is the one
# signal that cannot be reconstructed after the processes are killed.
capture_samples() {
  if ! bin_exists sample; then
    printf 'sample(1) not available\n' >"$DUMP_DIR/samples-skipped.txt"
    return 0
  fi
  local name pid
  for name in com.docker.backend com.docker.krun; do
    for pid in $(pgrep -x "$name" 2>/dev/null || true); do
      capture "sample-$name-$pid.txt" "$SAMPLE_TIMEOUT" \
        sample "$pid" "$SAMPLE_DURATION" -mayDie
    done
  done
}

capture_logs() {
  mkdir -p "$DUMP_DIR/logs"
  local f base
  for f in "$DOCKER_LOG_DIR"/host/*.log "$DOCKER_LOG_DIR"/vm/*.log; do
    if [ -f "$f" ]; then
      base="$(basename "$f")"
      tail -n "$LOG_TAIL_LINES" "$f" >"$DUMP_DIR/logs/$base" 2>/dev/null || true
    fi
  done
}

capture_crashes() {
  mkdir -p "$DUMP_DIR/crashes"
  if [ ! -d "$CRASH_DIR" ]; then
    return 0
  fi
  local f
  ls -1t "$CRASH_DIR" 2>/dev/null | grep -i docker | head -5 | while read -r f; do
    cp "$CRASH_DIR/$f" "$DUMP_DIR/crashes/" 2>/dev/null || true
  done
}

disk_report() {
  df -h
  printf '\n--- Docker.raw ---\n'
  ls -lh "$DOCKER_RAW" 2>/dev/null || printf 'Docker.raw not found\n'
  du -h -d0 "$DOCKER_RAW" 2>/dev/null || true
}

socket_report() {
  local sock="$HOME/.docker/run/docker.sock"
  printf 'socket: %s\n' "$sock"
  ls -l "$sock" 2>/dev/null || printf 'socket does not exist\n'
  printf '\n--- listeners ---\n'
  lsof "$sock" 2>/dev/null || printf 'no processes hold the socket\n'
}

run_dump() {
  DUMP_DIR="$(new_dump_dir)"
  CAPTURE_FAILURES=""
  log "docker-nuke: capturing diagnostics to $DUMP_DIR"

  capture "ps.txt" 10 ps -eo pid,ppid,stat,%cpu,%mem,etime,command
  capture "docker-info.txt" "$HEALTH_TIMEOUT" docker info
  capture "docker-version.txt" "$HEALTH_TIMEOUT" docker version
  capture "disk.txt" 15 disk_report
  capture "memory.txt" 10 vm_stat
  capture "socket.txt" 10 socket_report
  capture_logs
  capture_crashes
  capture_samples
}

prune_dumps() {
  local keep="${1:-$DUMP_RETENTION}"
  if [ ! -d "$DUMP_ROOT" ]; then
    return 0
  fi
  local d
  ls -1 "$DUMP_ROOT" 2>/dev/null | sort -r | tail -n "+$((keep + 1))" | while read -r d; do
    if [ -n "$d" ]; then
      rm -rf "${DUMP_ROOT:?}/$d"
    fi
  done
}
```

`disk_report` and `socket_report` are defined as functions so `capture` can time-bound them as single units.

- [ ] **Step 4: Run test to verify it passes**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: PASS — `ran 34, failed 0`

- [ ] **Step 5: Confirm a real dump is well-formed**

Run:

```bash
DOCKER_NUKE_DUMP_ROOT=/tmp/dn-check bash -c \
  'source ~/dotfiles/.local/bin/docker-nuke; run_dump; printf "failures:%s\n" "$CAPTURE_FAILURES"; ls -la "$DUMP_DIR"'
```

Expected: `ps.txt`, `docker-info.txt`, `disk.txt`, `memory.txt`, `socket.txt`, `logs/`, `crashes/`, and at least one `sample-*.txt`. `disk.txt` should show the near-full data volume. Sampling makes this take ~10-15s — that is the designed cost.

Then clean up: `rm -rf /tmp/dn-check`

- [ ] **Step 6: Lint and commit**

```bash
shellcheck ~/dotfiles/.local/bin/docker-nuke ~/dotfiles/.local/bin/test-docker-nuke.sh
cd ~/dotfiles
git add .local/bin/docker-nuke .local/bin/test-docker-nuke.sh
git commit -m "feat(docker-nuke): add pre-kill diagnostic dump with retention"
```

---

### Task 6: Kill escalation

Tested against throwaway `sleep` processes rather than real Docker, so the escalation logic is proven without bouncing containers.

**Files:**
- Modify: `~/dotfiles/.local/bin/docker-nuke`
- Modify: `~/dotfiles/.local/bin/test-docker-nuke.sh`

**Interfaces:**
- Consumes: `docker_pids`, `GRACEFUL_WAIT`, `TERM_WAIT`, `DOCKER_APP`
- Produces: `pids_alive PID...` (prints the subset still running, space-separated); `kill_pids SIGNAL PID...`; `wait_for_exit SECONDS PID...` (returns 0 once all are gone, 1 on timeout); `nuke_docker` (full escalation against `docker_pids`)

- [ ] **Step 1: Write the failing test**

Add before `=== summary ===`:

```bash
printf '\n=== kill escalation ===\n'

test_kill() {
  local a b rc alive

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

  kill_pids KILL "$b"
  sleep 1
  assert_eq "SIGKILL clears the last pid" "" "$(pids_alive "$a" "$b")"

  rc=0; kill_pids TERM 999999 || rc=$?
  assert_eq "killing a nonexistent pid is not an error" "0" "$rc"

  wait "$a" 2>/dev/null || true
  wait "$b" 2>/dev/null || true
}
test_kill
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: FAIL — `pids_alive: command not found`

- [ ] **Step 3: Write minimal implementation**

Add to `docker-nuke` after `prune_dumps`:

```bash
pids_alive() {
  local pid alive=""
  for pid in "$@"; do
    if kill -0 "$pid" 2>/dev/null; then
      alive="$alive $pid"
    fi
  done
  printf '%s' "${alive# }"
}

kill_pids() {
  local sig="$1"
  shift
  local pid
  for pid in "$@"; do
    kill "-$sig" "$pid" 2>/dev/null || true
  done
  return 0
}

# Returns 0 once every PID is gone, 1 if SECONDS elapses first.
wait_for_exit() {
  local secs="$1"
  shift
  local waited=0
  while [ "$waited" -lt "$secs" ]; do
    if [ -z "$(pids_alive "$@")" ]; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  if [ -z "$(pids_alive "$@")" ]; then
    return 0
  fi
  return 1
}

# Stop root launchd helpers. Only called with --deep; prompts for sudo.
stop_privileged_helpers() {
  log "docker-nuke: stopping privileged helpers (sudo required)"
  sudo launchctl stop com.docker.vmnetd 2>/dev/null || true
  sudo launchctl stop com.docker.socket 2>/dev/null || true
}

# Three-stage escalation: polite quit, SIGTERM, SIGKILL.
nuke_docker() {
  local pids
  pids="$(docker_pids | tr '\n' ' ')"
  if [ -z "$pids" ]; then
    log "docker-nuke: no Docker processes found"
    return 0
  fi

  log "docker-nuke: asking Docker Desktop to quit"
  osascript -e 'quit app "Docker Desktop"' >/dev/null 2>&1 || true
  # shellcheck disable=SC2086
  if wait_for_exit "$GRACEFUL_WAIT" $pids; then
    log "docker-nuke: Docker exited cleanly"
    return 0
  fi

  log "docker-nuke: sending SIGTERM"
  # shellcheck disable=SC2086
  kill_pids TERM $pids
  # shellcheck disable=SC2086
  if wait_for_exit "$TERM_WAIT" $pids; then
    log "docker-nuke: Docker exited after SIGTERM"
    return 0
  fi

  log "docker-nuke: sending SIGKILL"
  # shellcheck disable=SC2086
  local remaining
  remaining="$(pids_alive $pids)"
  # shellcheck disable=SC2086
  kill_pids KILL $remaining
  sleep 1

  if [ "$OPT_DEEP" -eq 1 ]; then
    stop_privileged_helpers
  fi

  # shellcheck disable=SC2086
  local still
  still="$(pids_alive $pids)"
  if [ -n "$still" ]; then
    warn "docker-nuke: processes survived SIGKILL: $still"
    return 1
  fi
  log "docker-nuke: all Docker processes terminated"
  return 0
}
```

The `SC2086` disables are deliberate: `$pids` must word-split into separate arguments here.

- [ ] **Step 4: Run test to verify it passes**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: PASS — `ran 41, failed 0`

- [ ] **Step 5: Lint and commit**

```bash
shellcheck ~/dotfiles/.local/bin/docker-nuke ~/dotfiles/.local/bin/test-docker-nuke.sh
cd ~/dotfiles
git add .local/bin/docker-nuke .local/bin/test-docker-nuke.sh
git commit -m "feat(docker-nuke): add three-stage kill escalation"
```

---

### Task 7: Restart, daemon polling, and summary

**Files:**
- Modify: `~/dotfiles/.local/bin/docker-nuke`
- Modify: `~/dotfiles/.local/bin/test-docker-nuke.sh`

**Interfaces:**
- Consumes: `docker_healthy`, `run_timeout`, `RESTART_TIMEOUT`, `POLL_INTERVAL`, `DUMP_DIR`, `CAPTURE_FAILURES`
- Produces: `start_docker`; `wait_for_daemon SECONDS` (0 when healthy, 1 on timeout); `write_summary VERDICT ELAPSED`

- [ ] **Step 1: Write the failing test**

Add before `=== summary ===`:

```bash
printf '\n=== restart and summary ===\n'

test_restart_and_summary() {
  local stub="$TMPROOT/stub2" oldpath="$PATH" rc

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
}
test_restart_and_summary
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: FAIL — `wait_for_daemon: command not found`

- [ ] **Step 3: Write minimal implementation**

Add to `docker-nuke` after `nuke_docker`:

```bash
start_docker() {
  log "docker-nuke: relaunching Docker Desktop"
  open -a Docker >/dev/null 2>&1 || open "$DOCKER_APP" >/dev/null 2>&1 || true
}

wait_for_daemon() {
  local secs="$1"
  local waited=0
  while [ "$waited" -lt "$secs" ]; do
    if docker_healthy; then
      return 0
    fi
    sleep "$POLL_INTERVAL"
    waited=$((waited + POLL_INTERVAL))
  done
  return 1
}

write_summary() {
  local verdict="$1" elapsed="$2"
  if [ -z "$DUMP_DIR" ] || [ ! -d "$DUMP_DIR" ]; then
    return 0
  fi
  {
    printf 'docker-nuke summary\n'
    printf '===================\n\n'
    printf 'verdict:          %s\n' "$verdict"
    printf 'elapsed seconds:  %s\n' "$elapsed"
    printf 'dump directory:   %s\n' "$DUMP_DIR"
    printf 'capture failures: %s\n' "${CAPTURE_FAILURES:-none}"
    printf '\nTriage hints\n------------\n'
    printf '* ps.txt      STAT column: U or D means stuck in the kernel, not user space\n'
    printf '* disk.txt    a nearly full data volume is a common cause of Docker hangs\n'
    printf '* sample-*    user-space stacks showing where the daemon was stuck\n'
    printf '* logs/       Docker host and vm logs from just before the kill\n'
  } >"$DUMP_DIR/summary.txt"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: PASS — `ran 46, failed 0`

- [ ] **Step 5: Lint and commit**

```bash
shellcheck ~/dotfiles/.local/bin/docker-nuke ~/dotfiles/.local/bin/test-docker-nuke.sh
cd ~/dotfiles
git add .local/bin/docker-nuke .local/bin/test-docker-nuke.sh
git commit -m "feat(docker-nuke): add restart, daemon polling, and triage summary"
```

---

### Task 8: Wire up `main`, dry-run, and install the symlink

**Files:**
- Modify: `~/dotfiles/.local/bin/docker-nuke` (replace the placeholder `main`)
- Modify: `~/dotfiles/.local/bin/test-docker-nuke.sh`
- Create: `~/.local/bin/docker-nuke` (symlink)
- Modify: `~/dotfiles/README.md`

**Interfaces:**
- Consumes: everything from Tasks 1-7
- Produces: `confirm_healthy_nuke` (returns 0 to proceed, 2 to abort); `dry_run_report`; the finished `main`

- [ ] **Step 1: Write the failing test**

Add before `=== summary ===`:

```bash
printf '\n=== dry run ===\n'

test_dry_run() {
  local out rc before

  before="$(ls -1 "$DUMP_ROOT" 2>/dev/null | wc -l | tr -d ' ')"
  rc=0
  out="$("$SCRIPT_DIR/docker-nuke" --dry-run 2>&1)" || rc=$?
  assert_eq "dry run exits 0" "0" "$rc"
  assert_contains "dry run says it changed nothing" "$out" "no changes made"
  assert_contains "dry run lists processes it would kill" "$out" "would kill"
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: FAIL — dry run output does not contain `would kill`

- [ ] **Step 3: Write minimal implementation**

In `docker-nuke`, replace the placeholder `main` with:

```bash
confirm_healthy_nuke() {
  local info
  info="$(run_timeout "$HEALTH_TIMEOUT" docker info \
    --format '{{.ServerVersion}} ({{.ContainersRunning}} running)' 2>/dev/null || true)"
  log "docker-nuke: Docker looks healthy: ${info:-unknown}"
  log "Nuking will stop running containers."
  printf 'Proceed anyway? [y/N] '
  local reply=""
  read -r reply || true
  case "$reply" in
    y|Y|yes|YES) return 0 ;;
    *) log "docker-nuke: aborted"; return 2 ;;
  esac
}

dry_run_report() {
  local pids
  pids="$(docker_pids | tr '\n' ' ')"
  log "docker-nuke: DRY RUN — no changes made"
  if [ -z "$pids" ]; then
    log "  would kill: (no Docker processes found)"
  else
    log "  would kill: $pids"
    # shellcheck disable=SC2086
    ps -o pid,stat,%cpu,%mem,etime,comm -p $pids 2>/dev/null || true
  fi
  log "  would dump to: $DUMP_ROOT/<timestamp>"
  if [ "$OPT_NO_RESTART" -eq 1 ]; then
    log "  would not restart Docker (--no-restart)"
  else
    log "  would restart Docker and wait up to ${RESTART_TIMEOUT}s"
  fi
}

main() {
  local rc=0
  parse_args "$@" || rc=$?
  if [ "$rc" -eq 3 ]; then return 0; fi
  if [ "$rc" -ne 0 ]; then return "$rc"; fi

  if [ "$OPT_DRY_RUN" -eq 1 ]; then
    dry_run_report
    return 0
  fi

  if docker_healthy && [ "$OPT_FORCE" -eq 0 ]; then
    confirm_healthy_nuke || return 2
  fi

  local started elapsed verdict
  started="$(date +%s)"

  run_dump
  nuke_docker || true

  if [ "$OPT_NO_RESTART" -eq 1 ]; then
    verdict="killed, not restarted (--no-restart)"
    elapsed=$(( $(date +%s) - started ))
    write_summary "$verdict" "$elapsed"
    prune_dumps
    log "docker-nuke: $verdict"
    log "docker-nuke: diagnostics in $DUMP_DIR"
    return 0
  fi

  start_docker
  if wait_for_daemon "$RESTART_TIMEOUT"; then
    verdict="recovered"
    elapsed=$(( $(date +%s) - started ))
    write_summary "$verdict" "$elapsed"
    prune_dumps
    local info
    info="$(run_timeout "$HEALTH_TIMEOUT" docker info \
      --format '{{.ServerVersion}} ({{.ContainersRunning}} running)' 2>/dev/null || true)"
    log "docker-nuke: Docker is back after ${elapsed}s — ${info:-ok}"
    log "docker-nuke: diagnostics in $DUMP_DIR"
    return 0
  fi

  verdict="daemon did not return within ${RESTART_TIMEOUT}s"
  elapsed=$(( $(date +%s) - started ))
  write_summary "$verdict" "$elapsed"
  prune_dumps
  warn "docker-nuke: $verdict"
  warn "docker-nuke: still running: $(docker_pids | tr '\n' ' ')"
  warn "docker-nuke: diagnostics in $DUMP_DIR"
  warn "docker-nuke: try 'docker-nuke --deep', or check disk space in $DUMP_DIR/disk.txt"
  return 1
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/dotfiles/.local/bin/test-docker-nuke.sh`
Expected: PASS — `ran 51, failed 0`

- [ ] **Step 5: Install the symlink and confirm it resolves**

```bash
ln -sfn ../../dotfiles/.local/bin/docker-nuke ~/.local/bin/docker-nuke
ls -l ~/.local/bin/docker-nuke
command -v docker-nuke
docker-nuke --help
```

Expected: the symlink resolves (matching the relative style used by `cl` and `brave-debug`), `command -v` prints `~/.local/bin/docker-nuke`, and help text prints.

- [ ] **Step 6: Confirm the healthy-daemon guard works**

Run: `printf 'n\n' | docker-nuke`
Expected: reports Docker looks healthy, prompts, then `aborted`. Exit code 2 (`echo $?`). **Docker must still be running afterwards** — verify with `docker info --format '{{.ServerVersion}}'`.

- [ ] **Step 7: Document it in the README**

Add an entry to `~/dotfiles/README.md` in whatever section lists the `.local/bin` scripts (match the file's existing format):

```markdown
- `docker-nuke` — force-restart a wedged Docker Desktop. Captures diagnostics to
  `~/.local/state/docker-nuke/<timestamp>/` before killing anything. `--dry-run`
  to preview, `--no-restart` to leave Docker down, `--deep` for root helpers.
```

- [ ] **Step 8: Lint and commit**

```bash
shellcheck ~/dotfiles/.local/bin/docker-nuke ~/dotfiles/.local/bin/test-docker-nuke.sh
cd ~/dotfiles
git add .local/bin/docker-nuke .local/bin/test-docker-nuke.sh README.md docs/plans/2026-07-19-docker-nuke.md
git commit -m "feat(docker-nuke): wire up main, dry-run mode, and docs"
```

---

### Task 9: Live end-to-end verification

**Requires explicit user go-ahead.** This bounces every running container. Do not run it unprompted.

**Files:** none modified.

**Interfaces:**
- Consumes: the installed `docker-nuke`
- Produces: evidence that a real nuke recovers the daemon

- [ ] **Step 1: Record pre-nuke state**

```bash
docker info --format 'version={{.ServerVersion}} running={{.ContainersRunning}} total={{.Containers}}'
docker ps --format '{{.Names}}' | sort >/tmp/dn-before.txt
wc -l </tmp/dn-before.txt
```

Expected: records the container names that were running, for comparison afterwards.

- [ ] **Step 2: Run the real nuke**

Run: `time docker-nuke --force`
Expected: dump path printed, kill stages logged, then `Docker is back after Ns`. Exit code 0.

- [ ] **Step 3: Verify recovery**

```bash
echo "exit: $?"
docker info --format 'version={{.ServerVersion}} running={{.ContainersRunning}}'
docker ps --format '{{.Names}}' | sort >/tmp/dn-after.txt
diff /tmp/dn-before.txt /tmp/dn-after.txt || true
```

Expected: the daemon responds. Containers with a restart policy are back; those without remain stopped — this is the documented non-goal, not a bug. Report the diff to the user rather than silently restarting anything.

- [ ] **Step 4: Verify the dump is useful**

```bash
ls -1t ~/.local/state/docker-nuke | head -1
cat ~/.local/state/docker-nuke/$(ls -1t ~/.local/state/docker-nuke | head -1)/summary.txt
```

Expected: `verdict: recovered`, a plausible elapsed time, `capture failures: none`, and the triage hints. Confirm `disk.txt` and at least one `sample-*.txt` are present and non-empty.

- [ ] **Step 5: Verify no stray processes and clean up**

```bash
rm -f /tmp/dn-before.txt /tmp/dn-after.txt
pgrep -x docker-nuke || echo "no docker-nuke processes left behind"
```

Expected: `no docker-nuke processes left behind` — proving the script did not kill or orphan itself.

---

## Self-Review

**Spec coverage:** Health check (Task 4, wired in 8) · pre-kill dump with all ten artifacts (Task 5) · dump-never-blocks-recovery (Task 5, `capture` always returns 0) · retention of 10 (Task 5) · three-stage kill escalation (Task 6) · restart and 90s poll (Task 7) · report with version, count, elapsed, dump path (Task 8) · process targeting incl. the self-kill hazard (Task 3) · all six flags (Tasks 1, 5, 6, 8) · exit codes 0/1/2 (Tasks 1, 8) · constants (Task 1) · `run_timeout` with fallback (Task 2) · `set -e`/`pgrep` care (Tasks 2, 3) · staged verification (Tasks 8, 9). No gaps.

**Non-goals honored:** no container snapshot/replay; no sudo outside `--deep`; no pruning or disk cleanup anywhere.

**Type consistency:** `DUMP_DIR` and `CAPTURE_FAILURES` are declared in Task 5 and consumed unchanged in Task 7. `capture NAME SECS CMD...` keeps that argument order at every call site. `wait_for_exit`/`wait_for_daemon` both take seconds first and return 0 on success, 1 on timeout. `pids_alive` returns a space-separated string in every use. `parse_args` returns 3 for `--help` and 2 for bad flags, handled identically in the Task 1 and Task 8 versions of `main`.
