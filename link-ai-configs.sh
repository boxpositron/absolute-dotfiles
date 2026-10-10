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
)
targets=(
    .config/ai/AGENTS.md
    .config/opencode/AGENTS.md
    .omo/omo.jsonc
    .claude/.omc-config.json
    .claude/CLAUDE.md
    .claude/settings.json
)

# ~/.config/opencode/AGENTS.md above is OmO's global-rules path, not an OpenCode
# file. OmO's rules engine reads it before ~/.claude/CLAUDE.md and stops at the
# first hit, so this link both supplies the shared preferences and keeps Claude
# Code's OMC orchestration text out of OmO. Keep it after OpenCode is gone.

# Skills vendored from upstream repos; provenance, verification and upgrade
# steps are in .config/omo/skills/README.md. frontend-workflow is the OmO
# delegation process skill and is not linked into Claude Code; the rest are
# shared by both harnesses.
omo_skills=(frontend-workflow impeccable web-design-guidelines product-marketing copywriting copy-editing emails cold-email content-strategy seo-audit ai-seo launch social)
claude_skills=(impeccable web-design-guidelines product-marketing copywriting copy-editing emails cold-email content-strategy seo-audit ai-seo launch social)
for skill in "${omo_skills[@]}"; do
    sources+=(".config/omo/skills/$skill")
    targets+=(".omo/agent/skills/$skill")
done
for skill in "${claude_skills[@]}"; do
    sources+=(".config/omo/skills/$skill")
    targets+=(".claude/skills/$skill")
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
