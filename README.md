# Dotfiles

A comprehensive collection of configuration files for macOS development environment, featuring Neovim, terminal emulators, shell configurations, and development tools.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Components](#components)
- [Configuration](#configuration)
- [Customization](#customization)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Overview

This repository contains personal dotfiles for configuring a complete development environment on macOS. These configurations emphasize productivity, aesthetics, and developer experience with carefully curated settings for various tools and applications.

## Features

- **Neovim Configuration**: Extensive Lua-based configuration with LSP support, debugging, and productivity plugins
- **Terminal Emulators**: Configurations for Ghostty and WezTerm with custom themes and shaders
- **Shell Environment**: Optimized Zsh configuration with useful aliases and functions
- **Window Management**: AeroSpace tiling window manager configuration
- **Development Tools**: Pre-configured settings for Git, tmux, and various language servers
- **AI Integration**: Built-in configurations for Claude and other AI coding assistants

## Prerequisites

Before installing these dotfiles, ensure you have the following:

- **Operating System**: macOS (Darwin platform)
- **Package Manager**: [Homebrew](https://brew.sh/) installed
- **Shell**: Zsh (default on modern macOS)
- **Git**: Version control system
- **Node.js**: Required for many Neovim plugins
- **Python**: Required for certain development tools

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
   ln -s ~/dotfiles/.aerospace.toml ~/.aerospace.toml
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
- AI-powered coding assistance (Claude, Copilot)
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

- Optimized PATH management
- Custom aliases and functions
- Integration with development tools
- Environment variable management
- Prompt customization with Starship

### Window Management (`.aerospace.toml`)

- Tiling window manager configuration
- Custom workspace layouts
- Application-specific rules
- Keyboard-driven workflow

### Development Tools

- **tmux** (`.tmux.conf`): Terminal multiplexer configuration
- **Git**: Global gitignore patterns
- **Starship** (`starship.toml`): Cross-shell prompt
- **Oh My Posh** (`.config/ohmyposh/`): Terminal prompt themes
- **Zellij** (`.config/zellij/`): Modern terminal workspace

### AI and Coding Assistants

- **OpenCode** (`.config/opencode/`): Agent configurations for various development tasks
- **Claude integration**: Built into Neovim configuration
- **Copilot support**: GitHub Copilot integration

## Configuration

### Environment Variables

The setup uses `.env` and `.envrc` files for environment-specific configurations. Copy the example files and modify as needed:

```bash
cp .env.example .env
cp .envrc.example .envrc
```

### Local Binaries

Custom scripts and binaries are stored in `.local/bin/`. Ensure this directory is in your PATH:

```bash
export PATH="$HOME/dotfiles/.local/bin:$PATH"
```

## Customization

### Adding Custom Configurations

1. **Neovim Plugins**: Add new plugins in `.config/nvim/lua/absolute/plugins/`
2. **Shell Aliases**: Modify `.zshrc` to add custom aliases
3. **Git Configuration**: Update `.gitignore` for global ignore patterns

### Theme Customization

Current theme configuration is managed in `.config/nvim/lua/current-theme.lua`. Modify this file to change the active colorscheme across Neovim.

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

Contributions are welcome! If you have improvements or bug fixes:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/improvement`)
3. Commit your changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/improvement`)
5. Open a Pull Request

## License

This project is open source and available under the MIT License. See individual tool configurations for their respective licenses.

## Acknowledgments

- [Absolute VIM](https://github.com/boxpositron/absolute-vim) - Previous Vim configuration
- The open-source community for the amazing tools and plugins
- Contributors and users who provide feedback and improvements

## Support

For questions, issues, or suggestions, please open an issue on the GitHub repository.