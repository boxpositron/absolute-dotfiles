---
description: Finish this owt workspace - close its Linear issues, then remove the worktree and close the window
argument-hint: "[notes for the Linear comment]"
requires-arguments: false
---
Close out the owt workspace this session is running in. Do the steps in order.

1. Run `owt done --check`. It prints `key=value` lines: workspace, path, branch, base, uncommitted, merged, pr_state, pr_url, remote_branch. It exits 1 when finishing would lose work. If it says this is not an owt workspace, stop and tell me.

2. Work out which Linear issues this workspace covered: the keys in the branch name (`feature/pra-107-108-...` means PRA-107 and PRA-108) plus any issues named earlier in this session. Read each with the Linear tools. If you find none, ask me which issues, if any, to close.

3. If the check exited 1, list exactly what would be lost (uncommitted files with `git status --short`, commits not on the base branch with `git log --oneline <base>..HEAD`, and the PR state), then ask me whether to discard it. Do not continue without an explicit yes. If I say no, stop here and change nothing.

4. Update Linear for each issue:
   - If `merged=yes`: comment with a short summary of what shipped, the PR link (`pr_url`), and the branch name, then move the issue to Done.
   - If I approved discarding unmerged work: comment that the workspace was discarded without merging and why, and leave the status as it is unless I say otherwise.
   Include these notes from me in the comment, if any: $ARGUMENTS

5. Give me a short final summary: issues updated and their new status, PR link, and what cleanup will remove.

6. As your very last action, run `owt done --detach`, adding `--force` only if I approved discarding work in step 3. About 5 seconds later it deletes the merged remote branch, removes the worktree and local branch, and closes this tmux window, which ends this session. Run nothing after it.
