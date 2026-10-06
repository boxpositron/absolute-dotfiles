# Dotfiles

A comprehensive collection of configuration files for macOS development environment, featuring Neovim, terminal emulators, shell configurations, and AI-powered development tools.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Components](#components)
- [Configuration](#configuration)
- [Customization](#customization)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Overview

This repository contains personal dotfiles for configuring a complete development environment on macOS. These configurations emphasize productivity, aesthetics, and developer experience with carefully curated settings for various tools and applications.

## Features

- **Neovim Configuration**: Extensive Lua-based configuration with LSP support, debugging, and 50+ productivity plugins
- **Terminal Emulators**: Configurations for Ghostty and WezTerm with custom themes and visual effects
- **Shell Environment**: Optimized Zsh configuration with Starship prompt and useful aliases
- **AI Integration**: OpenCode, OmO and Claude Code configuration, shared agent preferences, and `owt` workspaces that give each agent task its own git worktree
- **Development Tools**: Pre-configured settings for Git, tmux, direnv, and various language servers
- **Documentation Management**: with-context MCP integration for knowledge management

## Prerequisites

Before installing these dotfiles, ensure you have the following:

- **Operating System**: macOS (Apple Silicon or Intel)
- **Git**: To clone this repository. macOS offers to install it with the Command Line Tools the first time you run `git`

`setup-mac.sh` installs everything else: the Command Line Tools, Homebrew, Node.js, Python, Rust and the rest.

## Installation

### Quick Start

**Warning**: These dotfiles are personalized configurations. Review the code and understand what each configuration does before applying them to your system. Fork this repository first and modify according to your needs.

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/dotfiles.git ~/dotfiles
   cd ~/dotfiles
   ```

2. **Preview, then run the setup script**:
   ```bash
   ./setup-mac.sh --dry-run
   ./setup-mac.sh
   ```

The script is safe to rerun: each step checks what is already in place and only does the missing work. A failed step is reported at the end while the other steps still run. Name steps to run only those, for example `./setup-mac.sh links` after adding a config.

| Step | What it does |
|------|--------------|
| `xcode` | Installs the Xcode Command Line Tools |
| `homebrew` | Installs Homebrew and loads it from `~/.zprofile` |
| `brew` | Installs the CLI tools, fonts and terminals in `Brewfile` |
| `links` | Fetches the Neovim submodule on a fresh clone and symlinks the configs and `.local/bin` scripts into `$HOME`, backing up anything it replaces to `~/.local/state/dotfiles/backups/` |
| `shell` | Installs oh-my-zsh and the tmux plugins |
| `runtimes` | Node with nvm and the global npm packages, Rust, Python with pyenv, poetry, and Flutter with fvm |
| `ai` | Installs omo, Claude Code, OpenCode and Codex, then runs `link-ai-configs.sh` |
| `apps` | Installs the GUI and App Store apps in `Brewfile.apps` |

`brew` and `apps` never upgrade packages that are already installed. `apps` skips apps already in `/Applications` that Homebrew did not install, and its App Store entries need you signed in to the App Store first. To list what is installed but missing from `Brewfile`, run `brew bundle dump --file=- | diff Brewfile -`.

A few things still need you afterwards, such as signing in to the App Store and the AI tools, and turning on the 1Password SSH agent. The script lists them when it finishes.

### Manual Installation

For more control over the installation process, you can manually symlink specific configurations:

```bash
# Neovim
ln -s ~/dotfiles/.config/nvim ~/.config/nvim

# Terminal configurations
ln -s ~/dotfiles/.config/ghostty ~/.config/ghostty
ln -s ~/dotfiles/.config/wezterm ~/.config/wezterm

# Shell configurations
ln -s ~/dotfiles/.zshrc ~/.zshrc
```

### AI configuration restore

The `ai` step of `setup-mac.sh` runs this script. To run it on its own after installing Node.js, OpenCode, Claude Code, and OMC:

```bash
bash ~/dotfiles/link-ai-configs.sh --dry-run
bash ~/dotfiles/link-ai-configs.sh
```

The script creates individual relative symlinks, skips existing correct links, and backs up replaced files or links under `~/.local/state/dotfiles-ai/backups/`. It does not replace whole configuration directories. To undo a replacement, remove that individual symlink and move its corresponding backup back to the original path.

- `.config/omo/omo.jsonc` supplies `~/.omo/omo.jsonc`. Model routing is preserved; the OpenCode overlay excludes only the OMC Claude plugin through `claude_code.plugins_override`.
- `.config/ai/AGENTS.md` holds shared personal preferences. OpenCode loads it through `~/.config/opencode/AGENTS.md` instead of falling back to Claude's global orchestration instructions. Claude imports it from its own `CLAUDE.md`.
- `.config/claude/` supplies Claude's global instructions, settings, and OMC preferences. The machine-specific OMC `nodeBinary` cache is intentionally omitted; install Node.js and run OMC setup on each new machine to configure its runtime and HUD.
- OpenCode's main configuration, TUI registration, and existing command/MCP isolation plugins are linked individually. Other portable Claude plugins and user skills remain enabled.

Credentials, `settings.local.json`, plugin installations, unrelated user skills, histories, caches, and runtime state are not copied into this repository or managed by this script. The selected Impeccable, Vercel web-design-guidelines and frontend-workflow skills are managed individually; see [the GPT visual workflow](.config/opencode/README.md) for provenance, verification and rollback. Install other desired plugins and portable skills separately. OpenCode's local MCP servers are referenced through `{env:HOME}`, so the paths are portable, but the servers themselves (headroom, agcanvas, uvx, ast-grep-mcp, portfolio-mcp) must be installed at those locations on a new machine.

The OmO hooks and slash commands (`~/.omo/agent/hooks.json` and `~/.omo/agent/prompts`) and the workspace scripts in `~/.local/bin` are linked by the `links` step of `setup-mac.sh` instead.

Restart OpenCode and Claude Code after applying changes. On first use, Claude may ask to approve the shared preferences import. Updates can rewrite generated configuration or replace symlinks: review the live files and repository diff before rerunning the link script, which backs up divergent live files rather than merging them. No plugin versions or model choices are changed by this restore step.

## Components

### Neovim Configuration (`.config/nvim/`)

- **Core Configuration**: Modular Lua-based setup with lazy loading
- **LSP Support**: Pre-configured language servers via Mason
- **Plugin Management**: Lazy.nvim for efficient plugin loading
- **Key Mappings**: Intuitive and efficient keyboard shortcuts
- **Themes**: Multiple colorschemes including Catppuccin, Tokyo Night, and Rose Pine

Key features:
- AI-powered coding assistance (Claude, OpenCode)
- Advanced Git integration
- Flutter and mobile development support
- Python environment management
- Integrated debugging (DAP)
- File tree navigation
- Fuzzy finding with Telescope
- Terminal integration

### Terminal Emulators

#### Ghostty (`.config/ghostty/`)
- Custom shaders for visual effects (CRT, bloom, glow)
- Optimized colorscheme
- Native titlebar; SSH sessions forward the environment and terminfo
- Does not auto-attach tmux; start or attach sessions yourself

#### WezTerm (`.config/wezterm/`)
- Lua-based configuration
- Custom key bindings
- Multiplexer features

### Shell Configuration (`.zshrc`)

- Optimized PATH management for development tools
- Custom aliases and functions for productivity
- Integration with direnv, asdf, and other version managers
- Environment variable management with `.env` and `.envrc`
- Starship prompt with custom configuration
- Auto-completion and syntax highlighting
- 1Password as the SSH agent, an `sshm` wrapper with completion, and `fs [session]` to reach the remote dev box over mosh into a named tmux session
- Resets mouse-reporting modes at each prompt, so an unclean SSH or tmux disconnect cannot leave the terminal spewing escape codes

### Development Tools

- **tmux** (`.tmux.conf`): Terminal multiplexer with custom key bindings; sets the terminal title to the session name
- **Zed** (`.config/zed/keymap.json`): Editor key bindings. Settings stay local because they reference machine-specific agent paths
- **tmux server** (`.tmux-server.conf`): Lightweight tmux config for remote servers
- **Git**: Global gitignore patterns (`.rgignore`, `.gitignore`)
- **Starship** (`starship.toml`): Cross-shell prompt with Git integration
- **Oh My Posh** (`.config/ohmyposh/`): Alternative prompt theme (zen.toml)
- **Zellij** (`.config/zellij/`): Modern terminal workspace (config.kdl)
- **direnv** (`.config/direnv/`): Environment variable management per directory
- **OpenCommit** (`.opencommit`): AI-powered commit message generation

### AI and Coding Assistants

#### OpenCode (`.config/opencode/`)

Specialized AI agents for different development workflows:

- **debug**: Debugging assistance and troubleshooting
- **docs**: Documentation generation and maintenance
- **qa**: Quality assurance and code analysis
- **refactor**: Code refactoring patterns and best practices
- **review**: Code review guidelines and automation
- **security**: Security audits and vulnerability scanning
- **setup**: Project initialization and setup workflows
- **test**: Test generation and execution
- **webgen**: Web page generation from ideas

Custom commands:
- `/setup-mcp`: MCP server configuration
- Additional commands in `.config/opencode/command/`

Plugins:
- **oh-my-openagent**, **opencode-antigravity-auth** and **envsitter-guard** from npm
- **strip-claude-only-commands** and **strip-omc-mcp** (`.config/opencode/plugin/`): keep Claude-only commands and OMC's MCP servers out of OpenCode

MCP servers: Playwright, Chrome DevTools, Linear, reoclo, time, ast-grep, headroom, agcanvas and portfolio.

#### OmO (`.config/omo/`)

- `omo.jsonc` (linked as `~/.omo/omo.jsonc`): agent and category model routing for OpenCode and the native harness.
- `hooks.json` (linked as `~/.omo/agent/hooks.json`): runs `omo-notify` for a macOS notification when a session stops or needs attention.
- `prompts/` (linked as `~/.omo/agent/prompts`): slash commands for `owt` workspaces.
  - `/linear-sync [notes]` posts a progress comment on the workspace's Linear issues and sets them to In Progress, or In Review once a PR is open.
  - `/owt-done [notes]` finishes a workspace after its PR merges: it comments on each issue and moves it to Done, then runs `owt done --detach`. It asks before discarding uncommitted or unmerged work.

#### Agent workspaces (`owt`)

`owt` gives each agent task its own git worktree, in the style of Conductor. Run it from anywhere inside a repository:

```bash
owt new                 # random city name, e.g. ~/worktrees/<repo>/lagos on branch feature/lagos
owt new PRA-107 PRA-108 # same, and tell the agent which Linear issues to start on
owt ls                  # workspaces and their current branches
owt all                 # workspaces of every repo, with branches and source checkouts (from anywhere)
owt cd                  # jump into a workspace with fzf; owt cd lagos goes straight there
owt open lagos          # reopen the agent in a workspace
owt done                # remove the workspace you are in once its work is merged
```

`owt new` starts from the latest `origin` default branch, copies local `.env` files, installs dependencies, and opens a tmux window running omo with the workspace conventions: rename the placeholder branch to `feature/<keys>-<slug>` before pushing, and keep the Linear issues' statuses in sync. Workspaces share the main checkout's omo memory through a link under `~/.omo/memory/agents/`.

`owt cd` works from any directory. Inside a repository the picker starts filtered to that repo's workspaces and jumps straight in when only one matches. The `owt` function in `.zshrc` performs the `cd`; without it, `owt cd` only prints the path.

`owt done` refuses to discard work unless you pass `--force`. Work counts as merged when the branch is part of the default branch or its Gitea PR is merged (checked with `tea`). It then deletes the remote and local branch, removes the worktree and its memory link, and closes tmux windows open in it. `OWT_ROOT` (default `~/worktrees`) and `OWT_AGENT` (default `omo`) override the defaults; `owt --help` lists every option.

#### Neovim AI Integration

- **CodeCompanion**: AI pair programming with multiple providers
- **Gen.nvim**: Local LLM integration
- **LLM.nvim**: Additional LLM capabilities

## Configuration

### Environment Variables

The setup uses `.env` and `.envrc` files for environment-specific configurations. Copy the example files and modify as needed:

```bash
cp .env.example .env
cp .envrc.example .envrc
```

### Local Binaries

Custom scripts and binaries are stored in `.local/bin/`:

- `brave-debug`: Launch Brave browser in debug mode
- `cl`: Claude CLI wrapper
- `claude-tmux`: Claude integration with tmux
- `cldir`: Change directory with Claude context
- `owt`: Git worktree workspaces for coding agents (see [Agent workspaces](#agent-workspaces-owt))
- `omo-notify`: macOS notification for OmO's Stop and Notification hooks
- `docker-nuke`: Force-restart a wedged Docker Desktop, capturing diagnostics to `~/.local/state/docker-nuke/` first (`--dry-run` to preview, `--no-restart` to leave it down, `--deep` for root helpers)

The `links` step of `setup-mac.sh` links each script into `~/.local/bin`, which `.zshrc` puts on your PATH. `pbcopy` and `pbpaste` are OSC 52 clipboard shims for headless servers, so they are not linked on macOS.

### Local Servers

Docker Compose configuration for local development services in `local_servers/`.

## Customization

### Adding Custom Configurations

1. **Neovim Plugins**: Add new plugins in `.config/nvim/lua/absolute/plugins/`
   - Configure in `.config/nvim/lua/absolute/after/`
2. **Shell Aliases**: Modify `.zshrc` to add custom aliases and functions
3. **Git Configuration**: Update `.gitignore` or `.rgignore` for global ignore patterns
4. **OpenCode Agents**: Create custom agents in `.config/opencode/agent/`
5. **OpenCode Commands**: Add custom commands in `.config/opencode/command/`

### Theme Customization

Current theme configuration is managed in `.config/nvim/lua/current-theme.lua`. Available themes:

- Catppuccin
- Tokyo Night
- Rose Pine
- Nightfly

Terminal themes are configured in:
- Ghostty: `.config/ghostty/colorscheme`
- WezTerm: `.config/wezterm/wezterm.lua`

## Documentation

This repository uses the with-context MCP server for documentation management. See `AGENTS.md` for detailed guidelines on:

- Documentation delegation patterns
- Local vs. vault documentation
- OpenCode agent workflows
- Best practices for AI agents

Key documentation files:

- `AGENTS.md`: AI agent guidelines and with-context MCP usage
- `.withcontextignore`: Patterns for documentation delegation
- Component READMEs: Tool-specific documentation in respective directories

## Server Configuration

A lightweight tmux configuration (`.tmux-server.conf`) is available for remote servers. It's plugin-free and optimized for server environments.

### Key Differences from Desktop Config

| Feature | Desktop | Server |
|---------|---------|--------|
| Status bar | Top | Bottom |
| Prefix key | `Ctrl+b` | `Ctrl+/` |
| Plugins | Full (TPM, catppuccin, etc.) | None |
| Theme | Catppuccin | Simple minimal |

### Quick Setup on Remote Server

**One-liner download and setup:**

```bash
# Using curl
curl -fsSL https://raw.githubusercontent.com/boxpositron/absolute-dotfiles/main/.tmux-server.conf -o ~/.tmux.conf

# Or using wget
wget -qO ~/.tmux.conf https://raw.githubusercontent.com/boxpositron/absolute-dotfiles/main/.tmux-server.conf
```

**If tmux is already running**, reload the config:

```bash
tmux source-file ~/.tmux.conf
```

### Server Config Key Bindings

| Binding | Action |
|---------|--------|
| `Ctrl+/` | Prefix key |
| `Prefix + \|` | Vertical split |
| `Prefix + -` | Horizontal split |
| `Prefix + hjkl` | Resize panes |
| `Ctrl + hjkl` | Navigate panes (vim-aware) |
| `Prefix + m` | Toggle pane zoom |
| `Prefix + r` | Reload config |

## Troubleshooting

### Common Issues

1. **Neovim plugins not loading**:
   ```bash
   nvim --headless "+Lazy! sync" +qa
   ```

2. **LSP servers not working**:
   ```bash
   nvim
   :Mason
   ```

3. **Shell configuration not loading**:
   ```bash
   source ~/.zshrc
   ```

### Debug Mode

For debugging Neovim configuration issues:
```bash
nvim -V10nvim.log
```

## Contributing

These are personal dotfiles, but contributions are welcome! If you have improvements or bug fixes:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/improvement`)
3. Commit your changes (use OpenCommit: `.opencommit` configuration available)
4. Push to the branch (`git push origin feature/improvement`)
5. Open a Pull Request

**Note**: Review the code before applying these configurations. These are personalized settings that may need adjustment for your setup.

## License

This project is open source and available under the MIT License. See individual tool configurations for their respective licenses.

## Acknowledgments

- [Absolute VIM](https://github.com/boxpositron/absolute-vim) - Neovim configuration foundation
- The open-source community for the amazing tools and plugins
- OpenCode team for AI-powered development workflows
- Contributors and users who provide feedback and improvements

## Resources

- **OpenCode Documentation**: https://opencode.ai/docs
- **Neovim Plugin Ecosystem**: https://github.com/rockerBOO/awesome-neovim
- **Dotfiles Community**: https://dotfiles.github.io

## Support

For questions, issues, or suggestions, please open an issue on the GitHub repository.

---

**Last Updated**: 2025  
**Platform**: macOS (Darwin)  
**Primary Editor**: Neovim  
**Shell**: Zsh  
**AI Tools**: OpenCode, OmO, Claude Code
