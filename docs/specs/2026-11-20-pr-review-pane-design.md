# PR review pane: Design

**Date:** 2026-11-20
**Status:** Approved
**Targets:** `.local/bin/pr-review` (CLI), `.config/herdr-app/mods/reviews-tmux/` (Herdr panel and dialog)

## Purpose

An internal, CodeRabbit-style reviewer for pull requests on GitHub and Gitea. omo reviews a PR on demand, Herdr shows the findings in a dialog, and you choose which ones are posted back to the PR.

## Decisions

- UI: a Reviews view in Herdr's side panel (beside Jobs and PRDs) and a dialog over the window for one review.
- Trigger: you press Review on a PR, or one of your agents reviews it and submits through `pr-review submit`. There is no webhook or polling service: "automatic" means agents (see Modes).
- Output: the dialog first, then a Post that sends only the findings you tick.
- Scope: open PRs of the repo of the tmux pane you are in, with Here / All (All is every repo open in a pane of this tmux session). A Merged switch adds recently merged PRs, for reviews after the fact.
- Modes: per repo, with a per-PR override: manual, semi or auto (see Modes).
- Manual reviews: you write comments yourself on a diff view in the dialog.
- Posted reviews carry no marker. They post as your own account (gh's login, tea's login).
- Reviews only ever use the event `COMMENT`: the tool never approves a PR or requests changes.

## Non-goals (v1)

