#!/usr/bin/env bash
# Set up a Mac from this dotfiles repo. Safe to rerun: every step checks what
# is already in place and only does the missing work.
#
#   ./setup-mac.sh                 run every step in order
#   ./setup-mac.sh links shell     run only the named steps
#   ./setup-mac.sh --dry-run       show what would change without changing it
#
# Steps: xcode homebrew brew links shell runtimes ai apps
# Packages live in Brewfile (CLI tools, fonts, terminals) and Brewfile.apps
# (GUI and App Store apps). Written for the bash 3.2 that ships with macOS.

set -uo pipefail

STEPS="xcode homebrew brew links shell runtimes ai apps"
DOTFILES=$(dirname "$(realpath "${BASH_SOURCE[0]}")")
NVM_DIR=$HOME/.config/nvm
NODE_VERSION=22
PYTHON_VERSION=3.11
NPM_GLOBALS="oh-my-claude-sisyphus 9router better-sqlite3 sql.js systray2"
DRY_RUN=false

# Repo paths linked into $HOME, as "source:target" when the target differs.
# Paths missing from the repo (gitignored local files such as .env) are skipped.
# The AI configs are linked separately by link-ai-configs.sh in the ai step.
LINKS="
.zshrc
.tmux.conf
.tmux-server.conf
.rgignore
.withcontextconfig.jsonc
.withcontextignore
.env
.envrc
.opencommit
AGENTS.md
docs
local_servers
.superpowers
.config/nvim
.config/ghostty
.config/wezterm
.config/direnv
.config/starship.toml
.config/ohmyposh/zen.toml
.config/zellij/config.kdl
.config/zed/keymap.json
.config/zed/settings.json
.config/omo/hooks.json:.omo/agent/hooks.json
.config/omo/prompts:.omo/agent/prompts
"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

run() {
    if $DRY_RUN; then info "would run: $*"; else "$@"; fi
}

run_remote() {
    local url=$1 script
    shift
    if $DRY_RUN; then
        info "would run the installer from $url $*"
        return 0
    fi
    script=$(curl -fsSL "$url") || return 1
    /bin/bash -c "$script" "$url" "$@"
}

load_brew_env() {
    local brew
    for brew in /opt/homebrew/bin/brew /usr/local/bin/brew; do
        if [[ -x $brew ]]; then
            eval "$("$brew" shellenv)"
            return 0
        fi
    done
    return 1
}

describe() {
    case $1 in
        xcode) echo "Xcode Command Line Tools" ;;
        homebrew) echo "Homebrew" ;;
        brew) echo "CLI tools, fonts and terminals (Brewfile)" ;;
        links) echo "Dotfile symlinks" ;;
        shell) echo "oh-my-zsh and tmux plugins" ;;
        runtimes) echo "Node, Rust, Python and Flutter" ;;
        ai) echo "AI coding tools and their configs" ;;
        apps) echo "GUI and App Store apps (Brewfile.apps)" ;;
    esac
}

step_xcode() {
    if xcode-select -p >/dev/null 2>&1; then
        info "Command Line Tools already installed"
        return 0
    fi
    run xcode-select --install
    if ! $DRY_RUN; then
        info "Finish the Command Line Tools installer window; waiting for it"
        until xcode-select -p >/dev/null 2>&1; do sleep 5; done
    fi
}

step_homebrew() {
    local prefix=/usr/local
    if [[ $(uname -m) == arm64 ]]; then prefix=/opt/homebrew; fi
    if [[ -x $prefix/bin/brew ]]; then
        info "Homebrew already installed"
    else
        run_remote https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh
    fi
    # Login shells get brew on PATH from .zprofile; .zshrc relies on it.
    if grep -qs 'brew shellenv' "$HOME/.zprofile"; then
        info "Homebrew already loaded by ~/.zprofile"
    elif $DRY_RUN; then
        info "would add Homebrew's shellenv to ~/.zprofile"
    else
        # shellcheck disable=SC2016 # the $(...) is meant for .zprofile, not here
        printf '\n# Homebrew\neval "$(%s/bin/brew shellenv)"\n' "$prefix" >>"$HOME/.zprofile"
        info "added Homebrew's shellenv to ~/.zprofile"
    fi
}

