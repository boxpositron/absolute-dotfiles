# Automatic development workflow

Apply this routing policy to each new user goal without requiring a command or skill name. Explicit user instructions and project requirements take precedence. This is an instruction-based workflow, not a tool-permission enforcement mechanism.

## Choose the smallest appropriate route

- Questions and explanation-only requests: answer without making changes. Do not reinterpret curiosity as authorisation to implement.
- Trivial, fully specified edits (typos, formatting, exact configuration values): inspect, edit, and verify directly. Do not start a brainstorming ceremony.
- Bug fixes that restore established behaviour: load `systematic-debugging`, investigate, fix narrowly, and verify through the affected surface. If the fix requires a new product decision or architectural change, switch to the design route before implementing that change.
- New features, meaningful behaviour changes, ambiguous requirements, or significant architectural changes: automatically enter the design route below. Judge risk and semantics, not just file count. A one-line authorisation change is not a trivial edit.
- An already approved spec and plan: resume execution without restarting brainstorming. Confirm approval applies to the current scope and revision.

For substantive work, briefly name the chosen route. If classification is uncertain, inspect context read-only first; ask one focused question only if the answer changes scope or the approval boundary. Reassess when new evidence materially changes the task.

## Design and approval

Load `brainstorming` (or `superpowers:brainstorming` if unavailable). Explore the existing implementation, clarify material unknowns, compare credible approaches, and recommend one. Keep the process proportional to the task.

Before implementation, produce a concise written specification and implementation plan covering goal, non-goals, behaviour, acceptance criteria, affected components, risks, dependencies, and verification. Use the project's documentation conventions; otherwise use `docs/superpowers/specs/` and `docs/superpowers/plans/`. Load `superpowers:writing-plans` when available to structure the plan.

Present the current spec and plan for explicit approval, then stop. Read-only exploration and writing planning documents are allowed before approval; implementation, scaffolding, dependency changes, and delegating implementation are not. A request to build a feature is not approval of an unseen design. Approval already given for the same presented scope counts; do not ask twice. Material scope changes require renewed approval. Never commit merely because a skill says to; commit only when the user requests it.

This automatic route does not invoke `ulw-plan`, Prometheus, Metis, Momus, or `start-work` as a shortcut around their activation requirements. Preserve their explicit opt-in gates. If the user explicitly chooses one of those workflows, follow its own rules rather than running two planning processes.

## Approved execution and review

For an approved plan with separable implementation tasks, load `superpowers:subagent-driven-development` when available and use OMO task delegation. Give each worker the approved spec, acceptance criteria, dependencies, owned files, and required evidence. Keep a single writer per file set. Parallelise only independent work supported by the harness; run dependent work sequentially. Keep a single coherent edit local rather than inventing a team.

Workers execute their assigned scope; they do not restart the top-level brainstorming or approval loop. They report material scope gaps to the parent. The parent reviews results against the spec, then reviews code quality, runs relevant checks, and exercises the matching user-facing surface. Do not treat a worker's success claim as verification. If delegation is unavailable, execute sequentially and disclose that limitation.

For substantive UI work, also follow `UI-WORKFLOW.md` and load `frontend-workflow`; preserve its ownership and bounded visual review rules. Do not duplicate an already approved design process.

## TypeSafe and Jev

Load the installed `typesafe-ai` skill when designing or implementing semantic routing, ranking, extraction, or verification with TypeSafe, and consult its live documentation. Jev can suggest task categories or relevant skills using typed judgments. It is not a replacement for a reasoning/coding agent, spec review, tests, or observed user approval.

The default workflow requires no TypeSafe API calls. Installing its skill does not enable an API integration. Before adding one, agree on data sharing and credentials; do not send source code, secrets, or private conversations to a new service by default. Keep permissions, opt-in gates, and approval state explicit outside probabilistic judgments. Uncertain suggestions must not bypass those boundaries.
