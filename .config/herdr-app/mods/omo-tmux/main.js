// omo panes across tmux sessions. Herdr sees a tmux client as one terminal, so
// its agents list shows one row per tmux session; this lists every pane running
// omo behind those rows, with the state and message omo-status keeps for it
// (`omo-status list`). A click shows the pane (`omo-status show`): in the Herdr
// tab already on its tmux session, else in the space named after the session,
// else in a new space for it. The header's button gives every session running
// omo a space of its own (`omo-status spaces`).
//
// An inbox: panes that need you, failed, finished or are working; idle ones fold
// into one row that opens them.
//
// Motion, as herdr-t3-inbox does it: within a session the panes that need you
// come first, and a row that moves slides from where it was, a new one fades in
// from above, one that goes fades out where it was (150ms ease-out). "Needs you"
// pulses, and a pane that just finished flashes green once.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, layout, nextCommand, run, theme } from "herdr";

const SEP = "|^|";
const RANK = { error: 5, input: 4, done: 3, working: 2, idle: 1 };
// Window names tmux picks by itself say nothing about the work.
const GENERIC = new Set(["bun", "node", "omo", "zsh", "bash", "fish", "sh", "mosh-client", "ssh"]);
/** @type {import("gpui-shell").TransitionPolicy} */
const MOTION = { duration: 150, easing: "ease-out" };
// Rows have fixed heights, so where each one sits is known before it is drawn.
const HEAD_H = 26;
const ROW_H = 30;
const ROW_MSG_H = 44;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function parse(stdout) {
  const panes = [];
  for (const line of stdout.split("\n")) {
    const [pane, session, window, path, state, since, ...msg] = line.split(SEP);
    if (!pane) continue;
    const project = (path ?? "").split("/").filter(Boolean).pop() ?? "~";
    panes.push({ pane, session, window, project, state, since: Number(since) * 1000 || null, msg: msg.join(SEP) });
  }
  return panes;
}

function sessionsWithUrgentPanesFirst(panes) {
  const sessions = [];
  for (const p of panes) {
    if (sessions.at(-1)?.name === p.session) sessions.at(-1).panes.push(p);
    else sessions.push({ name: p.session, panes: [p] });
  }
  for (const s of sessions) s.panes = s.panes.map((p, i) => ({ p, i })).sort((a, b) => (RANK[b.p.state] ?? 0) - (RANK[a.p.state] ?? 0) || a.i - b.i).map((x) => x.p);
  return sessions;
}

