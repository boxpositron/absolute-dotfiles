// The sidebar's tree of spaces and agents. Per machine (this computer, then the others): Herdr's spaces in their order,
// each with its git (spaces.js) and its tabs, and each tab with the state of the omo panes in the tmux window it shows
// (shared "tmux.tabs", from tmux's clients, and the list the hidden omo-tmux copy publishes, shared "omo.list"); then,
// folded, the omo sessions no space shows. Herdr sees a tmux client as one agent carrying its session's most urgent
// state, so those terminals get no row of their own. Agents outside tmux follow in grouped or priority views; parents
// take their most urgent sub-agent's place.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, exec, home, readTextFile, writeTextFile, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout } from "herdr";
import { SpaceData, MARK, spaceColors } from "./spaces.js";

// Remote tmux (.tmux-server.conf) has a Cyberpunk yellow bar. Agents on another
// machine get a faint wash of the same yellow, and yellow hover and selection, so
// a remote session stands out when scanning the list.
const REMOTE = "#fcee0a";
const REMOTE_ROW = REMOTE + "10", REMOTE_HOVER = REMOTE + "1f", REMOTE_SELECTED = REMOTE + "38";
// Each tmux session has a colour of its own (tmux-session-tint; omo-tmux publishes them as shared
// "tmux.tints"): its row gets a wash of it, on either machine. The
// colours come from tmux-session-tint's list in the order this tree shows the sessions (syncTints), so
// sessions next to each other always contrast.
const tintOf = (s) => shared("tmux.tints")?.[s.machine ? `${s.machine}/${s.name}` : s.name] ?? null;
// A pane row is its session's colour lightened toward white, so it reads as a lighter band under the session's.
const lighten = (hex, amount) =>
  `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount) + 255 * amount).toString(16).padStart(2, "0")).join("")}`;
// The edge on the right of the pane Herdr shows.
const FOCUS_EDGE = "#ff3040";
// The drag handles' neon: netrunner's cyan for spaces, as the tmux bar uses it, and a very bright yellow for computers,
// both bright against every row's wash.
const GRIP = "#00f0ff";
const MACHINE_GRIP = "#ffff00";
// On the rail the list keeps a lane of its own at its right edge for its scrollbar, so the bar never covers a card.
const RAIL_LANE = 8;
// How fast a rail dot pulses (ms), by its agent's state; the others hold still.
const RAIL_PULSE = { working: 1100, background: 2400, input: 1600, error: 1600 };

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

// Drops what an agent puts before its title: a status glyph or spinner and the separator
// after it ("✦  Working", "⠋ - Thinking"), and Codex's blinking "[ ! ] " / "[ . ] " mark.
// Stops at an opening bracket or quote, so a title that starts with one ("[web] login") keeps it.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

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
  const telling = live && live !== (l?.terminal ?? l?.address) && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
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
// rows carry its name in front of the pane and the session (`server/%3`).
const SEP = "|^|";
// Tree rows have fixed heights, so where each sits is known before it is drawn.
const ROW_H = 28;
const HEAD_H = 30;
/** @type {import("gpui-shell").TransitionPolicy} */
const MOTION = { duration: 160, easing: "ease-out" };
const PANE_RANK = { error: 6, input: 5, done: 4, partial: 4, working: 3, background: 2, idle: 1 };
// Window names tmux picks by itself say nothing about the work.
const GENERIC = new Set(["bun", "node", "omo", "zsh", "bash", "fish", "sh", "mosh-client", "ssh"]);
const TMUX = /(^|\/)tmux$/;

// omo-status's note of when it last moved Herdr's focus itself (seconds): its list leaves such a move
// alone, where it would take a plain change of tab for a visit and go to the session's most urgent pane.
async function stampShown() {
  const path = `${home()}/.local/state/omo-status/herdr-shown`;
  try {
    await writeTextFile(path, `${Math.floor(Date.now() / 1000)}\n`, await readTextFile(path));
  } catch {
    // Only omo-status writes it too, and only when it moves the focus itself: a write lost to it
    // has been made by it.
  }
}

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

// tmux servers, this Mac first, each with its sessions and a session's panes in tmux's order. A change of state never
// moves a row; only a session or pane coming or going does.
function serverTree(rows) {
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
      const list = [...sessions]
        .map(([name, ps]) => {
          // `top`, the most urgent pane, is only what a folded session shows.
          const top = ps.reduce((m, p) => (byUrgency(p, m) < 0 ? p : m), ps[0]);
          return { key: `ses:${machine}/${name}`, name, machine, panes: ps, top, first: ps[0].order };
        })
        .sort((a, b) => a.first - b.first);
      return { key: `srv:${machine}`, machine, sessions: list, panes: list.flatMap((s) => s.panes) };
    });
}

