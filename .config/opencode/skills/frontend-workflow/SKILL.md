---
name: frontend-workflow
description: Use for substantive frontend UI implementation, redesign, styling, or visual review. Coordinates project-specific design direction, single-writer GPT implementation, browser image feedback, accessibility checks, and bounded correction. Not for backend-only work or trivial copy edits.
---

# Intentional frontend workflow

## 1. Establish the contract

Identify the page's audience, purpose and primary user action. Read existing components, tokens, PRODUCT.md/DESIGN.md and supplied references. Preserve established conventions unless a redesign is requested. Missing DESIGN.md does not mean missing design evidence. Record proposed defaults as proposals, not approved brand decisions. Ask only for a consequential unresolved choice, unavailable credential, or unsupported capability.

For this dotfiles repository's demonstration surface, read `references/dotfiles-workbench.md`. For other products, use their own evidence, never inherit this demonstration's palette or audience.

Write a short working design contract: typography and hierarchy, colour roles, spacing/layout rhythm, reusable components and states, imagery purpose, responsive behaviour, and measurable acceptance criteria. A resolved existing brief is sufficient; do not create unnecessary plans or research rounds.

## 2. Load complementary guidance on demand

- Load `impeccable` for direction/implementation, then only its relevant playbook. Resolve launcher commands from the loaded skill's base directory, not an assumed project-relative path. If its launcher cannot run, follow its documented fallback and read context directly.
- Load `web-design-guidelines` during accessibility and interaction review; fetch its current rule source and record the source/date. Network failure is a disclosed gap, not permission to invent a successful audit.
- Load the browser skill when using its tools. Prefer the configured isolated `playwright` MCP; preserve any existing working browser. Do not take over or kill the user's browser to resolve a profile lock.
- Optional design advice is subordinate to user instructions and product conventions. No blanket font/gradient/card/animation bans. No decoration just to look distinctive. Do not stack competing aesthetic skill libraries without a specific need.

## 3. One owner, separate passes

Use OMO's existing `visual-engineering` category and existing GPT model for implementation. Browser inspection and visual critique can be sequential passes by that same worker. No new model or agent is required. The registered GLM `multimodal-looker` is not the default visual-quality judge for this GPT workflow.

Delegation handoff must include: purpose/action; context and reference paths; approved versus proposed decisions; acceptance criteria; run/build commands and URL; owned files; phase (`implement`, `inspect`, `critique`, or `correct`); remaining pass/time budget. Pass relevant skill names through the task tool's supported `load_skills`, not an invented category `skills` config key. One writer per file set. Review delegates are read-only and return findings; only the owner applies corrections after review completes.

## 4. Build, then obtain actual visual evidence

Run the affected build/type/tests. Start the app on loopback using its documented command. Inspect at desktop and mobile widths, with an intermediate width when breakpoints or layout complexity warrant it. Use product targets, or proposed defaults 1280×900, 390×844, and 768×900. Record URL, viewport, state, and screenshot path.

After capture, check whether the tool response contains an actual image. If it returns only a path, use the native image-capable `read` tool to open the PNG, or attach it to the GPT session (`opencode run --model <existing-GPT-model> --file <screenshot> -- <inspection-prompt>`). Keep existing model identifiers; do not invent one. Describe concrete visible details to demonstrate receipt. DOM checks are complementary, not substitutes. If the model cannot see pixels, report the exact failing delivery step and do not claim visual QA.

## 5. Bounded critique and correction

Normally allow up to three total inspect/correct passes. For each pass:
1. Inspect desktop/mobile screenshots and relevant states. Describe the observed hierarchy, typography, spacing, colour, and alignment.
2. Rank the three most significant visible problems, or fewer if fewer are material. Cite the viewport/state and user impact, not subjective novelty. Do not fabricate findings to reach three.
3. Correct those issues in one edit batch, rebuild, and capture/read fresh screenshots. Re-test affected interactions.

Exercise the primary interaction and relevant loading, empty, error, focus and disabled states. Check horizontal overflow, wrapping/long content, text and control contrast, keyboard order/access, accessible labels/status messages, and reduced-motion behaviour. Record not-applicable states with a reason. Separate source review from browser-observed results; automated checks cannot establish aesthetic quality or complete accessibility conformance.

Stop early when the acceptance criteria hold. At the cap, report residual issues and their impact instead of continuing cosmetic churn. Respect a user-requested phase boundary (for example, an evaluator-owned browser pass).

## 6. Evidence and evaluation

Hand over changed files, tests/build result, screenshot paths with viewport/state, visible findings and fixes, interaction results, remaining debt, and any image-delivery limitation. Never promise to outperform another model or tool.

For comparisons, use the same brief, starting files, GPT model/reasoning, viewports, and declared time/token caps. Record actual elapsed time, input/output/reasoning/cache usage and subagent usage when available. A timeout is a task-completion result, not a visual-quality score. Blind A/B artifacts for a human reviewer; hide tool labels until ratings are recorded. Evaluate hierarchy, typography, spacing, consistency, responsiveness, accessibility, and primary-task completion. One sample and the generating model's own score cannot establish general superiority over Claude Code.
