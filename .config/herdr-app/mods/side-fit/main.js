// side-fit: keeps the terminal wide when the window narrows, and arranges the right column (the netrunner layout).
//
// The side panel and the priority queue share one column at the right (`right`) as an accordion: one part is expanded
// and the other, when open, folds to a 40 px bar of its own (`queue-bar`, `panel-bar`, drawn by this mod with props
// {bar}). Toggles still show and hide `panel` and `queue`, so a part shown from anywhere (its status chip, Files and
// Changes, Cmd+Alt+B, Cmd+Shift+J, a new queue card, a click on its bar) expands and the other folds, and the expanded
// part hidden closes while the folded one expands again. A folded queue with no cards left closes. The column keeps the
// side panel's width while the panel is open, expanded or folded, so switching parts never resizes the terminal.
//
// With room for everything, the sidebar and the right column dock beside the terminal as the layout has them. Without
// it they float over the terminal instead of squeezing it, as drawers: a click on the terminal closes them (a faint
// backdrop under them takes that click). Narrowing on, they fold one at a time:
// 1. the right column floats at the right edge (the sidebar too, if docking it would squeeze the terminal);
// 2. once too little terminal shows beside them, the sidebar folds to its rail;
// 3. then the right column closes, leaving the terminal nearly the whole window.
// What folded comes back as the window widens again, unless you opened or closed it yourself in between.
//
// While it floats, the right column keeps its slot in the layout, shown or hidden as before but 0 px wide, so every
// toggle still acts on the layout, and this copies what the slot shows into a window: Herdr's layout commands never
// reach a window's own nodes. The sidebar's toggle (workspace-chrome-tmux) runs `side-fit.sidebar`, so expanding knows
// whether to dock or float.
//
// Two copies measure: `fit-width` (0 px tall, across the work column), which also steers, and `fit-height` (0 px wide,
// beside the terminal). Copies share this module's state, the backdrop's too.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run, openOverlay, closeOverlay, props, shared, setShared, window, nextCommand, checking, theme, settings } from "herdr";
import { isHud, display, frame, caps, readout, title as hudTitle } from "./hud.js";

// netrunner.json's fixed sizes: tab bar, status bar, the work row's padding and gap, the focus edge, the sidebar divider,
// the expanded sidebar's brand row.
const TABS = 42, STATUS = 28, PAD = 8, GAP = 8, EDGE = 3, DIVIDER = 1, BRAND = 46;
// Narrowest the terminal gets with things docked beside it: about 80 columns of 14 px JetBrains Mono, with padding.
const TERMINAL_MIN = 720;
// Least terminal left showing beside what floats over it; narrower, the sidebar folds, then the right side closes.
const VISIBLE_MIN = 420;
// The floating right column narrows (down to FLOAT_MIN) to leave this much terminal to click.
const CLICK_MIN = 160, FLOAT_MIN = 240;
const PANEL_MIN = 280, QUEUE_MIN = 340, PANEL_WIDTH = 420, QUEUE_WIDTH = 460, SIDEBAR_WIDTH = 268, SIDEBAR_OPEN = 160;
// What floats gets a solid base under the layout's glass, or the terminal's text would show through it.
const BASE = "#0a0a14f5", LINE = { width: 1, color: "#00f0ff40" }, SCRIM = "#05050b40";
// The right column's parts, top to bottom, and the side panel's views as its bar names them.
const PARTS = ["queue", "panel"];
const VIEWS = { files: "Files", changes: "Changes", mcp: "MCP", omo: "omo in tmux", jobs: "Jobs", prds: "PRDs", reviews: "Reviews" };

// acc: the right column as this last arranged it. rightPx, rightFor: the docked width this last gave the column, and the
// part it was sized for, so a drag of its edge can be told from its own resizes.
const S = { body: 0, win: 0, lastWin: 0, folded: {}, windows: {}, sigs: {}, dueAt: 0, armed: false, passes: 0, acc: null, rightPx: null, rightFor: null };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const rail = () => (window()?.platform === "macos" ? 84 : 44);
const prefs = () => shared("side.fit") ?? {};
function setPrefs(patch) {
  const now = prefs(), next = { ...now, ...patch };
  if (JSON.stringify(now) !== JSON.stringify(next)) setShared("side.fit", next);
}