// Herdr's word for an agent's state in omo-status's, for a tab no omo pane reports for.
const HERDR_STATE = { blocked: "input", done: "done", working: "working", idle: "idle" };
// A space's name never shrinks below this next to its git, so a short one stays readable.
const SIDE_MIN = 48;

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
    // The order each machine's tmux last coloured its sessions by (syncTints).
    this.tinted = new Map();
    // The machines' order, as you dragged their headers ([machine, ...], "" for this computer); kept across restarts.
    try { this.machineOrder = JSON.parse(localStorage.getItem("machines.order") ?? "[]"); } catch { this.machineOrder = []; }
    if (!Array.isArray(this.machineOrder)) this.machineOrder = [];
    this.spaceData = new SpaceData(cx, {
      isFolded: (m) => this.folded.has(`srv:${m ?? ""}`),
      unfold: (m) => { this.folded.delete(`srv:${m}`); this.saveFolds(); },
    });
    // Which window each tmux client shows (loadTabs): every 3 s, and at once when a client comes or goes.
    this.loadTabs(cx);
    cx.timer.every(3000, (cx) => this.loadTabs(cx));
    this.drag = null;
    this.blocks = new Map();
    this.motion = null;
    this.panesOut = null;
    this.tmuxPanes = [];
    this.showProblem = null;
    // Scheduled wake-ups count down every second.
    cx.timer.every(1000, (cx) => { if (this.tmuxPanes.some((p) => p.resumeAt)) cx.notify(); });
    // Each agent's last state and when it changed (ms), kept across restarts.
    try { this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}"); } catch { this.changed = {}; }
    if (!this.changed || typeof this.changed !== "object" || Array.isArray(this.changed)) this.changed = {};
    try { this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]"); } catch { this.pendingPins = []; }
    if (!Array.isArray(this.pendingPins)) this.pendingPins = [];
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
    this.saveFolds();
    cx.notify();
  }

  // Machines, spaces and sessions keep their folds across restarts; agents and groups don't.
  saveFolds() {
    localStorage.setItem("folded", JSON.stringify([...this.folded].filter((k) => /^(srv|ses|sp|nih):/.test(k))));
  }

  // Dragging a space row lifts its block (the row and its tabs), and dragging a machine's header lifts the machine
  // with everything under it, to follow the pointer, while the others slide apart where it would land. A press becomes
  // a drag only once the pointer has moved, so a click still goes to the space or folds the machine. `s`: { level
  // ("space" or "machine"), machine, name } (a space by its id, a machine by its name, "" for this computer).
  dragStart(s, e) {
    this.dragged = false;
    const blocks = s.level === "machine" ? this.machineBlocks ?? [] : this.blocks.get(s.machine) ?? [];
    const me = blocks.find((b) => b.name === s.name);
    if (!me) return;
    // The others' places with this one taken out: the slots it can drop between.
    const others = [];
    let y = blocks[0].y;
    for (const b of blocks) if (b !== me) { others.push({ name: b.name, y, h: b.h }); y += b.h; }
    const from = blocks.indexOf(me);
    this.drag = { level: s.level, machine: s.machine, name: s.name, y: e.position.y, dy: 0, moved: false, top: me.y, rows: me.rows, hs: me.hs, others, from, index: from };
  }

  dragMove(e, cx) {
    const d = this.drag;
    if (!d) return;
    const dy = e.position.y - d.y;
    if (!d.moved && Math.abs(dy) < 4) return;
    d.moved = true;
    d.dy = dy;
    // It lands after every one whose middle the lifted top row's middle has passed.
    const middle = d.top + dy + d.hs[0] / 2;
    d.index = d.others.filter((o) => o.y + o.h / 2 < middle).length;
    cx.notify();
  }

  // Letting go settles the lifted rows from where they were into their slot and keeps the order;
  // leaving the list (keep false) settles them back where they came from.
  dragEnd(cx, keep = true) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    // The release also clicks the row it was pressed on, which must not go to its space.
    this.dragged = d.moved;
    if (!d.moved) return;
    let y = d.top + d.dy;
    d.rows.forEach((key, i) => { this.motion?.at.set(key, { key, y, h: d.hs[i] }); y += d.hs[i]; });
    if (keep && d.index !== d.from) {
      const names = d.others.map((o) => o.name);
      if (d.level === "machine") {
        // The machines' order is this tree's own, kept across restarts; one not connected now keeps its place after.
        names.splice(d.index, 0, d.name);
        this.machineOrder = [...names, ...this.machineOrder.filter((n) => !names.includes(n))];
        localStorage.setItem("machines.order", JSON.stringify(this.machineOrder));
      } else {
        // A space goes where it was dropped among its machine's spaces, in Herdr's own order.
        const ids = spaces().map((s) => s.id).filter((id) => id !== d.name);
        const next = names[d.index];
        const at = next ? ids.indexOf(next) : ids.indexOf(names.at(-1)) + 1;
        run("space.move", { id: d.name, index: at + 1 });
      }
    }
    cx.notify();
  }

  // Where every tree row sits now, against where it sat last time: a row that moved is drawn where it
  // was for one frame, then let go to slide home; a new one fades in. As the omo-tmux panel does it.
  plan(items, cx) {
    const at = new Map(items.map((x) => [x.key, x]));
    const sig = items.map((x) => `${x.key}@${x.y}`).join("\n");
    const m = this.motion;
    if (!m) { this.motion = { sig, at, fly: {}, gen: {}, step: 0 }; return; }
    if (sig === m.sig) return;
    const fly = {}, gen = m.gen;
    for (const x of items) {
      const was = m.at.get(x.key);
      if (!was) {
        gen[x.key] = (gen[x.key] ?? 0) + 1;
        fly[x.key] = { top: 0, fade: true };
      } else if (was.y !== x.y) {
        gen[x.key] = (gen[x.key] ?? 0) + 1;
        fly[x.key] = { top: was.y - x.y };
      }
    }
    const step = m.step + 1;
    this.motion = { sig, at, gen, fly, step };
    cx.timer.after(16, (cx) => { if (this.motion.step === step) { this.motion.fly = {}; cx.notify(); } });
  }

  // The handle a row is dragged by (the whole row drags): six neon dots in the row's left gutter, on a faint pill of
  // the same colour while the row is hovered or lifted. `top`: where it sits, for a row of another height.
  grip(t, on, top = 5, color = GRIP) {
    const dot = () => div().size(3).rounded(2).bg(color);
    const pair = () => h_flex().gap(2).child(dot()).child(dot());
    return v_flex().absolute().left(4).top(top).p(3).gap(2).rounded(4).opacity(on ? 1 : 0.7)
      .when(on, (el) => el.bg(color + "26")).child(pair()).child(pair()).child(pair());
  }

  // The pane in Herdr: the tab already on its session, else the session's space, else a new one.
  // exact: this pane, not the session's most urgent one, since each row is a pane of its own.
  // A pane on this Mac whose session a tab already shows is shown at once: the move is stamped as
  // omo-status's own (omo-tmux reads the list as soon as the focus moves), one tmux call selects the
  // pane and names the session's clients, and the tab running one of them is focused; `omo-status
  // locate` then marks the pane seen behind it. `omo-status show`, which took 0.2 to 0.7 s before the
  // tab changed, is left for another machine's panes and for sessions no tab shows. In tab mode (`omo-status
  // tabs`) each window has a tab whose client is on "<session>~<window>": the tab on the pane's window is focused
  // and nothing is selected first, since tmux would select the window in whichever tab used it last.
  show(p, cx) {
    cx.spawn(async (cx) => {
      const omo = `${home()}/.local/bin/omo-status`;
      /** @param {any} e */
      const failed = (e) => ({ code: -1, stderr: String(e?.message ?? e) });
      let r = null;
      if (!p.machine) {
        const tmuxBin = "/opt/homebrew/bin/tmux";
        const [where] = await Promise.all([
          exec(tmuxBin, ["-u", "display-message", "-p", "-t", p.pane, "#{window_id}\t#{s/~[0-9]+$//:session_name}",
            ";", "list-clients", "-F", "#{client_pid}\t#{window_id}\t#{session_name}"]).catch(() => ({ stdout: "" })),
          stampShown(),
        ]);
        const [head = "", ...rows] = where.stdout.split("\n").filter(Boolean);
        const [win, base] = head.split("\t");
        const tabs = rows.map((row) => row.split("\t"))
          .filter(([, , s]) => base && s.startsWith(`${base}~`) && /^\d+$/.test(s.slice(base.length + 1)));
        let pids;
        if (tabs.length) {
          pids = new Set(tabs.filter(([, w]) => w === win).map(([pid]) => Number(pid)));
        } else {
          const tmux = await exec(tmuxBin, ["-u", "select-window", "-t", p.pane, ";", "select-pane", "-t", p.pane,
            ";", "list-clients", "-t", p.pane, "-F", "#{client_pid}"]).catch(() => ({ stdout: "" }));
          pids = new Set(tmux.stdout.split("\n").filter(Boolean).map(Number));
        }
        const tab = terminals().find((x) => tmuxClient(x) && pids.has(x.foreground?.pid));
        if (tab) {
          run("pane.focus", { terminal: tab.address });
          r = await exec(omo, ["locate", p.pane, "exact"]).catch(failed);
        }
      }
      r ??= await exec(omo, ["show", p.pane, "exact"]).catch(failed);
      this.showProblem = r.code === 0 ? null : r.stderr.trim() || `omo-status show failed (${r.code})`;
      cx.notify();
    });
  }

  // A pane's own state; compact: a ! where there is no room for "Needs you".
  paneStatus(t, state, compact = false) {
    if (state === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (state === "background") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.ansi5).spin(2400);
    if (state === "input" || state === "error") {
      // Needs you in the accent pink: yellow already marks the remote server.
      const color = state === "error" ? t.ansi1 : t.accent;
      if (compact) return div().size(14).flex_none().rounded(4).bg(color + "26").text_size(10.5).font_bold().text_color(color).flex().items_center().justify_center().child("!");
      return div().flex_none().px(6).h(18).rounded(5).bg(color + "26").text_size(10.5).font_semibold().text_color(color)
        .flex().items_center().loop("opacity", { from: 0.55, to: 1, period: 1600 })
        .child(state === "error" ? "Failed" : "Needs you");
    }
    if (state === "done") return div().size(7).mx(3).flex_none().rounded(4).bg(t.done);
    // A step done with tasks still open (omo-status's partial): a ring around a dot.
    if (state === "partial") return div().size(8).mx(2.5).flex_none().rounded(4).border(1.5).border_color(t.done).flex().items_center().justify_center()
      .child(div().size(3).rounded(2).bg(t.done));
    return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  }

  // A tree's top level under a machine: its omo sessions no space shows, or the agents outside tmux. Folded, it shows
  // its most urgent state. `open`: given when it isn't the default (open unless folded).
  branch(t, { key, glyph, label, color, count, needs, top, open = !this.folded.has(key) }) {
    return h_flex()
      .id(key)
      .pl(22)
      .pr(8)
      .pt(8)
      .h(HEAD_H)
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
      .when(needs > 0, (el) => el.child(div().text_color(t.accent).child(`\u00b7 ${needs} need${needs === 1 ? "s" : ""} you`)))
      .child(div().flex_1())
      .when(!open, (el) => el
        .when(Boolean(top) && top !== "idle", (el) => el.child(this.paneStatus(t, top, true)))
        .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
  }

  // A tmux session no space shows (under Not in Herdr), on a wash of its colour: a click folds its panes.
  sessionRow(t, s) {
    const open = !this.folded.has(s.key);
    const remote = Boolean(s.machine);
    const top = s.top?.state;
    const tint = tintOf(s);
    return h_flex()
      .id(s.key)
      .relative()
      .pl(22)
      .pr(8)
      .h(ROW_H)
      .flex_none()
      .gap(6)
      .items_center()
      .when(remote && !tint, (el) => el.bg(REMOTE_ROW))
      .when(Boolean(tint), (el) => el.bg(tint + "2a"))
      .cursor_pointer()
      .hover((el) => el.bg(tint ? tint + "33" : remote ? REMOTE_HOVER : t.hover))
      .on_click((_e, cx) => this.fold(s.key, cx))
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
      .child(div().min_w(0).truncate().font_medium().text_color(top === "input" ? t.accent : top === "error" ? t.ansi1 : t.foreground).child(s.name))
      .child(div().text_size(11).text_color(t.dim).child(String(s.panes.length)))
      .child(div().flex_1())
      .when(!open && top !== "idle", (el) => el.child(this.paneStatus(t, top, true)));
  }

  // Hands each machine's tmux the order its sessions show in here (their spaces' order, then those no space shows)
  // whenever it changes (a drag, a session coming or going), and takes the colours tmux-session-tint gives them in that
  // order straight away, rather than at omo-tmux's next read of them. `order`: [{ machine, names }].
  syncTints(order, cx) {
    if (this.drag) return;
    for (const { machine, names } of order) {
      if (!names.length || this.tinted.get(machine) === names.join("\n")) continue;
      this.tinted.set(machine, names.join("\n"));
      const args = ["--order", ...names];
      cx.spawn(async (cx) => {
        try {
          const r = machine
            ? await exec("sh", ["-c", 'exec "$HOME/.local/bin/tmux-session-tint" "$@"', "tmux-session-tint", ...args], { on: machine })
            : await exec(`${home()}/.local/bin/tmux-session-tint`, args);
          if (r.code !== 0) return;
          const tints = Object.assign({}, shared("tmux.tints") ?? {});
          for (const line of r.stdout.split("\n")) {
            const [name, colour] = line.split("|^|");
            if (name && colour) tints[machine ? `${machine}/${name}` : name] = colour;
          }
          setShared("tmux.tints", tints);
          cx.notify();
        } catch {}
      });
    }
  }

  // A leaf of the tree: a tab, or a pane running omo. `x`: { id, label, msg, state, since, resumeAt, machine }; `on`:
  // the one Herdr shows, marked by an edge; `tint`: the colour of the row it hangs from, of which it gets a lighter
  // wash; `depth` 1: a pane under a tab.
  leafRow(t, x, last, now, on, tint, click, depth = 0) {
    const wash = tint && lighten(tint, 0.35);
    const remote = Boolean(x.machine);
    const quiet = !x.state || x.state === "idle";
    const wake = x.resumeAt && x.state !== "working";
    // A goal's wait reads as a sentence: "goal continues in 3:34 · waiting on CI".
    const goalWait = wake && /^goal (continues|retries|resumes)/.test(x.msg);
    // The pill already says it needs you, so the message keeps only the question.
    const said = x.state === "input" ? x.msg.replace(/^Needs your input:\s*/, "") : x.msg;
    const msg = goalWait ? said.replace(/^goal \w+/, (m) => `${m} ${countdown(x.resumeAt - now)}`) : said;
    return h_flex()
      .id(x.id)
      .relative()
      .pl(28 + depth * 16)
      .pr(8)
      .h(ROW_H)
      .flex_none()
      .items_center()
      .text_size(12.5)
      .when(remote && !tint, (el) => el.bg(REMOTE_ROW))
      .when(Boolean(wash), (el) => el.bg(wash + (on ? "40" : "24")))
      .when(on && !wash, (el) => el.bg(remote ? REMOTE_SELECTED : t.selected))
      .cursor_pointer()
      .hover((el) => el.bg(wash ? wash + "40" : remote ? REMOTE_HOVER : t.hover))
      .on_click((_e, cx) => click(cx))
      .when(on, (el) => el.child(div().absolute().right(0).top(0).bottom(0).w(3).bg(FOCUS_EDGE)))
      // A short bar at the row's edge: this is waiting on you (pink) or failed (red).
      .when(x.state === "input" || x.state === "error", (el) => el.child(div().absolute().left(3).top(6).w(2).h(16).rounded(1).bg(x.state === "error" ? t.ansi1 : t.accent)))
      .child(this.connector(t, last))
      .child(h_flex().flex_1().min_w(0).gap(5).items_center()
        .child(div().min_w(0).flex_none().max_w(msg ? 130 : 220).truncate().text_color(quiet && !on ? t.muted : t.foreground).child(x.label))
        .when(Boolean(msg), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${msg}`))))
      .when(Boolean(wake) && !goalWait, (el) => el.child(div().flex_none().ml(6).text_size(11).text_color(t.ansi5).child(countdown(x.resumeAt - now))))
      .when(!(wake && !goalWait) && Boolean(x.since), (el) => el.child(div().flex_none().ml(6).text_size(11).text_color(t.dim).child(duration(now - x.since))))
      .when(Boolean(x.state), (el) => el.child(div().ml(8).flex_none().child(this.paneStatus(t, x.state))));
  }

  // A pane running omo, named after its window (else its folder); a click shows it.
  paneRow(t, p, last, now, on, tint, depth = 0) {
    const label = GENERIC.has(p.window) ? p.project : p.window;
    return this.leafRow(t, { ...p, id: `tp-${p.pane}`, label }, last, now, on, tint, (cx) => this.show(p, cx), depth);
  }

  // A pane's tree line: an elbow to the pane, and the line on down to the next one unless it's the last.
  connector(t, last) {
    return div().relative().h_full().w(9).mr(7).flex_none()
      .child(div().absolute().left(0).top(-4).w(9).h(18).border_l(1.5).border_b(1.5).rounded_bl(6).border_color(t.input))
      .when(!last, (el) => el.child(div().absolute().left(0).top(8).h(20).border_l(1.5).border_color(t.input)));
  }

  // A space's colour: its tmux session's (tmux-session-tint, as its tmux bar shows it) when it has one, else its own
  // ("space.colors": a theme colour name or a picked #rrggbb).
  spaceColor(t, w, session, colors) {
    const tint = session ? shared("tmux.tints")?.[session] : null;
    const c = colors[w.id] ?? "ansi6";
    return tint ?? (c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.muted));
  }

  // Only what's unusual, after a space's name: "herdr \u00b7 spike \u21912 \u21931". The repo or branch goes when the name
  // already says it (a worktree is named after its branch), and master/main go: nearly every space is on one.
  gitTail(t, g, tree, name) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex().flex_auto().min_w(where ? SIDE_MIN : 0).gap(5).justify_end().items_center().text_size(11).text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  // A machine's header (m "": this computer): its name, its spaces and how many of their tabs need you, + for a new
  // space there, and for another machine a dot for its link, its state when it isn't connected, Connect when it was
  // rebuilt, and a warning when its agents stop at a disconnect. Folded, its most urgent state.
  machineHead(t, m, { count, needs, top }, ghost = false) {
    const key = `srv:${m}`;
    const open = !this.folded.has(key);
    const d = this.spaceData;
    const repair = d.reconnecting[m];
    const info = d.machines.find((k) => k.name === m) ?? repair?.machine;
    const connected = !m || info?.state === "connected";
    const rebuilt = Boolean(m) && (d.rebuilt(info) || Boolean(repair));
    const color = m ? REMOTE : null;
    return h_flex()
      .id(key)
      .pl(22)
      .pr(8)
      .pt(8)
      .h(HEAD_H)
      .flex_none()
      .gap(6)
      .items_center()
      .text_size(11)
      .font_medium()
      .cursor_pointer()
      .hover((s) => s.text_color(t.foreground))
      .relative()
      .on_hover((on, cx) => {
        const row = on ? key : this.hoverRow === key ? null : this.hoverRow;
        if (row !== this.hoverRow) { this.hoverRow = row; cx.notify(); }
      })
      .on_mouse_down("left", (e) => this.dragStart({ level: "machine", name: m }, e))
      .on_click((_e, cx) => {
        if (this.dragged || this.drag?.moved) { this.dragged = false; return; }
        this.fold(key, cx);
      })
      .child(this.grip(t, ghost || this.hoverRow === key, 10, MACHINE_GRIP))
      .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(12).flex_none().text_color(color ?? t.dim))
      .child(div().truncate().text_color(color ?? t.dim).child(m || (window()?.platform === "macos" ? "This Mac" : "This computer")))
      .child(div().text_color(t.dim).child(String(count)))
      .when(needs > 0, (el) => el.child(div().text_color(t.accent).child(`\u00b7 ${needs} need${needs === 1 ? "s" : ""} you`)))
      .child(div().flex_1())
      .when(info?.keeps_running_after_logout === false, (el) => el.child(div().id(`machine-logout-${m}`).flex_none().text_color(t.blocked)
        .tooltip("Agents stop when you disconnect. Click for the fix.")
        .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "machine-add", kind: "dialog", width: 560 }); })
        .child("\u26a0")))
      .when(Boolean(m) && !connected && !rebuilt, (el) => el.child(div().flex_none().text_color(t.dim).child((info?.state ?? "asleep").replace(/_/g, " "))))
      .when(rebuilt, (el) => el.child(div().id(`machine-connect-${m}`).flex_none().max_w(160).truncate()
        .text_color(repair?.error ? t.blocked : t.muted).hover((s) => s.text_color(t.foreground))
        .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
        .on_click((_e, cx) => { cx.stop_propagation(); d.reconnect(info, cx); })
        .child(repair?.busy ? "Connecting\u2026" : repair?.error || "rebuilt \u00b7 Connect")))
      .when(connected, (el) => el.child(div().id(`machine-add-${m || "local"}`).flex_none().p(2).rounded(4)
        .tooltip(`New space on ${m || "this computer"}`).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m }); })
        .child(svg("mods/workspace-chrome/plus.svg").size(12))))
      .when(Boolean(m), (el) => el.child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim)))
      .when(!open, (el) => el
        .when(Boolean(top) && top !== "idle", (el) => el.child(this.paneStatus(t, top, true)))
        .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
  }

  // Under a machine that needs a login: the command to run, and Copy.
  loginRow(t, m, login) {
    return v_flex().id(`machine-login-${m}`).pl(28).pr(16).h(48).flex_none().justify_center().gap(3)
      .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
      .child(h_flex().gap(5).items_center()
        .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
        .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4).text_size(11).text_color(t.foreground)
          .bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
          .child(this.copiedLogin === login ? "Copied" : "Copy")));
  }

  // Under a machine with no spaces: "Loading\u2026" while Herdr reads them, else a + to make its first.
  noteRow(t, m, loading) {
    return h_flex().id(`machine-note-${m || "local"}`).pl(28).h(ROW_H).flex_none().gap(7).items_center().text_size(12).text_color(t.dim)
      .when(!loading, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m }))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)))
      .child(loading ? "Loading\u2026" : "New space there");
  }

  // A space on a wash of its colour: its tile (a worktree: the branch sign, under its checkout), name, tab count and
  // git, and folded its most urgent state. A click goes to it, the chevron folds its tabs, right-click opens its menu,
  // and a drag (by the whole row) moves it among its machine's spaces. ghost: drawn in the lifted copy, its grip lit.
  spaceRow(t, r, ghost = false) {
    const { w, g, tree, color, top } = r;
    const open = !this.folded.has(r.key);
    return h_flex()
      .id(r.key)
      .relative()
      .pl(22)
      .pr(8)
      .h(ROW_H)
      .flex_none()
      .gap(6)
      .items_center()
      .bg(color + (w.active ? "40" : "26"))
      .cursor_pointer()
      .hover((el) => el.bg(color + "40"))
      .on_hover((on, cx) => {
        const key = on ? r.key : this.hoverRow === r.key ? null : this.hoverRow;
        if (key !== this.hoverRow) { this.hoverRow = key; cx.notify(); }
      })
      .on_mouse_down("left", (e) => this.dragStart({ level: "space", machine: r.machine, name: w.id }, e))
      .on_mouse_down("right", () => this.menu(w))
      .on_click(() => {
        if (this.dragged || this.drag?.moved) { this.dragged = false; return; }
        run("space.select", { id: w.id });
      })
      .child(this.grip(t, ghost || this.hoverRow === r.key))
      .child(div().id(`fold-${r.key}`).flex_none().p(2).rounded(4).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); this.fold(r.key, cx); })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).text_color(t.dim)))
      .child(tree
        ? svg("mods/workspace-chrome/branch.svg").size(13).flex_none().text_color(t.dim)
        : h_flex().size(16).flex_none().rounded(4).bg(color).items_center().justify_center().text_size(9.5).font_bold()
          .text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?"))
      .child(h_flex().flex_initial().min_w(SIDE_MIN).gap(6).items_center()
        .child(div().min_w(0).truncate().font_medium()
          .text_color(top === "input" ? t.accent : top === "error" ? t.ansi1 : t.foreground).child(w.name))
        .when(r.tabs.length > 1, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(r.tabs.length)))))
      .child(g ? this.gitTail(t, g, tree, w.name) : div().flex_1())
      .when(!open && Boolean(top) && top !== "idle", (el) => el.child(this.paneStatus(t, top, true)));
  }

  // A tab under its space: its name (in tab mode the window's work), the state and message of the omo pane in it that
  // most needs you, else Herdr's state for the agent in it. A click goes to it.
  tabRow(t, r, x, last, now) {
    const p = x.top;
    const leaf = { id: `tb-${x.ctx.id}`, label: x.label, msg: p?.msg ?? "", state: x.state, since: p?.since ?? null, resumeAt: p?.resumeAt ?? null, machine: x.machine };
    return this.leafRow(t, leaf, last, now, r.w.active && x.ctx.active, r.color, () => run("tab.select", { id: x.ctx.id }));
  }

  // On the rail: a space as a segment of its own, a card washed and edged in its colour (another machine's in yellow),
  // floating with room around it and a soft shadow: its tile with its initial and its tab count on the corner, ringed in the accent while
  // shown (when the card's edge brightens too), its name under it, and under that a dot for each of its agents; on
  // hover its name and the message of the tab that most needs you. A click goes to it.
  railSpace(t, r) {
    const { w, color, top, msg } = r;
    const remote = Boolean(w.machine);
    const on = w.active;
    const lit = Boolean(top) && top !== "idle";
    return v_flex()
      .id(`rs-${w.id}`)
      .flex_none()
      .mx(7)
      .my(4)
      .py(6)
      .gap(2)
      .items_center()
      .rounded(8)
      .shadow_md()
      .border_1()
      .border_color((remote ? REMOTE : color) + (on ? "aa" : "40"))
      .bg(remote ? REMOTE_ROW : color + "17")
      .hover((st) => st.bg(remote ? REMOTE_HOVER : color + "2b"))
      .tooltip(`${remote ? `${w.machine}/` : ""}${w.name}${msg ? ` \u00b7 ${msg}` : ""}`)
      .on_click(() => run("space.select", { id: w.id }))
      .child(h_flex().relative().size(26).rounded(8).items_center().justify_center()
        .border_1().border_color(on ? t.accent : "#00000000")
        .when(on, (el) => el.bg(remote ? REMOTE_SELECTED : t.selected))
        .child(h_flex().size(18).rounded(5).bg(color).items_center().justify_center().text_size(10.5).font_bold()
          .text_color("#ffffff").opacity(on || lit ? 1 : 0.7).child([...w.name][0]?.toUpperCase() ?? "?"))
        .when(r.tabs.length > 1, (el) => el.child(div().absolute().bottom(-3).left(-3).h(12).min_w(12).px(2).rounded(6)
          .bg(t.chrome).border_1().border_color(t.border).flex().items_center().justify_center().text_size(8.5)
          .text_color(t.muted).child(String(r.tabs.length)))))
      .child(div().max_w(60).truncate().text_size(9.5).text_color(on ? t.foreground : remote ? REMOTE : t.muted).child(w.name))
      .when(r.agents.length > 0, (el) => el.child(this.agentDots(t, r.agents)));
  }

  // A dot per agent, in its state's colour: pulsing while it works, runs in the background, waits on you or failed;
  // solid once finished; a ring while idle. They wrap into a grid six wide, under the space's name.
  agentDots(t, states) {
    const dot = (s) => {
      const color = s === "input" ? t.accent : s === "error" ? t.ansi1 : s === "working" ? t.working
        : s === "background" ? t.ansi5 : s === "done" || s === "partial" ? t.done : (t.idle ?? t.dim);
      if (!s || s === "idle") return div().size(5).rounded(3).border_1().border_color(color);
      return div().size(5).rounded(3).bg(color)
        .when(Boolean(RAIL_PULSE[s]), (el) => el.loop("opacity", { from: 0.3, to: 1, period: RAIL_PULSE[s] }));
    };
    return h_flex().flex_wrap().justify_center().gap(3).max_w(46).mt(1).children(states.map(dot));
  }

  // Which tmux window each Herdr terminal running a tmux client shows, as shared "tmux.tabs" ({<terminal>: {session,
  // tabbed, window, index, panes}}): session "[machine/]<name>" (a tab mode tab's "<name>~<id>" read as its session),
  // tabbed whether it is such a tab, and panes that window's, as omo-status names them ("[machine/]%3"). A client is
  // matched to its terminal by pid, here and on each connected machine. The picker reads it too.
  loadTabs(cx) {
    if (this.loadingTabs) return;
    this.loadingTabs = true;
    const names = ["", ...this.spaceData.machines.filter((k) => k.state === "connected").map((k) => k.name)];
    const clientsF = `c${SEP}#{client_pid}${SEP}#{session_name}${SEP}#{window_id}${SEP}#{window_index}`;
    const panesF = `p${SEP}#{pane_id}${SEP}#{window_id}`;
    cx.spawn(async (cx) => {
      const outs = await Promise.all(names.map((m) => (m
        ? exec("sh", ["-c", 'exec tmux -u list-clients -F "$1" \\; list-panes -a -F "$2"', "tmux", clientsF, panesF], { on: m, timeout: 5000 })
        : exec("/opt/homebrew/bin/tmux", ["-u", "list-clients", "-F", clientsF, ";", "list-panes", "-a", "-F", panesF], { timeout: 5000 }))
        .then((r) => (r.code === 0 ? r.stdout : ""), () => "")));
      const map = {};
      const terms = terminals().filter(tmuxClient);
      names.forEach((m, i) => {
        const prefix = m ? `${m}/` : "";
        const clients = new Map(), windows = new Map();
        for (const line of outs[i].split("\n")) {
          const f = line.split(SEP);
          if (f[0] === "c") clients.set(f[1], f.slice(2));
          else if (f[0] === "p") windows.set(f[2], [...(windows.get(f[2]) ?? []), `${prefix}${f[1]}`]);
        }
        for (const term of terms) {
          if ((term.address.includes("/") ? term.address.split("/")[0] : "") !== m) continue;
          const c = clients.get(String(term.foreground?.pid));
          if (!c) continue;
          const [session, win, index] = c;
          const own = /^(.+)~\d+$/.exec(session)?.[1];
          map[term.address] = { session: `${prefix}${own ?? session}`, tabbed: Boolean(own), window: win, index, panes: windows.get(win) ?? [] };
        }
      });
      this.loadingTabs = false;
      if (JSON.stringify(shared("tmux.tabs") ?? {}) !== JSON.stringify(map)) {
        setShared("tmux.tabs", map);
        cx.notify();
      }
    });
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
    // A tmux client came or went: which window each shows is asked now, not at the next 3 s look.
    const clientsSig = all.filter(tmuxClient).map((x) => `${x.address}:${x.foreground?.pid}`).join(" ");
    if (clientsSig !== this.clientsSig) { this.clientsSig = clientsSig; this.loadTabs(cx); }
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
    const count = (states, ...want) => states.filter((s) => want.includes(s)).length;
    const topOf = (states) => states.reduce((m, s) => ((PANE_RANK[s] ?? 0) > (PANE_RANK[m] ?? 0) ? s : m), null);
    const urgent = (ps) => ps.reduce((m, p) => (!m || paneRank(p) > paneRank(m) ? p : m), null);
    // Each space with its tabs, and each tab with the omo panes of the tmux window it shows (shared "tmux.tabs",
    // loadTabs): all of its session's for a tmux client not in tab mode.
    const ps = panes();
    const tabsOf = shared("tmux.tabs") ?? {};
    const colors = spaceColors();
    const keyOf = (p) => (p.machine ? `${p.machine}/${p.session}` : p.session);
    const bySession = new Map();
    for (const p of this.tmuxPanes) bySession.set(keyOf(p), [...(bySession.get(keyOf(p)) ?? []), p]);
    const shownSessions = new Set();
    const spaceRows = this.spaceData.ordered(ps).map(({ w, g, tree }) => {
      const tabs = (w.tabs ?? []).map((ctx) => {
        const term = ps.find((p) => p.tab === ctx.id && p.terminal && tabsOf[p.terminal])?.terminal;
        const m = term ? tabsOf[term] : null;
        if (m) shownSessions.add(m.session);
        const all = m ? bySession.get(m.session) ?? [] : [];
        const omo = m?.tabbed ? all.filter((p) => m.panes.includes(p.pane)) : all;
        const top = urgent(omo);
        const lead = ps.find((p) => p.tab === ctx.id);
        return {
          ctx, m, omo, top, machine: w.machine ?? "",
          state: top?.state ?? HERDR_STATE[ctx.status] ?? null,
          label: ctx.named ? ctx.name : m ? m.session.split("/").pop() : lead?.program?.name || lead?.title || ctx.name,
        };
      });
      const session = tabs.find((x) => x.m)?.m.session ?? null;
      // In tab mode a window whose tab you closed keeps its omo panes: they follow the tabs, and showing one opens its
      // tab again.
      const listed = new Set(tabs.flatMap((x) => x.omo.map((p) => p.pane)));
      const loose = session ? (bySession.get(session) ?? []).filter((p) => !listed.has(p.pane)) : [];
      return {
        w, g, tree, tabs, loose, session, key: `sp:${w.id}`, machine: w.machine ?? "",
        states: [...tabs.map((x) => x.state), ...loose.map((p) => p.state)],
        // Its agents' states, in tab order: each omo pane once, and the agent of a tab that isn't tmux.
        agents: [...new Map([...tabs.flatMap((x) => x.omo), ...loose].map((p) => [p.pane, p.state])).values(),
          ...tabs.filter((x) => !x.m && x.state).map((x) => x.state)],
        top: topOf([...tabs.map((x) => x.state), ...loose.map((p) => p.state)]),
        msg: urgent([...tabs.flatMap((x) => (x.top ? [x.top] : [])), ...loose])?.msg ?? "",
        color: this.spaceColor(t, w, session, colors),
      };
    });
    // The tree, per machine (this computer first unless you dragged the machines into another order): its spaces in
    // Herdr's order with their tabs, then the omo sessions no space shows. Rows know where they sit, so a move slides,
    // and a drag can lift a space with its tabs or a machine with everything under it.
    const d = this.spaceData;
    const found = ["", ...[...new Set([...spaceRows.map((r) => r.machine), ...d.machines.map((k) => k.name),
      ...Object.keys(d.reconnecting), ...this.tmuxPanes.map((p) => p.machine)])].filter(Boolean).sort()];
    const placed = (m) => (this.machineOrder.includes(m) ? this.machineOrder.indexOf(m) : Infinity);
    const held = this.drag?.moved ? this.drag : null;
    // While a space or a machine is dragged, the others stand in the order it would leave them.
    const standIn = (list, id) => {
      const ids = held.others.map((o) => o.name);
      ids.splice(held.index, 0, held.name);
      const byId = new Map(list.map((x) => [id(x), x]));
      return [...ids.filter((i) => byId.has(i)).map((i) => byId.get(i)), ...list.filter((x) => !ids.includes(id(x)))];
    };
    let machineKeys = [...found].sort((a, b) => placed(a) - placed(b) || found.indexOf(a) - found.indexOf(b));
    if (held?.level === "machine") machineKeys = standIn(machineKeys, (m) => m);
    const treeItems = [];
    const tintOrder = [];
    let ghostRows = null;
    let rowY = 0;
    const add = (key, h, draw) => { treeItems.push({ key, y: rowY, h, draw }); rowY += h; };
    this.blocks = new Map();
    this.machineBlocks = [];
    // One machine's rows, its header first.
    const section = (m) => {
      let mine = spaceRows.filter((r) => r.machine === m);
      const hidden = serverTree(this.tmuxPanes.filter((p) => p.machine === m && !shownSessions.has(keyOf(p))))[0]?.sessions ?? [];
      const own = (key) => key.slice(m ? m.length + 1 : 0);
      tintOrder.push({ machine: m, names: [...new Set([...mine.flatMap((r) => (r.session ? [own(r.session)] : [])), ...hidden.map((s) => s.name)])] });
      const states = mine.flatMap((r) => r.states);
      add(`srv:${m}`, HEAD_H, (ghost) => this.machineHead(t, m, { count: mine.length, needs: count(states, "input", "error"), top: topOf(states) }, ghost));
      // A rebuilt machine shows only its header, whose Connect puts it back.
      const info = d.machines.find((k) => k.name === m) ?? d.reconnecting[m]?.machine;
      if (this.folded.has(`srv:${m}`) || (m && (d.rebuilt(info) || d.reconnecting[m]))) return;
      if (m && info?.state === "needs_login") add(`login:${m}`, 48, () => this.loginRow(t, m, `hc machine login ${m}`));
      if (!mine.length) add(`note:${m}`, ROW_H, () => this.noteRow(t, m, d.loading(m || null)));
      if (held?.level === "space" && held.machine === m) mine = standIn(mine, (r) => r.w.id);
      const blocks = [];
      for (const r of mine) {
        const rows = [{ key: r.key, draw: (ghost) => this.spaceRow(t, r, ghost) }];
        if (!this.folded.has(r.key)) {
          r.tabs.forEach((x, i) => {
            rows.push({ key: `tb-${x.ctx.id}`, draw: () => this.tabRow(t, r, x, i === r.tabs.length - 1 && !r.loose.length, now) });
            // A tmux client not in tab mode lists its session's omo panes under its tab, as does a window running
            // more than one.
            const kids = x.m && (!x.m.tabbed || x.omo.length > 1) ? x.omo : [];
            kids.forEach((p, j) => rows.push({ key: `tp-${x.ctx.id}-${p.pane}`,
              draw: () => this.paneRow(t, p, j === kids.length - 1, now, p.pane === shownPane, r.color, 1) }));
          });
          r.loose.forEach((p, i) => rows.push({ key: `tp-${p.pane}`,
            draw: () => this.paneRow(t, p, i === r.loose.length - 1, now, p.pane === shownPane, r.color) }));
        }
        const h = rows.length * ROW_H;
        blocks.push({ name: r.w.id, y: rowY, h, rows: rows.map((x) => x.key), hs: rows.map(() => ROW_H) });
        if (held?.level === "space" && held.machine === m && held.name === r.w.id) {
          // Its landing place stays open as an outline while its rows follow the pointer.
          treeItems.push({ key: "drag-slot", y: rowY, h, draw: () => div().h(h).border_1().border_color(t.input) });
          ghostRows = rows;
        } else {
          rows.forEach((x, i) => treeItems.push({ key: x.key, y: rowY + i * ROW_H, h: ROW_H, draw: () => x.draw(false) }));
        }
        rowY += h;
      }
      this.blocks.set(m, blocks);
      if (!hidden.length) return;
      // Folded until opened: a click on one of their panes opens its session in Herdr.
      const key = `nih:${m}`, open = this.folded.has(key);
      const quiet = hidden.flatMap((s) => s.panes).map((p) => p.state);
      add(key, HEAD_H, () => this.branch(t, { key, open, glyph: "terminal", label: "Not in Herdr", color: null, count: hidden.length, needs: count(quiet, "input", "error"), top: topOf(quiet) }));
      if (!open) return;
      for (const s of hidden) {
        add(s.key, ROW_H, () => this.sessionRow(t, s));
        if (!this.folded.has(s.key)) s.panes.forEach((p, i) => add(`tp-${p.pane}`, ROW_H, () => this.paneRow(t, p, i === s.panes.length - 1, now, p.pane === shownPane, tintOf(s))));
      }
    };
    for (const m of machineKeys) {
      const start = rowY, first = treeItems.length;
      section(m);
      const items = treeItems.splice(first);
      const h = rowY - start;
      this.machineBlocks.push({ name: m, y: start, h, rows: items.map((x) => x.key), hs: items.map((x) => x.h) });
      if (held?.level === "machine" && held.name === m) {
        // Its landing place stays open as an outline while its rows follow the pointer.
        treeItems.push({ key: "drag-slot", y: start, h, draw: () => div().h(h).border_1().border_color(t.input) });
        ghostRows = items;
      } else {
        treeItems.push(...items);
      }
    }
    this.syncTints(tintOrder, cx);
    if (!collapsed) this.plan(treeItems, cx);
    const motion = this.motion;
    // A row in its wrapper: drawn first where it was (or clear, coming in), then let go to slide home.
    // The list's own background, so a row sliding over another hides it instead of mixing their text.
    const tmuxRows = treeItems.map((x) => {
      const f = motion?.fly[x.key];
      return div().id(`mv-${x.key}-${motion?.gen[x.key] ?? 0}`).flex_none().relative().bg(t.chrome)
        .top(f?.top ?? 0).opacity(f?.fade ? 0 : 1).transition("top", MOTION).transition("opacity", MOTION)
        .child(x.draw());
    });
    // The lifted copy: a full-width layer at the pointer's height, holding a raised card of the rows.
    const lifted = held && ghostRows
      ? div().id("drag-ghost").absolute().left(0).top(held.top + held.dy).w_full().px(8)
        .child(div().overflow_hidden().bg(t.popover).border_1().border_color(t.input).shadow_lg()
          .child(v_flex().children(ghostRows.map((r) => r.draw(true)))))
      : null;
    // Agents outside tmux get a heading of their own only below the tmux tree.
    const outside = list.length > 0;
    const herdrRows = outside && this.folded.has("srv:herdr")
      ? []
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);
    const rows = collapsed
      ? [...machineKeys.flatMap((m) => spaceRows.filter((r) => r.machine === m)).map((r) => this.railSpace(t, r)), ...list.flatMap((a, i) => withKids(a, spaceRows.length + i))]
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
      // On the rail the list is named too; the sidebar's toggle is at its top (workspace-chrome-tmux).
      .when(collapsed, (el) => el.child(h_flex().h(31).flex_none().justify_center().items_center().text_size(9).font_semibold()
        .text_color(t.dim).child("SPACES")))
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
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Spaces"))
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
      .child(v_flex().id("ag-list").relative().flex_1().min_h(0).pl(collapsed ? 0 : 8).pr(collapsed ? RAIL_LANE : 8).overflow_y_scrollbar().mode(collapsed ? "scrolling" : "always")
        .when(Boolean(this.drag?.moved), (el) => el.cursor_grabbing())
        .on_mouse_move((e, cx) => this.dragMove(e, cx))
        .on_mouse_up("left", (_e, cx) => this.dragEnd(cx))
        .on_hover((on, cx) => { if (!on) this.dragEnd(cx, false); })
        .children(rows)
        .when(Boolean(lifted) && !collapsed, (el) => el.child(lifted)));
  }
}
