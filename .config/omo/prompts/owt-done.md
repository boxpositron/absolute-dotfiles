---
description: Finish this owt workspace - sync it as /sq does (Studio, memory, handoff), close its Linear issues, then remove the worktree and close the window
argument-hint: "[notes for the Linear comment]"
requires-arguments: false
---
Close out the owt workspace this session is running in. This is /sq (safe quit, `~/.omo/agent/prompts/sq.md`) for a workspace whose work is done: everything the session did is synced, then the workspace is removed and the session ends. Do the steps in order.

If your previous message in this session ended with `SQ: done` (or `SQ: ready`), this runs straight after a safe quit and I may have stepped away. Skip step 4, which that safe quit already did, and do not ask me anything: in step 2, if no existing issue matches, continue without Linear and say so in the handoff, and if the check in step 1 exits 1, change nothing and say what stopped it.

1. Run `owt done --check`. It prints `key=value` lines: workspace, path, branch, base, uncommitted, merged, pr_state, pr_url, remote_branch. It exits 1 when finishing would lose work. If it says this is not an owt workspace, stop and tell me.

2. Work out which Linear issues this workspace covered: the keys in the branch name (`feature/pra-107-108-...` means PRA-107 and PRA-108) plus any issues named earlier in this session. Read each with the Linear tools. If you find none, search Linear for an open issue that matches the work this session did (its PRs, branch and subject) and use it if one does. If nothing matches, the work still needs a record: draft a new issue with a title, a short description of what was done and its PR links, and the team the repository's other issues use, show it to me, and create it only after I confirm. Treat a created issue like the others in step 5. If I decline, continue without Linear.

3. If the check exited 1, list exactly what would be lost (uncommitted files with `git status --short`, commits not on the base branch with `git log --oneline <base>..HEAD`, and the PR state), then ask me whether to discard it. Do not continue without an explicit yes. If I say no, stop here and change nothing.

4. Sync the rest as /sq does (its steps 1, 2, 5 and 6): finish or stop the background tasks, monitors and child tasks this session started; if `omo-work status` shows a bound task, post the logged time and what shipped as a dated task comment, run `omo-work posted`, and move the task and its PRD on as `~/.config/omo-work/rules.md` says; save the durable facts and decisions from this session; mark finished todos done and close the goal if it is complete. Skip /sq's git step: step 3 already decided what happens to this workspace's changes, and a commit pushed now onto a merged branch would be deleted by the cleanup.

5. Update Linear for each issue:
   - If `merged=yes`: comment with a short summary of what shipped, the PR link (`pr_url`), and the branch name, then move the issue to Done.
   - If I approved discarding unmerged work: comment that the workspace was discarded without merging and why, and leave the status as it is unless I say otherwise.
   Include these notes from me in the comment, if any: $ARGUMENTS

6. End with a handoff block (Ask, For you, Now, Next), as /sq does, so the record of this session says what happened: issues updated or created and their new status, the PR link, what was synced to Studio and memory, anything not synced and why, and what cleanup will remove.

7. As your very last action, run `owt done --detach`, adding `--force` only if I approved discarding work in step 3. About 5 seconds later it stops every process still running in the workspace (dev servers, watchers, this session) and the docker compose containers started from it, deletes the merged remote branch, removes the worktree and local branch, and closes this tmux window. Run nothing after it.