// A docked node as a window shows it: ids prefixed, a stack as the child it shows, mods told they float (`overlay`).
function copy(node) {
  if (node.type === "stack") {
    const shown = node.children?.find((c) => c.id === node.active) ?? node.children?.[0];
    const { background, border, radius, padding } = node;
    return { id: `fit-${node.id}`, type: "column", background, border, radius, padding, children: shown ? [copy(shown)] : [] };
  }
  const out = { ...node, id: `fit-${node.id}` };
  delete out.window_drag; delete out.hidden; delete out.min; delete out.max; delete out.floating;
  if (node.id === "brand") out.size = { px: BRAND };
  if (out.content?.mod) out.content = { ...out.content, props: { ...(out.content.props ?? {}), overlay: true } };
  if (node.children) out.children = node.children.filter((c) => !c.hidden).map(copy);
  return out;
}

const solid = (inner, look = {}) => ({ type: "column", background: BASE, border: LINE, radius: inner.radius ?? 0, shadow: "lg", ...look, children: [{ ...inner, size: undefined }] });

// A window over the terminal, or none (spec null). The same spec keeps the open one, so its mods keep their state.
// A new one opens before the old one closes, so nothing blinks; Herdr puts the newest window on top. The spec is in
// layout px, as Herdr sizes the window, but a window's `at` is in window px, so the zoom scales its place.
function place(part, spec) {
  const sig = spec ? JSON.stringify(spec) : null;
  if (S.sigs[part] === sig) return false;
  const old = S.windows[part], z = Number(settings().zoom);
  S.sigs[part] = sig;
  S.windows[part] = spec ? openOverlay({ kind: "window", frame: "none", width: spec.width, height: spec.height, at: { x: spec.x * z, y: spec.y * z }, layout: spec.layout }) : null;
  if (old) closeOverlay(old);
  return true;
}

// A part of the right column as the layout shows it: "open" (expanded), "bar" (folded to its bar) or "closed".
const partOf = (node, bar) => (!node.hidden ? "open" : !bar.hidden ? "bar" : "closed");

function read() {
  const root = layout();
  const nodes = Object.fromEntries(["sidebar", "right", "queue", "queue-bar", "panel", "panel-bar"].map((id) => [id, find(root, id)]));
  if (Object.values(nodes).some((node) => !node)) return null;
  const { sidebar, right } = nodes;
  const p = prefs();
  const sbPx = sidebar.size?.px ?? 0, rPx = right.size?.px ?? 0;
  const left = !sidebar.hidden, floating = left && Boolean(p.float);
  const acc = { queue: partOf(nodes.queue, nodes["queue-bar"]), panel: partOf(nodes.panel, nodes["panel-bar"]) };
  return {
    nodes, sidebar, right, p, sbPx, rPx, left, floating, acc,
    expanded: left && (floating || sbPx >= SIDEBAR_OPEN),
    open: sbPx >= SIDEBAR_OPEN ? sbPx : shared("sidebar.width") ?? SIDEBAR_WIDTH,
    pOpen: acc.panel !== "closed", qOpen: acc.queue !== "closed",
    pW: p.panel ?? PANEL_WIDTH, qW: p.queue ?? QUEUE_WIDTH,
  };
}

// The right column's width with these parts open: the side panel's while it is open, else the queue's; 0 with neither.
const rightWidth = (st, pOpen = st.pOpen, qOpen = st.qOpen) => (pOpen ? st.pW : qOpen ? st.qW : 0);

// The terminal that shows beside the sidebar and the right side: docked or floating, they take the same width of it.
function visible(st, { expanded = st.expanded, pOpen = st.pOpen, qOpen = st.qOpen } = {}) {
  const left = st.left ? (expanded ? st.open : rail()) + DIVIDER : 0;
  const right = rightWidth(st, pOpen, qOpen);
  return S.win - left - 2 * PAD - EDGE - (right ? right + GAP : 0);
}

