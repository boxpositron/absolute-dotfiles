# Vendored agent skills

These skills are vendored copies, not submodules. `link-ai-configs.sh` links every
directory here into `~/.omo/agent/skills/`, and all of them except
`frontend-workflow` into `~/.claude/skills/`, so OmO and Claude Code read one
canonical source instead of divergent copies.

They moved here from `.config/opencode/skills/` when OpenCode was retired; the
OpenCode-era evaluation notes and rollback steps are in git history at
`.config/opencode/README.md`.

## Provenance

| Skill | Upstream | Revision | License |
|---|---|---|---|
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) (`.opencode` integration, tag `skill-v4.8.0`, engine 0.1.18) | `414603bf14c7a344edb466bb1f85690c77ce8b7d` | Apache 2.0, included |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) (`skills/web-design-guidelines/SKILL.md`) | `063bee94c3f4df8453406c830b0a7df0f2860278` | per upstream |
| ten marketing and copy skills | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) (`skills/`) | `b9ba399dd88b082b926e261e8ccfb843d20aa066` | MIT, copied into each skill |
| `stageshow` | [benjitaylor/skills](https://github.com/benjitaylor/skills) (`stageshow/`) | `802057409787133703c56001080169e347305572` | MIT, included; app icons and brand artwork keep their own terms (`NOTICE.md`, `kit/brands/`) |
| `frontend-workflow` | local | - | - |
| `sound-design` | local | - | - |

The ten marketing skills are `product-marketing`, `copywriting`, `copy-editing`,
`emails`, `cold-email`, `content-strategy`, `seo-audit`, `ai-seo`, `launch` and
`social`.

## Local modifications

- **`impeccable`**: every `.opencode/skills/impeccable/scripts/impeccable` command
  path was rewritten to `~/.omo/agent/skills/impeccable/scripts/impeccable`,
  including the `allowed-tools` Bash entry and the base-directory fallback in
  `SKILL.md`. Without this the detector and live-server verbs do not resolve under
  OmO. `reference/critique.md` also carries an OmO routing line that sends
  Assessment A to the `design-critique-a` category and Assessment B to
  `design-critique-b` (defined in `.config/omo/omo.jsonc`). `LICENSE` comes from the
  upstream repository root, because the `.opencode` directory ships without one. The
  engine binary is not vendored: on first run, `scripts/impeccable` downloads the
  version named in `scripts/VERSION` into `~/.impeccable/bin/<version>/` and checks it
  against the published checksum.
- **`web-design-guidelines`**: unchanged. It fetches the current
  [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)
  when invoked, so its rule feed is intentionally not pinned.
- **marketing skills**: unchanged. They read a per-project
  `.agents/product-marketing.md` for product context, and a project's own copy
  skill overrides their generic direct-response advice. Links to the upstream
  repo's top-level `tools/` directory were not vendored and resolve to nothing.
- **`stageshow`**: the `description` in `SKILL.md` frontmatter was narrowed.
  Upstream's version fires for any hero or product shot "even if they never say
  faux UI", which pulls it into ordinary landing page work; the local one fires
  only for product illustrations, mocked screens and demo animations, and sends
  real interface work to `impeccable` or `frontend`. The skill's preview and
  `scripts/film.mjs` need `npm install` inside the skill directory and write
  `shots/` there, so `node_modules/`, `dist/` and `shots/` under it are ignored in
  the dotfiles `.gitignore`. Its workflow also copies a starting example into
  `examples/<name>/` inside the skill; delete those copies before committing.

## Upgrading

Re-copy the same directories from a newer upstream revision, update the revision
in the table above, then re-apply the local modifications listed for that skill
and rerun `link-ai-configs.sh`. For `stageshow`, run
`rsync -a --delete <upstream>/stageshow/ .config/omo/skills/stageshow/` and put the
narrowed `description` line back in `SKILL.md`. For `impeccable`, re-apply the path
rewrite:

```bash
cd .config/omo/skills/impeccable
rg -l -F '.opencode/skills/impeccable/scripts' . \
  | xargs sed -i '' 's#\.opencode/skills/impeccable/scripts#~/.omo/agent/skills/impeccable/scripts#g'
```

This pattern also covers the base-directory fallback in `SKILL.md`, which ends at
`scripts` rather than `scripts/impeccable`. Keep `LICENSE` when re-copying (for
example `rsync -a --delete --exclude LICENSE <upstream>/.opencode/skills/impeccable/ .`),
and re-add the OmO routing line after the "Delegate Assessment A and Assessment B"
paragraph in `reference/critique.md`.
