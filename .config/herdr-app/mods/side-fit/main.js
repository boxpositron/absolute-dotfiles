// side-fit: keeps the terminal wide when the window narrows (the netrunner layout).
//
// With room for everything, the sidebar, the side panel and the priority queue dock beside the terminal as the layout
// has them. Without it they float over the terminal instead of squeezing it, as drawers: a click on the terminal closes
// them (a faint backdrop under them takes that click). Narrowing on, they fold one at a time:
// 1. the side panel and the queue float at the right edge (the sidebar too, if docking it would squeeze the terminal);
// 2. once too little terminal shows beside them, the sidebar folds to its rail;
// 3. then the side panel and the queue close, leaving the terminal nearly the whole window.
// What folded comes back as the window widens again, unless you opened or closed it yourself in between.
//
// While they float, the side panel and the queue keep their slots in the layout, shown or hidden as before but 0 px wide,
// so every toggle that shows, hides or switches them (status chips, Files and Changes, Cmd+Alt+B, Cmd+Shift+J, a
// Ctrl+clicked file, a new queue card) still acts on the layout, and this copies what the slots show into windows: Herdr's
// layout commands never reach a window's own nodes. The sidebar's toggle (workspace-chrome-tmux) runs
// `side-fit.sidebar`, so expanding knows whether to dock or float.
//
// Two copies measure: `fit-width` (0 px tall, across the work column), which also steers, and `fit-height` (0 px wide,
// beside the terminal). Copies share this module's state, the backdrop's too.
import { View, div } from "gpui-kit";
import { layout, run, openOverlay, closeOverlay, props, shared, setShared, window, nextCommand, checking } from "herdr";

// netrunner.json's fixed sizes: tab bar, status bar, the work row's padding and gap, the focus edge, the sidebar divider,
// the expanded sidebar's brand row.
const TABS = 42, STATUS = 28, PAD = 8, GAP = 8, EDGE = 3, DIVIDER = 1, BRAND = 46;
// Narrowest the terminal gets with things docked beside it: about 80 columns of 14 px JetBrains Mono, with padding.
const TERMINAL_MIN = 720;
// Least terminal left showing beside what floats over it; narrower, the sidebar folds, then the right side closes.
const VISIBLE_MIN = 420;
// The side panel and the queue floating together narrow (down to FLOAT_MIN each) to leave this much terminal to click.
const CLICK_MIN = 160, FLOAT_MIN = 240;
const PANEL_MIN = 280, QUEUE_MIN = 340, PANEL_WIDTH = 420, QUEUE_WIDTH = 460, SIDEBAR_WIDTH = 268, SIDEBAR_OPEN = 160;
// What floats gets a solid base under the layout's glass, or the terminal's text would show through it.
const BASE = "#0a0a14f5", LINE = { width: 1, color: "#00f0ff40" }, SCRIM = "#05050b40";

const S = { body: 0, win: 0, lastWin: 0, folded: {}, windows: {}, sigs: {}, dueAt: 0, armed: false };

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
// A new one opens before the old one closes, so nothing blinks; Herdr puts the newest window on top.
function place(part, spec) {
  const sig = spec ? JSON.stringify(spec) : null;
  if (S.sigs[part] === sig) return false;
  const old = S.windows[part];
  S.sigs[part] = sig;
  S.windows[part] = spec ? openOverlay({ kind: "window", frame: "none", width: spec.width, height: spec.height, at: { x: spec.x, y: spec.y }, layout: spec.layout }) : null;
  if (old) closeOverlay(old);
  return true;
}

function read() {
  const root = layout();
  const sidebar = find(root, "sidebar"), panel = find(root, "panel"), queue = find(root, "queue");
  if (!sidebar || !panel || !queue) return null;
  const p = prefs();
  const sbPx = sidebar.size?.px ?? 0, pPx = panel.size?.px ?? 0, qPx = queue.size?.px ?? 0;
  const left = !sidebar.hidden, floating = left && Boolean(p.float);
  return {
    sidebar, panel, queue, p, sbPx, pPx, qPx, left, floating,
    expanded: left && (floating || sbPx >= SIDEBAR_OPEN),
    open: sbPx >= SIDEBAR_OPEN ? sbPx : shared("sidebar.width") ?? SIDEBAR_WIDTH,
    pOpen: !panel.hidden, qOpen: !queue.hidden,
    pW: p.right !== "float" && pPx >= PANEL_MIN ? pPx : p.panel ?? PANEL_WIDTH,
    qW: p.right !== "float" && qPx >= QUEUE_MIN ? qPx : p.queue ?? QUEUE_WIDTH,
  };
}

