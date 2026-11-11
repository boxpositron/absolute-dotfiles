# Herdr

Herdr's desktop app (`herdr-app`, with herdr-core as `hc`) as the window around tmux. tmux stays as it is: each Herdr tab runs a tmux client (`tma <session>`), and Herdr adds the theme, the agents list and its sounds and toasts around it.

## Files

`setup-mac.sh links` links these into `~/.config/herdr-app/`, which holds everything else Herdr writes:

- `settings.json`: Catppuccin Mocha and Latte for layouts without a theme of their own, following the system's light or dark mode; JetBrainsMono Nerd Font 14 like Ghostty; omo's own `omo-done` and `omo-input` sounds for Herdr's done and blocked alerts; telemetry off.
- `themes/catppuccin-mocha.json`, `themes/catppuccin-latte.json`: terminal colours from Catppuccin's Ghostty palettes, plus Herdr panel and status colours from the same palette (blue working, yellow needs you, green done).
- `themes/netrunner.json`: the `netrunner` layout's own cyberpunk theme (Settings offers it only there): near-black blue terminals, neon ANSI colours, hot pink accent and focus border, cyan working, Cyberpunk yellow needs you, green done. Dark only, whatever the system's mode. tmux's bar and pane borders (`.tmux.conf` at the repo root) use the same palette.
- `programs.json`: omo with its own name and icon, and in the + menu to start it in a pane of its own.
- `layouts/netrunner.json`: Herdr's main layout, cloned from 0.1.13 (called `tmux` until 2026-11-11), with the "omo in tmux" panel in the side panel and the sidebar from `workspace-chrome-tmux`, in the `netrunner` theme with near-square pane corners, a purple sidebar gradient and a cyan divider. The status bar's row also holds three zero-width blocks: hidden copies of `tmux-context`, `omo-tmux` and `mcp-tmux` (props `{"headless": true}`). Herdr starts a block only the first time it shows and gives keys only to shown copies, and the side panel is often closed, so these copies follow tmux, poll and take Cmd+J and the folder picker key, and publish what they find in shared values; the copies in the panel only draw it (the context strip draws `tmux.context` and loads only PRs and Linear itself). They react to change rather than poll fast: Herdr's focus, tmux's hooks (which touch `~/.local/state/omo-status/where/tick`) and omo state changes (`omo-status set` touches `.../list/tick`) start a read at once, and the timers are a safety net (`tmux-context` every 15 s, the local omo list every 5 s, the other machines' every 15 s). Herdr no longer updates a cloned layout, so changes to `main` in later releases don't reach it. Switch layouts with Cmd+Shift+L.
- `mods/omo-tmux/`: the "omo in tmux" panel.
- `mods/agents-tmux/`: Herdr's Agents list, cloned from `agents` in 0.1.15. Agents on another machine (flowstate-remote) get a faint wash of the Cyberpunk yellow of the server's tmux bar, yellow hover and selection, and a yellow machine label, so a remote session stands out when you scan the list.
- `mods/picker-tmux/`: Herdr's search ("Go to…") with tmux sessions and panes added, cloned from Herdr's `picker` in 0.1.13.
- `mods/workspace-chrome-tmux/`: Herdr's sidebar header and footer, cloned from `workspace-chrome` in 0.1.13, whose search button opens `picker-tmux`. It uses the shipped mod's icons, since Herdr loads no images through the link.
- `mods/files-tmux/`, `mods/changes-tmux/`: Herdr's Files and Changes panels, cloned from `files` and `changes` in 0.1.15, showing the folder of the tmux pane you are in rather than where the tmux client started (see Files and Changes). They use the shipped mods' icons.
- `mods/tmux-context/`: the strip above them: the folder they show and what it is (see Files and Changes).
- `mods/pane-tmux/`, `mods/workspace-status-tmux/`: Herdr's pane header and status bar, cloned from `pane` and `workspace-status` in 0.1.15, showing the tmux pane's folder and branch (see Files and Changes). The header uses the shipped mod's icons.
- `mods/mcp-tmux/`: the MCP panel, the MCP servers of the omo session in the tmux pane you are in (see MCP).
- `mods/omo-board/`: the board view (see Board).
- `mods/preview/`: the file preview (see Preview).
- `keys.json`: Herdr's default keys, plus Cmd+P opening `picker-tmux` in the `netrunner` layout. Herdr stops adding its new default shortcuts to a `keys.json` you have edited, so add new ones here by hand.
- `omo.svg`: omo's icon. It is copied, not linked: Herdr loads a program icon only from a real file in its folder.

## omo's status in Herdr

Herdr knows an agent's state only when the program reports it with OSC 7501 (the [Program Status Protocol](https://www.superlogical.com/rex/docs/build/program-status)), and omo inside tmux can't report through tmux. `omo-status` reports for it instead. A tmux client whose environment holds `HC_TERMINAL_ID` runs in a Herdr terminal, so omo-status sends that client its session's most urgent state, from every omo pane in the session:

| omo | Herdr |
| --- | --- |
| working on a prompt | working |
| turn over, a build, watcher or child session still running, or a wake-up scheduled | working, with `◐ background · <what is running>` as the message (the protocol has no background state, and Herdr shows a terminal that goes from working to idle while you aren't looking as done) |
| asked you something | blocked (question) |
| finished | done |
| stopped with an error | error |
| at rest, or you've looked | idle |

The message names the project and the task, the first line of the prompt: `studio: Finished: fix the imap timeouts`. tmux's `client-attached` and `client-session-changed` hooks send it again when a client arrives or switches session. omo running straight in a Herdr pane, outside tmux, reports to its own terminal. Where Herdr shows the session, `omo-notify` plays no sound and posts no banner of its own, and Herdr plays omo's sounds. Ghostty tabs work as before, and Ghostty gets no reports.

## The "omo in tmux" panel

Herdr sees a tmux client as one terminal, so its agents list has one row per tmux session. The panel, a view of the side panel beside Files, Changes and MCP, lists every pane running omo in every tmux session, grouped by session: project and window name, state, and message, read with `omo-status list-local` the moment a pane's omo state changes or Herdr's focus moves (else every 5 s), and `omo-status list-remote` for the other machines every 15 s. A click runs `omo-status show <pane>` (see Spaces).

The status bar's omo chip (`omo 9`, with a yellow dot when a pane needs you) opens and closes it; it adds `"omo"` to the shared `workspace.panels` list, so Herdr's `tabs` brings it back when you return to a space. The hidden copy beside the status bar reads the list and takes Cmd+J, and publishes the list (`omo.list`) and the counts (`omo.tmux`), so the chip and Cmd+J work with the panel closed.

`omo-status list` finds omo by its process (bun running senpi's CLI) on each pane's terminal, so a pane shows as soon as omo runs in it, idle until omo's hooks report for it, and goes when omo exits. A pane running mosh or ssh shows the remote session's state, which its terminal title brought.

Inside each session the panes that need you come first, then finished, working, background and idle ones. A pane whose turn is over but whose work still runs shows a slower, purple spinner and what it is running (`Watching: staging deploy`, `Running: gh pr checks 13 (+1 more)`, `goal · waiting on CI watch`). A pane with a `schedule_prompt` job counts down to its wake-up, and a parked goal counts down too (`goal continues in 3:34 · waiting on CI watch`): omo stores that time nowhere, so `omo-status` reads it from the footer omo draws in the pane. Herdr's own Agents list can't count down, so there it reads in whole minutes and changes once a minute. Each row shows how long the pane has been in its state (`@omo_since`, which `omo-status` sets on every change). The panel moves the way herdr-t3-inbox does: a row whose place changes slides there, a new one fades in from above, one that goes fades out where it was, all over 150ms ease-out. "Needs you" and "Failed" pulse, and a pane that has just finished flashes green once and fades over 1.5s.

## Search

In the `netrunner` layout, Cmd+P and the sidebar's search button open `picker-tmux`: Herdr's "Go to…" list of tabs and spaces, plus tmux. With nothing typed, tmux's sessions fold into one "tmux: N sessions" row; click it to list them. Typing matches sessions by name and panes by window name, program, folder or omo message, so `riga` finds the prawnwire pane working in the riga worktree. Enter or a click shows the session's current pane, or the pane, through `omo-status show`, as the "omo in tmux" panel does. Every tmux pane is searchable, not only omo's. The selection is one highlight that slides to the row you pick, by arrow keys or by moving the pointer (a list scrolling under a still pointer doesn't move it), and "needs you" marks pulse.

The cloned picker, sidebar chrome and layout don't get Herdr's later changes to the shipped ones. To pick those up, clone again from the new release and carry the tmux additions over.

## Spaces

A tmux session can have a Herdr space of its own, named after it and running a tmux client attached to it. Its terminal is then an agent in Herdr's Agents list with the session's omo status, and the space shows in the sidebar like any project.

- `omo-status show <pane>` (the panel and search use it) focuses the Herdr tab already on the pane's session. Without one, it opens a tab attached to the session in the space named after it, or makes that space in the pane's folder. It never moves a tmux client you have open to another session.
- Openings run one at a time (`show`, `open`, `spaces`), and each waits up to 5 s for its tmux client to attach before the next one looks. Two at once used to find no client each and open the session twice (a double click, or Telegram's "Open on Mac" with a click).
- `omo-status spaces`, or the layers button in the panel's header, makes a space for every tmux session running omo that no Herdr tab shows, closes the spaces it made for sessions that have ended, and puts you back where you were. The spaces it made are listed in `~/.local/state/omo-status/spaces`. It asks Herdr which tmux session each terminal is attached to, finds a space by its saved id before its name (so a renamed space is still found), and opens nothing if it can't read what Herdr already shows.
- In Herdr outside tmux, `owt` opens each workspace as a space of its own, named after its title. Herdr's sidebar nests it under the repo's space when that is open.

A session attached in Ghostty and in Herdr at once is sized to whichever client you used last (tmux's default `window-size latest`).

## Attention

- The panel is an inbox: panes that need you, failed, finished, working or running something in the background, with idle ones folded into an "N idle" row that opens them.
- Cmd+J in the `netrunner` layout (`omo-tmux.next` in `keys.json`, `omo-status next` from a shell) shows the pane that most needs you: a question or a failure, then a finished turn, the longest waiting first. Looking at it clears it, so pressing again moves on.
- A tmux session holding several agents shows its most urgent state. Herdr's Agents list has one entry per session and names that pane and the queue behind it (`needs you · reoclo: which server? (+1 more)`). Going to the session selects the pane that most needs you (a failure, a question, then a finished turn, the longest waiting first) and clears only that pane, so the session keeps its next state and the next visit goes to the next pane, until it falls to working, background or idle. A click on a panel row or board card that needs you goes to that pane; a click on one that doesn't goes to the session's most urgent pane instead. Herdr sends tmux no focus event, so a click in its Agents list is seen as a change of Herdr's focused terminal, within the panel's two-second refresh.
- Herdr's agents list reads "<space> · <work>": `omo-status` names a session's Herdr tab after its most urgent pane's window (an `owt` title) or task, and sends it as the report's OSC 7501 `title`. Only tabs still called by their number, or by the label it set, change.
- omo sends no Stop hook while a background task (a terminal monitor, a child session) is live, so a finished turn could stay "working". `omo-notify` records each pane's transcript (`@omo_transcript`), and `omo-status list` reads the transcript's last `session-lifecycle` entry. A pane with terminal monitors, background commands, detached eval cells or child sessions still live goes to `background` (a purple dot on its tab), as does a pane with a job in `~/.omo/agent/schedule/pending/`; one waiting on nothing real goes to idle. omo's own plumbing in that entry (queued deliveries, goal timers, open questions) doesn't count.
- A question asked without holding the turn stays "needs you" when the turn ends; answering it, or a new prompt, moves the pane on.
- A pane can go without omo saying so: `owt done` kills its window, or the pane dies. tmux's `window-unlinked`, `pane-exited` and `after-kill-pane` hooks run `omo-status refresh`, which works out again each session still reporting an agent whose omo panes aren't the ones it counted last (`@omo_panes`, kept by every status update), so no session keeps reporting a pane that's gone. tmux's `pane-exited` doesn't name the session, so this is how refresh finds it: about 30 ms when nothing changed, where working out every session took 3 to 4 s.
- Spaces sync by themselves: omo's start hook runs `omo-status spaces --local` when Herdr is running, and tmux's `session-closed` hook closes the space of a session that ended. `--local` opens spaces only for this Mac's sessions; the layers button opens them for every machine's. A lock keeps two syncs from overlapping.
- tmux marks a client in a Herdr terminal focused even while its space is hidden, since Herdr sends it no focus-out, so `omo-status` doesn't count Herdr clients as looking at a pane. Going to a pane through the panel, search or Cmd+J clears it instead.

## Board

Cmd+Shift+B in the `netrunner` layout, or the screen button in the Agents list's header, opens the board (`mods/omo-board`) as a dialog centered over the dimmed window, 90% by 88% of it, in the netrunner colours with its own pink neon frame (`frame: "none"` in its `mod.json`); Esc, the ESC keycap or the same key again closes it. It shows every omo session on every machine the omo board knows, read every five seconds from agent-state (`127.0.0.1:4747`, through the omo board's tunnel). Sessions sit in five columns: Needs you (an open question or a blocked goal, oldest first), Working, Background (the turn is over but a build, watcher or child session still runs), Done (finished in the last day) and Idle. A card shows the session's title, its machine, project and tmux target, the question waiting or the "For you" part of its last report, its to-do progress, and a dot for how recently it was active: hot under an hour, warm under a day, dim after that. A click runs `omo-status open`, which shows the session in its Herdr space, or a new one, server sessions included. Sessions not in tmux can't be shown from here.

Telegram's "Open on Mac" button (omo-assistant) runs the same `omo-status open` on the Mac through the board, and brings Herdr forward. `omo-presence` tells omo-assistant whether you are at the Mac (Herdr in front, screen unlocked, keyboard or mouse used in the last five minutes); while you are, it keeps a session's questions and errors off Telegram, since Herdr alerts you.

## Preview

`mods/preview` shows a file beside your terminal:

- Markdown rendered, with a Rendered/Source toggle; HTML the same way.
- Images fitted to the pane, never enlarged; HEIC and TIFF are converted first.
- Text and code with line numbers and highlighting. Compact JSON (three lines or fewer) is pretty-printed. Files over 1 MB or 20,000 lines show their start, and say so.
- Word, RTF and similar documents through `textutil`; PDFs page by page (the first 20 pages); Keynote, Numbers, PowerPoint and Excel files through Quick Look.
- Folders as a list you can click through, and anything else as an info card.

The header copies the path (Cmd+Shift+C), reveals the file in Finder (Cmd+Shift+R), opens it in its default app (Cmd+O) and reloads it (Cmd+R). It also reloads by itself when the file changes. For text, code, Markdown, HTML files and folders, Edit (Cmd+E) opens nvim in a terminal below the preview, in the file's folder, so the preview follows each save. nvim starts through your interactive login shell, so it has what your terminals have; started bare, it lacks `XDG_CONFIG_HOME` from `.zshrc` and the nvim config's WezTerm theme sync fails.

Open it with `herdr-preview <path>`, a split beside the terminal you run it in (`--tab` for a tab of its own), or click a path in a tmux pane (see Clicking paths and links below). Ctrl+click anywhere on a Markdown link or image in a pane, `[label](target)` or `![alt](target)`, opens its target. omo draws a link as `label (target)`, and Ctrl+click on the label opens the target too; omo draws an image link as its alt text only, so it has no path to click. Outside Herdr, Ctrl+click keeps its old routes. Herdr has no setting for what its own Cmd+click does with file paths.

### Clicking paths and links

In a tmux pane, `tmux-open-path` opens the path or web link under the pointer. Inside Herdr on macOS that is **Option+click**: Herdr turns Ctrl+click into a right-click (its terminal menu, or a plain right-click when right-clicks go to the program) and handles Cmd+click itself: it opens a clicked path with macOS `open`, in the file's default app (Ghostty for scripts and files without an extension), so neither reaches tmux. Outside Herdr (Ghostty) it is Ctrl+click, as before.

- What a click names, first match wins: an OSC 8 hyperlink under it (read from the pane's line with its escapes, which tmux keeps, so its exact target counts); a Markdown link around it; the text inside the nearest quotes or backticks; the run of text drawn in one style around it (omo draws inline code in its own colour, without the backticks); the words around it, as many as name a real path, longest first; omo's `label (target)`. So a path with spaces opens from a click anywhere on it, quoted, in an omo code span, with `\ ` escapes or bare. Only a path wrapped onto a second terminal line can't, since tmux reports one line.
- A web link (`http`, `https`) opens in the default browser, plain or as a Markdown, omo or OSC 8 link.
- In the `netrunner` layout, a file opens in the side panel's preview and a folder in its Files list. `tmux-open-path` leaves the request in `~/.local/state/omo-status/open/request.json`; the hidden `tmux-context` copy picks it up, sets `files.open` or `files.root` and shows the panel. A clicked folder stays in the Files list while that pane stays in its folder; the back arrow in the Files header returns to the pane's folder.
- A `path:line` opens the file without going to the line: the preview's Edit opens nvim at the top.
- The Files header's folder button opens the folder it shows in Finder; the preview's folder button reveals the file in Finder, selected in its folder.
- On flowstate-remote the click runs on the server, which has no Herdr panel to open, so it keeps its old routes there.

Watch out:

- Herdr's `image()` only loads files inside `~/.config/herdr-app`, so images, converted images and PDF pages are copied into `~/.config/herdr-app/preview-cache`, outside this repo and pruned after 7 days.
- Herdr's Markdown view draws no images: an image in Markdown shows as an "Image: alt" link that opens it in the preview. Bold and italic showed as plain text in testing.
- Code doesn't wrap, so columns stay aligned; long lines scroll sideways.
- An open preview pane keeps running its old code after `main.js` changes, even after a layout switch: close and reopen it.

## Files and Changes

Herdr's Files and Changes panels follow the focused terminal's folder, and for a tmux client that is wherever `tmux attach` started, not the pane you are working in: a session opened in a repo's main checkout kept showing it while omo worked in an owt worktree. The `netrunner` layout uses `files-tmux` and `changes-tmux` instead, which show the folder of the tmux pane the client shows, with the `tmux-context` strip above them. The tab bar's Files and Changes buttons open them as before.

- `omo-status where <terminal>` finds the tmux client a Herdr terminal runs (`hc get <terminal> --json` `.foreground.pid` is its `#{client_pid}`) and lists its session's panes, with omo found by its process as `omo-status list` does. For flowstate-remote it runs through `hc exec` and takes its own function along, so the server's copy of `omo-status` doesn't need updating. A terminal running no tmux client gets nothing back, and the panels show Herdr's own folder.
- `tmux-context` publishes that pane's folder as the shared value `tmux.where`, which the two panels read; until it has looked at a newly focused terminal they show "Finding the tmux pane…" rather than the client's folder. It looks again when Herdr's focus moves, when tmux changes pane, window or session (hooks in `.tmux.conf` touch `~/.local/state/omo-status/where/tick`, which it watches), and every 3 seconds, which catches a `cd` and flowstate-remote's sessions, whose hooks can't reach the Mac.
- The strip shows the folder (an owt workspace by its name, with its `owt title` beside it) and the repo; the branch with what is to push and pull (↑ ↓), how far it is ahead of and behind the default branch, and the uncommitted files; the Linear issue the branch names; the branch's PR with its state, review and checks (`gh pr view`, read again each minute); and the most urgent omo agent in the session working in that repo, which a click shows (`omo-status show`). A folder on flowstate-remote gets a yellow machine label.
- Clicking the folder's name (or `tmux-context.pick`, which `keys.json` can bind) lists the session's folders with their agents. Picking one pins the panels to that pane, whatever tmux shows, until you pick "Follow the active pane"; a pink pin marks it. Pins are kept per Herdr terminal in the shared value `tmux.pins`.
- Linear links come from `~/.config/herdr-app/linear.json`, which maps each Linear workspace to its team keys: `{ "<workspace>": ["ABC", "XYZ"] }`. It stays out of this repo and isn't linked. An issue of a team it doesn't list copies its id instead of opening.
- Changes has three views. Uncommitted is Herdr's: the work tree against the last commit. Branch is everything the branch changes since it left the default branch (`origin/HEAD`, else `main` or `master`, from their merge-base), uncommitted work and new files included. Commits lists the commits that aren't on the default branch, and opening one shows its whole patch. An owt worktree opens on Branch and anything else on Uncommitted; a view you pick stays for that repo while Herdr runs.
- An open file shows its `path:line` (its first change) with Preview (a split with the preview mod; this Mac only), Edit at the line (nvim in a terminal below, started through your login shell as the preview mod does) and Copy path. An open commit can copy its hash. A submodule (from `.gitmodules`) shows git's summary of it, or what changed inside it when that summary is empty (new files), and offers only Copy path. `keys.json` (or `herdr-app do changes-tmux.<command>`) reaches the same: `uncommitted`, `branch` and `commits` pick the view, `preview`, `edit` and `copy` act on what is open.
- A mod pane opened beside a tmux client, such as that preview, keeps the folder its tab's client showed: the strip, Files, Changes and the status bar stay on the worktree instead of jumping to the folder Herdr has for the space.
- In Files, a click on a file on this Mac opens it in the preview mod in the same place (the layout's `files` slot is a stack of `files-tree`, `files-preview` and `files-edit`; Files hands the file over in the shared value `files.open`). Markdown renders, "Files" or Esc goes back to the tree. The preview's Edit (Cmd+E) runs nvim in the panel too: the `files-edit` block shows the terminal named `files-nvim`, which runs `.local/bin/herdr-files-editor`. It starts on the first Edit and stays; the preview types the folder and file into it (`hc send`), it opens nvim there, and when nvim quits (`:q`) it writes `~/.local/state/herdr-files/closed`, which brings the preview back, reloaded. While nvim is open, Edit shows it again rather than opening another file in it. Files on another machine keep Herdr's read-only view, as the preview reads this Mac's files only. Moving to another tab or folder puts the tree back; an open nvim keeps running.
- The editor terminal never exits on purpose: when a terminal shown in a layout block ends, Herdr removes the block and rewrites the layout file, through the link, into this repo. If `files-nvim` is killed while it shows, check `git diff layouts/netrunner.json` and restore the file. Without the block, Edit opens nvim below the preview, as outside the panel.
- Herdr's Commit button is gone from Changes: it ran `git add -A` and committed everything in the repo shown. Commit from the terminal or ask the agent.
- The pane header (`pane-tmux`) shows the folder of the tmux pane each client shows, from the shared value `tmux.panes` that `tmux-context` fills for every tmux client in the shown tab. The status bar (`workspace-status-tmux`) shows that pane's branch, from `tmux.where`. The hidden `tmux-context` beside the status bar keeps both right with the panel closed, from the moment Herdr starts.
- Agents are only looked for in the tmux session the client shows.

## MCP

The status bar's MCP chip counts the MCP servers of the omo session in the tmux pane the focused client shows (or the first omo pane of that tmux session), with a yellow dot when one needs you. A click opens the MCP panel in the side panel, a third view beside Files and Changes; another click closes it. Herdr's tab bar has no button for it.

- The chip reads once the focus has stayed on a pane for 0.8 s, so passing through panes reads none of them, and again every two minutes; the panel's refresh button reads at once. `omo-status mcp` keeps what it found in each transcript (`~/.local/state/omo-status/mcp/`) and reads only what was added since, so a long session costs a full read once.
- `omo-status mcp <pane> [machine]` works the list out as omo does when a session starts or reloads: your `~/.omo/agent/mcp.json`, then the project's Claude `.mcp.json` (only when `importConfigs` has `"claude"`) and `.omo/mcp.json`, both only in a trusted project; omo's bundled `context7` and `grep_app` unless configured by name. On flowstate-remote it runs there, as `where` does.
- Each server shows where it comes from (user, project, claude, omo), how it runs, how many tools it listed last (omo's `mcp-cache.json`), its sign-in, a problem omo logged in the last day, and the session's own latest call to it since its config was read, from its transcript, with omo's error when it failed.
- omo keeps live connection state in its process, so a server the session hasn't called since shows only what its config says. The panel also says when the config was read, warns when an `mcp.json` changed after that (`/reload` picks it up), and names servers an untrusted project's `.omo/mcp.json` or an unimported `.mcp.json` would add.
- `mcp-tmux` adds `"mcp"` to the shared `workspace.panels` list (the welcome sets it to Files and Changes), so Herdr's `tabs` brings the MCP panel back when you return to a space, as it does the others.

## Herdr updates

`herdr-tmux-update` carries our copies onto a new Herdr: it keeps Herdr's own versions we copied from in `base/`, merges what Herdr changed since into `picker-tmux`, `workspace-chrome-tmux`, `agents-tmux`, `files-tmux`, `changes-tmux`, `pane-tmux`, `workspace-status-tmux` and the `netrunner` layout with `git merge-file`, and checks the mods one by one. A conflict leaves `<<<<<<<` blocks to settle by hand; then check the mod again with `herdr-app check`. Run it when you mean to merge, not as a check: it writes Herdr's pending changes into our copies and records them in `base/`.

## flowstate-remote

flowstate-remote is a Herdr machine (`hc machine add flowstate-remote`, herdr-core 0.1.18 installed there), and its tmux sessions work like the Mac's:

- The panel, search and Cmd+J list its panes as `flowstate-remote/<session>`. `omo-status` on the Mac reads them by running the server's own `omo-status` through `hc exec --on flowstate-remote`.
- Opening one shows the Herdr tab already on its session, or makes a space for it on the server. The layers button makes spaces for its sessions too; the automatic syncs don't, so no server session is attached from Herdr, and resized, unless you ask.
- On the server, `~/.local/bin/omo-status` links to the dotfiles clone's, and `.tmux-server.conf` runs its `sync` and `focus` hooks. The server's own `~/.local/bin/omo-notify`, which is not in this repo (the earlier one is kept as `omo-notify.bak-20261107`), calls `omo-status set` on every omo event. A tmux client in a Herdr terminal there gets the same OSC 7501 report as on the Mac and no `omo:` title.
- Its ntfy push carries a `herdr` tag when a Herdr terminal shows the session, and `omo-remote` on the Mac then leaves the sound and banner to Herdr.

A session attached from mosh and from Herdr at once is sized to the client used last.

## Watch out

- Herdr hot-reloads a mod when it sees the mod's files change, and it doesn't see edits made through the link. After editing `mods/omo-tmux/`, switch layouts away and back (Cmd+Shift+L) or restart Herdr. Check a mod with `herdr-app check ~/.config/herdr-app/mods/omo-tmux`.
- Herdr writes `gpui-kit.d.ts` and `jsconfig.json` into the mod folder, through the link. They are gitignored.
- Changing settings in Herdr's Settings window may replace the `settings.json` link with a plain file. If `ls -l ~/.config/herdr-app/settings.json` no longer shows a link, copy the changes here and run `setup-mac.sh links`.
- Herdr runs tmux without a UTF-8 locale, so the panel runs `tmux -u` and splits fields on `|^|`: tmux prints control characters as `_`.
