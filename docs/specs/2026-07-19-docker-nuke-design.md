# docker-nuke — Design

**Date:** 2026-07-19
**Status:** Approved
**Target:** `~/.local/bin/docker-nuke`

## Purpose

Recover a wedged Docker Desktop on macOS with a single command, and capture enough
forensic state beforehand to triage *why* it wedged.

The script exists because Docker Desktop periodically becomes unresponsive on this
machine and the manual recovery (quit app, hunt stray processes, kill, relaunch,
wait) is slow and easy to get wrong.

## Context

Observed environment at design time:

- Docker Desktop is the only runtime. Daemon 29.6.1, 27 running containers.
- `/usr/local/bin/docker` is the real CLI.
- `~/bin` contains **dangling** OrbStack symlinks (`docker`, `docker-compose`,
  `kubectl`, `orb`, `orbctl`) pointing into a gutted `~/.orbstack/bin/`.
  Out of scope here; noted for separate cleanup.
- `sample`, `spindump`, `lsof`, `vm_stat`, `fs_usage` all available.
- Docker logs: `~/Library/Containers/com.docker.docker/Data/log/{host,vm}`.
- **The data volume is 100% full — 653 MB free of 926 GB. `Docker.raw` is 140 GB
  on disk (215 GB apparent).** This is the likely root cause of the recurring
  hangs. Out of scope for this script, but it is why disk capture is a
  first-class part of the dump.

## Non-goals

- **No container-state snapshot/replay.** Containers without a restart policy stay
  stopped after a nuke. Recording running state requires querying the daemon —
  precisely what is broken when the script is needed — so it would be unreliable
  exactly when it matters. Docker's own restart policies cover what matters.
- **No sudo on the default path.** Root launchd helper cleanup is opt-in via `--deep`
  so the normal path never blocks on a password prompt.
- **No disk cleanup or pruning.** The script never deletes Docker data.
- **No fix for the full disk.** Surfaced in the dump, handled separately.

## Behavior

### 1. Health check

Run `docker info` under a 6s hard timeout.

- **Times out or fails** → Docker is wedged. Proceed immediately, no prompt.
- **Succeeds** → print daemon version and container count, then require `y/N`
  confirmation. `--force` skips the prompt.

Rationale: zero friction in the case the tool exists for, while a healthy daemon
cannot be bounced by an accidental invocation.

### 2. Pre-kill dump

Capture happens **before** any kill, because killing destroys the state being
triaged. Written to `~/.local/state/docker-nuke/<UTC-timestamp>/`.

The full dump always runs — there is no flag to skip or reduce it. The only run
that produces no dump is `--dry-run`. Stack sampling is included unconditionally,
accepting roughly 10-15s of added latency before the kill begins, because stack
traces are the one signal that cannot be reconstructed after the processes die.
`--no-restart` still produces a complete dump.

| File | Contents | Diagnostic value |
|---|---|---|
| `ps.txt` | Docker procs with `STAT`, `%cpu`, `%mem`, elapsed, full command | `U`/`D` state means stuck in kernel, not user space |
| `sample-<pid>.txt` | 2s stack samples of `com.docker.backend`, `com.docker.krun` | Shows where it is hung |
| `disk.txt` | `df -h` all volumes, `Docker.raw` apparent + on-disk size | Would have caught the current full-disk issue |
| `memory.txt` | `vm_stat`, memory pressure | Detects pressure-induced stalls |
| `socket.txt` | `docker.sock` existence, permissions, listener | Distinguishes dead daemon from dead socket |
| `docker-info.txt` | `docker info` / `docker version` output + whether each timed out | |
| `logs/` | Last 2000 lines of Docker host + vm logs | Restart rotates these away |
| `crashes/` | Recent Docker entries from `~/Library/Logs/DiagnosticReports` | |
| `summary.txt` | Verdict, timings, recovery outcome — written at end of run | The file actually read during triage |

**Robustness requirement:** every capture step runs under its own timeout. `sample`
can itself hang on a truly wedged process. A failed or timed-out step records the
failure in `summary.txt` and continues. **The dump can never block recovery.**

Log tails are capped at 2000 lines to keep dumps small — relevant given only
653 MB free.

Retention: keep the 10 most recent dump directories, prune older ones at the end
of a run.

### 3. Kill, escalating

Three stages, re-checking liveness between each:

1. `osascript` quit of Docker Desktop, wait up to 8s — lets it clean up if merely slow
2. `SIGTERM` everything still alive, wait up to 5s
3. `SIGKILL` the remainder

### 4. Restart

`open -a Docker`, then poll `docker info` every 2s up to 90s. Skipped with
`--no-restart`.

### 5. Report

On success: daemon version, container count, elapsed recovery time, dump path.
On failure: what is still running, the dump path, and suggested next steps.

## Process targeting

The most correctness-sensitive part. Matched two ways:

- Anything under `/Applications/Docker.app` (`pgrep -f '/Applications/Docker.app'`)
- Exact process names: `com.docker.backend`, `com.docker.build`, `com.docker.krun`,
  `com.docker.vpnkit`, `com.docker.virtualization`, `vpnkit`
- Hung CLI clients: `pgrep -x docker`

**Critical hazard:** a naive `pgrep -f docker` matches the string `docker` in this
script's own name and command line, so `docker-nuke` would kill itself mid-run.
Matching is therefore anchored to the app bundle path and exact process names, and
`$$` / `$PPID` are always filtered from the result set. `pgrep -f docker` must never
be used.

## Interface

| Flag | Effect |
|---|---|
| `-f, --force` | Skip the confirmation when Docker looks healthy |
| `-n, --no-restart` | Kill only, leave Docker down |
| `--dry-run` | Report what would be killed and dumped; change nothing |
| `--deep` | Also stop root launchd helpers (`com.docker.vmnetd`); prompts for sudo |
| `-h, --help` | Usage |

Exit codes:

- `0` — Docker killed and (unless `--no-restart`) confirmed responsive again
- `1` — daemon did not come back within the restart timeout
- `2` — aborted by user at the healthy-daemon confirmation

## Constants

```
HEALTH_TIMEOUT=6      GRACEFUL_WAIT=8      TERM_WAIT=5
RESTART_TIMEOUT=90    POLL_INTERVAL=2      SAMPLE_DURATION=2
SAMPLE_TIMEOUT=10     DUMP_RETENTION=10    LOG_TAIL_LINES=2000
DUMP_ROOT="$HOME/.local/state/docker-nuke"
```

## Implementation notes

- Bash. `timeout` is available via coreutils but must not be assumed — provide a
  `run_timeout` helper that uses `timeout`/`gtimeout` when present and falls back
  to a background-process-and-poll implementation.
- Care with `set -euo pipefail`: `pgrep` exits non-zero when it matches nothing,
  which is a normal condition here, not an error.

## Verification plan

Docker is healthy with 27 running containers, so testing is staged:

1. Safe, non-disruptive: `--help`, `--dry-run`, health check on a healthy daemon,
   the confirmation guard, dump creation and contents, retention pruning.
2. Disruptive: a real end-to-end nuke. Bounces all 27 containers. Requires explicit
   user go-ahead before running.