// The terminal that shows beside the sidebar and the right side: docked or floating, they take the same width of it.
function visible(st, { expanded = st.expanded, pOpen = st.pOpen, qOpen = st.qOpen } = {}) {
  const left = st.left ? (expanded ? st.open : rail()) + DIVIDER : 0;
  return S.win - left - 2 * PAD - EDGE - (pOpen ? st.pW + GAP : 0) - (qOpen ? st.qW + GAP : 0);
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
  if (st.p.right === "float") {
    if (st.pOpen) run("layout.hide", { id: "panel" });
    if (st.qOpen) run("layout.hide", { id: "queue" });
  }
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
      f.right = { panel: st.pOpen, queue: st.qOpen };
      if (st.pOpen) run("layout.hide", { id: "panel" });
      if (st.qOpen) run("layout.hide", { id: "queue" });
      acted = true;
    }
    return acted;
  }
  if (f.right && visible(st, { pOpen: f.right.panel, qOpen: f.right.queue }) >= VISIBLE_MIN) {
    if (f.right.panel) run("layout.show", { id: "panel" });
    if (f.right.queue) run("layout.show", { id: "queue" });
    st = { ...st, pOpen: f.right.panel || st.pOpen, qOpen: f.right.queue || st.qOpen };
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

function steer() {
  const st = read();
  if (!st || !S.win || !S.body) return;
  if (S.win !== S.lastWin && fold(st)) return;
  const { p } = st;
  const fixed = 2 * PAD + EDGE, W = S.win, R = rail();

  const leftFloats = st.expanded && W - st.open - DIVIDER - fixed < TERMINAL_MIN;
  const leftDocked = !st.left ? 0 : (st.expanded && !leftFloats ? st.open : R) + DIVIDER;
  // With nothing open on the right it decides for the side panel alone, so opening it lands where it will stay.
  const rightW = st.pOpen || st.qOpen ? (st.pOpen ? st.pW + GAP : 0) + (st.qOpen ? st.qW + GAP : 0) : st.pW + GAP;
  const rightFloats = W - leftDocked - fixed - rightW < TERMINAL_MIN;

  if (!rightFloats && p.right !== "float") {
    if (st.pOpen && st.pPx >= PANEL_MIN && st.pPx !== p.panel) setPrefs({ panel: st.pPx });
    if (st.qOpen && st.qPx >= QUEUE_MIN && st.qPx !== p.queue) setPrefs({ queue: st.qPx });
  }
  setPrefs({ right: rightFloats ? "float" : "dock", float: leftFloats });
  const pPx = rightFloats ? 0 : st.pW, qPx = rightFloats ? 0 : st.qW;
  if (Math.abs(st.pPx - pPx) > 0.5) run("layout.resize", { id: "panel", px: pPx });
  if (Math.abs(st.qPx - qPx) > 0.5) run("layout.resize", { id: "queue", px: qPx });
  if (st.left && Math.abs(st.sbPx - (leftDocked - DIVIDER)) > 0.5) {
    if (st.sbPx >= SIDEBAR_OPEN) setShared("sidebar.width", st.sbPx);
    run("layout.resize", { id: "sidebar", px: leftDocked - DIVIDER });
  }

  // Backdrop first, over the terminal's row and beside the docked sidebar; the drawers above it. A new backdrop would
  // land on top of them, so they reopen after it.
  const top = TABS, height = 2 * PAD + S.body;
  const sidebarOut = st.left && leftFloats, queueOut = rightFloats && st.qOpen, panelOut = rightFloats && st.pOpen;
  const anyOut = sidebarOut || queueOut || panelOut;
  if (place("backdrop", anyOut ? { x: leftDocked, y: top, width: W - leftDocked, height, layout: { type: "block", background: SCRIM, content: { mod: "side-fit", props: { backdrop: true } } } } : null)) {
    for (const part of ["sidebar", "queue", "panel"]) S.sigs[part] = undefined;
  }
  place("sidebar", sidebarOut ? {
    x: 0, y: 0, width: st.open, height: TABS + height + STATUS,
    layout: solid(copy(st.sidebar), { radius: 0, border: { width: 1, color: LINE.color } }),
  } : null);
  const room = W - (sidebarOut ? st.open : leftDocked) - 2 * PAD - CLICK_MIN - (queueOut && panelOut ? GAP : 0);
  const wide = (queueOut ? st.qW : 0) + (panelOut ? st.pW : 0);
  const fit = (w) => (wide > room ? Math.max(FLOAT_MIN, Math.floor((w * room) / wide)) : w);
  const qW = fit(st.qW), pW = fit(st.pW);
  let right = W - PAD;
  if (queueOut) {
    right -= qW;
    place("queue", { x: right, y: top + PAD, width: qW, height: S.body, layout: solid(copy(st.queue)) });
    right -= GAP;
  } else place("queue", null);
  right -= pW;
  place("panel", panelOut ? { x: right, y: top + PAD, width: pW, height: S.body, layout: solid(copy(st.panel), { radius: 10 }) } : null);
}

// Steers once the size has held still a moment, so dragging the window's edge doesn't reopen the windows every frame.
function later(cx, ms) {
  S.dueAt = Date.now() + ms;
  if (S.armed) return;
  S.armed = true;
  const wait = (cx, delay) => cx.timer.after(delay, (cx) => {
    const left = S.dueAt - Date.now();
    if (left > 0) return wait(cx, left);
    S.armed = false;
    steer();
  });
  wait(cx, ms);
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
    if (this.measure === "width" && !checking()) later(cx, 0);
    return div().id("side-fit").size_full().on_size_change((size, cx) => {
      if (this.measure === "height") {
        if (Math.abs(size.height - S.body) < 0.5) return;
        S.body = size.height;
      } else {
        const sidebar = find(layout(), "sidebar");
        const win = size.width + (sidebar && !sidebar.hidden ? (sidebar.size?.px ?? 0) + DIVIDER : 0);
        if (Math.abs(win - S.win) < 0.5) return;
        S.win = win;
      }
      later(cx, 150);
    });
  }
}
