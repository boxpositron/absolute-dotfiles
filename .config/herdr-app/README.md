# Herdr

Herdr's desktop app (`herdr-app`, with herdr-core as `hc`) as the window around tmux. tmux stays as it is: each Herdr tab runs a tmux client (`tma <session>`), and Herdr adds the theme, the agents list and its sounds and toasts around it.

## Files

`setup-mac.sh links` links these into `~/.config/herdr-app/`, which holds everything else Herdr writes:

- `settings.json`: Catppuccin Mocha and Latte, following the system's light or dark mode; JetBrainsMono Nerd Font 14 like Ghostty; omo's own `omo-done` and `omo-input` sounds for Herdr's done and blocked alerts; telemetry off.
- `themes/catppuccin-mocha.json`, `themes/catppuccin-latte.json`: terminal colours from Catppuccin's Ghostty palettes, plus Herdr panel and status colours from the same palette (blue working, yellow needs you, green done).
- `programs.json`: omo with its own name and icon, and in the + menu to start it in a pane of its own.
- `layouts/tmux.json`: Herdr's main layout, cloned from 0.1.13, with the "omo in tmux" panel under the agents list and the sidebar from `workspace-chrome-tmux`. Herdr no longer updates a cloned layout, so changes to `main` in later releases don't reach it. Switch layouts with Cmd+Shift+L.
- `mods/omo-tmux/`: the "omo in tmux" panel.
- `mods/picker-tmux/`: Herdr's search ("Go to…") with tmux sessions and panes added, cloned from Herdr's `picker` in 0.1.13.
- `mods/workspace-chrome-tmux/`: Herdr's sidebar header and footer, cloned from `workspace-chrome` in 0.1.13, whose search button opens `picker-tmux`. It uses the shipped mod's icons, since Herdr loads no images through the link.
- `keys.json`: Herdr's default keys, plus Cmd+P opening `picker-tmux` in the `tmux` layout. Herdr stops adding its new default shortcuts to a `keys.json` you have edited, so add new ones here by hand.
- `omo.svg`: omo's icon. It is copied, not linked: Herdr loads a program icon only from a real file in its folder.

## omo's status in Herdr

Herdr knows an agent's state only when the program reports it with OSC 7501 (the [Program Status Protocol](https://www.superlogical.com/rex/docs/build/program-status)), and omo inside tmux can't report through tmux. `omo-status` reports for it instead. A tmux client whose environment holds `HC_TERMINAL_ID` runs in a Herdr terminal, so omo-status sends that client its session's most urgent state, from every omo pane in the session:

| omo | Herdr |
| --- | --- |
| working on a prompt | working |
| asked you something | blocked (question) |
| finished | done |
| stopped with an error | error |
| at rest, or you've looked | idle |

The message names the project and the task, the first line of the prompt: `studio: Finished: fix the imap timeouts`. tmux's `client-attached` and `client-session-changed` hooks send it again when a client arrives or switches session. omo running straight in a Herdr pane, outside tmux, reports to its own terminal. Where Herdr shows the session, `omo-notify` plays no sound and posts no banner of its own, and Herdr plays omo's sounds. Ghostty tabs work as before, and Ghostty gets no reports.

## The "omo in tmux" panel

Herdr sees a tmux client as one terminal, so its agents list has one row per tmux session. The panel lists every pane running omo in every tmux session, grouped by session: project and window name, state, and message, read every two seconds with `omo-status list`. A click runs `omo-status show <pane>` (see Spaces).

