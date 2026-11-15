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
// ↑/↓ and Enter, or the pointer; Ctrl+D closes the selected tab; Esc leaves.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, spaces, terminals, run, hc, exec, home, theme, settings, props, closeOverlay, shared, setShared, notify } from "herdr";

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
const H = { section: 30, ctx: 34, earlier: 34, tsession: 36, tpane: 32, create: 40, action: 34, note: 34 };
const PICK = new Set(["ctx", "earlier", "tsession", "tpane", "create", "action"]);
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
  return r.kind;
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
    const typed = this.filter.trim(), f = typed.toLowerCase();
    const all = agents();
    const live = terminals().filter((x) => x.state === "live");
    const teamOf = (addrs) => {
      let n = 0;
      const walk = (a) => live.filter((x) => x.parent === a).forEach((k) => (n++, walk(k.address)));
      addrs.forEach(walk);
      return n;
    };
    const groups = spaces().map((w) => {
      const ctxs = w.tabs
        .map((ctx) => {
          const mine = all.filter((a) => a.tab === ctx.id);
          return { w, ctx, mine, team: teamOf(mine.map((a) => a.address)) };
        })
        .filter((c) => !f || [w.name, c.ctx.name, ...c.mine.map((a) => a.program?.name ?? "")].join(" ").toLowerCase().includes(f));
      return { w, ctxs };
    });
    const busy = groups.filter((p) => p.w.status && p.ctxs.length);
    const quiet = groups.filter((p) => !p.w.status && p.ctxs.length);
    busy.sort((a, b) => (b.w.status === "blocked") - (a.w.status === "blocked"));
    const out = [];
    const add = (p) => {
      for (const c of p.ctxs) out.push({ kind: "ctx", ...c });
    };
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
        ? mine.map((s) => ({ s, named: s.name.toLowerCase().includes(f), panes: s.panes.filter((p) => [p.window, p.command, p.folder, p.msg].join(" ").toLowerCase().includes(f)) }))
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
    const where = name && this.loaded.sessions ? [null, ...this.machines].filter((m) => !sessions.some((s) => s.machine === m && s.name === name)) : [];
    if (f && !out.some((r) => PICK.has(r.kind)) && !where.length) out.push({ kind: "note", text: name ? `No matches for \u201c${typed}\u201d` : "Session names take letters, digits, - and _" });
    out.push({ kind: "section", label: "New" });
    for (const m of where) out.push({ kind: "create", name, machine: m });
    out.push({ kind: "action", what: "tab" });
    out.push({ kind: "action", what: "space", machine: null });
    for (const m of this.machines) out.push({ kind: "action", what: "space", machine: m });
    return out;
  }

  pickable() {
    return this.rows().filter((r) => PICK.has(r.kind));
  }

  // The row Enter takes for what is typed: a tab, else a tmux session or pane, else a new session.
  preferred() {
    const p = this.pickable();
    for (const kind of ["ctx", "tsession", "tpane", "create"]) {
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

  spinner(t, color) {
    return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(color ?? t.dim).spin(900);
  }

  glyph(t, st) {
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    if (st === "background") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.ansi5).spin(2400);
    // partial: a step done with tasks still open (omo-status).
    return div().w(12).flex_none().text_color(st === "partial" ? t.done : t[st] ?? t.dim)
      .when(st === "blocked", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1600 }))
      .child(st === "idle" ? "\u25cb" : st === "partial" ? "\u25c9" : st ? "\u25cf" : "\u00b7");
  }

  tag(t, text, color) {
    return div().flex_none().h(18).px(6).flex().items_center().rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(color).child(text);
  }

  keycap(t, text) {
    return div().flex_none().h(18).min_w(18).px(4).flex().items_center().justify_center().rounded(4).border_1().border_color(t.border)
      .bg(t.background).text_size(10.5).text_color(t.muted).child(text);
  }

  hint(t, keys, label) {
    return h_flex().flex_none().gap(4).items_center().children(keys.map((k) => this.keycap(t, k))).child(div().pl(2).child(label));
  }

  enterLabel(r) {
    if (!r) return "open";
    if (r.kind === "ctx") return "go to tab";
    if (r.kind === "earlier") return this.showEarlier ? "fold quiet spaces" : "show quiet spaces";
    if (r.kind === "tsession") return r.s.shown ? "go to session" : "open in a space";
    if (r.kind === "tpane") return "go to pane";
    if (r.kind === "create") return "create and attach";
    return r.what === "tab" ? "new tab" : "new space";
  }

  render() {
    const t = theme();
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
    const highlight = si >= 0 && div().id("pk-sel").absolute().left(6).right(6).h(H[sel.kind] - 4).rounded(7).bg(t.selected)
      .top(tops[si] + 2 - this.scroll)
      .transition("top", { duration: 120, easing: "ease-out" })
      .child(div().absolute().left(0).top(8).bottom(8).w(2).rounded(1).bg(t.accent));

    const pickRow = (r, id) => h_flex().id(id).size_full().pr(16).gap(10).items_center().cursor_pointer()
      .on_mouse_move(point(r)).on_click((_e, cx) => this.go(r, cx));

    const row = (r) => {
      if (r.kind === "section") {
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
          .child(`${r.count} quiet space${r.count > 1 ? "s" : ""}`);
      }
      if (r.kind === "tsession") {
        const s = r.s, spinning = busyKey === rowKey(r);
        return pickRow(r, `pk-ts-${s.key}`).pl(18)
          .child(spinning ? this.spinner(t, t.accent) : s.status ? this.glyph(t, s.status) : svg("mods/workspace-chrome/terminal.svg").size(12).flex_none().text_color(t.dim))
          .child(div().flex_none().max_w(220).truncate().text_color(t.foreground).child(s.name))
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
          .child(div().flex_none().max_w(180).truncate().text_size(12.5).text_color(t.foreground).child(p.window))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(p.msg || ""))
          .when(Boolean(detail), (el) => el.child(div().flex_none().max_w(150).truncate().text_size(11).text_color(t.dim).child(detail)))
          .child(div().flex_none().text_size(10.5).text_color(t.dim).child(`${r.s.name}:${p.windowIndex}.${p.paneIndex}`));
      }
      if (r.kind === "create") {
        const spinning = busyKey === rowKey(r);
        return pickRow(r, `pk-create-${r.machine ?? "here"}`).pl(14)
          .child(h_flex().size(22).flex_none().rounded(6).items_center().justify_center().bg((r.machine ? REMOTE : t.accent) + "26")
            .child(spinning ? this.spinner(t, r.machine ? REMOTE : t.accent) : svg("mods/workspace-chrome/plus.svg").size(13).text_color(r.machine ? REMOTE : t.accent)))
          .child(h_flex().flex_1().min_w(0).gap(6).items_center()
            .child(div().flex_none().text_color(t.muted).child("Create tmux session"))
            .child(div().min_w(0).truncate().font_semibold().text_color(t.foreground).child(r.name)))
          .child(div().flex_none().text_size(11).text_color(r.machine ? REMOTE : t.dim).child(`on ${r.machine ?? "This Mac"}`));
      }
      if (r.kind === "ctx") {
        const who = r.mine.map((a) => a.program?.name ?? "agent").join(" \u00b7 ");
        const here = r.w.active && r.ctx.active;
        return pickRow(r, `pk-${r.ctx.id}`).pl(18)
          .child(this.glyph(t, r.ctx.status))
          .child(h_flex().w(136).flex_none().gap(7).items_center()
            .child(h_flex().size(16).flex_none().rounded(4).bg(spaceColor(t, r.w)).items_center().justify_center().text_size(9.5).font_bold().text_color("#ffffff").child([...r.w.name][0]?.toUpperCase() ?? "?"))
            .child(div().min_w(0).truncate().text_size(12).text_color(r.w.machine ? REMOTE : t.muted).child(r.w.name)))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).when(here, (d) => d.font_semibold()).child(r.ctx.name))
          .when(here, (el) => el.child(this.tag(t, "here", t.muted)))
          .when(r.ctx.status === "blocked", (el) => el.child(this.tag(t, "needs you", t.blocked)))
          .when(r.ctx.status === "done", (el) => el.child(this.tag(t, "finished", t.done)))
          .when(Boolean(who), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(who + (r.team ? `  +${r.team}` : ""))));
      }
      return pickRow(r, r.what === "tab" ? "pk-new" : `pk-space-${r.machine ?? "here"}`).pl(18).text_color(t.muted)
        .child(svg(r.what === "tab" ? "mods/workspace-chrome/plus.svg" : "mods/workspace-chrome/folder-plus.svg").size(13).flex_none().text_color(t.dim))
        .child(div().flex_1().child(r.what === "tab" ? "New tab" : "New space"))
        .when(Boolean(r.machine), (el) => el.child(div().flex_none().text_size(11).text_color(REMOTE).child(`on ${r.machine}`)));
    };

    const typing = Boolean(this.filter);
    return v_flex()
      .id("picker")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.close();
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
      .child(h_flex().h(54).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/workspace-chrome/search.svg").size(16).flex_none().text_color(typing ? t.accent : t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(14.5).text_color(t.foreground))
        .when(!this.loaded.sessions || !this.loaded.panes, (el) => el.child(this.spinner(t)))
        .child(div().id("picker-esc").flex_none().cursor_pointer().on_click(() => this.close()).child(this.keycap(t, "esc"))))
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
      .child(h_flex().h(36).flex_none().px(16).gap(14).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(this.hint(t, ["\u2191", "\u2193"], "move"))
        .child(this.hint(t, ["\u21b5"], this.enterLabel(sel)))
        .when(sel?.kind === "ctx", (el) => el.child(this.hint(t, ["\u2303D"], "close tab")))
        .child(div().flex_1())
        .child(this.hint(t, ["esc"], "close")));
  }
}
