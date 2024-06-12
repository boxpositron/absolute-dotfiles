# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:/usr/local/bin:$PATH

# Enable 256 colors
# export TERM="xterm-256color"


# Path to your oh-my-zsh installation.
export ZSH="$HOME/.oh-my-zsh"

# Set name of the theme to load --- if set to "random", it will
# load a random theme each time oh-my-zsh is loaded, in which case,
# to know which specific one was loaded, run: echo $RANDOM_THEME
# See https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
# ZSH_THEME="robbyrussell"
# ZSH_THEME="powerlevel9k/powerlevel9k"
ZSH_THEME="agnoster"

# Set list of themes to pick from when loading at random
# Setting this variable when ZSH_THEME=random will cause zsh to load
# a theme from this variable instead of looking in ~/.oh-my-zsh/themes/
# If set to an empty array, this variable will have no effect.
# ZSH_THEME_RANDOM_CANDIDATES=( "robbyrussell" "agnoster" )

# Uncomment the following line to use hyphen-insensitive completion.
# Case-sensitive completion must be off. _ and - will be interchangeable.
# HYPHEN_INSENSITIVE="true"

# Uncomment the following line to disable bi-weekly auto-update checks.
# DISABLE_AUTO_UPDATE="true"

# Uncomment the following line to automatically update without prompting.
DISABLE_UPDATE_PROMPT="true"

# Uncomment the following line to change how often to auto-update (in days).
# export UPDATE_ZSH_DAYS=13

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS=true

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# You can set one of the optional three formats:
# "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# or set a custom format using the strftime function format specifications,
# see 'man strftime' for details.
# HIST_STAMPS="mm/dd/yyyy"

# Would you like to use another custom folder than $ZSH/custom?
# ZSH_CUSTOM=/path/to/new-custom-folder

# Which plugins would you like to load?
# Standard plugins can be found in ~/.oh-my-zsh/plugins/*
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(git asdf zsh-syntax-highlighting)

source $ZSH/oh-my-zsh.sh

# User configuration

# Setup oh-my-posh
if [ "$TERM_PROGRAM" != "Apple_Terminal" ]; then
  eval "$(oh-my-posh init zsh --config $HOME/.config/ohmyposh/zen.toml)"
fi

# export MANPATH="/usr/local/man:$MANPATH"

# You may need to manually set your language environment
# export LANG=en_US.UTF-8

# Preferred editor for local and remote sessions
if [[ -n $SSH_CONNECTION ]]; then
  export EDITOR='vim'
else
  export EDITOR='nvim'
fi

# Compilation flags
# export ARCHFLAGS="-arch x86_64"

# Set personal aliases, overriding those provided by oh-my-zsh libs,
# plugins, and themes. Aliases can be placed here, though oh-my-zsh
# users are encouraged to define aliases within the ZSH_CUSTOM folder.
# For a full list of active aliases, run `alias`.
#
# Example aliases
# alias zshconfig="mate ~/.zshrc"
# alias ohmyzsh="mate ~/.oh-my-zsh"
export PATH="/usr/local/opt/ncurses/bin:$PATH"

# Go Setup
export PATH="/usr/local/go/bin:$PATH"

# Flutter Setup

export PATH="$HOME/fvm/default/bin:$PATH"

# Act Setup

export PATH="$HOME/bin:$PATH"

###-tns-completion-start-###
if [ -f "$HOME/.tnsrc" ]; then
  source "$HOME/.tnsrc"
fi
###-tns-completion-end-###

# aliases for extra commands

alias nmap='grc nmap'

alias ls='eza -a --color=always --group-directories-first --icons'  #my preferred listing
alias la='eza -a --color=always --group-directories-first --icons'  # all files and dirs
alias ll='eza -l --color=always --group-directories-first --icons'  # long format
alias lt='eza -aT --color=always --group-directories-first --icons' # tree 
alias l.='eza -a --icons | egrep "^\."'

alias cat="bat --theme=\$(defaults read -globalDomain AppleInterfaceStyle &> /dev/null && echo ansi || echo base16)"

# alias vim to neovim
alias vim='nvim'


[[ -s "/etc/grc.zsh" ]] && source /etc/grc.zsh

# pnpm
export PNPM_HOME="$HOME/Library/pnpm"
export PATH="$PNPM_HOME:$PATH"
alias pn=pnpm
# pnpm end

# Initiate cargo
. "$HOME/.cargo/env"


# Curl Setup
export LDFLAGS="-L/opt/homebrew/opt/curl/lib"
export CPPFLAGS="-I/opt/homebrew/opt/curl/include"

export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools

if [ -d "$HOME/.local/bin" ] ; then
    PATH="$HOME/.local/bin:$PATH"
fi

# TMUX Setup Start

alias tml="tmux ls"

function tma() {
    tmux attach -t $1 | title "Workspace"
}

function tmn() {
    tmux new -s $1 -c $PWD | title "Workspace"
}

# Setup Flutter
export PATH="$HOME/.pub-cache/bin:$PATH"

# Setup FZF
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

export GEM_HOME=$HOME/.gem
export PATH=$GEM_HOME/bin:$PATH
export PATH=$HOME/flutter/bin:$PATH


PATH="$HOME/perl5/bin${PATH:+:${PATH}}"; export PATH;
PERL5LIB="$HOME/perl5/lib/perl5${PERL5LIB:+:${PERL5LIB}}"; export PERL5LIB;
PERL_LOCAL_LIB_ROOT="$HOME/perl5${PERL_LOCAL_LIB_ROOT:+:${PERL_LOCAL_LIB_ROOT}}"; export PERL_LOCAL_LIB_ROOT;
PERL_MB_OPT="--install_base \"$HOME/perl5\""; export PERL_MB_OPT;
PERL_MM_OPT="INSTALL_BASE=$HOME/perl5"; export PERL_MM_OPT;


## [Completion]
## Completion scripts setup. Remove the following line to uninstall
[[ -f /Users/davidibia/.dart-cli-completion/zsh-config.zsh ]] && . /Users/davidibia/.dart-cli-completion/zsh-config.zsh || true
## [/Completion]


#THIS MUST BE AT THE END OF THE FILE FOR SDKMAN TO WORK!!!
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]] && source "$HOME/.sdkman/bin/sdkman-init.sh"
