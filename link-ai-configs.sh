#!/usr/bin/env bash
set -euo pipefail

dry_run=false
while [ "$#" -gt 0 ]; do
    case "$1" in
        --dry-run) dry_run=true ;;
        --help|-h)
            printf '%s\n' 'Usage: bash link-ai-configs.sh [--dry-run]' \
                'Link selected AI configuration files into HOME. Requires Node.js.' \
                'Existing files and links are moved to ~/.local/state/dotfiles-ai/backups/.' \
                'Credentials, local settings, installed plugins, unrelated skills, and runtime state are not managed.'
            exit 0
            ;;
        *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
    esac
    shift
done

: "${HOME:?HOME must be set}"
if ! command -v node >/dev/null 2>&1; then
    printf '%s\n' 'Node.js is required to resolve portable symlink paths.' >&2
    exit 1
fi
repo_root=$(node -e 'console.log(require("node:path").dirname(require("node:fs").realpathSync(process.argv[1])))' "$0")

sources=(
    .config/ai/AGENTS.md
    .config/ai/AGENTS.md
    .config/omo/omo.jsonc
    .config/claude/omc.json
    .config/claude/CLAUDE.md
    .config/claude/settings.json
    .config/opencode/opencode.json
    .config/opencode/tui.json
    .config/opencode/plugin/strip-omc-mcp.ts
    .config/opencode/plugin/strip-claude-only-commands.ts
    .config/opencode/plugin/lib/claude-only-command-registry.ts
    .config/opencode/UI-WORKFLOW.md
    .config/opencode/DEVELOPMENT-WORKFLOW.md
    .config/opencode/skills/frontend-workflow
    .config/opencode/skills/impeccable
    .config/opencode/skills/web-design-guidelines
)
targets=(
    .config/ai/AGENTS.md
    .config/opencode/AGENTS.md
    .omo/omo.jsonc
    .claude/.omc-config.json
    .claude/CLAUDE.md
    .claude/settings.json
    .config/opencode/opencode.json
    .config/opencode/tui.json
    .config/opencode/plugin/strip-omc-mcp.ts
    .config/opencode/plugin/strip-claude-only-commands.ts
    .config/opencode/plugin/lib/claude-only-command-registry.ts
    .config/opencode/UI-WORKFLOW.md
    .config/opencode/DEVELOPMENT-WORKFLOW.md
    .config/opencode/skills/frontend-workflow
    .config/opencode/skills/impeccable
    .config/opencode/skills/web-design-guidelines
)

# Marketing and copy skills vendored from coreyhaines31/marketingskills (see
# .config/opencode/README.md), linked for OpenCode, Claude Code and OMO.
marketing_skills=(product-marketing copywriting copy-editing emails cold-email content-strategy seo-audit ai-seo launch social)
for skill in "${marketing_skills[@]}"; do
    for target_dir in .config/opencode/skills .claude/skills .omo/agent/skills; do
        sources+=(".config/opencode/skills/$skill")
        targets+=("$target_dir/$skill")
    done
done

# Preflight the entire manifest before changing any live file.
for i in "${!sources[@]}"; do
    source="$repo_root/${sources[$i]}"
    target="$HOME/${targets[$i]}"
    if [ ! -e "$source" ] || { [ -d "$target" ] && [ ! -L "$target" ]; }; then
        printf 'Refusing missing source or directory target: %s -> %s\n' "$source" "$target" >&2
        exit 1
    fi
done

umask 077
backup_dir=''
for i in "${!sources[@]}"; do
    source="$repo_root/${sources[$i]}"
    target="$HOME/${targets[$i]}"
    if [ "$source" -ef "$target" ]; then
        printf 'Already linked: %s\n' "$target"
        continue
    fi
    parent=$(dirname "$target")
    if "$dry_run"; then
        if [ -e "$target" ] || [ -L "$target" ]; then
            printf 'Would back up: %s\n' "$target"
        fi
        printf 'Would link: %s -> %s\n' "$target" "$source"
        continue
    fi
    mkdir -p "$parent"
    relative=$(node -e 'console.log(require("node:path").relative(require("node:fs").realpathSync(process.argv[1]), process.argv[2]))' "$parent" "$source")
    backup=''
    if [ -e "$target" ] || [ -L "$target" ]; then
        if [ -z "$backup_dir" ]; then
            backup_base="$HOME/.local/state/dotfiles-ai/backups"
            mkdir -p "$backup_base"
            backup_dir=$(mktemp -d "$backup_base/$(date +%Y-%m-%dT%H-%M-%S).XXXXXX")
        fi
        backup="$backup_dir/${targets[$i]}"
        mkdir -p "$(dirname "$backup")"
        mv "$target" "$backup"
        printf 'Backed up: %s\n' "$backup"
    fi
    if ! ln -s "$relative" "$target"; then
        if [ -n "$backup" ]; then mv "$backup" "$target"; fi
        exit 1
    fi
    printf 'Linked: %s -> %s\n' "$target" "$relative"
done
