# absolute-dotfiles

My macOS development setup: Neovim, Ghostty and Herdr around tmux, Zsh, and the configuration for the coding agents I work with (OmO, Claude Code and Codex). Everything lives in `~/dotfiles`, and `setup-mac.sh` installs the tools and links the configs into place.

These are personal settings. Read what a script does before you run it, and fork the repository rather than applying it as it is.

## Contents

- [What's here](#whats-here)
- [Install](#install)
- [Terminals and editors](#terminals-and-editors)
- [Shell and tools](#shell-and-tools)
- [AI agents](#ai-agents)
- [Scripts](#scripts)
- [Servers](#servers)
- [Customising](#customising)
- [Secrets and local files](#secrets-and-local-files)
- [Docs for agents](#docs-for-agents)
- [Troubleshooting](#troubleshooting)
- [Credits and license](#credits-and-license)

## What's here

| Path | What it is |
|------|------------|
| `setup-mac.sh` | Sets up a Mac from scratch, or fills in whatever is missing (see [Install](#install)) |
| `link-ai-configs.sh` | Links the AI tools' configs into place; `setup-mac.sh` runs it |
| `Brewfile`, `Brewfile.apps` | Homebrew: CLI tools, fonts and terminals; GUI and App Store apps |
| `.zshrc` | Zsh (see [Shell and tools](#shell-and-tools)) |
| `.tmux.conf` | tmux on the Mac |
| `.tmux-server.conf` | Plugin-free tmux for servers (see [Servers](#servers)) |
| `.config/nvim/` | Neovim, the [absolute-vim](https://github.com/boxpositron/absolute-vim) repository as a git submodule |
| `.config/ghostty/` | Ghostty, with its shaders |
| `.config/herdr-app/` | Herdr's desktop app: themes, layout, keys and mods ([README](.config/herdr-app/README.md)) |
| `.config/wezterm/` | WezTerm |
| `.config/zed/` | Zed's keymap and settings |
| `.config/zellij/` | Zellij |
| `.config/starship.toml`, `.config/ohmyposh/` | The Starship prompt, and Oh My Posh's `zen.toml` as an alternative |
| `.config/direnv/` | direnv |
| `.config/omo/` | OmO: model routing, hooks, keys, slash commands, skills, extensions and sounds |
| `.config/claude/` | Claude Code: global instructions, settings and OMC preferences |
| `.config/ai/AGENTS.md` | Preferences shared by every coding agent |
| `.config/opencode/` | The retired OpenCode config, kept for reference ([README](.config/opencode/README.md)) |
| `.local/bin/` | Scripts (see [Scripts](#scripts)) |
| `.opencommit` | OpenCommit settings for AI-written commit messages |
| `.rgignore` | Global ripgrep ignore patterns |
| `.withcontextconfig.jsonc` | with-context MCP settings (see [Docs for agents](#docs-for-agents)) |
| `local_servers/` | A Docker Compose file that runs Open WebUI |
| `docs/` | Plans and design specs, so far for `docker-nuke` |

## Install

### Quick start

You need macOS (Apple Silicon or Intel) and Git. macOS offers to install Git with the Command Line Tools the first time you run `git`, and `setup-mac.sh` installs everything else: the Command Line Tools, Homebrew, Node.js, Python, Rust and the rest.

1. Clone the repository:

   ```bash
   git clone https://github.com/boxpositron/absolute-dotfiles.git ~/dotfiles
   cd ~/dotfiles
   ```

2. Preview, then run the setup script:

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
| `ai` | Installs omo, Claude Code and Codex, then runs `link-ai-configs.sh` |
| `apps` | Installs the GUI and App Store apps in `Brewfile.apps` |
| `macos` | Saves screenshots straight to `~/Desktop/Screenshots` without the floating thumbnail, so a screenshot dragged into a terminal is a path agents can read |

`brew` and `apps` never upgrade packages that are already installed. `apps` skips apps already in `/Applications` that Homebrew did not install, and its App Store entries need you signed in to the App Store first. To list what is installed but missing from `Brewfile`, run `brew bundle dump --file=- | diff Brewfile -`.

A few things still need you afterwards, such as signing in to the App Store and the AI tools, and turning on the 1Password SSH agent. The script lists them when it finishes.

### Linking one config by hand

To take only some of the configs, link them yourself:

```bash
# Neovim
ln -s ~/dotfiles/.config/nvim ~/.config/nvim

# Terminals
ln -s ~/dotfiles/.config/ghostty ~/.config/ghostty
ln -s ~/dotfiles/.config/wezterm ~/.config/wezterm

# Shell
ln -s ~/dotfiles/.zshrc ~/.zshrc
```

### AI configs (`link-ai-configs.sh`)

The `ai` step of `setup-mac.sh` runs this script. To run it on its own after installing Node.js, omo, Claude Code and OMC:

```bash
bash ~/dotfiles/link-ai-configs.sh --dry-run
bash ~/dotfiles/link-ai-configs.sh
```

It creates individual relative symlinks, skips links that are already correct, and backs up replaced files or links under `~/.local/state/dotfiles-ai/backups/`. It never replaces whole configuration directories. To undo a replacement, remove that symlink and move its backup back to the original path.

- `.config/omo/omo.jsonc` becomes `~/.omo/omo.jsonc`, OmO's model routing, including the `design-critique-a` and `design-critique-b` categories that the Impeccable critique delegates its two assessments to.
- `.config/ai/AGENTS.md` holds the shared personal preferences. OmO reads it through `~/.config/opencode/AGENTS.md`, which OmO's rules engine checks ahead of `~/.claude/CLAUDE.md`. The engine stops at the first file it finds, so this link both supplies the preferences and keeps Claude's OMC orchestration instructions out of OmO. Keep it even though OpenCode is retired. Claude imports the same file from its own `CLAUDE.md`.
- `.config/claude/` supplies Claude's global instructions, settings and OMC preferences. The machine-specific OMC `nodeBinary` cache is left out on purpose: install Node.js and run OMC setup on each new machine to configure its runtime and HUD.
- `.config/omo/skills/` holds the vendored skills (see [AI agents](#ai-agents)). The script links every one into `~/.omo/agent/skills/`, and all but `frontend-workflow` into `~/.claude/skills/`. Portable Claude plugins and unrelated user skills stay enabled.

Credentials, `settings.local.json`, plugin installations, unrelated user skills, histories, caches and runtime state are not copied into this repository or managed by this script. Install other plugins and portable skills separately. OmO's MCP servers live in `~/.omo/agent/mcp.json`, which this repository does not manage; the local ones (headroom, agcanvas, uvx, ast-grep-mcp, portfolio-mcp) must be installed on a new machine before they resolve.

OmO's hooks, keys, extensions and slash commands (`~/.omo/agent/hooks.json`, `keybindings.json`, `extensions/` and `prompts`) and the scripts in `~/.local/bin` are linked by the `links` step of `setup-mac.sh` instead.

Restart OmO and Claude Code after applying changes. On first use, Claude may ask you to approve the shared preferences import. Updates can rewrite generated configuration or replace symlinks, so review the live files and the repository diff before rerunning the link script, which backs up divergent live files rather than merging them. This step changes no plugin versions or model choices.

## Terminals and editors

### Neovim (`.config/nvim/`)

The Neovim config is [absolute-vim](https://github.com/boxpositron/absolute-vim), pulled in as a git submodule; its [README](https://github.com/boxpositron/absolute-vim/blob/main/README.md) covers it in full.

- Modular Lua setup, lazy-loaded with lazy.nvim: plugins in `lua/absolute/plugins/` (around 40), their configuration in `lua/absolute/after/`
- Language servers through Mason, and debugging through DAP
- snacks.nvim for the fuzzy picker, file explorer, notifications and input prompts (replacing Telescope, nvim-notify and dressing)
- Completion with blink.cmp (replacing nvim-cmp)
- Git integration, including inline blame for the current line
- Flutter and mobile development, Python environment management and terminal integration
- Catppuccin, Tokyo Night, Rose Pine and Nightfly colour schemes (see [Customising](#customising))

### Ghostty (`.config/ghostty/`)

- Custom shaders for CRT, bloom, glow, flicker and starfield effects
- Its own colour scheme
- Native title bar; SSH sessions forward the environment and terminfo
- Does not attach tmux by itself; start or attach sessions yourself

### Herdr (`.config/herdr-app/`)

Herdr's desktop app is the window around tmux: each tab runs a tmux client, and Herdr adds the theme, agent status, sounds and toasts around it. Everything below is described in full in [its README](.config/herdr-app/README.md).

- The `netrunner` layout, in a cyberpunk theme that tmux's bar matches. Other layouts use Catppuccin Mocha and Latte, following the system appearance. JetBrainsMono Nerd Font 14, omo's own sounds, telemetry off.
- The Agents tab lists every tmux server (this Mac and each connected machine), its sessions and the omo panes in them, each with its state and message. Drag a session to put it where you want it.
- The side panel shows Files, Changes, MCP, "omo in tmux" and Jobs for the tmux pane you are in. Cmd+Alt+B collapses it and brings it back, as Cmd+B does the sidebar.
- Cmd+P searches tabs, spaces, and the tmux sessions and panes on every machine, and starts a new tmux session by name. Cmd+J shows the pane that most needs you, and Cmd+Shift+B opens the omo board.
- The preview shows Markdown (with highlighted code and Mermaid diagrams), HTML, images with zoom, PDFs, documents and code, from this Mac or a Herdr machine. Ctrl+click a path in a tmux pane to open it there.
- omo reports its state from inside tmux through `omo-status`, including "step done" for a turn that ends with tasks still open in its todo list.
- `herdr-tmux-update` carries our copies of Herdr's mods onto a new Herdr release.

### WezTerm (`.config/wezterm/`)

- Lua configuration
- Custom key bindings
- Multiplexer features

### Zed (`.config/zed/`)

Key bindings and settings. The settings leave out the machine-specific agent servers and SSH hosts.

### Zellij (`.config/zellij/`)

A terminal workspace, configured in `config.kdl`.

## Shell and tools

### Zsh (`.zshrc`)

- PATH set up for the development tools, plus aliases and functions
- oh-my-zsh with the `git` and `asdf` plugins, completion, and zsh-syntax-highlighting
- The Starship prompt (`.config/starship.toml`); Oh My Posh's `zen.toml` is there as an alternative
- direnv loads a folder's `.envrc` when you enter it, without its usual chatter
- 1Password as the SSH agent, and an `sshm` wrapper with completion
- tmux session helpers: `tma [session]` attaches (an fzf picker with no argument, switching the client when you are already inside tmux) and `tml [prefix]` lists sessions. Both Tab-complete the running sessions with their window counts. When no tmux server is up, `tma` starts a new session named after the argument or the current directory, and `tml` and completion say so instead of erroring
- Resets mouse-reporting modes at each prompt, so an unclean SSH or tmux disconnect cannot leave the terminal spewing escape codes
- The `owt` wrapper, which lets `owt cd` change your directory (see [Agent workspaces](#agent-workspaces-owt))

### tmux (`.tmux.conf`)

- The `Ctrl+b` prefix, the status bar on top, and the netrunner palette Herdr uses
- Sets the terminal title to the session name, after the omo status marker when there is one, and hands a client in Herdr its session's omo status when it attaches or switches session
- Ctrl+click a file path or a Markdown link in any pane (omo, a shell, logs) to open it with `tmux-open-path`: markdown in Markdown Preview, images, PDFs and directories in yazi, and anything else in nvim at the clicked `:line`. yazi and nvim open in a split beside the clicked pane. From Herdr, every file opens in Herdr's preview instead

For servers, see [Servers](#servers).

### Other tools

- **ripgrep**: `.rgignore` is linked as `~/.rgignore`, the global ignore patterns
- **OpenCommit** (`.opencommit`): AI-written commit messages
- **direnv** (`.config/direnv/`): per-folder environment variables

## AI agents

### OmO (`.config/omo/`)

OpenCode is retired. Its agents, commands and plugins are left in `.config/opencode/` for reference; they are no longer installed or linked, and its skills and slash commands moved here.

- `omo.jsonc` (linked as `~/.omo/omo.jsonc`): model routing for the main session, task categories and curated agents. `design-critique-a` and `design-critique-b` are the two lanes the Impeccable critique delegates its assessments to.
- `hooks.json` (linked as `~/.omo/agent/hooks.json`): runs `omo-notify` when a session starts, when you send a prompt, when a session stops and when it asks you something, for the sound, the notification, the coloured tab marker and the status Herdr shows. It also runs `owt hook` with each prompt, which tells an agent in an `owt` workspace its current tab title so it retitles the tab as the work changes. omo runs a new hook only after you approve it with `/hooks trust <id>` (the ids are in `/hooks list`).
- `keybindings.json` (linked as `~/.omo/agent/keybindings.json`): interrupt on Ctrl+G and the external editor on Ctrl+Q.
- `sounds/`: omo's own notification sounds, rendered offline by `sfx` from `recipes.toml`. They are pure synthesis, so they contain no third-party audio and play on Linux too. `omo-sound` plays them for `omo-notify` and `omo-remote`. Edit a recipe, run `sfx recipes.toml` in that folder, and the next notification uses the new sound.
- `prompts/` (linked as `~/.omo/agent/prompts`): slash commands.
  - `/linear-sync [notes]` posts a progress comment on the workspace's Linear issues and sets them to In Progress, or In Review once a PR is open.
  - `/owt-done [notes]` finishes a workspace after its PR merges. It syncs the session as `/sq` does (running work, Studio time and tasks, memory, a handoff block), comments on each Linear issue and moves it to Done, then runs `owt done --detach`, which stops what still runs in the workspace (dev servers, watchers, docker compose containers started from it) before removing it. It asks before discarding uncommitted or unmerged work.
  - `/sq` (safe quit) gets a session ready to close: it finishes or stops its running work, posts logged client time and progress to Studio, updates Linear, commits and pushes the session's own changes (checking a public repository's diff for secrets and private details first), saves memory and writes a handoff. Its last line is `SQ: done` when the session has nothing of its own left (what waits on you in Studio or Linear goes in the handoff and doesn't keep it open), `SQ: park <open items>` when the session has work of its own to come back to, or `SQ: hold <reason>` when closing would lose work.
  - `/studio-audit [client | PRD]` checks Studio's PRDs and tasks against the work sessions did (their sessions, commits, pull requests and logged time), stages what Studio is missing, and applies only what you approve. It loads the Studio audit skill, which Studio serves with its other guides.
  - `/impeccable [command] [target]` runs the Impeccable design skill.
  - `/setup-notes`, `/sync-notes`, `/ingest-notes`, `/teleport-notes`, `/analyze-vault`, `/reorganize-notes`, `/preview-notes-delegation` and `/validate-notes-config` manage with-context documentation delegation. They came over from OpenCode and need the with-context MCP server, which is not in `~/.omo/agent/mcp.json`.
- `skills/` (linked into `~/.omo/agent/skills/`, and the shared ones into `~/.claude/skills/`): the vendored Impeccable, Vercel `web-design-guidelines`, Stageshow, `frontend-workflow`, `sound-design` and marketing skills. See [the skills README](.config/omo/skills/README.md) for provenance, local modifications and upgrades.
- `extensions/vim-quit.ts` (linked into `~/.omo/agent/extensions/`): `:q`, `:q!`, `:qa` and `:wq` quit omo, and `:sq` runs `/sq` and acts on its verdict. `SQ: done` cleans up: in an `owt` workspace that is committed and merged it runs `/owt-done`, which stops what still runs in the workspace, removes it and ends the session, and any other session just closes. `SQ: park` files the session in the library (`omo-sessions`) and closes it, as does a done in a workspace that can't be finished yet. `SQ: hold` keeps it open. It also acts on quit and handover requests written to `~/.local/state/omo-sessions/requests/<session id>.json`, for a session manager that is not written yet.
- `extensions/omo-working.ts` (linked the same way): keeps the tmux pane's omo state and name current. It marks the pane working whenever a turn starts, including turns omo starts itself (an answer to a question, a finished background task, a monitor, a goal continuation), which fire no prompt hook. It sends omo's own name for the session (`omo-status name`), which names the Herdr tab ahead of the last prompt's first line (an `owt` title still wins). When omo exits it clears the pane, so the tab gets its number back instead of keeping the last state and name.
- `extensions/omo-nice.ts` (linked the same way): runs omo at nice 10, so agents' test runs and builds can't starve Herdr, tmux and the window server. Everything omo starts inherits it (shell commands, eval kernels, MCP servers, subagents), however the session was launched. Agents also cap test workers at 3, a rule in `.config/ai/AGENTS.md`.
- `archive/`: the OpenCode-era `DEVELOPMENT-WORKFLOW.md` and `UI-WORKFLOW.md`, kept for reference and loaded by nothing.

`.local/bin/omo-sessions` keeps the library of sessions closed on purpose and passes work between sessions: `park` and `resume` a session (or `--all`), `fresh` starts a new session from a parked or live session's handoff, and `handoff <session|new> <task>` gives a task to another session, on another machine with `--on`. `start [--tmux <session>] <task>` starts omo on a task in a new window of a tmux session (made if missing), named after a random city (`owt city`, the list owt names workspaces from), and prints the pane; Herdr's picker uses it to start tasks. The session retitles its window with `omo-sessions title <words>` once it knows the work, reminded on each prompt by `omo-sessions hook`, as owt's hook does in workspaces. agent-state serves the results at `/api/library` and `/api/handoffs`, and the Herdr board's Parked column reopens a session or starts fresh from it.

MCP servers live in `~/.omo/agent/mcp.json`, which this repository does not manage: Playwright, Chrome DevTools, Figma, Linear, reoclo, time, ast-grep, headroom, agcanvas and portfolio, plus private ones for client work.

### Claude Code (`.config/claude/`)

Global instructions (`CLAUDE.md`, which imports the shared `.config/ai/AGENTS.md`), settings and OMC preferences, linked by `link-ai-configs.sh` (see [AI configs](#ai-configs-link-ai-configssh)). The `cl`, `cldir` and `claude-tmux` scripts give each tmux session its own Claude profile (see [Scripts](#scripts)).

### Agent workspaces (`owt`)

`owt` gives each agent task its own git worktree, in the style of Conductor. Run it from anywhere inside a repository:

```bash
owt new                 # random city name, e.g. ~/worktrees/<repo>/lagos on branch feature/lagos
owt new PRA-107 PRA-108 # same, and tell the agent which Linear issues to start on
owt new --task <id>     # same, for Studio tasks (a PRD requirement's task; repeatable): the agent binds its time to them
owt ls                  # workspaces and their current branches
owt all                 # workspaces of every repo, with branches and source checkouts (from anywhere)
owt cd                  # jump into a workspace with fzf; owt cd lagos goes straight there
owt open lagos          # reopen the agent in a workspace
owt title imap timeouts # title the workspace's tab (one to three words); the agent does this itself
owt done                # remove the workspace you are in once its work is merged
owt completion zsh      # the zsh tab completion, which .zshrc sources: commands, flags, workspaces, git refs for --base
```

`owt new` fetches its base branch (the `origin` default branch unless you pass `--base`), fast-forwards the local copy of that branch, and starts the workspace from the result; `--no-ff` skips the fetch and fast-forward and uses the ref as it is locally. It then copies local `.env` files, installs dependencies, and opens a tmux window running omo with the workspace conventions: rename the placeholder branch to `feature/<keys>-<slug>` before pushing, title the tab with one to three words naming the work (`owt title`) and update it when the focus changes, and keep the Linear issues' statuses in sync. The title is saved with the worktree, so `owt open` reopens the tab under it. Workspaces share the main checkout's omo memory through a link under `~/.omo/memory/agents/`.

`owt cd` works from any directory. Inside a repository the picker starts filtered to that repo's workspaces and jumps straight in when only one matches. The `owt` function in `.zshrc` performs the `cd`; without it, `owt cd` only prints the path.

`owt done` refuses to discard work unless you pass `--force`. Work counts as merged when the branch is part of the default branch or its Gitea PR is merged (checked with `tea`). It then deletes the remote and local branch, removes the worktree and its memory link, and closes tmux windows and Herdr tabs open in it. `OWT_ROOT` (default `~/worktrees`) and `OWT_AGENT` (default `omo`) override the defaults; `owt --help` lists every option.

In Herdr outside tmux, `owt` uses Herdr spaces where it would use tmux windows. `owt new` and `owt open` open a space of its own for the workspace, named after its title, which Herdr's sidebar nests under the repo's space when that is open. `owt title` renames it, `owt done` closes it, and `owt done --detach` runs its cleanup as a herdr-core terminal of its own so closing the space can't stop it. Inside tmux, `owt` keeps to tmux windows even when the tmux client runs in Herdr.

`owt` runs on Linux too. For a repository on GitHub, which `tea` cannot query, `owt done` counts a branch as merged only once it is part of the default branch: merge-commit PRs pass, squash-merged ones need `--force`.

## Scripts

Scripts live in `.local/bin/`. The `links` step of `setup-mac.sh` links each executable one into `~/.local/bin`, which `.zshrc` puts on your PATH. The server-only ones (`pbcopy`, `pbpaste`, `impeccable-browser` and `skills-update`) are not linked on macOS.

### Herdr and tmux

- `tmux-open-path`: Backs tmux's Ctrl+click.
  - It takes the path under the mouse. Anywhere on a Markdown link or image, `[label](target)` or `![alt](target)`, it takes the target; on the label of omo's `label (target)`, it takes the target when the label is no file.
  - It strips `:line:col`, `#L10`, `@` and `file://`, and resolves the path against the pane's directory, then its git root.
  - It routes the file by type: markdown to Markdown Preview (`cask "markdown-preview"` in `Brewfile.apps`), images, PDFs and directories to yazi, and the rest to nvim. When the clicking tmux client runs in Herdr, every file opens in Herdr's preview (`herdr-preview`) instead.
- `herdr-preview`: Opens a file or folder in Herdr's preview (`.config/herdr-app/mods/preview`), split beside the terminal it runs in, or `--tab`. It renders Markdown (with highlighted code and Mermaid), HTML, images, PDFs, documents and code, with copy path, reveal in Finder and open actions, and Edit (Cmd+E) opens nvim on the file below it. Outside Herdr it opens the file with its default app (see [the Herdr README](.config/herdr-app/README.md)).
- `herdr-render`: Draws HTML pages (in tiles) and Mermaid diagrams to PNG with the system WebKit (`Bun.WebView`), for Herdr's preview; run with bun. The first diagram installs `mermaid` into `~/.cache/herdr-render`.
- `herdr-files-editor`: The nvim behind Herdr's Files panel. It runs as the `files-nvim` terminal that the `netrunner` layout's edit block shows, opens each file the preview sends it from that file's folder, and never exits, since a terminal that ends takes its layout block with it.
- `herdr-tmux-update`: After a Herdr update, merges Herdr's changes to its search, sidebar chrome and main layout into our copies of them (see [the Herdr README](.config/herdr-app/README.md)).

### omo

- `omo-notify`: Sound, tab marker and notification for OmO's hooks. Ghostty posts the notification, so clicking it opens the session's tab and pane. Messages name the task, the first line of your prompt ("Finished: fix the imap timeouts"). In Herdr it stays quiet, and Herdr plays the sound and shows the toast.
- `omo-status`: The status of every omo session in tmux.
  - A coloured marker in front of the Ghostty tab title for each tmux session running omo: 🔴 stopped with an error, 🟡 waiting for your answer, 🟢 finished, 🔘 finished a step with tasks still open in omo's todo list, 🔵 working. A tab with several agents shows the most urgent one. Focusing the tab clears red, amber and green, and undoes any title you gave the tab by hand, so it always shows its session name.
  - It reports the session's most urgent state and message to tmux clients running in Herdr as an OSC 7501 program status, since omo inside tmux cannot report through tmux.
  - `omo-status list` and `omo-status show <pane>` list every pane running omo and show one in Herdr, for Herdr's "omo in tmux" panel. `omo-status spaces` gives every tmux session running omo a Herdr space of its own, and `omo-status next` (Cmd+J in Herdr) shows the pane that most needs you.
  - These cover the tmux sessions of other Herdr machines too, and `omo-status open <tmux target> [<host>]` shows a board session for Telegram's "Open on Mac" button.
- `omo-remote`: The same sound, tab marker and notification for omo sessions on another machine.
  - That machine's own `omo-notify` (not in this repository) writes the session's state into its terminal title, marker first (`🟢 project · omo:done:...`). mosh drops notifications but carries titles, and so does ssh, so tmux's `pane-title-changed` hook passes the event to `omo-notify` for the pane running mosh or ssh.
  - Everything else reaches you through ntfy: `omo-remote install` starts a launchd agent that subscribes to the topic and plays the sound and posts the notification for omo pushes, unless a tmux pane here already handled that event through its title, so nothing arrives twice. That covers sessions no terminal is showing and a mosh or ssh session in a plain Ghostty tab, whose title shows the marker and which posts the notification itself (the coloured tab marker needs tmux).
  - The agent reads `NTFY_URL`, `NTFY_TOPIC` and `NTFY_TOKEN` from `~/.config/ntfy/omo-remote.env` (chmod 600, not in this repository) and needs `brew "ntfy"`.
- `omo-sound`: Plays an omo notification sound by name (`omo-done`, `omo-input`, `omo-error`) or any audio file, with afplay on macOS and pw-play, paplay, aplay or ffplay on Linux.
- `omo-sessions`: The library of parked sessions and handoffs between sessions (see [OmO](#omo-configomo)).
- `omo-presence`: Prints `present` or `away` for omo-assistant: present while Herdr is in front, the screen is unlocked and the keyboard or mouse was used in the last five minutes. omo-assistant keeps sessions' questions and errors off Telegram while you are present, since Herdr alerts you.
- `omo-work`: Run by omo's hooks in a client's code, which it recognises by folder from the private `~/.config/omo-work/customers` (outside this repository). It tells the agent which client the session works for and logs each stretch the agent works, so the time can be posted to the work's task; in-house clients are tracked but never billed. A session can move between tasks: binding again switches, the time worked so far stays with the task it was for, and `omo-work posted <task id>` marks one task's time as posted. `omo-work report` lists the logged time by client and task. The rules for client work live in the private `~/.config/omo-work/rules.md`, which `.config/ai/AGENTS.md` points agents to.
- `owt`: Git worktree workspaces for coding agents (see [Agent workspaces](#agent-workspaces-owt)).
- `sfx`: Renders notification sounds and short effects from a TOML recipe, offline and from synthesis alone, normalised to one loudness, as WAV plus optional MP3 and MIDI. A uv script; `sfx --help` lists the options and the `sound-design` skill documents the recipe format.

### Claude Code

- `claude-tmux`: Keeps a Claude Code profile for each tmux session and launches Claude with it. A new profile starts as a copy of `~/.claude`, or empty when there is none.
- `cl`: Starts Claude Code with the tmux session's profile (`claude-tmux run`); outside tmux it picks or creates a session first.
- `cldir`: Prints the Claude profile folder of the tmux session you are in, or `~/.claude` outside tmux.

### Mac upkeep

- `docker-nuke`: Force-restarts a wedged Docker Desktop, capturing diagnostics to `~/.local/state/docker-nuke/` first (`--dry-run` to preview, `--no-restart` to leave it down, `--deep` for root helpers). `test-docker-nuke.sh` is its test harness, and `docs/` holds its plan and design spec.
- `logi-watchdog`: Restarts Logi Options+'s background agent (launchd job `com.logi.cp-dev-mgr`) when it is down. Without the agent the Options+ window hangs on its loading screen, and Logitech's job restarts the agent only after an unclean exit, so a crash followed by a clean exit leaves it down for good. `logi-watchdog install` starts a launchd agent that checks once a minute and logs each restart to `~/.local/state/logi-watchdog.log`. It leaves the agent alone while Logi's installer runs, since an update stops the agent on purpose. `logi-watchdog uninstall` removes it.
- `brave-debug`: Starts Brave with remote debugging on port 9222 and a throwaway profile in `/tmp/brave-debug`, for tools that drive a browser over the DevTools protocol.

### Servers only

- `pbcopy`, `pbpaste`: macOS-style clipboard commands for headless servers. `pbcopy` sends text over OSC 52 to the terminal on the other end of the SSH connection, which puts it on your own machine's clipboard. Terminals refuse OSC 52 reads, so `pbpaste` returns the tmux paste buffer instead.
- `tmux-osc52`: tmux's copy command on servers reached over mosh, set in `.tmux-server.conf`. tmux 3.6 sends copies as OSC 52 with a blank clipboard name, which mosh 1.4 drops, so this rewrites each copy into the form mosh, Herdr and Ghostty all accept.
- `impeccable-browser`: The browser for Impeccable's URL scans (`impeccable detect <url>`) on a headless Linux machine, set as `IMPECCABLE_BROWSER` in `~/.zshenv`.
  - Public URLs render on Browserless. Its key, `BROWSERLESS_API_KEY` from the Reoclo project and organization that `BROWSERLESS_REOCLO_PROJECT` and `BROWSERLESS_REOCLO_ORG` name, is cached for 12 hours in `~/.impeccable/browserless.token`.
  - Localhost and private addresses reach Browserless through a cloudflared quick tunnel that lasts only for the scan, and reports still name the local URL.
  - Other launches, and any scan whose tunnel or Browserless connection fails, run on the headless Chrome in the Puppeteer cache with `--no-sandbox`, since AppArmor can block Chrome's sandbox.
  - `IMPECCABLE_TUNNEL=0` keeps private addresses on local Chrome, which pages that call a second local port (a separate API, say) need. Every decision is logged to `~/.impeccable/browser.log`.
- `skills-update`: Refreshes omo's skills from upstream every day on a Linux machine, from a systemd user timer that `skills-update --install-timer` writes and enables (05:00 UTC).
  - The vendored `impeccable` (newest `skill-v*` release) and `web-design-guidelines` are re-vendored as [the skills README](.config/omo/skills/README.md) describes, then committed and pushed. Only the skill paths are committed, and the push happens only when `main` was level with `origin/main`.
  - The machine-local `vercel-react-best-practices`, `docx`, `pdf`, `pptx`, `xlsx` and `skill-creator` copies in `~/.omo/agent/skills` are synced from `vercel-labs/agent-skills` and `anthropics/skills`.
  - A failed update keeps the previous copy and marks the run failed (`journalctl --user -u skills-update`).

## Servers

`.tmux-server.conf` is a lightweight, plugin-free tmux config for remote servers.

| Feature | Desktop (`.tmux.conf`) | Server (`.tmux-server.conf`) |
|---------|---------|--------|
| Status bar | Top | Bottom |
| Prefix key | `Ctrl+b` | `Ctrl+/` |
| Plugins | TPM, sessionx, floax and others | None |
| Theme | Netrunner (dark cyberpunk, matches Herdr) | A Cyberpunk yellow bar, so a remote session never passes for the Mac's |
| Copying | tmux's defaults | OSC 52 through `tmux-osc52`, so copies reach the Mac's clipboard over mosh |

To install it on a server:

```bash
# With curl
curl -fsSL https://raw.githubusercontent.com/boxpositron/absolute-dotfiles/main/.tmux-server.conf -o ~/.tmux.conf

# Or with wget
wget -qO ~/.tmux.conf https://raw.githubusercontent.com/boxpositron/absolute-dotfiles/main/.tmux-server.conf
```

If tmux is already running, reload it with `tmux source-file ~/.tmux.conf`. The copy command expects `tmux-osc52` in `~/.local/bin`; copy it from `.local/bin/` too.

| Binding | Action |
|---------|--------|
| `Ctrl+/` | Prefix key |
| `Prefix + \|` | Split side by side, in the pane's folder |
| `Prefix + -` | Split top and bottom, in the pane's folder |
| `Prefix + hjkl` | Resize panes |
| `Ctrl + hjkl` | Move between panes (vim-aware) |
| `Prefix + m` | Zoom the pane |
| `Prefix + /` | Search the scrollback |
| `Prefix + Left/Right` | Move the window left or right |
| `Prefix + C` | Make the pane's folder the session's folder |
| `Alt+Shift+X` | Close the pane |
| `Prefix + r` | Reload the config |

`owt` runs on servers too (see [Agent workspaces](#agent-workspaces-owt)), and the [server-only scripts](#servers-only) are written for them.

## Customising

- **Neovim plugins**: add them in `.config/nvim/lua/absolute/plugins/` and configure them in `.config/nvim/lua/absolute/after/`.
- **Shell aliases and functions**: edit `.zshrc`.
- **Search ignores**: edit `.rgignore`.
- **OmO skills**: add one in `.config/omo/skills/`, then link it with `link-ai-configs.sh`.
- **OmO slash commands**: add a prompt template in `.config/omo/prompts/`.
- **Herdr keys**: add them to `.config/herdr-app/keys.json` by hand, since Herdr stops adding its new default shortcuts to a `keys.json` you have edited.
- **New configs**: add the path to `LINKS` in `setup-mac.sh`, then run `./setup-mac.sh links`.

### Themes

Neovim's colour scheme is set in `.config/nvim/lua/current-theme.lua` (Tokyo Night at the moment). The installed schemes are Catppuccin, Tokyo Night, Rose Pine and Nightfly.

Terminal themes are set in:

- Ghostty: `.config/ghostty/colorscheme`
- WezTerm: `.config/wezterm/wezterm.lua`
- Herdr: `.config/herdr-app/themes/`, with `netrunner.json` for the `netrunner` layout and tmux's bar matching it

## Secrets and local files

Nothing secret belongs in this repository, which is public: no API keys, tokens, passwords, personal email addresses or client configuration.

- `.env`, `.envrc`, the root `AGENTS.md` and `.withcontextignore` are gitignored, so they exist only on the machine that has them. `setup-mac.sh links` still links them into `$HOME` when they are there, and skips them when they are not. There are no example files: on a new Mac, copy them over or write them yourself.
- `.zshrc` sources `~/.zshrc.local` last, when it exists, for this machine's private settings such as hosts and paths. It is not in the repository.
- direnv loads a folder's `.envrc` when you enter it.
- Other private settings live outside the repository: `~/.config/ntfy/omo-remote.env` for `omo-remote`, `~/.config/omo-work/` for client work, and `~/.omo/agent/mcp.json` for OmO's MCP servers.

## Docs for agents

- `.config/ai/AGENTS.md`: preferences every coding agent follows, such as commit attribution, writing style and test worker limits.
- `AGENTS.md` at the repository root (local only, see above): guidelines for agents working in this repository and the layout of the home folder.
- The with-context MCP server can move documentation into an Obsidian vault. `.withcontextconfig.jsonc` configures it, and `.withcontextignore` (local only) lists what stays here: this README, the component READMEs, `.config/omo/`, setup scripts, drafts and anything sensitive. The `/setup-notes` and `/sync-notes` slash commands describe its use.
- Component READMEs: [Herdr](.config/herdr-app/README.md), [Neovim](https://github.com/boxpositron/absolute-vim/blob/main/README.md), [OmO skills](.config/omo/skills/README.md) and [OpenCode](.config/opencode/README.md).

## Troubleshooting

Neovim plugins not loading:

```bash
nvim --headless "+Lazy! sync" +qa
```

Language servers not working: open Neovim and run `:Mason` to check and install them.

Shell changes not showing: reload with `source ~/.zshrc`, or open a new terminal.

To debug Neovim's startup, write a verbose log:

```bash
nvim -V10nvim.log
```

## Credits and license

- [Absolute VIM](https://github.com/boxpositron/absolute-vim) is the foundation of the Neovim config.
- [OmO](https://github.com/code-yeongyu/oh-my-openagent), the coding agent most of this is built around.
- [awesome-neovim](https://github.com/rockerBOO/awesome-neovim) and [dotfiles.github.io](https://dotfiles.github.io) for ideas.

Released under the MIT License. The tools configured here keep their own licenses.