# Installs a Brewfile without upgrading what is already installed. In dry-run
# mode it lists what is missing instead.
bundle() {
    if ! have brew; then
        warn "Homebrew is missing; run the homebrew step first"
        return 1
    fi
    if $DRY_RUN; then
        info "missing from ${1##*/}:"
        HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_BUNDLE_NO_UPGRADE=1 brew bundle check --file="$1" --verbose 2>&1 |
            grep -v '^The Brewfile' | sed 's/^/      /' || true
        return 0
    fi
    HOMEBREW_BUNDLE_NO_UPGRADE=1 brew bundle install --file="$1"
}

step_brew() {
    bundle "$DOTFILES/Brewfile"
}

BACKUP_DIR=""
KEPT=0

# Links ~/<target> to the repo's <source>, backing up whatever was there.
link() {
    local src=$DOTFILES/$1 dst=$HOME/$2 parent
    if [[ ! -e $src ]]; then
        info "skipped ~/$2 ($1 is not in the repo)"
        return 0
    fi
    if [[ $src -ef $dst ]]; then
        KEPT=$((KEPT + 1))
        return 0
    fi
    if $DRY_RUN; then
        if [[ -e $dst || -L $dst ]]; then
            info "would back up ~/$2 and link it to $1"
        else
            info "would link ~/$2 to $1"
        fi
        return 0
    fi
    parent=$(dirname "$dst")
    mkdir -p "$parent"
    if [[ -e $dst || -L $dst ]]; then
        if [[ -z $BACKUP_DIR ]]; then
            BACKUP_DIR=$HOME/.local/state/dotfiles/backups/$(date +%Y-%m-%dT%H-%M-%S)
        fi
        mkdir -p "$(dirname "$BACKUP_DIR/$2")"
        mv "$dst" "$BACKUP_DIR/$2"
        info "backed up ~/$2 to $BACKUP_DIR/$2"
    fi
    ln -s "$(python3 -c 'import os, sys; print(os.path.relpath(sys.argv[1], os.path.realpath(sys.argv[2])))' "$src" "$parent")" "$dst"
    info "linked ~/$2"
}

step_links() {
    # Fetch the nvim config on a fresh clone only. An initialised submodule is
    # left alone so whatever branch it has checked out is never reset.
    if git -C "$DOTFILES" submodule status .config/nvim | grep -q '^-'; then
        run git -C "$DOTFILES" submodule update --init --recursive .config/nvim
    fi
    local entry script name
    for entry in $LINKS; do
        link "${entry%%:*}" "${entry#*:}"
    done
    for script in "$DOTFILES"/.local/bin/*; do
        name=${script##*/}
        case $name in
            pbcopy | pbpaste) continue ;; # OSC 52 clipboard shims for headless servers
        esac
        if [[ -x $script ]]; then link ".local/bin/$name" ".local/bin/$name"; fi
    done
    info "$KEPT links already in place"
}

step_shell() {
    if [[ -d $HOME/.oh-my-zsh ]]; then
        info "oh-my-zsh already installed"
    else
        # --keep-zshrc leaves the linked .zshrc alone.
        run_remote https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh --unattended --keep-zshrc
    fi
    local tpm=$HOME/.tmux/plugins/tpm
    if [[ -d $tpm ]]; then
        info "tpm already installed"
    else
        run git clone --depth 1 https://github.com/tmux-plugins/tpm "$tpm"
    fi
    # Installs the .tmux.conf plugins that are not there yet.
    run "$tpm/bin/install_plugins"
}

