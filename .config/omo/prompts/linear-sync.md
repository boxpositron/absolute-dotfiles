---
description: Post a progress update to this workspace's Linear issues and set their status, without cleaning up
argument-hint: "[notes for the Linear comment]"
requires-arguments: false
---
Sync this workspace's progress to Linear. Do not remove or change the workspace.

1. Run `owt done --check` to get the branch, PR state and PR link. If this is not an owt workspace, use `git branch --show-current` for the branch and continue.

2. Work out which Linear issues this work covers: the keys in the branch name (`feature/pra-107-108-...` means PRA-107 and PRA-108) plus any issues named earlier in this session. Read each with the Linear tools, including comments. If you find none, ask me which issues to update.

3. For each issue, post one comment covering: what is done so far, what is left, the branch name, and the PR link if there is one. Keep it short and factual, based on the actual commits and diff (`git log --oneline <base>..HEAD`, `git diff --stat <base>`), not on plans. Include these notes from me, if any: $ARGUMENTS

4. Set each issue's status from the PR state: no PR means In Progress, an open PR means In Review. Never move an issue to Done here; `/owt-done` does that after the merge. Leave an issue alone if it is already in a later status than this rule gives.

5. Tell me in a few lines which issues you updated and their status.