// Shows and hides the parts, their bars and the column so the right column is `want` ({queue, panel}: open, bar or
// closed). True when it changed the layout.
function arrange(st, want) {
  S.acc = want;
  const shown = {
    right: want.queue !== "closed" || want.panel !== "closed",
    "queue-bar": want.queue === "bar", queue: want.queue === "open",
    "panel-bar": want.panel === "bar", panel: want.panel === "open",
  };
  let acted = false;
  for (const [id, on] of Object.entries(shown)) {
    if (Boolean(st.nodes[id].hidden) === !on) continue;
    run(on ? "layout.show" : "layout.hide", { id });
    acted = true;
  }
  // Both parts fill the column. Herdr keeps a node's size across layout changes, so a width saved while they were
  // columns of their own would read as a height here.
  for (const id of PARTS) {
    if (!st.nodes[id].size?.px) continue;
    run("layout.resize", { id, weight: 1 });
    acted = true;
  }
  return acted;
}

// The layout against what this last arranged: a part that came open expands and the other folds (both at once, as when
// Herdr starts, keep the queue), and an expanded part that closed hands the column to the folded one.
function accordion(st) {
  const now = st.acc, was = S.acc ?? now, want = { ...now };
  const other = (part) => (part === "queue" ? "panel" : "queue");
  if (now.queue === "open" && now.panel === "open") {
    const opened = PARTS.filter((part) => was[part] !== "open");
    want[other(opened.length === 1 ? opened[0] : "queue")] = "bar";
  }
  for (const part of PARTS) {
    if (was[part] === "open" && now[part] === "closed" && want[other(part)] === "bar") want[other(part)] = "open";
  }
  if (want.queue === "bar" && shared("omo.queue")?.items?.length === 0) {
    want.queue = "closed";
    if (want.panel === "bar") want.panel = "open";
  }
  return arrange(st, want);
}

// The docked column's width is the width of the part it is sized for, and a drag of its edge sets that part's width.
// Until the side panel has a width of its own, the layout's counts as its.
function widths(st) {
  const { p, rPx } = st, docked = p.right !== "float" && rPx > 0;
  if (docked && S.rightPx === null && p.panel === undefined && rPx >= PANEL_MIN) setPrefs({ panel: rPx });
  else if (docked && S.rightPx !== null && Math.abs(rPx - S.rightPx) > 0.5) {
    if (S.rightFor === "panel" && rPx >= PANEL_MIN) setPrefs({ panel: rPx });
    if (S.rightFor === "queue" && rPx >= QUEUE_MIN) setPrefs({ queue: rPx });
  }
  const q = prefs();
  return { ...st, p: q, pW: q.panel ?? PANEL_WIDTH, qW: q.queue ?? QUEUE_WIDTH };
}

function foldSidebar(st) {
  if (st.floating) setPrefs({ float: false });
  else if (st.sbPx >= SIDEBAR_OPEN) {
    setShared("sidebar.width", st.sbPx);
    run("layout.resize", { id: "sidebar", px: rail() });
  }
  setShared("sidebar.collapsed", true);
}

function expandSidebar(st) {
  setShared("sidebar.collapsed", false);
  if (S.win - st.open - DIVIDER - 2 * PAD - EDGE >= TERMINAL_MIN) run("layout.resize", { id: "sidebar", px: st.open });
  else setPrefs({ float: true });
}

function toggleSidebar() {
  const st = read();
  if (!st) return;
  S.folded.left = false;
  if (st.expanded) foldSidebar(st);
  else expandSidebar(st);
}

function closeDrawers() {
  const st = read();
  if (!st) return;
  if (st.floating) foldSidebar(st);
  if (st.p.right === "float") arrange(st, { queue: "closed", panel: "closed" });
}

// As the window narrows, fold what leaves too little terminal showing, the sidebar first; as it widens, bring back what
// this folded, the right side first. A part you opened or closed yourself since is yours again. True when it acted.
function fold(st) {
  const f = S.folded;
  if (f.left && st.expanded) f.left = false;
  if (f.right && (st.pOpen || st.qOpen)) f.right = null;
  const shrinking = S.win < S.lastWin;
  S.lastWin = S.win;
  let acted = false;
  if (shrinking) {
    if (st.expanded && visible(st) < VISIBLE_MIN) {
      foldSidebar(st);
      f.left = acted = true;
      st = { ...st, expanded: false, floating: false };
    }
    if ((st.pOpen || st.qOpen) && visible(st) < VISIBLE_MIN) {
      f.right = { ...st.acc };
      arrange(st, { queue: "closed", panel: "closed" });
      acted = true;
    }
    return acted;
  }
  const back = f.right && { pOpen: f.right.panel !== "closed", qOpen: f.right.queue !== "closed" };
  if (back && visible(st, back) >= VISIBLE_MIN) {
    arrange(st, f.right);
    st = { ...st, ...back };
    f.right = null;
    acted = true;
  }
  if (f.left && !f.right && st.left && visible(st, { expanded: true }) >= VISIBLE_MIN) {
    f.left = false;
    expandSidebar(st);
    acted = true;
  }
  return acted;
}