`omo-status list` finds omo by its process (bun running senpi's CLI) on each pane's terminal, so a pane shows as soon as omo runs in it, idle until omo's hooks report for it, and goes when omo exits. A pane running mosh or ssh shows the remote session's state, which its terminal title brought.

Inside each session the panes that need you come first, then finished, working and idle ones. Each row shows how long the pane has been in its state (`@omo_since`, which `omo-status` sets on every change). The panel moves the way herdr-t3-inbox does: a row whose place changes slides there, a new one fades in from above, one that goes fades out where it was, all over 150ms ease-out. "Needs you" and "Failed" pulse, and a pane that has just finished flashes green once and fades over 1.5s.

## Search

In the `tmux` layout, Cmd+P and the sidebar's search button open `picker-tmux`: Herdr's "Go to…" list of tabs and spaces, plus tmux. With nothing typed, tmux's sessions fold into one "tmux: N sessions" row; click it to list them. Typing matches sessions by name and panes by window name, program, folder or omo message, so `riga` finds the prawnwire pane working in the riga worktree. Enter or a click shows the session's current pane, or the pane, through `omo-status show`, as the "omo in tmux" panel does. Every tmux pane is searchable, not only omo's. The selection is one highlight that slides to the row you pick, by arrow keys or by moving the pointer (a list scrolling under a still pointer doesn't move it), and "needs you" marks pulse.

The cloned picker, sidebar chrome and layout don't get Herdr's later changes to the shipped ones. To pick those up, clone again from the new release and carry the tmux additions over.

## Spaces

A tmux session can have a Herdr space of its own, named after it and running a tmux client attached to it. Its terminal is then an agent in Herdr's Agents list with the session's omo status, and the space shows in the sidebar like any project.

- `omo-status show <pane>` (the panel and search use it) focuses the Herdr tab already on the pane's session. Without one, it opens a tab attached to the session in the space named after it, or makes that space in the pane's folder. It never moves a tmux client you have open to another session.
- `omo-status spaces`, or the layers button in the panel's header, makes a space for every tmux session running omo that no Herdr tab shows, closes the spaces it made for sessions that have ended, and puts you back where you were. The spaces it made are listed in `~/.local/state/omo-status/spaces`.
- In Herdr outside tmux, `owt` opens each workspace as a space of its own, named after its title. Herdr's sidebar nests it under the repo's space when that is open.

A session attached in Ghostty and in Herdr at once is sized to whichever client you used last (tmux's default `window-size latest`).

## Attention

- The panel is an inbox: panes that need you, failed, finished or are working, with idle ones folded into an "N idle" row that opens them.
- Cmd+J in the `tmux` layout (`omo-tmux.next` in `keys.json`, `omo-status next` from a shell) shows the pane that most needs you: a question or a failure, then a finished turn, the longest waiting first. Looking at it clears it, so pressing again moves on.
- Herdr's agents list reads "<space> · <work>": `omo-status` names a session's Herdr tab after its most urgent pane's window (an `owt` title) or task, and sends it as the report's OSC 7501 `title`. Only tabs still called by their number, or by the label it set, change.
- omo sends no Stop hook while a background task (a terminal monitor, a child session) is live, so a finished turn could stay "working". `omo-notify` records each pane's transcript (`@omo_transcript`), and `omo-status list` turns a working pane idle when the transcript's last `session-lifecycle` state is `waiting_*`.
- Spaces sync by themselves: omo's start hook runs `omo-status spaces --local` when Herdr is running, and tmux's `session-closed` hook closes the space of a session that ended. `--local` opens spaces only for this Mac's sessions; the layers button opens them for every machine's. A lock keeps two syncs from overlapping.
- tmux marks a client in a Herdr terminal focused even while its space is hidden, since Herdr sends it no focus-out, so `omo-status` doesn't count Herdr clients as looking at a pane. Going to a pane through the panel, search or Cmd+J clears it instead.

## Herdr updates

`herdr-tmux-update` carries our copies onto a new Herdr: it keeps Herdr's own versions we copied from in `base/`, merges what Herdr changed since into `picker-tmux`, `workspace-chrome-tmux` and the `tmux` layout with `git merge-file`, and checks the mods. A conflict leaves `<<<<<<<` blocks to settle by hand.

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
