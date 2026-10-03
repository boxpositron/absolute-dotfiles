# OpenCode development workflows

## Automatic task routing

`DEVELOPMENT-WORKFLOW.md` is loaded through OpenCode's `instructions` and managed by `link-ai-configs.sh`. Questions stay read-only, exact small edits stay lightweight, and bugs enter systematic debugging. Features and significant behaviour or architecture changes enter brainstorming, a written spec and plan, and explicit approval before implementation. Approved separable tasks use subagents with file ownership and spec-compliance and code-quality review. Existing UI workflow rules still apply.

This is model-followed policy, not a plugin-enforced permission gate. `ulw-plan` remains explicitly opt-in. Restart OpenCode after changing the instructions.

The TypeSafe skill can be installed for OpenCode with `npx skills add typesafe-ai/skills --skill typesafe-ai --agent opencode --global --yes`. Its Jev model is useful for optional semantic task/skill suggestions, not generating specifications or granting approval. The default router makes no TypeSafe API calls and requires no API key. See the [TypeSafe skill-suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion.md) before considering a separate integration.

## GPT visual workflow

This setup keeps the existing GPT models and adds a bounded, evidence-led frontend process. It does not promise better results than Claude Code.

## Installed integration

- OpenCode 1.18.31 and Oh My OpenAgent (OMO) 4.19.4 were inspected and exercised.
- Impeccable skill 4.3.1 is vendored unchanged from the upstream compiled `.opencode/skills/impeccable` integration at [pbakaus/impeccable revision f2c7051853848826aac2f4646581d62a732155ad](https://github.com/pbakaus/impeccable/tree/f2c7051853848826aac2f4646581d62a732155ad/.opencode). Its native slash command is in `command/impeccable.md`; its Apache 2.0 license is included. The installed launcher reports engine `4.0.0`; both `context` and `detect` ran successfully. Skill, npm launcher and engine version numbers are distinct.
- The documented command `npx impeccable@4.1.0 install -y --providers=opencode --scope=global --no-hooks` timed out downloading its payload. Installation therefore used the pinned, committed OpenCode integration artifacts above, through OpenCode's documented global skill and command directories, rather than inventing another skill format.
- Vercel's `web-design-guidelines` SKILL.md comes from [vercel-labs/agent-skills revision 063bee94c3f4df8453406c830b0a7df0f2860278](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines/SKILL.md). It fetches the current [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) when invoked, so its rule feed is intentionally not pinned.
- `frontend-workflow` is the small local process skill. Its dotfiles-workbench reference distinguishes repository evidence from proposed fixture defaults; no approved web brand or screenshot reference was invented.

`link-ai-configs.sh` links the three managed skill directories into `~/.config/opencode/skills/`, plus `UI-WORKFLOW.md`. Old OpenCode Impeccable 3.6 and duplicate Vercel copies were archived. Claude's design-skill paths now alias the same canonical Impeccable and Vercel source, preserving discovery without divergent copies. Unrelated skills and Claude configuration were not changed.

## Default behaviour and ownership

The short `UI-WORKFLOW.md` trigger is loaded through OpenCode `instructions`. It loads the workflow skill only for substantive UI tasks. OMO's existing `visual-engineering` category retains `openai/gpt-6-astra` with high reasoning and uses the supported `prompt_append` field for delegation context. No unsupported category `skills` property was added.

One owner implements and corrects a file set. Browser inspection and critique are separate sequential passes, with a normal maximum of three. A delegated handoff supplies purpose, primary action, design/reference paths, acceptance criteria, run command, phase, ownership and remaining budget. Read-only reviewers return findings, not concurrent edits. The user brief and established design system override optional aesthetic bans or arbitrary perfect-score demands.

Existing Hephaestus, OpenAI and z.ai model assignments are unchanged. GPT workers inspect images directly; the GLM `multimodal-looker` remains available for other work and is not silently substituted for GPT visual judgement.

## Browser and screenshot delivery

The configured Playwright MCP is pinned to `@playwright/mcp@0.0.81`, using installed Chrome, an isolated headless profile and `--image-responses allow`. Its CLI help confirmed these flags; the fresh OpenCode server reported it connected. Existing Chrome DevTools configuration was preserved, including its independent profile-lock limitation.

A fresh OpenCode GPT-6 Astra session called the configured `playwright_browser_navigate`, `playwright_browser_resize` and `playwright_browser_take_screenshot` tools. The screenshot tool returned an actual `image/png` data attachment. GPT identified a purple circle, teal triangle, orange square, and random six-character code `658FDB` without inspecting DOM/source or reading the file. Session: `ses_f4f2b153cffeGEf87dvdhGTgZc`.

Some wrappers return only a screenshot filename. In that case the worker must explicitly read the image or attach it to the GPT session before claiming visual inspection. A separate attachment test and three-screenshot critique also succeeded. Never infer image receipt merely from a tool success message.

## Verification evidence

Artifacts are under `~/Projects/Research/opencode-design-evaluation-2026-09-17/`:

- `runtime-evidence.json`: fresh skill discovery, agent models, MCP connection, actual skill invocations and recorded session usage.
- `updated/`: representative build, screenshot critique, correction, and fresh `pass2-*.png` desktop/mobile/intermediate and interaction-state captures.
- `controlled-before/` and `controlled-after/`: separate initial builds from the same brief and starting context with explicit working directories.
- `EVALUATION.md` and `HUMAN-REVIEW.md`: measured results, limitations and an unscored blind preference form.

The representative page passed `node --check app.js`, JavaScript diagnostics, desktop/mobile Run/loading/disabled/error/retry/success/filter/empty/reset checks, visible keyboard focus, reduced motion and long-text wrapping. No horizontal overflow at 1280, 768 or 390px. Sampled rendered text contrast was at least 6.7:1. Two independent GPT reviewers approved the final source/evidence and all 13 fresh screenshots, without a numeric taste score.

The critic found two material issues rather than fabricating a third. Corrections moved scenario before Run and reduced mobile setup overhead; the first check starts at 628px instead of roughly 840px. The process stopped after two screenshot rounds. Impeccable's mechanical detector retained one advisory about repeated safety-disclosure copy. Full screen-reader, cross-browser and production performance testing were not performed on this disposable static fixture.

## Rollback

Pre-change snapshots are in `~/.local/state/opencode-design/2026-09-17/`. Do not use a repository-wide Git reset: unrelated changes predate this work.

1. Quit OpenCode. Preserve any changes made since installation before restoring snapshots.
2. Restore `omo.jsonc` to `~/dotfiles/.config/omo/omo.jsonc`, `opencode.json` to `~/dotfiles/.config/opencode/opencode.json`, `link-ai-configs.sh` to the repository root, and `dotfiles-README.md` to the root README.
3. Remove only the newly created symlinks `~/.config/opencode/UI-WORKFLOW.md` and `~/.config/opencode/skills/{frontend-workflow,impeccable,web-design-guidelines}`. Leave their source directories intact if you want to retain the work for inspection.
4. Restore `retired-opencode-impeccable` to `~/.opencode/skills/impeccable` and `retired-opencode-web-design-guidelines` to `~/.config/opencode/skill/web-design-guidelines`.
5. Remove only the two new Claude skill symlinks, then restore `retired-claude-impeccable` and `retired-claude-web-design-guidelines` to their original directories under `~/.claude/skills/`.
6. Move the newly added `~/dotfiles/.config/opencode/command/impeccable.md` out of the command scan root. Restart OpenCode. No model credentials, accounts or unrelated settings need changing.

For future upgrades, review upstream changes and preserve this contextual workflow. Do not merge an old Impeccable script tree into a newer one. After changes, restart OpenCode and repeat the native screenshot smoke test and discovery checks.