// True when it changed the layout, so another pass should follow once the change shows.
function steer() {
  let st = read();
  if (!st || !S.win || !S.body) return false;
  if (accordion(st)) return true;
  st = widths(st);
  if (S.win !== S.lastWin && fold(st)) return true;
  const fixed = 2 * PAD + EDGE, W = S.win, R = rail();

  const leftFloats = st.expanded && W - st.open - DIVIDER - fixed < TERMINAL_MIN;
  const leftDocked = !st.left ? 0 : (st.expanded && !leftFloats ? st.open : R) + DIVIDER;
  // With nothing open on the right it decides for the side panel alone, so opening it lands where it will stay.
  const rightOpen = st.pOpen || st.qOpen;
  const rightFloats = W - leftDocked - fixed - (rightOpen ? rightWidth(st) : st.pW) - GAP < TERMINAL_MIN;

  setPrefs({ right: rightFloats ? "float" : "dock", float: leftFloats });
  const rPx = rightFloats ? 0 : rightOpen ? rightWidth(st) : st.rPx;
  if (Math.abs(st.rPx - rPx) > 0.5) run("layout.resize", { id: "right", px: rPx });
  S.rightPx = rPx;
  S.rightFor = st.pOpen ? "panel" : "queue";
  if (st.left && Math.abs(st.sbPx - (leftDocked - DIVIDER)) > 0.5) {
    if (st.sbPx >= SIDEBAR_OPEN) setShared("sidebar.width", st.sbPx);
    run("layout.resize", { id: "sidebar", px: leftDocked - DIVIDER });
  }

  // Backdrop first, over the terminal's row and beside the docked sidebar; the drawers above it. A new backdrop would
  // land on top of them, so they reopen after it.
  const top = TABS, height = 2 * PAD + S.body;
  const sidebarOut = st.left && leftFloats, rightOut = rightFloats && rightOpen;
  if (place("backdrop", sidebarOut || rightOut ? { x: leftDocked, y: top, width: W - leftDocked, height, layout: { type: "block", background: SCRIM, content: { mod: "side-fit", props: { backdrop: true } } } } : null)) {
    for (const part of ["sidebar", "right"]) S.sigs[part] = undefined;
  }
  place("sidebar", sidebarOut ? {
    x: 0, y: 0, width: st.open, height: TABS + height + STATUS,
    layout: solid(copy(st.sidebar), { radius: 0, border: { width: 1, color: LINE.color } }),
  } : null);
  const room = W - (sidebarOut ? st.open : leftDocked) - 2 * PAD - CLICK_MIN;
  const w = Math.min(rightWidth(st), Math.max(FLOAT_MIN, room));
  place("right", rightOut ? { x: W - PAD - w, y: top + PAD, width: w, height: S.body, layout: solid(copy(st.right), { radius: 10 }) } : null);
  return false;
}

// Steers once the size has held still a moment, so dragging the window's edge doesn't reopen the windows every frame.
// A pass that changed the layout steers again shortly, a few times at most.
function later(cx, ms) {
  S.dueAt = Date.now() + ms;
  if (S.armed) return;
  S.armed = true;
  const wait = (cx, delay) => cx.timer.after(delay, (cx) => {
    const left = S.dueAt - Date.now();
    if (left > 0) return wait(cx, left);
    S.armed = false;
    if (steer() && ++S.passes < 6) later(cx, 60);
    else S.passes = 0;
  });
  wait(cx, ms);
}

