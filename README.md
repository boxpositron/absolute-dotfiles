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
- **AI Integration**: OpenCode CLI with specialized agents for debugging, testing, refactoring, and more
- **Development Tools**: Pre-configured settings for Git, tmux, direnv, and various language servers
- **Documentation Management**: with-context MCP integration for knowledge management

## Prerequisites

Before installing these dotfiles, ensure you have the following:

- **Operating System**: macOS (Darwin platform)
- **Package Manager**: [Homebrew](https://brew.sh/) installed
- **Shell**: Zsh (default on modern macOS)
- **Git**: Version control system
- **Node.js**: Required for many Neovim plugins and LSP servers
- **Python**: Required for certain development tools and Neovim plugins
- **Rust**: (Optional) Required for some tools like ripgrep, fd, etc.

## Installation

### Quick Start

**Warning**: These dotfiles are personalized configurations. Review the code and understand what each configuration does before applying them to your system. Fork this repository first and modify according to your needs.

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/dotfiles.git ~/dotfiles
   cd ~/dotfiles
   ```

2. **Run the setup script**:
   ```bash
   ./setup-mac.sh
   ```

3. **Create symbolic links** (if not handled by setup script):
   ```bash
   ln -s ~/dotfiles/.config ~/.config
   ln -s ~/dotfiles/.zshrc ~/.zshrc
   ln -s ~/dotfiles/.tmux.conf ~/.tmux.conf
   ```

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
- Performance-focused configuration

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

### Development Tools

- **tmux** (`.tmux.conf`): Terminal multiplexer with custom key bindings
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
- **terminal-bell**: Terminal notification system
- **websearch**: Web search integration
- **with-context**: Documentation management with Obsidian vault

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

Ensure this directory is in your PATH:

```bash
export PATH="$HOME/dotfiles/.local/bin:$PATH"
```

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
curl -fsSL https://raw.githubusercontent.com/boxpositron/dotfiles/main/.tmux-server.conf -o ~/.tmux.conf

# Or using wget
wget -qO ~/.tmux.conf https://raw.githubusercontent.com/boxpositron/dotfiles/main/.tmux-server.conf
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
**AI Tools**: OpenCode, Claude