export default class OmoTmux extends View {
  init(_props, cx) {
    this.panes = [];
    this.last = null;
    this.problem = null;
    this.states = new Map();
    this.flash = new Map();
    this.motion = null;
    this.refresh(cx);
    cx.timer.every(2000, (cx) => this.refresh(cx));
    // The times on the rows count up.
    cx.timer.every(30000, (cx) => cx.notify());
    // keys.json binds "omo-tmux.next" (Cmd+J in the tmux layout): the pane that most needs you.
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "next") await exec(`${home()}/.local/bin/omo-status`, ["next"]);
        this.refresh(cx);
      }
    });
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      let out = "";
      let problem = null;
      try {
        const r = await exec(`${home()}/.local/bin/omo-status`, ["list"]);
        if (/no server running/.test(r.stderr)) problem = "tmux isn't running.";
        else if (r.code === 0) out = r.stdout;
        else problem = r.stderr.trim() || `omo-status list failed (${r.code})`;
      } catch (e) {
        problem = `omo-status didn't start: ${e?.message ?? e}`;
      }
      this.busy = false;
      if (out === this.last && problem === this.problem) return;
      this.last = out;
      this.problem = problem;
      this.panes = parse(out);
      this.noteFinished(cx);
      cx.notify();
    });
  }

  // A pane that has just come to done flashes once: drawn lit, then let fade.
  noteFinished(cx) {
    const seen = this.states.size > 0;
    const now = new Map(this.panes.map((p) => [p.pane, p.state]));
    for (const [pane, state] of now) {
      if (!seen || state !== "done" || this.states.get(pane) === "done") continue;
      const gen = (this.flash.get(pane)?.gen ?? 0) + 1;
      this.flash.set(pane, { gen, lit: true });
      cx.timer.after(60, (cx) => { if (this.flash.get(pane)?.gen === gen) { this.flash.get(pane).lit = false; cx.notify(); } });
      cx.timer.after(1700, (cx) => { if (this.flash.get(pane)?.gen === gen) { this.flash.delete(pane); cx.notify(); } });
    }
    this.states = now;
  }

  // Where every row sits now, against where it sat last time: rows that moved
  // are drawn where they were for one frame, then let go to slide home.
  plan(items, cx) {
    const at = new Map(items.map((x) => [x.key, x]));
    const sig = items.map((x) => `${x.key}@${x.y}`).join("\n");
    const m = this.motion;
    if (!m) { this.motion = { sig, at, fly: {}, gen: {}, exits: [], step: 0, leaving: false }; return; }
    if (sig === m.sig) return;
    const fly = {}, gen = m.gen;
    const exits = [...m.at].filter(([k]) => !at.has(k)).map(([, x]) => x);
    for (const x of items) {
      const was = m.at.get(x.key);
      if (!was) {
        gen[x.key] = (gen[x.key] ?? 0) + 1;
        fly[x.key] = { top: -Math.min(x.h, 24), fade: true };
      } else if (was.y !== x.y) {
        gen[x.key] = (gen[x.key] ?? 0) + 1;
        fly[x.key] = { top: was.y - x.y };
      }
    }
    const step = m.step + 1;
    this.motion = { sig, at, gen, fly, exits: exits.length + Object.keys(fly).length <= 40 ? exits : [], step, leaving: false };
    cx.timer.after(16, (cx) => { if (this.motion.step === step) { this.motion.fly = {}; this.motion.leaving = true; cx.notify(); } });
    cx.timer.after(MOTION.duration + 50, (cx) => { if (this.motion.step === step) { this.motion.exits = []; cx.notify(); } });
  }

  open(p, cx) {
    cx.spawn(async (cx) => {
      await exec(`${home()}/.local/bin/omo-status`, ["show", p.pane]);
      this.refresh(cx);
    });
  }

  syncSpaces(cx) {
    if (this.syncing) return;
    this.syncing = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await exec(`${home()}/.local/bin/omo-status`, ["spaces"]);
      } finally {
        this.syncing = false;
        cx.notify();
      }
    });
  }

  status(t, state) {
    if (state === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (state === "input" || state === "error") {
      const color = state === "error" ? t.ansi1 : t.blocked;
      return div().flex_none().px(6).h(18).rounded(5).bg(color + "26").text_size(10.5).font_semibold().text_color(color)
        .flex().items_center().loop("opacity", { from: 0.55, to: 1, period: 1600 })
        .child(state === "error" ? "Failed" : "Needs you");
    }
    if (state === "done") return div().size(7).mx(3).flex_none().rounded(4).bg(t.done);
    return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  }

  fold(t, idle) {
    return h_flex().id("omo-idle").px(8).h(ROW_H).flex_none().gap(6).items_center().text_size(12).text_color(t.dim)
      .cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { this.showIdle = !this.showIdle; cx.notify(); })
      .child(`${idle} idle ${this.showIdle ? "▴" : "▾"}`);
  }

  header(t, s) {
    const top = s.panes.reduce((m, p) => ((RANK[p.state] ?? 0) > (RANK[m] ?? 0) ? p.state : m), null);
    return h_flex().px(8).pt(8).h(HEAD_H).flex_none().gap(6).items_center().text_size(11).font_medium()
      .child(div().truncate().text_color(top === "input" || top === "error" ? t.blocked : t.dim).child(s.name))
      .child(div().text_color(t.dim).child(String(s.panes.length)));
  }

  row(t, p, now) {
    const label = GENERIC.has(p.window) || p.window === p.project ? p.project : `${p.project} \u00b7 ${p.window}`;
    const quiet = p.state === "idle";
    const flash = this.flash.get(p.pane);
    return h_flex()
      .id(`omo-${p.pane}`)
      .relative()
      .px(8)
      .h(p.msg ? ROW_MSG_H : ROW_H)
      .flex_none()
      .rounded(8)
      .gap(9)
      .items_center()
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.open(p, cx))
      .when(Boolean(flash), (el) => el.child(div().id(`flash-${p.pane}-${flash.gen}`).absolute().inset_0().rounded(8).bg(t.done + "38")
        .opacity(flash.lit ? 1 : 0).transition("opacity", { duration: 1500, easing: "ease-out" })))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_color(quiet ? t.muted : t.foreground).child(label))
        .when(Boolean(p.msg), (el) => el.child(div().truncate().text_size(11.5).text_color(t.dim).child(p.msg))))
      .when(!quiet && Boolean(p.since), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - p.since))))
      .child(this.status(t, p.state));
  }

  render(cx) {
    const t = theme();
    const now = Date.now();
    const idle = this.panes.filter((p) => p.state === "idle").length;
    const sessions = sessionsWithUrgentPanesFirst(this.showIdle ? this.panes : this.panes.filter((p) => p.state !== "idle"));

    if (narrow()) {
      return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).pt(6)
        .children(sessions.flatMap((s) => s.panes).map((p) => h_flex().id(`omo-${p.pane}`).h(26).flex_none().items_center().justify_center()
          .hover((s) => s.bg(t.hover)).tooltip(`${p.session}: ${p.msg || p.project}`)
          .on_click((_e, cx) => this.open(p, cx)).child(this.status(t, p.state === "input" || p.state === "error" ? "done" : p.state))));
    }

    const items = [];
    let y = 0;
    for (const s of sessions) {
      items.push({ key: `s:${s.name}`, y, h: HEAD_H, draw: () => this.header(t, s) });
      y += HEAD_H;
      for (const p of s.panes) {
        const h = p.msg ? ROW_MSG_H : ROW_H;
        items.push({ key: `p:${p.pane}`, y, h, draw: () => this.row(t, p, now) });
        y += h;
      }
    }
    if (idle) items.push({ key: "fold", y, h: ROW_H, draw: () => this.fold(t, idle) });
    this.plan(items, cx);
    const m = this.motion;

    // A row in its wrapper: drawn first where it was (or above and clear, coming in), then let go.
    const fly = (x) => {
      const f = m.fly[x.key];
      // The panel's own background, so a row sliding over another hides it instead of mixing their text.
      return div().id(`fly-${x.key}-${m.gen[x.key] ?? 0}`).flex_none().relative().bg(t.chrome)
        .top(f?.top ?? 0).opacity(f?.fade ? 0 : 1).transition("top", MOTION).transition("opacity", MOTION)
        .child(x.draw());
    };
    // A row that went, drawn where it was and fading out, under the rows sliding into its place.
    const leaving = (x) => div().id(`leaving-${x.key}-${m.step}`).absolute().left(8).right(8).top(x.y)
      .opacity(m.leaving ? 0 : 1).transition("opacity", MOTION).child(x.draw());

    const empty = this.problem ?? (idle ? "Nothing needs you." : "No omo running in tmux.");
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .child(h_flex().px(16).h(41).pt(14).pb(5).flex_none().items_center().justify_between()
        .child(div().flex_1().text_size(11.5).font_medium().text_color(t.dim).child("omo in tmux"))
        .child(div().id("omo-board").size(22).flex_none().flex().items_center().justify_center().rounded(5)
          .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
          .tooltip("Board: every omo session on both machines (Cmd+Shift+B)")
          .on_click(() => run("mod.open", { name: "omo-board" }))
          .child(svg("mods/workspace-chrome/monitor.svg").size(14)))
        .child(div().id("omo-spaces").size(22).flex_none().flex().items_center().justify_center().rounded(5)
          .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
          .tooltip("Give every tmux session running omo its own space")
          .on_click((_e, cx) => this.syncSpaces(cx))
          .child(this.syncing
            ? svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.working).spin(900)
            : svg("mods/workspace-chrome/layers.svg").size(14))))
      .when(sessions.length === 0, (el) => el.child(div().px(16).text_size(12).text_color(t.dim).child(empty)))
      .child(v_flex().id("omo-list").relative().flex_1().min_h(0).px(8).overflow_y_scrollbar().mode("always")
        .children([...m.exits.map(leaving), ...items.map(fly)]));
  }
}
