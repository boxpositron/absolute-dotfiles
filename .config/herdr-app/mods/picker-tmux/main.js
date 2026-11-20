// Go to a tab, a space or a tmux session: Cmd+P in the netrunner layout, and the sidebar's search
// button. A popup a little above the middle of the window (mod.json: 170 px down), so the search
// field stays put while the list shrinks as you type.
// picker-tmux: Herdr's picker (cloned from `picker` 0.1.13) with tmux added, and a look of its own.
//
// With nothing typed: the spaces with something running (what needs you first, the tab you are on
// selected), quiet spaces folded into one row, then each machine's tmux sessions that no Herdr
// terminal shows yet (this Mac, then each connected Herdr machine), then new tab and new space.
// Typing filters tabs by space, tab or agent name, tmux sessions by name and their panes by window,
// program, folder or omo message, and offers to create a tmux session of that name, on this Mac or
// a machine. When nothing else matches that offer comes first and is selected, so a name and Enter
// start the session in your home folder and attach it in a space of its own.
// Going to a session or a pane runs `omo-status show` (the Herdr tab already on the session, else a
// tab in the space named after it, else a new space); creating runs `omo-status session`.
// Typed text can also start an omo task, as the omo assistant does: a sentence ("set up remotion")
// offers it first. Then the picker asks where it runs: a new tmux session (named after the task's
// first word that isn't filler, or what you type), a new omo window in an existing tmux session, or a running omo
// session it is handed to. Places whose names share a word with the task come first. It runs
// `omo-sessions start` or `omo-sessions handoff` on that machine and shows the pane.
// ↑/↓ and Enter, or the pointer; Ctrl+D closes the selected tab; Esc leaves (or goes back from "where").
// Tab mode (`omo-status tabs`): each tmux window has a Herdr tab, whose client is on "<session>~<window id>". The picker
// finds the window each tab shows (shared "tmux.tabs", which the sidebar's tree keeps), so a tab matches and shows its
// window's work, a pane its tab already shows isn't listed again, and with nothing typed only the tabs with something
// going on (and yours) are listed, the quiet ones folded.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, spaces, panes, terminals, run, hc, exec, home, theme, settings, props, closeOverlay, shared, setShared, notify } from "herdr";
import { INK, isHud, spinner, display, frame, modalFrame, caps, title as hudTitle } from "./hud.js";

// The popup's own fill in ash: the theme's popover without its alpha, so the list never shows through.
const solid = (c) => (typeof c === "string" && c.length === 9 ? c.slice(0, 7) : c);

const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
// Another machine's things, as the Agents tree marks them.
const REMOTE = "#fcee0a";

// Space colors, kept by space id in shared "space.colors": a theme
// color name ("ansi6") or a picked #rrggbb. A space seen without one gets
// the theme color fewest spaces use, once; every mod does the same in the
// same order, so they agree, and adding or renaming spaces moves nothing.
const PROJECT_COLORS = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
function spaceColors() {
  const ids = new Set(spaces().map((p) => p.id));
  const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
  let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
  for (const p of spaces()) {
    if (kept[p.id] || p.name === "~") continue;
    const uses = (c) => Object.values(kept).filter((v) => v === c).length;
    kept[p.id] = PROJECT_COLORS.reduce((best, c) => (uses(c) < uses(best) ? c : best));
    changed = true;
  }
  if (changed) setShared("space.colors", kept);
  return kept;
}
// Every tmux pane (`omo-status panes`) and session (`omo-status sessions`), here and on Herdr
// machines ("server/%3", "server/main"). tmux turns control characters in
// its output into "_" when Herdr runs it, so fields split on text.
const SEP = "|^|";
// omo-status's states in Herdr's words.
const OMO = { working: "working", background: "background", input: "blocked", error: "blocked", done: "done", partial: "partial", idle: "idle" };
const RANK = { blocked: 5, done: 4, partial: 4, working: 3, background: 2, idle: 1 };
// Each row's height. Rows sit at fixed y, so the selection is one highlight that slides between them.
const H = { section: 30, ctx: 34, earlier: 34, tsession: 36, tpane: 32, create: 40, action: 34, note: 34, task: 40, tnew: 40, tstart: 36, thand: 32 };
const PICK = new Set(["ctx", "earlier", "tsession", "tpane", "create", "action", "task", "tnew", "tstart", "thand"]);
const MAX_LIST = 560;

// tmux sessions in tmux's order, each with its panes and the pane it shows.
function tmuxSessions(stdout) {
  const sessions = new Map();
  for (const line of stdout.split("\n")) {
    const [pane, session, attached, windowIndex, window, windowActive, paneIndex, paneActive, command, path, state, ...msg] = line.split(SEP);
    if (!pane) continue;
    const s = sessions.get(session) ?? { name: session, attached: attached !== "0", panes: [], windows: new Set(), current: null, status: null };
    const p = { pane, window, windowIndex, paneIndex, command, folder: (path ?? "").split("/").filter(Boolean).pop() ?? "~", status: OMO[state] ?? null, msg: msg.join(SEP) };
    s.panes.push(p);
    s.windows.add(windowIndex);
    if (windowActive === "1" && paneActive === "1") s.current = p;
    if ((RANK[p.status] ?? 0) > (RANK[s.status] ?? 0)) s.status = p.status;
    sessions.set(session, s);
  }
  return [...sessions.values()].map((s) => ({ ...s, current: s.current ?? s.panes[0] }));
}