install_node() {
    if [[ -s $NVM_DIR/nvm.sh ]]; then
        info "nvm already installed"
    else
        run git clone --quiet https://github.com/nvm-sh/nvm.git "$NVM_DIR"
        if $DRY_RUN; then
            info "would install Node $NODE_VERSION as the nvm default, plus npm globals: $NPM_GLOBALS"
            return 0
        fi
        git -C "$NVM_DIR" checkout --quiet "$(git -C "$NVM_DIR" describe --abbrev=0 --tags --match 'v[0-9]*' "$(git -C "$NVM_DIR" rev-list --tags --max-count=1)")"
    fi
    # nvm does not work under set -eu, so it gets a subshell of its own.
    (
        set +eu
        # shellcheck source=/dev/null
        . "$NVM_DIR/nvm.sh"
        if nvm which "$NODE_VERSION" >/dev/null 2>&1; then
            info "Node $NODE_VERSION already installed"
        else
            run nvm install "$NODE_VERSION" || exit 1
        fi
        if [[ $(nvm version default) != "$(nvm version "$NODE_VERSION")" ]]; then
            run nvm alias default "$NODE_VERSION" || exit 1
        fi
        nvm use --silent "$NODE_VERSION" >/dev/null 2>&1 || exit 0 # dry run before Node exists
        for pkg in $NPM_GLOBALS; do
            if npm ls -g --depth=0 "$pkg" >/dev/null 2>&1; then
                info "npm $pkg already installed"
            else
                run npm install -g "$pkg" || exit 1
            fi
        done
    )
}

install_rust() {
    if [[ -x $HOME/.cargo/bin/rustup ]]; then
        info "Rust already installed"
    else
        run_remote https://sh.rustup.rs -y --no-modify-path
    fi
    if [[ -x $HOME/.cargo/bin/cargo-xwin ]]; then
        info "cargo-xwin already installed"
    else
        run "$HOME/.cargo/bin/cargo" install --locked cargo-xwin
    fi
}

install_python() {
    local current
    current=$(pyenv global 2>/dev/null || true)
    if [[ -n $current && $current != system ]]; then
        info "pyenv global Python already set ($current)"
    elif $DRY_RUN; then
        info "would install the latest Python $PYTHON_VERSION with pyenv and make it the global default"
    else
        pyenv install --skip-existing "$PYTHON_VERSION"
        pyenv global "$(pyenv latest "$PYTHON_VERSION")"
    fi
    if have poetry; then
        info "poetry already installed"
    else
        run uv tool install poetry
    fi
    # .zshrc adds ~/.zfunc to fpath for these completions.
    if [[ -f $HOME/.zfunc/_poetry ]]; then
        info "poetry completions already installed"
    elif $DRY_RUN; then
        info "would write poetry's zsh completions to ~/.zfunc/_poetry"
    else
        mkdir -p "$HOME/.zfunc"
        poetry completions zsh >"$HOME/.zfunc/_poetry"
    fi
}

install_flutter() {
    if [[ -e $HOME/fvm/default ]]; then
        info "Flutter already installed (fvm global)"
    else
        run fvm install stable
        run fvm global stable
    fi
}

step_runtimes() {
    install_node
    install_rust
    install_python
    install_flutter
}

step_ai() {
    if have omo; then info "omo already installed"; else run bun add -g omo-ai; fi
    if have claude; then
        info "Claude Code already installed"
    else
        run_remote https://claude.ai/install.sh
    fi
    if have codex; then info "Codex already installed"; else run brew install --cask codex; fi
    # link-ai-configs.sh needs Node from the runtimes step.
    local args=""
    if $DRY_RUN; then args=--dry-run; fi
    (
        set +eu
        # shellcheck source=/dev/null
        . "$NVM_DIR/nvm.sh"
        bash "$DOTFILES/link-ai-configs.sh" $args
    )
}

