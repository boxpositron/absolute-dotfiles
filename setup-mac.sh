#!/bin/bash


echo "Setting up your Mac..."
# Check if Homebrew is installed
if command -v brew &> /dev/null; then
    echo "Homebrew is installed."
else
    echo "Homebrew is not installed."
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
# Check if Git is installed

if command -v git &> /dev/null; then
    echo "Git is installed."
else
    echo "Git is not installed."
    echo "Installing Git..."
    brew install git
fi

# Check if coreutils is installed

if command -v gdate &> /dev/null; then
    echo "coreutils is installed."
else
    echo "coreutils is not installed."
    echo "Installing coreutils..."
    brew install coreutils
fi

# Check if OhMyPosh is installed

if command -v oh-my-posh &> /dev/null; then
    echo "OhMyPosh is installed."
else
    echo "OhMyPosh is not installed."
    echo "Installing OhMyPosh..."
    brew install jandedobbeleer/oh-my-posh/oh-my-posh
fi

# Check if asdf is installed
if command -v asdf &> /dev/null; then
    echo "asdf is installed."
else
    echo "asdf is not installed."
    echo "Installing asdf..."
    brew install asdf

    echo "Adding asdf plugins..."
    asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git
fi

# Check if NodeJS is installed
if command -v node &> /dev/null; then
    echo "NodeJS is installed."
else
    echo "NodeJS is not installed."
    echo "Installing NodeJS..."
    brew install node
fi

# Check if Neovim is installed

if command -v nvim &> /dev/null; then
    echo "Neovim is installed."
else
    echo "Neovim is not installed."
    echo "Installing Neovim..."
    brew install neovim
fi

# Check if WezTerm is installed


if command -v wezterm &> /dev/null; then
    echo "WezTerm is installed."
else
    echo "WezTerm is not installed."
    echo "Installing WezTerm..."
    brew install wezterm
fi


# Ensure fira font is installed

brew install font-fira-code-nerd-font

# Check if Zsh is installed

if command -v zsh &> /dev/null; then
    echo "Zsh is installed."
else
    echo "Zsh is not installed."
    echo "Installing Zsh..."
    brew install zsh

    echo "Setting Zsh as default shell..."
    sudo sh -c "echo $(which zsh) >> /etc/shells"
fi

# Check if Generic Colorizer is installed

if command -v grc &> /dev/null; then
    echo "Generic Colorizer is installed."
else
    echo "Generic Colorizer is not installed."
    echo "Installing Generic Colorizer..."
    brew install grc
fi

# Check if bat is installed

if command -v bat &> /dev/null; then
    echo "bat is installed."
else
    echo "bat is not installed."
    echo "Installing bat..."
    brew install bat
fi

# Check if eza is installed

if command -v eza &> /dev/null; then
    echo "eza is installed."
else
    echo "eza is not installed."
    echo "Installing eza..."
    brew install eza
fi

# Install global pnpm package
if command -v pnpm &> /dev/null; then
    echo "pnpm is installed."
else
    echo "pnpm is not installed."
    echo "Installing pnpm..."
    npm install -g pnpm
fi

# Check if fzf is installed

if command -v fzf &> /dev/null; then
    echo "fzf is installed."
else
    echo "fzf is not installed."
    echo "Installing fzf..."
    brew install fzf
fi

# Check if ripgrep is installed

if command -v rg &> /dev/null; then
    echo "ripgrep is installed."
else
    echo "ripgrep is not installed."
    echo "Installing ripgrep..."
    brew install ripgrep
fi

# Check if poetry is installed

if command -v poetry &> /dev/null; then
    echo "poetry is installed."
else
    echo "poetry is not installed."
    echo "Installing poetry..."
    curl -sSL https://install.python-poetry.org | python3 -
fi

# Install Flutter version manager

if command -v fvm &> /dev/null; then
    echo "fvm is installed."
else
    echo "fvm is not installed."
    echo "Installing fvm..."
    curl -fsSL https://fvm.app/install.sh | bash
fi


# Install SDK manager
# Check if $HOME/.sdkman exists

if [ -d "$HOME/.sdkman" ]; then
    echo "sdkman is installed."
else
    echo "sdkman is not installed."
    echo "Installing sdkman..."
    curl -s "https://get.sdkman.io" | bash
fi


# Install Aerospace

if command -v aerospace &> /dev/null; then
    echo "aerospace is installed."
else
    echo "aerospace is not installed."
    echo "Installing aerospace..."
    brew install --cask nikitabobko/tap/aerospace
fi
