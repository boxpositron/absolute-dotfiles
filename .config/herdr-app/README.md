# Herdr

Herdr's desktop app (`herdr-app`, with herdr-core as `hc`) as the window around tmux. tmux stays as it is: each Herdr tab runs a tmux client (`tma <session>`), and Herdr adds the theme, the agents list and its sounds and toasts around it.

## Files

`setup-mac.sh links` links these into `~/.config/herdr-app/`, which holds everything else Herdr writes:

- `settings.json`: Catppuccin Mocha and Latte for layouts without a theme of their own, following the system's light or dark mode; JetBrainsMono Nerd Font 14 like Ghostty; omo's own `omo-done` and `omo-input` sounds for Herdr's done and blocked alerts; telemetry off.
- `themes/catppuccin-mocha.json`, `themes/catppuccin-latte.json`: terminal colours from Catppuccin's Ghostty palettes, plus Herdr panel and status colours from the same palette (blue working, yellow needs you, green done).
- `themes/netrunner.json`: the `netrunner` layout's own cyberpunk theme (Settings offers it only there): near-black blue terminals, neon ANSI colours, hot pink accent and focus border, cyan working, Cyberpunk yellow needs you, green done. Dark only, whatever the system's mode.
- `programs.json`: omo with its own name and icon, and in the + menu to start it in a pane of its own.
- `layouts/netrunner.json`: Herdr's main layout, cloned from 0.1.13 (called `tmux` until 2026-11-11), with the "omo in tmux" panel under the agents list and the sidebar from `workspace-chrome-tmux`, in the `netrunner` theme with near-square pane corners, a purple sidebar gradient and a cyan divider. Herdr no longer updates a cloned layout, so changes to `main` in later releases don't reach it. Switch layouts with Cmd+Shift+L.
- `mods/omo-tmux/`: the "omo in tmux" panel.
- `mods/picker-tmux/`: Herdr's search ("Go to…") with tmux sessions and panes added, cloned from Herdr's `picker` in 0.1.13.
- `mods/workspace-chrome-tmux/`: Herdr's sidebar header and footer, cloned from `workspace-chrome` in 0.1.13, whose search button opens `picker-tmux`. It uses the shipped mod's icons, since Herdr loads no images through the link.
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

Herdr sees a tmux client as one terminal, so its agents list has one row per tmux session. The panel lists every pane running omo in every tmux session, grouped by session: project and window name, state, and message, read every two seconds with `omo-status list`. A click runs `omo-status show <pane>` (see Spaces).

`omo-status list` finds omo by its process (bun running senpi's CLI) on each pane's terminal, so a pane shows as soon as omo runs in it, idle until omo's hooks report for it, and goes when omo exits. A pane running mosh or ssh shows the remote session's state, which its terminal title brought.

Inside each session the panes that need you come first, then finished, working, background and idle ones. A pane whose turn is over but whose work still runs shows a slower, purple spinner and what it is running (`Watching: staging deploy`, `Running: gh pr checks 13 (+1 more)`, `goal · waiting on CI watch`). A pane with a `schedule_prompt` job counts down to its wake-up, and a parked goal counts down too (`goal continues in 3:34 · waiting on CI watch`): omo stores that time nowhere, so `omo-status` reads it from the footer omo draws in the pane. Herdr's own Agents list can't count down, so there it reads in whole minutes and changes once a minute. Each row shows how long the pane has been in its state (`@omo_since`, which `omo-status` sets on every change). The panel moves the way herdr-t3-inbox does: a row whose place changes slides there, a new one fades in from above, one that goes fades out where it was, all over 150ms ease-out. "Needs you" and "Failed" pulse, and a pane that has just finished flashes green once and fades over 1.5s.

## Search

In the `netrunner` layout, Cmd+P and the sidebar's search button open `picker-tmux`: Herdr's "Go to…" list of tabs and spaces, plus tmux. With nothing typed, tmux's sessions fold into one "tmux: N sessions" row; click it to list them. Typing matches sessions by name and panes by window name, program, folder or omo message, so `riga` finds the prawnwire pane working in the riga worktree. Enter or a click shows the session's current pane, or the pane, through `omo-status show`, as the "omo in tmux" panel does. Every tmux pane is searchable, not only omo's. The selection is one highlight that slides to the row you pick, by arrow keys or by moving the pointer (a list scrolling under a still pointer doesn't move it), and "needs you" marks pulse.

The cloned picker, sidebar chrome and layout don't get Herdr's later changes to the shipped ones. To pick those up, clone again from the new release and carry the tmux additions over.

## Spaces

A tmux session can have a Herdr space of its own, named after it and running a tmux client attached to it. Its terminal is then an agent in Herdr's Agents list with the session's omo status, and the space shows in the sidebar like any project.

