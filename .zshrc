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
plugins=(git asdf tmux)

source $ZSH/oh-my-zsh.sh

# User configuration

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
alias ping='grc ping'

# Check if eza is installed

if [ -x "$(command -v eza)" ]; then
    alias ls='eza -a --color=always --group-directories-first --icons'  #my preferred listing
    alias la='eza -a --color=always --group-directories-first --icons'  # all files and dirs
    alias ll='eza -l --color=always --group-directories-first --icons'  # long format
    alias lt='eza -aT --color=always --group-directories-first --icons' # tree 
    alias l.='eza -a --icons | egrep "^\."'
else
    echo "eza is not installed. Please install it to use the custom ls commands."
fi

# Check if bat is installed

if [ -x "$(command -v bat)" ]; then
    alias cat="bat --theme=\$(defaults read -globalDomain AppleInterfaceStyle &> /dev/null && echo ansi || echo base16)"
else
    echo "bat is not installed. Please install it to use the custom cat command."
fi

# alias vim to neovim
alias vim='nvim'


# [[ -s "/etc/grc.zsh" ]] && source /etc/grc.zsh

# pnpm
export PNPM_HOME="$HOME/Library/pnpm"
export PATH="$PNPM_HOME:$PATH"
alias pn=pnpm
# pnpm end

# Initiate cargo
if [ -d "$HOME/.cargo" ] ; then
    . "$HOME/.cargo/env"
fi


# Curl Setup
if [ -d "/opt/homebrew/opt/curl" ] ; then
    export LDFLAGS="-L/opt/homebrew/opt/curl/lib"
    export CPPFLAGS="-I/opt/homebrew/opt/curl/include"
fi


# Android setup
if [ -d "$HOME/Library/Android/sdk" ] ; then
    export ANDROID_HOME=$HOME/Library/Android/sdk
    export PATH=$PATH:$ANDROID_HOME/platform-tools
fi

if [ -d "$HOME/.local/bin" ] ; then
    PATH="$HOME/.local/bin:$PATH"
fi

# TMUX Setup Start

function tml() {
    sessions=$(tmux ls | sed -E 's/:.*$//')
    for session in $sessions; do
        echo $session
    done
}


function tma() {

    # If no argument is passed, show the list of tmux sessions with fzf
    
    if [ -z "$1" ]; then
        tmux attach -t $(tml | fzf)
        return
    fi

    # If an argument is passed, attach to the session with that name
    tmux attach -t $1 

}

function get_tmn_recommendation() {
    # Get the list of directories in the current directory
    list_of_directories_in_current_directory=$(ls -d */ | sed 's/\/$//')

    # Return the list of directories as newline-separated strings
    for dir in $list_of_directories_in_current_directory; do
        echo $dir
    done
}


function tmn() {

   
    # If no argument is passed, get the recommendations and show them with fzf

    if [ -z "$1" ]; then
        random_tag_name=$(date +%s)
        tmux new -s $(get_tmn_recommendation | fzf) | title $("Workspace - $random_tag_name")
        return
    fi

    tmux new -s $1 
}

_fzf_complete_tma() {
  _fzf_complete --multi --reverse --prompt="tma> " -- "$@" < <(tmux ls | sed -E 's/:.*$//')
}

_fzf_complete_tmn() {
  _fzf_complete --multi --reverse --prompt="tmn> " -- "$@" < <( get_tmn_recommendation )
}

# Setup Flutter


export PATH="$HOME/.pub-cache/bin:$PATH"

export GEM_HOME=$HOME/.gem
export PATH=$GEM_HOME/bin:$PATH
export PATH=$HOME/flutter/bin:$PATH

export XDG_CONFIG_HOME="$HOME/.config"


PATH="$HOME/perl5/bin${PATH:+:${PATH}}"; export PATH;
PERL5LIB="$HOME/perl5/lib/perl5${PERL5LIB:+:${PERL5LIB}}"; export PERL5LIB;
PERL_LOCAL_LIB_ROOT="$HOME/perl5${PERL_LOCAL_LIB_ROOT:+:${PERL_LOCAL_LIB_ROOT}}"; export PERL_LOCAL_LIB_ROOT;
PERL_MB_OPT="--install_base \"$HOME/perl5\""; export PERL_MB_OPT;
PERL_MM_OPT="INSTALL_BASE=$HOME/perl5"; export PERL_MM_OPT;


## [Completion]
## Completion scripts setup. Remove the following line to uninstall
[[ -f $HOME/.dart-cli-completion/zsh-config.zsh ]] && . $HOME/.dart-cli-completion/zsh-config.zsh || true

## Setup fzf
[[ -f ~/.fzf.zsh  ]] && source <(fzf --zsh)
## [/Completion]

# Init Starship
export STARSHIP_CONFIG="$HOME/.config/starship.toml"
eval "$(starship init zsh)"

# Poetry Shell
fpath+=~/.zfunc
autoload -Uz compinit && compinit

# Pyenv Virtualenv init
export PYENV_ROOT="$HOME/.pyenv"
[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"

eval "$(pyenv init -)"
eval "$(pyenv virtualenv-init -)"

if [ -d "/opt/homebrew/share/zsh-syntax-highlighting" ]; then
    source /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
fi