// A folded part's bar: its name and what it holds. A click expands it (the other part folds); its x closes it.
function bar(part) {
  const t = theme(), queue = part === "queue";
  const items = queue ? shared("omo.queue")?.items ?? [] : [];
  const needs = items.filter((i) => !i.pinned && (i.kind === "input" || i.kind === "error" || i.kind === "blocked")).length;
  const title = queue ? "PRIORITY QUEUE" : VIEWS[find(layout(), "panel-body")?.active] ?? "Side panel";
  const detail = queue
    ? needs ? `${needs} need${needs === 1 ? "s" : ""} you` : `${items.length} card${items.length === 1 ? "" : "s"}`
    : shared("tmux.where")?.cwd?.split("/").filter(Boolean).pop() ?? "";
  const hud = isHud();
  return h_flex().id(`side-fit-${part}-bar`).size_full().px(12).gap(10).items_center().overflow_hidden().cursor_pointer()
    .when(!hud, (el) => el.rounded(10).hover((s) => s.bg(t.hover)))
    .when(hud, (el) => el.relative().children(frame(8, { bg: t.chrome, line: (queue ? t.accent : t.working) + "4d" })).hover((s) => s.opacity(0.8)))
    .tooltip(`Expand ${queue ? "the priority queue" : title}`)
    .on_click(() => run("layout.show", { id: part }))
    .child(svg("mods/workspace-chrome/chevron-right.svg").size(13).flex_none().text_color(t.dim).when(hud, (el) => el.relative()))
    .when(queue && !hud, (el) => el.child(h_flex().h(16).gap(3).flex_none().items_end()
      .child(div().w(3).h(16).bg(t.accent)).child(div().w(3).h(10).bg(t.working))))
    .when(!hud, (el) => el.child(div().flex_none().text_size(12.5).font_bold().text_color(t.foreground)
      .when(queue, (el) => el.font_family(settings().font_family ?? "JetBrains Mono")).child(title)))
    .when(hud, (el) => el.child(hudTitle(t, queue ? "Priority queue" : title, 15).relative()))
    .when(!hud, (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(needs ? t.accent : t.dim).child(detail)))
    .when(hud && queue, (el) => el.child(h_flex().relative().flex_1().min_w(0).gap(6).items_center()
      .child(readout(t, needs || items.length, { status: needs ? t.accent : null, h: 18 }))
      .child(caps(needs ? `need${needs === 1 ? "s" : ""} you` : items.length === 1 ? "card" : "cards", 12, 600).text_color(needs ? t.accent : t.dim))))
    .when(hud && !queue, (el) => el.child(div().relative().flex_1().min_w(0).truncate().font_family(display()).font_weight(600).text_size(13.5).text_color(t.dim).child(detail)))
    .child(div().id(`side-fit-${part}-close`).size(24).flex().flex_none().items_center().justify_center().rounded(hud ? 0 : 4).when(hud, (el) => el.relative())
      .hover((s) => s.bg(t.hover)).tooltip("Close")
      .on_click((_e, cx) => { cx.stop_propagation(); run("layout.hide", { id: `${part}-bar` }); })
      .child(svg("mods/workspace-chrome/x.svg").size(13).text_color(t.dim)));
}

export default class SideFit extends View {
  init(_props, cx) {
    this.measure = props()?.measure;
    if (checking() || this.measure !== "width") return;
    cx.spawn(async (cx) => {
      for (;;) {
        if (await nextCommand() === "sidebar") toggleSidebar();
        cx.notify();
      }
    });
  }

  render(cx) {
    if (props()?.backdrop) {
      return div().id("side-fit-backdrop").size_full().on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); closeDrawers(); });
    }
    if (props()?.bar) return bar(props().bar);
    if (this.measure === "width" && !checking()) later(cx, 0);
    // Sizes come in window px; everything here is in layout px, which Herdr's zoom scales.
    return div().id("side-fit").size_full().on_size_change((size, cx) => {
      const z = Number(settings().zoom);
      if (this.measure === "height") {
        if (Math.abs(size.height / z - S.body) < 0.5) return;
        S.body = size.height / z;
      } else {
        const sidebar = find(layout(), "sidebar");
        const win = size.width / z + (sidebar && !sidebar.hidden ? (sidebar.size?.px ?? 0) + DIVIDER : 0);
        if (Math.abs(win - S.win) < 0.5) return;
        S.win = win;
      }
      later(cx, 150);
    });
  }
}
