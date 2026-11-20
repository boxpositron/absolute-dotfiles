---
name: pr-review
description: Use when reviewing a GitHub or Gitea pull request, when a gate or code review finishes on work that has an open PR, or when asked to leave review comments on a PR. Submits findings through the `pr-review` CLI, so they land in Herdr's Reviews panel and reach the PR as the PR's mode (manual, semi or auto) says.
---

# pr-review

`pr-review` (`~/.local/bin/pr-review`) keeps reviews of pull requests on GitHub and Gitea. David reads them in Herdr's Reviews panel, picks findings and posts them to the PR. Each PR has a mode, its own override or else its repo's (semi by default):

| Mode | You | What you submit |
| --- | --- | --- |
| manual | review only when David asks you to | waits in the panel |
| semi | review on your own (see When) | waits in the panel for David to pick from |
| auto | review on your own | posts its blockers and majors to the PR at once |

Submitting through `pr-review` is how reviews respect the mode. Don't post review comments with `gh pr review`, `gh api` or `tea` when this tool is available.

## When

- After you open a PR or push to one, in semi or auto mode.
- When a gate review (review-work, a code-reviewer child, your own final check) finishes on work that has an open PR: submit its findings as well as reporting them.
- When David asks you to review a PR, whatever the mode.
- Not again for the same head commit: `pr-review list <dir>` shows each PR's latest review with its `source` and `sha`. Skip when you (same `--name`) already reviewed that commit, unless asked.

## Steps

1. Find the PR: `pr-review list <dir>` lists the repo's open PRs (`number`, `head` branch, `sha`), so match your branch. Add `--merged` for PRs merged in the last 30 days, which can still be reviewed.
2. `pr-review mode <dir> <number>` prints `{repo, override, effective}`. Stop at `manual` unless David asked.
3. `pr-review context <dir> <number>` prints the PR (title, body, `sha`, `merge_base`), its mode, and `diff`. In `diff`, each line starts with its line number in the new file, and removed lines have none. Read more code than the diff when you need it. Your checkout may not be at the PR's head, so read files at the head with `git show <sha>:<path>`.
4. Write the review as JSON:
   ```json
   {"summary": "two to six sentences of Markdown: what the PR does and your view",
    "verdict": "good | changes | questions",
    "findings": [{"severity": "blocker | major | minor | nit", "path": "src/app.ts", "line": 42, "start_line": null,
                  "title": "one line", "body": "Markdown: what is wrong, why, what to do", "suggestion": null}]}
   ```
   - Cite `line` (and `start_line` for a range) from the diff's numbers, on added or unchanged lines, so findings become inline comments. A finding outside the diff goes into the review's body instead.
   - `suggestion` is the exact replacement for those lines, or null.
   - Report what the author should act on: bugs, security, data loss, breaking changes, missing tests, the repo's own rules. Leave out what a linter catches, and praise.
   - Severity: blocker must be fixed before merging, major should be fixed, minor is worth fixing, nit is optional.
5. Submit with a short, stable name for yourself (your role or session, for example `gate reviewer`):
   ```bash
   pr-review submit <dir> <number> --name "gate reviewer" <<'EOF'
   {"summary": "...", "verdict": "changes", "findings": [...]}
   EOF
   ```
   It prints `{file, mode, posted}`, or `{error}` naming what to fix in the JSON.
6. Tell David where it went. In semi or manual mode, say it is waiting in Herdr's Reviews panel. In auto mode, give the URL from `posted`.

## Other commands

- `pr-review review <dir> <number>` starts omo's own read-only review in the background, the same one as the panel's Review button. Use it when David asks for "a review" and your own context adds nothing.
- `pr-review post <file> --ids f1,f3` posts chosen findings from a stored review. Only do this when David asks you to post.
- `pr-review mode <dir> <number|-> <manual|semi|auto|inherit>` sets a mode. Only do this when David asks.

Every command prints one JSON value. `pr-review` alone lists the commands.
