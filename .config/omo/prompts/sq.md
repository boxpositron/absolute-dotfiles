---
description: Safe quit. Sync this session's work (trackers, time, git, memory), write a handoff, then mark the session ready to close; `:sq` closes it afterwards
---
Safe quit. I am stepping away and may be too tired to check anything, so make sure nothing from this session is lost, then get the session ready to close. Do not start new work and do not ask me questions: decide, and record anything you could not do in the handoff.

1. Running work: finish or stop the background tasks, monitors and child tasks this session started. If one must keep running (a deploy, a migration), say so.
2. Client work: if `omo-work status` shows a bound task, post the logged time and progress as a dated task comment, run `omo-work posted`, and update the task and its PRD as `~/.config/omo-work/rules.md` says.
3. Trackers: bring the Linear issues and Studio records this session worked on up to date (state, a short progress comment).
4. Git: in each repository this session changed, commit this session's own changes with a clear message and push them; running /sq or `:sq` is my request to commit and push. Never include changes this session did not make. Before pushing to a public repository, check the diff for secrets, client names and private paths; if anything private is in it, do not push and say so. List anything you left uncommitted and why. In an owt workspace whose branch has already merged (`owt done --check` says `merged=yes`), do not commit onto that branch, because finishing the workspace deletes it: leave the changes and say in the handoff that they need a new branch, or that /owt-done can finish the workspace if nothing is left.
5. Memory: save the durable facts and decisions from this session.
6. Todos and goal: mark finished todos done and leave open ones open. Leave an active goal active unless it is complete.
7. Handoff: end with a handoff block (Ask, For you, Now, Next) that someone reopening this session tomorrow can act on: what is done, what is open, what was not synced and why.
8. Last line, on its own: `SQ: ready` when the session can close without losing anything, or `SQ: hold <reason>` when closing now would lose work.