# Prints the casks in a Brewfile whose app is already installed, but not by
# Homebrew. Installing those fails with "It seems there is already an App".
unmanaged_casks() {
    local cask casks="" managed json name kind id
    if ! have jq; then
        warn "jq is missing, so apps installed outside Homebrew cannot be detected"
        return 0
    fi
    managed=$(brew list --cask)
    while read -r cask; do
        if ! grep -qx "${cask##*/}" <<<"$managed"; then casks="$casks $cask"; fi
    done < <(sed -nE 's/^cask "([^"]+)".*/\1/p' "$1")
    if [[ -z $casks ]]; then return 0; fi
    # Casks from taps that are not trusted yet cannot be looked up; on a fresh
    # Mac there is nothing to skip anyway.
    # shellcheck disable=SC2086 # one argument per cask
    if ! json=$(HOMEBREW_NO_AUTO_UPDATE=1 brew info --cask --json=v2 $casks 2>/dev/null); then
        warn "could not look up the casks, so none are skipped"
        return 0
    fi
    # Each cask yields the app names it installs (source and renamed target),
    # or, for pkg and installer casks, its display name plus its pkg receipts.
    jq -r '
        .casks[] | .token as $name |
        [.artifacts[] | select(has("app")) | .app | (.[0] | split("/") | last),
            (.[1]? | objects | .target // empty | split("/") | last)] as $apps |
        if ($apps | length) > 0 then $apps[] | "\($name)\tapp\t\(.)"
        else "\($name)\tapp\t\(.name[0]).app",
            (.artifacts[] | select(has("uninstall")) | .uninstall[] | .pkgutil? // empty
                | (if type == "array" then .[] else . end) | "\($name)\tpkg\t\(.)")
        end' <<<"$json" |
        while IFS=$'\t' read -r name kind id; do
            if [[ $kind == app && (-e /Applications/$id || -e $HOME/Applications/$id) ]] ||
                { [[ $kind == pkg && -n $(pkgutil --pkgs="$id" 2>/dev/null) ]]; }; then
                echo "$name"
            fi
        done | sort -u | tr '\n' ' '
}

step_apps() {
    local skip
    if ! have brew; then
        warn "Homebrew is missing; run the homebrew step first"
        return 1
    fi
    skip=$(unmanaged_casks "$DOTFILES/Brewfile.apps")
    skip=${skip% }
    if [[ -n $skip ]]; then
        info "skipping casks for apps installed outside Homebrew: $skip"
    fi
    HOMEBREW_BUNDLE_CASK_SKIP=$skip bundle "$DOTFILES/Brewfile.apps"
}

usage() {
    sed -n '2,/^$/s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"
}

main() {
    local arg step status selected="" failed=""
    for arg in "$@"; do
        case $arg in
            -n | --dry-run) DRY_RUN=true ;;
            -h | --help)
                usage
                return 0
                ;;
            -*)
                warn "unknown option: $arg"
                usage
                return 2
                ;;
            *)
                if [[ " $STEPS " != *" $arg "* ]]; then
                    warn "unknown step: $arg (steps: $STEPS)"
                    return 2
                fi
                selected="$selected $arg"
                ;;
        esac
    done
    if [[ $(uname -s) != Darwin ]]; then
        warn "setup-mac.sh only runs on macOS"
        return 1
    fi
    if [[ -z $selected ]]; then selected=$STEPS; fi

    # Tools from non-Homebrew installers live here; the steps look for them.
    export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
    load_brew_env || true
    if $DRY_RUN; then say "Dry run: nothing will be changed"; fi

    for step in $selected; do
        say "$step: $(describe "$step")"
        # Each step runs in a subshell with errexit so it stops at its first
        # failure. Testing the subshell directly would switch errexit off.
        (
            set -e
            "step_$step"
        )
        status=$?
        if [[ $status -ne 0 ]]; then
            failed="$failed $step"
            warn "$step failed; fix the error above, then rerun ./setup-mac.sh $step"
        fi
        load_brew_env || true
    done

    say "Done"
    if [[ -n $failed ]]; then warn "failed steps:$failed"; fi
    if ! $DRY_RUN && [[ $selected == "$STEPS" ]]; then
        info "Steps that need you:"
        info "- Sign in to the App Store, then rerun ./setup-mac.sh apps for the App Store apps"
        info "- 1Password: turn on the SSH agent (Settings > Developer); .zshrc uses it for SSH"
        info "- Sign in: gh auth login, then omo, Claude Code and Codex"
        info "- Open a new terminal to load the new shell setup"
    fi
    [[ -z $failed ]]
}

main "$@"
