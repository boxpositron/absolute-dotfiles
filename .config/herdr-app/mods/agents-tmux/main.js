// Agents in two parts. omo in tmux comes first, as a tree: each tmux server (this Mac, then the
// other machines), its sessions, and the panes running omo in them, every pane with its own state,
// from the list the hidden omo-tmux copy publishes (shared "omo.list"). Herdr sees a tmux client as
// one agent carrying its session's most urgent state, so those terminals get no row of their own.
// Agents outside tmux follow in grouped or priority views; parents take their most urgent
// sub-agent's place.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, exec, home, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout } from "herdr";

// Remote tmux (.tmux-server.conf) has a Cyberpunk yellow bar. Agents on another
// machine get a faint wash of the same yellow, and yellow hover and selection, so
// a remote session stands out when scanning the list.
const REMOTE = "#fcee0a";
const REMOTE_ROW = REMOTE + "10", REMOTE_HOVER = REMOTE + "1f", REMOTE_SELECTED = REMOTE + "38";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((l?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// `omo-status list` prints a row per pane running omo, fields joined by SEP; another machine's
// rows carry its name in front of the pane and the session (`flowstate-remote/%3`).
const SEP = "|^|";
const PANE_RANK = { error: 6, input: 5, done: 4, working: 3, background: 2, idle: 1 };
// Window names tmux picks by itself say nothing about the work.
const GENERIC = new Set(["bun", "node", "omo", "zsh", "bash", "fish", "sh", "mosh-client", "ssh"]);
const TMUX = /(^|\/)tmux$/;

// A Herdr terminal running a tmux client: tmux is its program now, or it was started as `tmux attach`.
function tmuxClient(term) {
  const now = term?.foreground?.argv?.[0];
  if (now) return TMUX.test(now);
  const argv = term?.argv ?? [];
  const i = argv.findIndex((a) => TMUX.test(a));
  return i >= 0 && /^(a|at|attach|attach-session|new|new-session)$/.test(argv[i + 1] ?? "");
}

function parsePanes(out) {
  const rows = [];
  for (const line of (out ?? "").split("\n")) {
    const [pane, session = "", win = "", path = "", state, since, resume, ...msg] = line.split(SEP);
    if (!pane) continue;
    const machine = pane.includes("/") ? pane.split("/")[0] : "";
    rows.push({
      pane, machine, state, window: win, msg: msg.join(SEP),
      session: machine && session.startsWith(`${machine}/`) ? session.slice(machine.length + 1) : session,
      project: path.split("/").filter(Boolean).pop() ?? "~",
      since: Number(since) * 1000 || null,
      resumeAt: Number(resume) * 1000 || null,
      order: rows.length,
    });
  }
  return rows;
}

const paneRank = (p) => PANE_RANK[p?.state] ?? 0;

// Servers, this Mac first. In each, sessions go in the order you dragged them to (order[machine]),
// sessions you never placed after those; with no order yet, by their most urgent pane. A session's
// panes go by urgency. Ties keep tmux's order, so rows move only when a state changes.
function serverTree(rows, order = {}) {
  const servers = new Map();
  for (const p of rows) {
    if (!servers.has(p.machine)) servers.set(p.machine, new Map());
    const sessions = servers.get(p.machine);
    if (!sessions.has(p.session)) sessions.set(p.session, []);
    sessions.get(p.session).push(p);
  }
  const byUrgency = (a, b) => paneRank(b) - paneRank(a) || a.order - b.order;
  return [...servers]
    .sort(([a], [b]) => (a !== "") - (b !== "") || a.localeCompare(b))
    .map(([machine, sessions]) => {
      const place = order[machine] ? new Map(order[machine].map((name, i) => [name, i])) : null;
      const list = [...sessions]
        .map(([name, ps]) => {
          const sorted = [...ps].sort(byUrgency);
          return { key: `ses:${machine}/${name}`, name, machine, panes: sorted, top: sorted[0] };
        })
        .sort((a, b) => place
          ? (place.get(a.name) ?? Infinity) - (place.get(b.name) ?? Infinity) || a.top.order - b.top.order
          : byUrgency(a.top, b.top));
      return { key: `srv:${machine}`, machine, sessions: list, panes: list.flatMap((s) => s.panes) };
    });
}

// Time left to a scheduled wake-up: m:ss under an hour, then hours and minutes.
function countdown(ms) {
  if (ms <= 0) return "due";
  const s = Math.ceil(ms / 1000);
  if (s < 3600) return `in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const h = Math.floor(s / 3600);
  return h < 24 ? `in ${h}h ${Math.floor((s % 3600) / 60)}m` : `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    // Folded tree branches are kept across restarts; folded agents and groups are not.
    this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
    // Session order per server, as you dragged it ({machine: [session, ...]}); kept across restarts.
    this.order = JSON.parse(localStorage.getItem("order") ?? "{}");
    this.drag = null;
    this.shownSessions = new Map();
    this.panesOut = null;
    this.tmuxPanes = [];
    this.showProblem = null;
    // Scheduled wake-ups count down every second.
    cx.timer.every(1000, (cx) => { if (this.tmuxPanes.some((p) => p.resumeAt)) cx.notify(); });
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  rank(a) {
    return RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  fold(key, cx) {
    this.folded.has(key) ? this.folded.delete(key) : this.folded.add(key);
    localStorage.setItem("folded", JSON.stringify([...this.folded].filter((k) => /^(srv|ses):/.test(k))));
    cx.notify();
  }

  // Dragging a session row moves it among its server's sessions. A press becomes a drag only once
  // the pointer has moved, so a click still folds the session; leaving the list cancels it.
  dragStart(s, e) {
    this.dragged = false;
    this.drag = { machine: s.machine, name: s.name, y: e.position.y, moved: false, target: null };
  }

  // Where the dragged session would land: before or after session `name` of `machine`.
  dragOver(machine, name, after, e, cx) {
    const d = this.drag;
    if (!d || d.machine !== machine) return;
    if (!d.moved && Math.abs(e.position.y - d.y) < 4) return;
    d.moved = true;
    if (d.target?.name === name && d.target.after === after) return;
    d.target = { machine, name, after };
    cx.notify();
  }

  dragEnd(cx) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    // The release also clicks the row it was pressed on, which must not fold it.
    this.dragged = d.moved;
    const target = d.target;
    if (d.moved && target && target.name !== d.name) {
      const shown = this.shownSessions.get(d.machine) ?? [];
      const names = shown.filter((n) => n !== d.name);
      const i = names.indexOf(target.name);
      if (i >= 0) {
        names.splice(target.after ? i + 1 : i, 0, d.name);
        // Sessions not running now keep their places after the ones that are.
        const gone = (this.order[d.machine] ?? []).filter((n) => !shown.includes(n));
        this.order[d.machine] = [...names, ...gone];
        localStorage.setItem("order", JSON.stringify(this.order));
      }
    }
    cx.notify();
  }

  dropping(machine, name, after) {
    const d = this.drag, at = d?.target;
    return Boolean(d?.moved && at && at.name !== d.name && at.machine === machine && at.name === name && at.after === after);
  }

  // The line where a dragged session will land, laid over the row so nothing shifts under the pointer.
  dropLine(t, below) {
    return div().absolute().left(4).right(4).top(below ? 27 : -1).h(2).rounded(1).bg(t.accent);
  }

  // The pane in Herdr: the tab already on its session, else the session's space, else a new one.
  // exact: this pane, not the session's most urgent one, since each row is a pane of its own.
  show(p, cx) {
    cx.spawn(async (cx) => {
      const r = await exec(`${home()}/.local/bin/omo-status`, ["show", p.pane, "exact"]).catch((e) => ({ code: -1, stderr: String(e?.message ?? e) }));
      this.showProblem = r.code === 0 ? null : r.stderr.trim() || `omo-status show failed (${r.code})`;
      cx.notify();
    });
  }

  // A pane's own state; compact: a ! where there is no room for "Needs you".
  paneStatus(t, state, compact = false) {
    if (state === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (state === "background") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.ansi5).spin(2400);
    if (state === "input" || state === "error") {
      const color = state === "error" ? t.ansi1 : t.blocked;
      if (compact) return div().size(14).flex_none().rounded(4).bg(color + "26").text_size(10.5).font_bold().text_color(color).flex().items_center().justify_center().child("!");
      return div().flex_none().px(6).h(18).rounded(5).bg(color + "26").text_size(10.5).font_semibold().text_color(color)
        .flex().items_center().loop("opacity", { from: 0.55, to: 1, period: 1600 })
        .child(state === "error" ? "Failed" : "Needs you");
    }
    if (state === "done") return div().size(7).mx(3).flex_none().rounded(4).bg(t.done);
    return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  }

  // A tree's top level: a tmux server, or the agents outside tmux. Folded, it shows its most urgent state.
  branch(t, { key, glyph, label, color, count, needs, top }) {
    const open = !this.folded.has(key);
    return h_flex()
      .id(key)
      .px(8)
      .pt(8)
      .h(30)
      .flex_none()
      .gap(6)
      .items_center()
      .text_size(11)
      .font_medium()
      .cursor_pointer()
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => this.fold(key, cx))
      .child(svg(`mods/workspace-chrome/${glyph}.svg`).size(12).flex_none().text_color(color ?? t.dim))
      .child(div().truncate().text_color(color ?? t.dim).child(label))
      .child(div().text_color(t.dim).child(String(count)))
      .when(needs > 0, (el) => el.child(div().text_color(t.blocked).child(`· ${needs} need${needs === 1 ? "s" : ""} you`)))
      .child(div().flex_1())
      .when(!open, (el) => el
        .when(Boolean(top) && top !== "idle", (el) => el.child(this.paneStatus(t, top, true)))
        .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
  }

  sessionRow(t, s) {
    const open = !this.folded.has(s.key);
    const remote = Boolean(s.machine);
    const top = s.top?.state;
    const lifted = Boolean(this.drag?.moved && this.drag.machine === s.machine && this.drag.name === s.name);
    // Folded, the lower half of the row means after it; open, its panes do.
    const shut = !open || !s.panes.length;
    return h_flex()
      .id(s.key)
      .relative()
      .px(8)
      .h(28)
      .flex_none()
      .rounded(8)
      .gap(6)
      .items_center()
      .when(remote, (el) => el.bg(REMOTE_ROW))
      .when(lifted, (el) => el.opacity(0.4))
      .cursor_pointer()
      .hover((el) => el.bg(remote ? REMOTE_HOVER : t.hover))
      .on_mouse_down("left", (e) => this.dragStart(s, e))
      .on_mouse_move((e, cx) => this.dragOver(s.machine, s.name, shut && (e.local_position?.y ?? 0) > 14, e, cx))
      .on_click((_e, cx) => {
        if (this.dragged) { this.dragged = false; return; }
        this.fold(s.key, cx);
      })
      .when(this.dropping(s.machine, s.name, false), (el) => el.child(this.dropLine(t, false)))
      .when(shut && this.dropping(s.machine, s.name, true), (el) => el.child(this.dropLine(t, true)))
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
      .child(div().min_w(0).truncate().font_medium().text_color(top === "input" || top === "error" ? t.blocked : t.foreground).child(s.name))
      .child(div().text_size(11).text_color(t.dim).child(String(s.panes.length)))
      .child(div().flex_1())
      .when(!open && top !== "idle", (el) => el.child(this.paneStatus(t, top, true)));
  }

  paneRow(t, p, last, now, on) {
    const remote = Boolean(p.machine);
    const quiet = p.state === "idle";
    const label = GENERIC.has(p.window) ? p.project : p.window;
    const wake = p.resumeAt && p.state !== "working";
    // A goal's wait reads as a sentence: "goal continues in 3:34 · waiting on CI".
    const goalWait = wake && /^goal (continues|retries|resumes)/.test(p.msg);
    // The pill already says it needs you, so the message keeps only the question.
    const said = p.state === "input" ? p.msg.replace(/^Needs your input:\s*/, "") : p.msg;
    const msg = goalWait ? said.replace(/^goal \w+/, (m) => `${m} ${countdown(p.resumeAt - now)}`) : said;
    return h_flex()
      .id(`tp-${p.pane}`)
      .relative()
      .pl(14)
      .pr(8)
      .h(28)
      .flex_none()
      .rounded(8)
      .items_center()
      .text_size(12.5)
      .when(remote, (el) => el.bg(REMOTE_ROW))
      .when(on, (el) => el.bg(remote ? REMOTE_SELECTED : t.selected))
      .cursor_pointer()
      .hover((el) => el.bg(remote ? REMOTE_HOVER : t.hover))
      .on_click((_e, cx) => this.show(p, cx))
      .on_mouse_move((e, cx) => this.dragOver(p.machine, p.session, true, e, cx))
      .when(last && this.dropping(p.machine, p.session, true), (el) => el.child(this.dropLine(t, true)))
      .child(this.connector(t, last))
      .child(h_flex().flex_1().min_w(0).gap(5).items_center()
        .child(div().min_w(0).flex_none().max_w(msg ? 130 : 220).truncate().text_color(quiet && !on ? t.muted : t.foreground).child(label))
        .when(Boolean(msg), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`· ${msg}`))))
      .when(Boolean(wake) && !goalWait, (el) => el.child(div().flex_none().ml(6).text_size(11).text_color(t.ansi5).child(countdown(p.resumeAt - now))))
      .when(!(wake && !goalWait) && Boolean(p.since), (el) => el.child(div().flex_none().ml(6).text_size(11).text_color(t.dim).child(duration(now - p.since))))
      .child(div().ml(8).flex_none().child(this.paneStatus(t, p.state)));
  }

  // A pane's tree line: an elbow to the pane, and the line on down to the next one unless it's the last.
  connector(t, last) {
    return div().relative().h_full().w(9).mr(7).flex_none()
      .child(div().absolute().left(0).top(-4).w(9).h(18).border_l(1.5).border_b(1.5).rounded_bl(6).border_color(t.input))
      .when(!last, (el) => el.child(div().absolute().left(0).top(8).h(20).border_l(1.5).border_color(t.input)));
  }

  // On the rail: the pane's place in the list and its state.
  railPane(t, p, i, on) {
    const remote = Boolean(p.machine);
    return h_flex()
      .id(`rp-${p.pane}`)
      .h(26)
      .px(8)
      .flex_none()
      .items_center()
      .gap(4)
      .when(remote, (el) => el.bg(REMOTE_ROW))
      .when(on, (el) => el.bg(remote ? REMOTE_SELECTED : t.selected))
      .hover((el) => el.bg(remote ? REMOTE_HOVER : t.hover))
      .on_click((_e, cx) => this.show(p, cx))
      .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
      .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.paneStatus(t, p.state, true)));
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    const remote = k.address.includes("/");
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(remote, (el) => el.bg(REMOTE_ROW))
      .when(on, (el) => el.bg(remote ? REMOTE_SELECTED : t.raised))
      .hover((s) => s.bg(remote ? REMOTE_HOVER : t.hover))
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    const all = terminals();
    // omo in tmux, pane by pane; the tmux clients Herdr counts as agents give way to it.
    const omo = shared("omo.list");
    if ((omo?.out ?? null) !== this.panesOut) {
      this.panesOut = omo?.out ?? null;
      this.tmuxPanes = parsePanes(this.panesOut);
    }
    const servers = serverTree(this.tmuxPanes, this.order);
    const where = shared("tmux.where");
    const shownPane = where?.tmux && where.pane ? (where.on ? `${where.on}/${where.pane}` : where.pane) : null;
    const clients = new Set(all.filter(tmuxClient).map((x) => x.address));
    let list = agents().filter((a) => !clients.has(a.address));
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
    // it, it gets no row of its own, unless it's pinned.
    const nested = new Set(collapsed ? [] : list.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    const tabCounts = new Map();
    for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(panes());
    const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      const many = tabCounts.get(a.tab) > 1;
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
    }));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .when(Boolean(machine), (el) => el.bg(REMOTE_ROW))
          .hover((s) => s.bg(machine ? REMOTE_HOVER : t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      return h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(Boolean(machine), (el) => el.bg(REMOTE_ROW))
        .when(a.focused, (el) => el.bg(machine ? REMOTE_SELECTED : t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(machine ? REMOTE_HOVER : t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
          .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(REMOTE + "a0").child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const count = (ps, ...states) => ps.filter((p) => states.includes(p.state)).length;
    const topState = (ps) => ps.reduce((m, p) => (paneRank(p) > (PANE_RANK[m] ?? 0) ? p.state : m), null);
    this.shownSessions = new Map(servers.map((srv) => [srv.machine, srv.sessions.map((s) => s.name)]));
    const tmuxRows = servers.flatMap((srv) => [
      this.branch(t, {
        key: srv.key,
        glyph: "server",
        label: srv.machine || (window()?.platform === "macos" ? "This Mac" : "This computer"),
        color: srv.machine ? REMOTE : null,
        count: srv.panes.length,
        needs: count(srv.panes, "input", "error"),
        top: topState(srv.panes),
      }),
      ...(this.folded.has(srv.key) ? [] : srv.sessions.flatMap((s) => [
        this.sessionRow(t, s),
        ...(this.folded.has(s.key) ? [] : s.panes.map((p, i) => this.paneRow(t, p, i === s.panes.length - 1, now, p.pane === shownPane))),
      ])),
    ]);
    // Agents outside tmux get a heading of their own only below the tmux tree.
    const outside = servers.length > 0 && list.length > 0;
    const herdrRows = outside && this.folded.has("srv:herdr")
      ? []
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);
    const railPanes = servers.flatMap((s) => s.panes);
    const rows = collapsed
      ? [...railPanes.map((p, i) => this.railPane(t, p, i, p.pane === shownPane)), ...list.flatMap((a, i) => withKids(a, railPanes.length + i))]
      : [
          ...tmuxRows,
          ...(outside ? [this.branch(t, { key: "srv:herdr", glyph: "terminal", label: "Not in tmux", color: null, count: list.length, needs: list.filter((a) => a.status === "blocked").length, top: null })] : []),
          ...herdrRows,
        ];
    const problem = this.showProblem ?? (omo?.problem && !/isn't running/.test(omo.problem) ? omo.problem : null);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(
              h_flex()
                .gap(10)
                .items_center()
                .child(
                  div()
                    .id("ag-board")
                    .text_color(t.dim)
                    .hover((s) => s.text_color(t.foreground))
                    .on_click(() => run("mod.open", { name: "omo-board" }))
                    .tooltip("Board: every omo session on both machines (Cmd+Shift+B)")
                    .child(svg("mods/workspace-chrome/monitor.svg").size(14)),
                )
                // Sorting orders only the agents outside tmux.
                .when(list.length > 0, (el) => el.child(
                  div()
                    .id("ag-sort")
                    .text_size(11)
                    .text_color(t.dim)
                    .hover((s) => s.text_color(t.foreground))
                    .on_click(() => openOverlay({ mod: "agents-tmux", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                    .tooltip(`Sort agents outside tmux: ${sort.label}`)
                    .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
                )),
            ),
        ),
      )
      .when(Boolean(problem) && !collapsed, (el) => el.child(div().px(16).pb(4).text_size(11.5).text_color(t.ansi1).child(problem)))
      .when(servers.length === 0 && list.length === 0 && !collapsed, (el) =>
        el.child(div().px(16).text_size(12).text_color(t.dim).child("No agents yet. omo in tmux shows up here as soon as it starts; other agents when they report their status.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always")
        .when(Boolean(this.drag?.moved), (el) => el.cursor_grabbing())
        .on_mouse_up("left", (_e, cx) => this.dragEnd(cx))
        .on_hover((on, cx) => { if (!on && this.drag) { this.drag = null; cx.notify(); } })
        .children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