- `omo-status show <pane>` (the panel and search use it) focuses the Herdr tab already on the pane's session. Without one, it opens a tab attached to the session in the space named after it, or makes that space in the pane's folder. It never moves a tmux client you have open to another session.
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
- A pane can go without omo saying so: `owt done` kills its window, or the pane dies. tmux's `window-unlinked`, `pane-exited` and `after-kill-pane` hooks run `omo-status refresh`, which works out each session still reporting an agent again, so no session keeps reporting a pane that's gone.
- Spaces sync by themselves: omo's start hook runs `omo-status spaces --local` when Herdr is running, and tmux's `session-closed` hook closes the space of a session that ended. `--local` opens spaces only for this Mac's sessions; the layers button opens them for every machine's. A lock keeps two syncs from overlapping.
- tmux marks a client in a Herdr terminal focused even while its space is hidden, since Herdr sends it no focus-out, so `omo-status` doesn't count Herdr clients as looking at a pane. Going to a pane through the panel, search or Cmd+J clears it instead.

## Board

Cmd+Shift+B in the `netrunner` layout, or the screen button in the "omo in tmux" panel's header, opens the board (`mods/omo-board`): every omo session on every machine the omo board knows, read every five seconds from agent-state (`127.0.0.1:4747`, through the omo board's tunnel). Sessions sit in five columns: Needs you (an open question or a blocked goal, oldest first), Working, Background (the turn is over but a build, watcher or child session still runs), Done (finished in the last day) and Idle. A card shows the session's title, its machine, project and tmux target, the question waiting or the "For you" part of its last report, its to-do progress, and a dot for how recently it was active: hot under an hour, warm under a day, dim after that. A click runs `omo-status open`, which shows the session in its Herdr space, or a new one, server sessions included. Sessions not in tmux can't be shown from here.

Telegram's "Open on Mac" button (omo-assistant) runs the same `omo-status open` on the Mac through the board, and brings Herdr forward. `omo-presence` tells omo-assistant whether you are at the Mac (Herdr in front, screen unlocked, keyboard or mouse used in the last five minutes); while you are, it keeps a session's questions and errors off Telegram, since Herdr alerts you.

## Preview

`mods/preview` shows a file beside your terminal:

- Markdown rendered, with a Rendered/Source toggle; HTML the same way.
- Images fitted to the pane, never enlarged; HEIC and TIFF are converted first.
- Text and code with line numbers and highlighting. Compact JSON (three lines or fewer) is pretty-printed. Files over 1 MB or 20,000 lines show their start, and say so.
- Word, RTF and similar documents through `textutil`; PDFs page by page (the first 20 pages); Keynote, Numbers, PowerPoint and Excel files through Quick Look.
- Folders as a list you can click through, and anything else as an info card.

The header copies the path (Cmd+Shift+C), reveals the file in Finder (Cmd+Shift+R), opens it in its default app (Cmd+O) and reloads it (Cmd+R). It also reloads by itself when the file changes. For text, code, Markdown, HTML files and folders, Edit (Cmd+E) opens nvim in a terminal below the preview, in the file's folder, so the preview follows each save. nvim starts through your interactive login shell, so it has what your terminals have; started bare, it lacks `XDG_CONFIG_HOME` from `.zshrc` and the nvim config's WezTerm theme sync fails.

Open it with `herdr-preview <path>`, a split beside the terminal you run it in (`--tab` for a tab of its own), or Ctrl+click a Markdown, image, PDF or document path in a tmux pane inside Herdr (`tmux-open-path`). Ctrl+click anywhere on a Markdown link or image in a pane, `[label](target)` or `![alt](target)`, opens its target. omo draws a link as `label (target)`, and Ctrl+click on the label opens the target too; omo draws an image link as its alt text only, so it has no path to click. Outside Herdr, Ctrl+click keeps its old routes. Herdr has no setting for what its own Cmd+click does with file paths.

Watch out:

- Herdr's `image()` only loads files inside `~/.config/herdr-app`, so images, converted images and PDF pages are copied into `~/.config/herdr-app/preview-cache`, outside this repo and pruned after 7 days.
- Herdr's Markdown view draws no images: an image in Markdown shows as an "Image: alt" link that opens it in the preview. Bold and italic showed as plain text in testing.
- Code doesn't wrap, so columns stay aligned; long lines scroll sideways.
- An open preview pane keeps running its old code after `main.js` changes, even after a layout switch: close and reopen it.

## Herdr updates

`herdr-tmux-update` carries our copies onto a new Herdr: it keeps Herdr's own versions we copied from in `base/`, merges what Herdr changed since into `picker-tmux`, `workspace-chrome-tmux` and the `netrunner` layout with `git merge-file`, and checks the mods. A conflict leaves `<<<<<<<` blocks to settle by hand.

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