// "<[machine/]name>|^|<windows>|^|<clients>|^|<shown in Herdr>|^|<folder>|^|<activity>" lines.
function tmuxList(stdout) {
  return stdout.split("\n").filter(Boolean).map((line) => {
    const [key, windows, clients, shown, folder, activity] = line.split(SEP);
    const i = key.indexOf("/");
    return {
      key, name: i >= 0 ? key.slice(i + 1) : key, machine: i >= 0 ? key.slice(0, i) : null,
      windows: Number(windows) || 0, clients: Number(clients) || 0, shown: shown === "1", folder: folder ?? "", activity: Number(activity) || 0,
    };
  });
}

// What a typed name becomes as a tmux session name: tmux turns "." and ":" into "_", and
// omo-status splits on spaces, so spaces become dashes and other characters go.
function sessionName(text) {
  return text.trim().replace(/[\s.:/]+/g, "-").replace(/[^A-Za-z0-9_-]/g, "").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
}

// The words of a task that can name a place: no fillers like "let's get started setting up".
const FILLER = new Set("a an and the to of in on for with from into up set setting get getting started start starting begin lets let us we our my me you can could please work working task new make build add fix do some it this that".split(" "));
function taskWords(text) {
  return [...new Set(text.toLowerCase().replace(/'/g, "").split(/[^a-z0-9_-]+/))].filter((w) => w.length >= 3 && !FILLER.has(w));
}

function ago(sec) {
  const s = Math.max(0, Date.now() / 1000 - sec);
  if (!sec) return "";
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// "~/…/Code/stockhut": the home folder as ~, and only the last two folders of a deep path.
function shortPath(folder, machine) {
  const h = home();
  let p = machine ? folder.replace(/^\/home\/[^/]+|^\/root(?=\/|$)/, "~") : folder === h ? "~" : folder.startsWith(`${h}/`) ? `~${folder.slice(h.length)}` : folder;
  const parts = p.split("/");
  if (parts.length > 4) p = `${parts[0]}/\u2026/${parts.slice(-2).join("/")}`;
  return p;
}

function spaceColor(t, p) {
  if (p.name === "~") return t.dim;
  const c = spaceColors()[p.id] ?? PROJECT_COLORS[0];
  return c.startsWith("#") ? c : (MARK[c] ?? t[c]);
}

// Who each row is, across renders, for the row that is busy opening.
function rowKey(r) {
  if (!r) return null;
  if (r.kind === "ctx") return `ctx:${r.ctx.id}`;
  if (r.kind === "tsession") return `ts:${r.s.key}`;
  if (r.kind === "tpane") return `tp:${r.p.pane}`;
  if (r.kind === "create") return `new:${r.machine ?? ""}:${r.name}`;
  if (r.kind === "tnew") return `tnew:${r.machine ?? ""}:${r.name}`;
  if (r.kind === "tstart") return `tstart:${r.s.key}`;
  if (r.kind === "thand") return `thand:${r.p.pane}`;
  return r.kind;
}

// omo-sessions on the machine the place is on.
function omoSessions(machine, args) {
  return machine
    ? exec("sh", ["-c", 'exec "$HOME/.local/bin/omo-sessions" "$@"', "omo-sessions", ...args], { on: machine })
    : exec(`${home()}/.local/bin/omo-sessions`, args);
}

export default class Picker extends View {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "Go to a tab, space or tmux session, or name a new session\u2026" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value();
      this.at = this.filter.trim() ? this.preferred() : null;
      cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.go(this.pickable()[this.at], cx));
    // The second step, once a task is chosen: where it runs.
    this.task = null;
    this.whereFilter = "";
    this.where = InputState.new({ placeholder: "Where should it run? Filter, or name a new tmux session\u2026" });
    this.where.on("change", (_e, cx) => {
      this.whereFilter = this.where.value();
      this.at = 0;
      cx.notify();
    });
    this.where.on("submit", (_e, cx) => this.go(this.pickable()[this.at], cx));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.at = null;
    this.scroll = 0;
    this.showEarlier = false;
    this.tmux = [];
    this.sessions = [];
    this.loaded = { panes: false, sessions: false };
    this.machines = [];
    this.busy = null;
    const load = (what, parse) => cx.spawn(async (cx) => {
      try {
        const r = await exec(`${home()}/.local/bin/omo-status`, [what]);
        if (r.code === 0) parse(r.stdout);
      } catch {}
      this.loaded[what] = true;
      // A name typed before the list came keeps the best row for it selected.
      if (this.filter.trim()) this.at = this.preferred();
      cx.notify();
    });
    load("panes", (out) => { this.tmux = tmuxSessions(out); });
    load("sessions", (out) => { this.sessions = tmuxList(out); });
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => m.state === "connected" && !m.temporary).map((m) => m.name);
      } catch {}
      cx.notify();
    });
  }

  // The tmux window a tab shows in tab mode (shared "tmux.tabs"): its session (from `panes`), the window's index and
  // its panes. Null for a tab that isn't a tab mode tab.
  tabWindow(ctx) {
    const tabs = shared("tmux.tabs") ?? {};
    for (const p of panes()) {
      const w = p.tab === ctx.id && p.terminal ? tabs[p.terminal] : null;
      if (!w?.tabbed) continue;
      const s = this.tmux.find((x) => x.name === w.session);
      if (s) return { s, index: w.index, panes: s.panes.filter((x) => x.windowIndex === w.index) };
    }
    return null;
  }

  close() {
    closeOverlay(props().overlay);
  }

  // Sessions with what `panes` knows of them: their omo state and the pane each shows. Without
  // `sessions` (an older omo-status), the panes alone.
  sessionList() {
    const byKey = new Map(this.tmux.map((s) => [s.name, s]));
    const list = this.sessions.length ? this.sessions : this.tmux.map((s) => tmuxList(`${s.name}${SEP}${s.windows.size}${SEP}${s.attached ? 1 : 0}${SEP}0${SEP}${SEP}0`)[0]);
    return list.map((x) => {
      const s = byKey.get(x.key);
      return { ...x, panes: s?.panes ?? [], current: s?.current ?? null, status: s?.status ?? null };
    });
  }

  rows() {
    if (this.task) return this.whereRows();
    const typed = this.filter.trim(), f = typed.toLowerCase();
    const all = agents();
    const live = terminals().filter((x) => x.state === "live");
    const teamOf = (addrs) => {
      let n = 0;
      const walk = (a) => live.filter((x) => x.parent === a).forEach((k) => (n++, walk(k.address)));
      addrs.forEach(walk);
      return n;
    };
    // The tmux windows tabs show (tab mode), as "<session>\0<window index>": their panes aren't listed again.
    const tabbed = new Set();
    const ctxs = spaces().flatMap((w) => w.tabs.map((ctx) => {
      const mine = all.filter((a) => a.tab === ctx.id);
      const win = this.tabWindow(ctx);
      if (win) tabbed.add(`${win.s.name}\u0000${win.index}`);
      return { w, ctx, mine, team: teamOf(mine.map((a) => a.address)), win, pane: win?.panes.find((p) => p.status) ?? win?.panes[0] ?? null };
    })).filter((c) => !f || [c.w.name, c.ctx.name, ...c.mine.map((a) => a.program?.name ?? ""),
      ...(c.win?.panes ?? []).flatMap((p) => [p.window, p.command, p.folder, p.msg])].join(" ").toLowerCase().includes(f));
    // A tab with something going on (an agent working, finished or waiting on you) is listed, and the one you are on;
    // the quiet ones, idle agents included, fold. What needs you comes first; otherwise Herdr's order stays.
    const here = (c) => c.w.active && c.ctx.active;
    const going = (c) => c.ctx.status && c.ctx.status !== "idle";
    const busy = ctxs.filter((c) => going(c) || here(c));
    const quiet = ctxs.filter((c) => !going(c) && !here(c));
    busy.sort((a, b) => (b.ctx.status === "blocked") - (a.ctx.status === "blocked"));
    const out = [];
    // A sentence is most likely a task, so it leads; a single word is offered with the new things.
    const sentence = /\s/.test(typed);
    if (sentence) out.push({ kind: "section", label: "Task" }, { kind: "task", text: typed });
    const add = (c) => out.push({ kind: "ctx", ...c });
    if (busy.length || quiet.length) out.push({ kind: "section", label: "Spaces" });
    busy.forEach(add);
    if (quiet.length && f) quiet.forEach(add);
    else if (quiet.length) {
      out.push({ kind: "earlier", count: quiet.length });
      if (this.showEarlier) quiet.forEach(add);
    }

    // tmux, a section per machine: unshown sessions with nothing typed, every match once typing.
    const sessions = this.sessionList();
    const machines = [null, ...this.machines, ...sessions.map((s) => s.machine)].filter((m, i, a) => a.indexOf(m) === i);
    for (const machine of machines) {
      const mine = sessions.filter((s) => s.machine === machine);
      const hits = f
        ? mine.map((s) => ({ s, named: s.name.toLowerCase().includes(f), panes: s.panes.filter((p) => !tabbed.has(`${s.key}\u0000${p.windowIndex}`)
          && [p.window, p.command, p.folder, p.msg].join(" ").toLowerCase().includes(f)) }))
          .filter((h) => h.named || h.panes.length)
        : mine.filter((s) => !s.shown).map((s) => ({ s, panes: [] }));
      if (!hits.length) continue;
      const note = f ? `${hits.length} match${hits.length > 1 ? "es" : ""}` : `${hits.length} not in Herdr`;
      out.push({ kind: "section", label: "tmux", machine, note });
      for (const h of hits) {
        out.push({ kind: "tsession", s: h.s });
        h.panes.forEach((p) => out.push({ kind: "tpane", s: h.s, p }));
      }
    }
    if (!this.loaded.sessions || !this.loaded.panes) out.push({ kind: "note", text: "Looking for tmux sessions\u2026", spin: true });

    const name = sessionName(typed);
    // A sentence of three words or more is a task, not a session name.
    const where = name && this.loaded.sessions && typed.split(/\s+/).length < 3 ? [null, ...this.machines].filter((m) => !sessions.some((s) => s.machine === m && s.name === name)) : [];
    if (f && !out.some((r) => PICK.has(r.kind)) && !where.length) out.push({ kind: "note", text: name ? `No matches for \u201c${typed}\u201d` : "Session names take letters, digits, - and _" });
    out.push({ kind: "section", label: "New" });
    for (const m of where) out.push({ kind: "create", name, machine: m });
    if (typed && !sentence) out.push({ kind: "task", text: typed });
    out.push({ kind: "action", what: "tab" });
    out.push({ kind: "action", what: "space", machine: null });
    for (const m of this.machines) out.push({ kind: "action", what: "space", machine: m });
    return out;
  }

  // Where a task runs: places sharing a word with it first, then a new tmux session on each machine, an
  // existing session's new window, and running omo sessions to hand it to. What is typed filters them
  // and names the new session.
  whereRows() {
    const typed = this.whereFilter.trim(), f = typed.toLowerCase();
    const words = taskWords(this.task);
    const score = (text) => words.filter((w) => text.toLowerCase().includes(w)).length;
    const shown = (text) => !f || text.toLowerCase().includes(f);
    const sessions = this.sessionList();
    const machines = [null, ...this.machines, ...sessions.map((s) => s.machine)].filter((m, i, a) => a.indexOf(m) === i);
    const starts = sessions.filter((s) => shown(`${s.name} ${s.folder}`)).map((s) => ({ kind: "tstart", s, score: score(`${s.name} ${s.folder}`) }));
    const hands = sessions.flatMap((s) => s.panes.filter((p) => p.status).map((p) => ({ kind: "thand", s, p, text: `${s.name} ${p.window} ${p.folder} ${p.msg}` })))
      .filter((r) => shown(r.text)).map((r) => ({ ...r, score: score(r.text) }));
    const suggested = [...starts, ...hands].filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);
    const out = [];
    if (suggested.length) out.push({ kind: "section", label: "Suggested" }, ...suggested);
    const name = sessionName(typed) || sessionName(words[0] ?? "") || "task";
    const fresh = machines.filter((m) => !sessions.some((s) => s.machine === m && s.name === name));
    if (fresh.length) out.push({ kind: "section", label: "New tmux session" }, ...fresh.map((m) => ({ kind: "tnew", name, machine: m })));
    for (const [label, list] of [["Start in tmux", starts], ["Hand to omo", hands]]) {
      for (const machine of machines) {
        const mine = list.filter((r) => r.s.machine === machine && !suggested.includes(r));
        if (mine.length) out.push({ kind: "section", label, machine, note: `${mine.length}` }, ...mine);
      }
    }
    if (!this.loaded.sessions || !this.loaded.panes) out.push({ kind: "note", text: "Looking for tmux sessions\u2026", spin: true });
    return out;
  }

  pickable() {
    return this.rows().filter((r) => PICK.has(r.kind));
  }

  // The row Enter takes for what is typed: a task for a sentence, else a tab, a tmux session or pane, a
  // new session.
  preferred() {
    const p = this.pickable();
    for (const kind of ["task", "ctx", "tsession", "tpane", "create"]) {
      if (kind === "task" && !/\s/.test(this.filter.trim())) continue;
      const i = p.findIndex((r) => r.kind === kind);
      if (i >= 0) return i;
    }
    return 0;
  }

  go(r, cx) {
    if (!r || this.busy) return;
    if (r.kind === "earlier") {
      this.showEarlier = !this.showEarlier;
      this.at = this.pickable().findIndex((x) => x.kind === "earlier");
      this.input.focus();
      cx.notify();
      return;
    }
    if (r.kind === "tsession" || r.kind === "tpane") {
      const pane = r.kind === "tpane" ? r.p : r.s.current;
      return this.omo(r, pane ? ["show", pane.pane] : ["session", r.s.name, ...(r.s.machine ? [r.s.machine] : [])], cx);
    }
    if (r.kind === "create") return this.omo(r, ["session", r.name, ...(r.machine ? [r.machine] : [])], cx);
    if (r.kind === "task") return this.chooseWhere(r.text, cx);
    if (r.kind === "tnew") return this.startTask(r, r.machine, ["start", "--tmux", r.name, "--", this.task], cx);
    if (r.kind === "tstart") return this.startTask(r, r.s.machine, ["start", "--tmux", r.s.name, "--", this.task], cx);
    if (r.kind === "thand") return this.startTask(r, r.s.machine, ["handoff", r.p.pane.split("/").pop(), this.task], cx, r.p.pane);
    this.close();
    if (r.kind === "ctx") run("tab.select", { id: r.ctx.id });
    else if (r.what === "tab") run("tab.new");
    else run("space.new", { machine: r.machine ?? "" });
  }

  // The popup closes after the jump, which can take a few seconds while a new space attaches:
  // closing it first would cancel the task. The row spins meanwhile.
  omo(r, args, cx) {
    this.busy = rowKey(r);
    cx.notify();
    cx.spawn(async () => {
      let failed = null;
      try {
        const res = await exec(`${home()}/.local/bin/omo-status`, args);
        if (res.code !== 0) failed = res.stderr.trim() || `omo-status ${args[0]} stopped with code ${res.code}`;
      } catch (e) {
        failed = String(e?.message ?? e);
      }
      if (failed) notify({ title: r.kind === "create" ? `Could not create ${r.name}` : "Could not open the tmux session", body: failed, level: "error" });
      this.close();
    });
  }

  chooseWhere(text, cx) {
    this.task = text;
    this.where.set_value("");
    this.whereFilter = "";
    this.at = 0;
    this.scroll = 0;
    this.where.focus();
    cx.notify();
  }

  back(cx) {
    this.task = null;
    this.at = this.preferred();
    this.scroll = 0;
    this.input.focus();
    cx.notify();
  }

  // Starts the task (or hands it over) on the place's machine, then shows its pane: the one
  // `omo-sessions start` prints, or the running session's. The row spins meanwhile.
  startTask(r, machine, args, cx, pane) {
    this.busy = rowKey(r);
    cx.notify();
    cx.spawn(async () => {
      let failed = null;
      try {
        const res = await omoSessions(machine, args);
        if (res.code !== 0) failed = res.stderr.trim() || `omo-sessions ${args[0]} stopped with code ${res.code}`;
        else {
          const target = pane ?? `${machine ? `${machine}/` : ""}${res.stdout.trim().split("\n").pop()}`;
          const shown = await exec(`${home()}/.local/bin/omo-status`, ["show", target]);
          if (shown.code !== 0) failed = shown.stderr.trim() || `omo-status show stopped with code ${shown.code}`;
        }
      } catch (e) {
        failed = String(e?.message ?? e);
      }
      if (failed) notify({ title: r.kind === "thand" ? "Could not hand the task over" : "Could not start the task", body: failed, level: "error" });
      this.close();
    });
  }

  spinner(t, color) {
    return this.hud ? spinner(color ?? t.dim, 12, 900) : svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(color ?? t.dim).spin(900);
  }

  glyph(t, st) {
    if (st === "working") return this.hud ? spinner(t.working, 12, 900) : svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    if (st === "background") return this.hud ? spinner(t.ansi5, 12, 2400) : svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.ansi5).spin(2400);
    // partial: a step done with tasks still open (omo-status).
    return div().w(12).flex_none().text_color(st === "partial" ? t.done : t[st] ?? t.dim)
      .when(st === "blocked", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1600 }))
      .child(st === "idle" ? "\u25cb" : st === "partial" ? "\u25c9" : st ? "\u25cf" : "\u00b7");
  }

  // Names people chose, in the HUD's display face (keeping their case).
  disp(el, size, weight = 600) {
    return this.hud ? el.font_family(display()).font_weight(weight).text_size(size) : el;
  }

  // "on <machine>" at a row's end.
  onMachine(color, text) {
    return this.hud ? caps(text, 12, 600).flex_none().text_color(color) : div().flex_none().text_size(11).text_color(color).child(text);
  }

  tag(t, text, color) {
    if (this.hud) return div().relative().flex_none().h(18).px(7).flex().items_center().text_color(color)
      .children(frame(4, { line: color + "80" })).child(caps(text, 11.5, 700).relative());
    return div().flex_none().h(18).px(6).flex().items_center().rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(color).child(text);
  }

  keycap(t, text) {
    if (this.hud) return div().relative().flex_none().h(18).min_w(18).px(5).flex().items_center().justify_center().text_color(t.muted)
      .children(frame(4, { line: t.working + "99" })).child(caps(text, 11.5, 700).relative());
    return div().flex_none().h(18).min_w(18).px(4).flex().items_center().justify_center().rounded(4).border_1().border_color(t.border)
      .bg(t.background).text_size(10.5).text_color(t.muted).child(text);
  }

  hint(t, keys, label) {
    return h_flex().flex_none().gap(4).items_center().children(keys.map((k) => this.keycap(t, k))).child(div().pl(2).child(this.hud ? caps(label, 12, 600) : label));
  }

  enterLabel(r) {
    if (!r) return "open";
    if (r.kind === "ctx") return "go to tab";
    if (r.kind === "earlier") return this.showEarlier ? "fold quiet tabs" : "show quiet tabs";
    if (r.kind === "tsession") return r.s.shown ? "go to session" : "open in a space";
    if (r.kind === "tpane") return "go to pane";
    if (r.kind === "create") return "create and attach";
    if (r.kind === "task") return "choose where it runs";
    if (r.kind === "tnew") return "start in a new session";
    if (r.kind === "tstart") return "start omo here";
    if (r.kind === "thand") return "hand the task over";
    return r.what === "tab" ? "new tab" : "new space";
  }

  render() {
    const t = theme();
    this.hud = isHud();
    const rows = this.rows();
    const pickable = rows.filter((r) => PICK.has(r.kind));
    // Opens on where you are.
    if (this.at === null) this.at = Math.max(0, pickable.findIndex((r) => r.kind === "ctx" && r.w.active && r.ctx.active));
    this.at = Math.max(0, Math.min(this.at, pickable.length - 1));
    const sel = pickable[this.at];
    // One continuous strip: each row at a fixed y. Scrolling moves the strip only as far as it takes
    // to keep the selected row (and the titles right above it) in view.
    const tops = [];
    let y = 0;
    rows.forEach((r) => { tops.push(y); y += H[r.kind]; });
    const total = y + 8;
    const height = Math.min(MAX_LIST, total, this.listHeight ?? MAX_LIST);
    const maxScroll = Math.max(0, total - height);
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
    const si = rows.indexOf(sel);
    if (si >= 0) {
      let top = si;
      while (top > 0 && rows[top - 1].kind === "section") top--;
      if (tops[top] < this.scroll) this.scroll = tops[top];
      if (tops[si] + H[sel.kind] > this.scroll + height) this.scroll = tops[si] + H[sel.kind] - height;
    }
    const place = (el, i) => el.absolute().left(0).right(0).top(tops[i] - this.scroll).h(H[rows[i].kind]);
    const visible = (i) => tops[i] + H[rows[i].kind] > this.scroll && tops[i] < this.scroll + height;
    // Pointer movement picks the row under it; a list scrolling under a still pointer doesn't.
    const point = (r) => (_e, cx) => {
      const i = pickable.indexOf(r);
      if (i >= 0 && i !== this.at) {
        this.at = i;
        cx.notify();
      }
    };
    const busyKey = this.busy;
    // One highlight for the selection, sliding to it, with an accent edge.
    const highlight = si >= 0 && div().id("pk-sel").absolute().left(this.hud ? 0 : 6).right(this.hud ? 0 : 6).h(H[sel.kind] - 4).rounded(this.hud ? 0 : 7).bg(this.hud ? t.accent + "24" : t.selected)
      .top(tops[si] + 2 - this.scroll)
      .transition("top", { duration: 120, easing: "ease-out" })
      .child(div().absolute().left(0).top(this.hud ? 0 : 8).bottom(this.hud ? 0 : 8).w(this.hud ? 3 : 2).rounded(this.hud ? 0 : 1).bg(t.accent));

    const pickRow = (r, id) => h_flex().id(id).size_full().pr(16).gap(10).items_center().cursor_pointer()
      .on_mouse_move(point(r)).on_click((_e, cx) => this.go(r, cx));

    const row = (r) => {
      if (r.kind === "section") {
        if (this.hud) return h_flex().relative().size_full().px(16).pt(10).gap(8).items_center()
          .child(caps(r.label, 12.5, 700).text_color(t.muted))
          .when(r.machine !== undefined, (el) => el
            .child(div().w(1).h(11).bg(t.accent + "66"))
            .child(caps(r.machine ?? "This Mac", 12.5, 700).text_color(r.machine ? REMOTE : t.muted)))
          .child(div().flex_1())
          .when(Boolean(r.note), (el) => el.child(caps(r.note, 12, 600).text_color(t.dim)))
          .child(div().absolute().left(16).right(16).bottom(0).h(1).bg(t.accent + "26"));
        return h_flex().size_full().px(16).pt(10).gap(6).items_center().text_size(10.5).text_color(t.dim)
          .child(div().font_semibold().child(r.label.toUpperCase()))
          .when(r.machine !== undefined, (el) => el
            .child(div().child("\u00b7"))
            .child(div().font_semibold().text_color(r.machine ? REMOTE : t.muted).child((r.machine ?? "This Mac").toUpperCase())))
          .child(div().flex_1())
          .when(Boolean(r.note), (el) => el.child(div().text_size(11).child(r.note)));
      }
      if (r.kind === "note") {
        return h_flex().size_full().px(18).gap(10).items_center().text_size(12).text_color(t.dim)
          .child(r.spin ? this.spinner(t) : div().w(12))
          .child(r.text);
      }
      if (r.kind === "earlier") {
        return pickRow(r, "pk-earlier").pl(18).text_size(12).text_color(t.dim)
          .child(svg(this.showEarlier ? "mods/workspace-chrome/chevron-down.svg" : "mods/workspace-chrome/chevron-right.svg").size(12).flex_none())
          .child(this.hud ? caps(`${r.count} quiet tab${r.count > 1 ? "s" : ""}`, 12.5, 600) : `${r.count} quiet tab${r.count > 1 ? "s" : ""}`);
      }
      if (r.kind === "tsession") {
        const s = r.s, spinning = busyKey === rowKey(r);
        return pickRow(r, `pk-ts-${s.key}`).pl(18)
          .child(spinning ? this.spinner(t, t.accent) : s.status ? this.glyph(t, s.status) : svg("mods/workspace-chrome/terminal.svg").size(12).flex_none().text_color(t.dim))
          .child(this.disp(div().flex_none().max_w(220).truncate().text_color(t.foreground), 14.5).child(s.name))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim)
            .child(`${s.windows} window${s.windows === 1 ? "" : "s"}${s.folder ? `  \u00b7  ${shortPath(s.folder, s.machine)}` : ""}`))
          .when(s.shown, (el) => el.child(this.tag(t, "in Herdr", t.done)))
          .when(!s.shown && s.clients > 0, (el) => el.child(this.tag(t, "attached elsewhere", t.muted)))
          .child(div().w(26).flex_none().text_right().text_size(11).text_color(t.dim).child(ago(s.activity)));
      }
      if (r.kind === "tpane") {
        const p = r.p, spinning = busyKey === rowKey(r);
        const detail = [p.folder, p.command].filter((x) => x && x !== p.window).join(" \u00b7 ");
        return pickRow(r, `pk-tp-${p.pane}`).pl(40).gap(8)
          .child(spinning ? this.spinner(t, t.accent) : this.glyph(t, p.status))
          .child(this.disp(div().flex_none().max_w(180).truncate().text_size(12.5).text_color(t.foreground), 14).child(p.window))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(p.msg || ""))
          .when(Boolean(detail), (el) => el.child(div().flex_none().max_w(150).truncate().text_size(11).text_color(t.dim).child(detail)))
          .child(div().flex_none().text_size(10.5).text_color(t.dim).child(`${r.s.name}:${p.windowIndex}.${p.paneIndex}`));
      }
      if (r.kind === "create") {
        const spinning = busyKey === rowKey(r);
        return pickRow(r, `pk-create-${r.machine ?? "here"}`).pl(14)
          .child(h_flex().size(22).flex_none().rounded(this.hud ? 0 : 6).items_center().justify_center().bg((r.machine ? REMOTE : t.accent) + "26")
            .child(spinning ? this.spinner(t, r.machine ? REMOTE : t.accent) : svg("mods/workspace-chrome/plus.svg").size(13).text_color(r.machine ? REMOTE : t.accent)))
          .child(h_flex().flex_1().min_w(0).gap(6).items_center()
            .child(this.hud ? caps("Create tmux session", 13, 700).flex_none().text_color(t.muted) : div().flex_none().text_color(t.muted).child("Create tmux session"))
            .child(this.disp(div().min_w(0).truncate().font_semibold().text_color(t.foreground), 14.5).child(r.name)))
          .child(this.onMachine(r.machine ? REMOTE : t.dim, `on ${r.machine ?? "This Mac"}`));
      }
      if (r.kind === "task" || r.kind === "tnew") {
        const spinning = busyKey === rowKey(r), color = r.machine ? REMOTE : t.accent;
        return pickRow(r, r.kind === "task" ? "pk-task" : `pk-tnew-${r.machine ?? "here"}`).pl(14)
          .child(h_flex().size(22).flex_none().rounded(this.hud ? 0 : 6).items_center().justify_center().bg(color + "26")
            .child(spinning ? this.spinner(t, color) : svg(r.kind === "task" ? "mods/workspace-chrome/terminal.svg" : "mods/workspace-chrome/plus.svg").size(13).text_color(color)))
          .child(h_flex().flex_1().min_w(0).gap(6).items_center()
            .child(this.hud ? caps(r.kind === "task" ? "Start an omo task" : "New tmux session", 13, 700).flex_none().text_color(r.kind === "task" ? color : t.muted)
              : div().flex_none().text_color(t.muted).child(r.kind === "task" ? "Start an omo task" : "New tmux session"))
            .child((r.kind === "task" ? div() : this.disp(div(), 14.5)).min_w(0).truncate().font_semibold().text_color(t.foreground).child(r.kind === "task" ? `\u201c${r.text}\u201d` : r.name)))
          .child(r.kind === "task"
            ? h_flex().flex_none().gap(4).items_center().text_size(11).text_color(t.dim).child(this.hud ? caps("where", 12, 600) : "where").child(svg("mods/workspace-chrome/chevron-right.svg").size(11))
            : this.onMachine(r.machine ? REMOTE : t.dim, `on ${r.machine ?? "This Mac"}`));
      }
      if (r.kind === "tstart") {
        const s = r.s, spinning = busyKey === rowKey(r);
        return pickRow(r, `pk-tstart-${s.key}`).pl(18)
          .child(spinning ? this.spinner(t, t.accent) : svg("mods/workspace-chrome/terminal.svg").size(12).flex_none().text_color(s.machine ? REMOTE : t.dim))
          .child(this.disp(div().flex_none().max_w(220).truncate().text_color(t.foreground), 14.5).child(s.name))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(s.folder ? shortPath(s.folder, s.machine) : ""))
          .child(this.tag(t, "new omo window", t.muted))
          .when(Boolean(s.machine), (el) => el.child(div().flex_none().text_size(11).text_color(REMOTE).child(s.machine)));
      }
      if (r.kind === "thand") {
        const p = r.p, spinning = busyKey === rowKey(r);
        return pickRow(r, `pk-thand-${p.pane}`).pl(18).gap(8)
          .child(spinning ? this.spinner(t, t.accent) : this.glyph(t, p.status))
          .child(this.disp(div().flex_none().max_w(180).truncate().text_size(12.5).text_color(t.foreground), 14).child(p.window))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(p.msg || p.folder))
          .child(this.tag(t, "hand over", t.muted))
          .child(div().flex_none().text_size(10.5).text_color(r.s.machine ? REMOTE : t.dim).child(`${r.s.machine ? `${r.s.machine} ` : ""}${r.s.name}:${p.windowIndex}.${p.paneIndex}`));
      }
      if (r.kind === "ctx") {
        const who = r.mine.map((a) => a.program?.name ?? "agent").join(" \u00b7 ");
        const here = r.w.active && r.ctx.active;
        return pickRow(r, `pk-${r.ctx.id}`).pl(18)
          .child(this.glyph(t, r.ctx.status))
          .child(h_flex().w(136).flex_none().gap(7).items_center()
            .child(this.disp(h_flex().size(16).flex_none().rounded(this.hud ? 0 : 4).bg(spaceColor(t, r.w)).items_center().justify_center().text_size(9.5).font_bold().text_color(this.hud ? INK : "#ffffff"), 12, 700).child([...r.w.name][0]?.toUpperCase() ?? "?"))
            .child(this.disp(div().min_w(0).truncate().text_size(12).text_color(r.w.machine ? REMOTE : t.muted), 14).child(r.w.name)))
          .child(h_flex().flex_1().min_w(0).gap(8).items_center()
            .child(this.disp(div().flex_none().max_w(220).truncate().text_color(t.foreground).when(here, (d) => d.font_semibold()), 15, here ? 700 : 600).child(r.ctx.name))
            .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(r.pane?.msg || "")))
          .when(here, (el) => el.child(this.tag(t, "here", t.muted)))
          .when(r.ctx.status === "blocked", (el) => el.child(this.tag(t, "needs you", t.blocked)))
          .when(r.ctx.status === "done", (el) => el.child(this.tag(t, "finished", t.done)))
          .when(Boolean(who), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(who + (r.team ? `  +${r.team}` : ""))));
      }
      return pickRow(r, r.what === "tab" ? "pk-new" : `pk-space-${r.machine ?? "here"}`).pl(18).text_color(t.muted)
        .child(svg(r.what === "tab" ? "mods/workspace-chrome/plus.svg" : "mods/workspace-chrome/folder-plus.svg").size(13).flex_none().text_color(t.dim))
        .child((this.hud ? caps(r.what === "tab" ? "New tab" : "New space", 13, 600) : div().child(r.what === "tab" ? "New tab" : "New space")).flex_1())
        .when(Boolean(r.machine), (el) => el.child(this.onMachine(REMOTE, `on ${r.machine}`)));
    };

    const typing = Boolean(this.task ? this.whereFilter : this.filter);
    const lead = this.task
      ? div().id("picker-back").flex_none().cursor_pointer().on_click((_e, cx) => this.back(cx))
        .child(svg("mods/workspace-chrome/chevron-left.svg").size(16).text_color(t.accent))
      : svg("mods/workspace-chrome/search.svg").size(16).flex_none().text_color(typing ? t.accent : t.dim);
    const input = Input.new(this.task ? this.where : this.input).flex_1().h_full().text_size(14.5).text_color(t.foreground);
    const searching = !this.loaded.sessions || !this.loaded.panes;
    const esc = div().id("picker-esc").flex_none().cursor_pointer().on_click((_e, cx) => (this.task ? this.back(cx) : this.close())).child(this.keycap(t, "esc"));
    const rule = this.hud ? t.accent + "33" : t.border;
    return v_flex()
      .id("picker")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .text_size(13)
      // The popup is opened with frame "none", so it draws its own: Herdr's look in ash, the HUD's modal frame in netrunner.
      .when(!this.hud, (el) => el.bg(solid(t.popover)).border_1().border_color(t.border).rounded(10).overflow_hidden().shadow_2xl())
      .when(this.hud, (el) => el.relative().children(modalFrame(t, 14)))
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.task ? this.back(cx) : this.close();
        if (k === "down") this.at = (this.at + 1) % pickable.length;
        else if (k === "up") this.at = (this.at + pickable.length - 1) % pickable.length;
        else if (k === "d" && e.modifiers.control) {
          if (sel?.kind === "ctx") {
            this.close();
            run("tab.close", { id: sel.ctx.id });
          }
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().h(54).flex_none().px(16).gap(10).items_center().border_b(1).border_color(rule)
        .when(!this.hud, (el) => el.child(lead).child(input).when(searching, (e) => e.child(this.spinner(t))).child(esc))
        .when(this.hud, (el) => el.child(h_flex().relative().flex_1().h(38).px(12).gap(10).items_center()
          .children(frame(7, { bg: t.accent + "0d", line: t.accent + (typing || this.task ? "cc" : "66") }))
          .child(lead).child(input).when(searching, (e) => e.child(this.spinner(t, t.accent)))).child(esc)))
      .when(Boolean(this.task), (el) => el.child(h_flex().h(38).flex_none().px(16).gap(10).items_center().border_b(1).border_color(rule).bg(t.accent + "12")
        .child(this.hud ? hudTitle(t, "Task", 13) : div().flex_none().text_size(10.5).font_semibold().text_color(t.accent).child("TASK"))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(this.task ?? ""))))
      .child(
        v_flex()
          .id("pk-list")
          .relative()
          .on_size_change((size, cx) => {
            const h = size.height / settings().zoom;
            if (this.listHeight !== undefined && Math.abs(this.listHeight - h) < 1) return;
            this.listHeight = h;
            cx.notify();
          })
          .h(Math.min(MAX_LIST, total))
          .min_h(0)
          .overflow_hidden()
          .on_scroll_wheel((e, cx) => {
            this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, maxScroll));
            // The selection follows the wheel, so the next frame doesn't scroll back to it.
            while (this.at < pickable.length - 1 && tops[rows.indexOf(pickable[this.at])] < this.scroll) this.at++;
            while (this.at > 0 && tops[rows.indexOf(pickable[this.at])] + H[pickable[this.at].kind] > this.scroll + height) this.at--;
            cx.notify();
          })
          .children([highlight, ...rows.map((r, i) => (visible(i) ? place(row(r), i) : null))].filter(Boolean)),
      )
      .child(h_flex().h(36).flex_none().px(16).gap(14).items_center().border_t(1).border_color(rule).text_size(11).text_color(t.dim)
        .child(this.hint(t, ["\u2191", "\u2193"], "move"))
        .child(this.hint(t, ["\u21b5"], this.enterLabel(sel)))
        .when(sel?.kind === "ctx", (el) => el.child(this.hint(t, ["\u2303D"], "close tab")))
        .child(div().flex_1())
        .child(this.hint(t, ["esc"], this.task ? "back" : "close")));
  }
}