- No watcher or webhook: automatic reviews come only from agents that use the tool.
- No incremental "only the new commits" review: a new head commit means a fresh review.
- No editing of findings in the dialog.
- Any machine Herdr reaches. For a pane on another machine the panel runs the CLI there (Herdr's `exec` with `on`, as `$HOME/.bun/bin/bun $HOME/.local/bin/pr-review`) and the dialog reads that machine's review and diff files (`readTextFile` with `on`), so a review runs where the checkout is, with that machine's omo and forge logins. The machine needs bun, omo, the dotfiles' `pr-review`, and `gh` or a tea login for the forges its repos use.

## Architecture

The CLI does all the work and the mod only draws, the same split as `studio-prds` and `prds-tmux`.

### `pr-review` CLI (Bun, TypeScript)

```
pr-review list <dir> [<dir>...]   JSON for the panel: each dir's repo and its open PRs, with review states
pr-review review <dir> <number>   starts a review in the background, prints {"file", "state"} and exits
pr-review post <file> [--ids a,b] posts the ticked findings (default: blockers and majors) as one review
pr-review run <dir> <number>      the review itself, in the foreground (what `review` starts detached)
```

### Forges

The forge comes from the `origin` remote. Its URL (`git@host:o/r.git`, `ssh://git@host[:port]/o/r.git`, `https://host/o/r[.git]`) gives host, owner and name.

- **GitHub:** the host is `github.com`, or any host `gh` holds a token for. The token comes from `gh auth token --hostname <host>`. The API is `https://api.github.com` (or `https://<host>/api/v3`).
- **Gitea:** the host matches the `url` host or the `ssh_host` of a login in tea's config (`~/.config/tea/config.yml`, read with `Bun.YAML`). The API is `<login url>/api/v1` with that login's token. The CLI calls it with `fetch`, not `tea`, because tea's go-git rejects `extensions.worktreeConfig`.
- **Hostnames:** none are written into this repo. They all come from the gh and tea configs.

Both forges serve `refs/pull/<n>/head`, so fetching a PR works the same way on either.

List calls:

- GitHub: `GET /repos/{o}/{r}/pulls?state=open&per_page=50`.
- Gitea: `GET /repos/{o}/{r}/pulls?state=open&limit=50`.

Answers are cached for 30 s per repo in `~/.local/state/pr-review/cache/`, so several panes don't call the API repeatedly.

### A review run

1. `git fetch origin +refs/pull/<n>/head:refs/pr-review/<n>` and the base branch, then take `git merge-base`.
2. `git worktree add --detach ~/.local/state/pr-review/work/<id> refs/pr-review/<n>`. It is removed (`git worktree remove --force`, then `prune`) when the run ends, however it ends.
3. Diff the merge base against the head with `-U3`:
   - Lockfiles, minified files, `dist/` and binaries are left out and listed as skipped.
   - The diff is capped at about 300 KB. Past that, the remaining files are named and the agent reads them itself.
   - Every line in the prompt is annotated with its new-file line number, so findings cite real lines.
4. `omo -p --mode json --no-session --permission-preset read-only -` runs in the worktree with the whole prompt on stdin (omo prepends stdin to the argument with no separator).
   - The agent can read the surrounding code and the repo's AGENTS.md, and can't change anything.
   - `PR_REVIEW_MODEL` sets `--model`. omo's default applies otherwise.
   - The run is killed after 20 minutes.
5. Parse the result. The text of the last `message_end` from the assistant is the review JSON. A fenced block is unwrapped, and anything that doesn't fit the schema fails the run with the reason. The cost is summed from the assistant messages' `usage.cost.total`.
6. Mark each finding `commentable` when its line is a new-side line (added or context) of a hunk of its file.

The prompt lives beside the CLI (`.local/bin/pr-review.d/prompt.md`). It asks for:

```json
{
  "summary": "markdown: what the PR does and the review's overall view",
  "verdict": "good | changes | questions",
  "findings": [
    { "severity": "blocker | major | minor | nit", "path": "src/a.ts", "line": 42, "start_line": 40,
      "title": "one line", "body": "markdown", "suggestion": "replacement code for start_line..line, or null" }
  ]
}
```

### Review file (the contract with the dialog)

The review file is at `~/.local/state/pr-review/reviews/<host>/<owner>/<name>/<number>/<sha>.json`. It is written atomically (temp file plus rename), first with `state: "running"`, then again with `"done"` or `"failed"`.

```json
{
  "version": 1,
  "id": "<host>/<owner>/<name>/<number>/<sha>",
  "state": "running | done | failed",
  "error": null,
  "repo": { "forge": "github | gitea", "host": "...", "owner": "...", "name": "...", "web": "https://..." },
  "pr": { "number": 12, "title": "...", "author": "...", "head": "feature/x", "base": "main",
          "sha": "<head sha>", "base_sha": "<merge base>", "url": "https://..." },
  "pid": 123, "started_at": "ISO", "finished_at": "ISO or null", "duration_ms": 0,
  "model": "claude-...", "cost_usd": 0.42, "log": "/abs/path/<sha>.log",
  "skipped": ["bun.lock"],
  "summary": "markdown", "verdict": "good | changes | questions",
  "findings": [
    { "id": "f1", "severity": "major", "path": "src/a.ts", "line": 42, "start_line": 40, "commentable": true,
      "title": "...", "body": "markdown", "suggestion": "code or null" }
  ],
  "posted": [ { "at": "ISO", "url": "https://...", "ids": ["f1"], "in_summary": ["f4"] } ]
}
```

A `running` review whose `pid` is no longer alive is reported as `failed` ("the review process stopped").

### `list` output (the contract with the panel)

```json
{
  "read_at": "ISO",
  "repos": [
    { "dir": "/abs/dir", "problem": null,
      "repo": { "forge": "github", "host": "...", "owner": "...", "name": "...", "web": "https://..." },
      "prs": [
        { "number": 12, "title": "...", "author": "...", "head": "feature/x", "base": "main", "sha": "...",
          "draft": false, "url": "https://...", "updated_at": "ISO",
          "review": null }
      ] }
  ]
}
```

- `review` is null when the PR has never been reviewed. Otherwise it is the latest review: `{ "file", "state", "stale", "sha", "started_at", "finished_at", "counts": { "blocker", "major", "minor", "nit" }, "posted": <number of findings posted>, "error" }`.
- `stale` is true when the review's sha is not the PR's head.
- `problem` names what stopped a repo from being read: not a git repo, no `origin`, a forge with no login, or an API error. The repo is kept in the output with `prs: []`.

### Posting

`pr-review post <file> --ids f1,f3` sends one review to the PR, against `commit_id` = the review's sha:

- GitHub: `POST /repos/{o}/{r}/pulls/{n}/reviews` with `{commit_id, event: "COMMENT", body, comments: [{path, line, side: "RIGHT", start_line?, start_side?, body}]}`. `start_line` is sent only when it is commentable and in the same hunk as `line`.
- Gitea: `POST /repos/{o}/{r}/pulls/{n}/reviews` with `{commit_id, event: "COMMENT", body, comments: [{path, new_position: line, body}]}`.
- A comment's body is the finding's title in bold, its body, and its suggestion. On GitHub the suggestion is a `suggestion` fence, which GitHub offers to apply. On Gitea it is a plain code fence.
- The review body is the summary on the first post, followed by every ticked finding that isn't `commentable`, as a list with `path:line`. Later posts carry only those out-of-diff findings.
- The ids that were posted are recorded under `posted`, and a later post skips them.
- If the forge rejects the inline comments (422), the post is retried once with every finding moved into the body.
- It prints `{url, ids, in_summary}` or `{error}`.

### `reviews-tmux` Herdr mod

It follows the `prds-tmux` pattern:

- A hidden headless copy beside the status bar runs `pr-review list` for the dirs in view and publishes shared `pr.reviews` (`{data, problem, busy}`). It reads when `tmux.where` changes, every 60 s, and every 3 s while one of its reviews is `running`.
- The panel and the status bar's `reviews N` chip only draw.
- The chip toggles the `reviews` view and carries a working-colour dot while a review runs.

Panel:

- A header with Here / All.
- Per repo, the forge and `owner/name`, then one row per PR:
  - its number and title, author, `head → base`, draft and age;
  - its review state: Review, a spinner with the elapsed time, the counts per severity in severity colours, Stale (the head has moved since), or Failed with the error as tooltip;
  - Review, or Re-run once reviewed, plus Open and Web.
- A problem shows in red as the repo's only row. A failed action says so for 10 s, as in `prds-tmux`.

Dialog: `openOverlay({ mod: "reviews-tmux", kind: "dialog", frame: "none", width: 0.8, height: 0.78, props: { file } })`. It uses the solid colours of the Board and preview zen mode, since `frame: "none"` overlays would otherwise be see-through.

- Header: the PR's number and title, `head → base`, the forge, the verdict, the model, the duration and the cost.
- Then the summary (Markdown), then the findings grouped by file:
  - each finding has a checkbox, its severity chip, `path:line`, the title, the body and the suggestion as code;
  - findings that can't be inline comments are marked "goes in the summary";
  - posted findings are greyed and can't be ticked.
- Blockers and majors start ticked.
- The footer's Post N button runs `pr-review post` and shows the URL it returns, or the error.
- Esc closes the dialog.
- It reloads the file while the state is `running`.

## Modes, agents, manual and retroactive reviews (second round, 2026-11-20)

### Modes

A PR's mode is its own override, else its repo's mode, else `semi`. Modes are stored in `~/.local/state/pr-review/modes.json` (`{repos: {"host/owner/name": mode}, prs: {"host/owner/name#12": mode}}`), which stays out of the dotfiles because repo names are private.

| Mode | Agents | A review you start | An agent's submitted review |
| --- | --- | --- | --- |
| manual | don't review unless you ask them to | waits in the dialog | waits in the dialog |
| semi | review on their own and submit | waits in the dialog | waits in the dialog |
| auto | review on their own and submit | posts the default picks (blockers and majors) when done | posts the default picks at once |

### For agents

- `pr-review context <dir> <number>` prints the PR, its effective mode and the annotated diff (the same line numbers the reviewer uses), so an agent can review in its own session.
- `pr-review submit <dir> <number> --name <agent> [--file f]` takes a review in the reviewer's schema (stdin or a file). It checks the review, fetches the PR to mark which findings can be inline comments, and stores the review with `source: {kind: "agent", name}`. In auto mode it then posts the default picks. It prints `{file, mode, posted}`.
- A skill, `pr-review` (`.config/omo/skills/pr-review/SKILL.md`), tells every omo session about the tool: when to review (after opening or updating a PR, when asked, or when a gate review finishes on work that has a PR), to check the mode first, and how to submit.

### Manual reviews

- `pr-review manual <dir> <number>` makes an empty review with `source: {kind: "manual", name: "you"}` and its diff, and prints `{file}`.
- `pr-review add <file> --path p --line n [--start-line m] --severity s --title t --body b` adds your own finding to any review (manual or not), with `by: "you"`, and prints `{id}`. `pr-review remove <file> <id>` removes one of your unposted findings.
- Every review keeps its diff beside it (`diff_file`): `{files: [{path, old_path, status, skipped, hunks: [{header, lines: [{kind, text, old, new}]}]}]}`. The dialog's Diff tab draws it, and clicking a new-side line opens a comment box that runs `pr-review add`.

### Retroactive reviews

`pr-review list --merged <dir>...` adds the PRs merged in the last 30 days (up to 20 per repo). A merged PR is diffed from its merge base (Gitea's `merge_base`, else the merge base of the PR's recorded `base.sha` and its head), not from today's base branch. Both forges accept review comments on merged PRs.

### Contract changes

- List repos carry `mode`. List PRs carry `state` (`open`, `merged` or `closed`), `mode` (effective) and `mode_override` (null or a mode), `reviews` (how many reviews exist) and `history` (the ten newest reviews in the same shape as `review`, newest first). The latest `review` also has `source`.
- Review files carry `source`, `phase` (while running: `fetching`, `reviewing` or `checking`), `diff_file`, and `by` on each finding (the reviewer's name, or `you`).
- A list repo that is only a folder with nothing to review (not a git repo, or no `origin`) carries `idle: true` beside its `problem`, so the status chip doesn't flag it.
- `pr-review mode <dir> <number|-> <manual|semi|auto|inherit>` sets a PR's or a repo's mode (`-` sets the repo's) and prints the effective modes.

## Errors

| Case | Shows |
| --- | --- |
| Not a repo, no origin, forge with no login | the repo's problem row, naming the fix (`gh auth login`, `tea login add`) |
| API error on list | problem row with the status; last good answer kept from the cache |
| omo exits non-zero, times out, or returns JSON outside the schema | review `failed` with the reason and the log path; Re-run |
| Review process died | `failed`, "the review process stopped" |
| Post rejected | retried with everything in the body; if that fails too, the error shows in the dialog |

## Testing

- `bun test` (`.local/bin/pr-review.d/*.test.ts`) covers the pure parts:
  - remote URL to host, owner and name;
  - forge detection from given gh and tea configs;
  - diff hunks to commentable lines;
  - the annotated diff;
  - the review JSON check;
  - each forge's post body, including the out-of-diff and 422 fallback.
- Live: one real PR on GitHub and one on Gitea, each reviewed from the panel and posted from the dialog, with the comments checked on the forge, plus screenshots of the panel and the dialog.
- The mod passes `herdr-app check`.
