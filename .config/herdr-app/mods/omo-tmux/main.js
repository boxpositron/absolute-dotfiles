// omo panes across tmux sessions. Herdr sees a tmux client as one terminal, so
// its agents list shows one row per tmux session; this lists every pane running
// omo behind those rows, with the state and message omo-status keeps for it
// (`omo-status list`). A click shows the pane (`omo-status show`): in the Herdr
// tab already on its tmux session, else in the space named after the session,
// else in a new space for it. The header's button gives every session running
// omo a space of its own (`omo-status spaces`).
//
// An inbox: panes that need you, failed, finished, working or with work still
// running in the background (a slower, purple spinner); idle ones fold
// into one row that opens them.
//
// Motion, as herdr-t3-inbox does it: within a session the panes that need you
// come first, and a row that moves slides from where it was, a new one fades in
// from above, one that goes fades out where it was (150ms ease-out). "Needs you"
// pulses, and a pane that just finished flashes green once.
//
// It is a view of the netrunner layout's side panel (panel-body "omo"), opened and closed by the
// status bar's omo chip. Herdr starts a block only once it shows and gives keys to shown copies only,
// and the panel is often closed, so a hidden copy beside the status bar (props {headless: true}) reads
// the list and takes Cmd+J: it publishes the list in shared "omo.list" for this panel and the counts
// in "omo.tmux" for the chip. The panel only draws. It reads this Mac's panes (`omo-status
// list-local`) the moment omo's state changes (omo-status set touches the list tick) or Herdr's
// focus moves, else every 5 s. It reads the other machines' (`list-remote`, under a second each)
// whenever the remote folder changes: `omo-status follow`, a launchd agent, touches its tick the moment
// a machine's omo state changes and on a beat every 15 s, and `omo-status ack` touches its seen after
// clearing one of their panes. While no tick comes for 25 s (no agent, or no link), it reads them every 3 s.
// Every 15 s it also publishes each tmux session's colour (`omo-status tints`, from tmux-session-tint)
// in shared "tmux.tints", {"<session>" or "<machine>/<session>": "#rrggbb"}, for the Agents tree.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, nextCommand, run, theme, shared, setShared, props, focused, watchFolder } from "herdr";
import { INK, isHud, spinner, mono, display, fill, caps, readout, button as hudButton, title as hudTitle } from "./hud.js";

const listTick = () => `${home()}/.local/state/omo-status/list`;
const remoteTick = () => `${home()}/.local/state/omo-status/remote`;

const SEP = "|^|";
const RANK = { error: 6, input: 5, done: 4, partial: 4, working: 3, background: 2, idle: 1 };
// Window names tmux picks by itself say nothing about the work.
const GENERIC = new Set(["bun", "node", "omo", "zsh", "bash", "fish", "sh", "mosh-client", "ssh"]);
/** @type {import("gpui-shell").TransitionPolicy} */
const MOTION = { duration: 150, easing: "ease-out" };
// Rows have fixed heights, so where each one sits is known before it is drawn.
const HEAD_H = 26;
const ROW_H = 30;
const ROW_MSG_H = 44;

// Time left to a scheduled wake-up: m:ss under an hour, then hours and minutes.
function countdown(ms) {
  if (ms <= 0) return "due";
  const s = Math.ceil(ms / 1000);
  if (s < 3600) return `in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const h = Math.floor(s / 3600);
  return h < 24 ? `in ${h}h ${Math.floor((s % 3600) / 60)}m` : `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

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
    const [pane, session, window, path, state, since, resume, ...msg] = line.split(SEP);
    if (!pane) continue;
    const project = (path ?? "").split("/").filter(Boolean).pop() ?? "~";
    panes.push({ pane, session, window, project, state, since: Number(since) * 1000 || null, resumeAt: Number(resume) * 1000 || null, msg: msg.join(SEP) });
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
    this.headless = Boolean(props()?.headless);
    this.panes = [];
    this.last = null;
    this.problem = null;
    this.states = new Map();
    this.flash = new Map();
    this.motion = null;
    if (this.headless) {
      this.local = "";
      this.remote = "";
      this.refresh(cx);
      this.refreshRemote(cx);
      this.heardAt = 0;
      cx.timer.every(5000, (cx) => this.refresh(cx));
      cx.timer.every(3000, (cx) => { if (Date.now() - this.heardAt > 25000) this.refreshRemote(cx); });
      this.refreshTints(cx);
      cx.timer.every(15000, (cx) => this.refreshTints(cx));
      this.onTick(listTick(), (cx) => this.refresh(cx), cx);
      this.onTick(remoteTick(), (cx, paths) => {
        if (paths.some((p) => p.endsWith("/tick"))) this.heardAt = Date.now();
        this.refreshRemote(cx);
      }, cx);
      // keys.json binds "omo-tmux.next" (Cmd+J in the netrunner layout): the pane that most needs you.
      cx.spawn(async (cx) => {
        for (;;) {
          if ((await nextCommand()) === "next") await exec(`${home()}/.local/bin/omo-status`, ["next"]);
          this.refresh(cx);
        }
      });
      return;
    }
    // The times on the rows count up.
    cx.timer.every(30000, (cx) => cx.notify());
    // Scheduled wake-ups count down here, so no report is sent every second.
    cx.timer.every(1000, (cx) => { if (this.panes.some((p) => p.resumeAt)) cx.notify(); });
  }

  // A change while a read runs reads again in the same task: a task started by one that is ending is dropped.
  refresh(cx) {
    if (!this.headless) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    cx.spawn(async () => {
      do {
        this.again = false;
        let out = "";
        let problem = null;
        try {
          const r = await exec(`${home()}/.local/bin/omo-status`, ["list-local"]);
          if (/no server running/.test(r.stderr)) problem = "tmux isn't running.";
          else if (r.code === 0) out = r.stdout;
          else problem = r.stderr.trim() || `omo-status list failed (${r.code})`;
        } catch (e) {
          problem = `omo-status didn't start: ${e?.message ?? e}`;
        }
        this.local = out;
        this.problem = problem;
        this.share();
      } while (this.again);
      this.busy = false;
    });
  }

  // Runs `then` with the changed paths whenever something in the tick folder `dir` changes.
  onTick(dir, then, cx) {
    cx.spawn(async (cx) => {
      await exec("mkdir", ["-p", dir]).catch(() => null);
      for (;;) {
        let paths;
        try { paths = await watchFolder(dir); } catch { return; }
        then(cx, paths);
      }
    });
  }

  // As refresh: a change heard while a read runs reads again, so it isn't left for the next beat.
  refreshRemote(cx) {
    if (this.remoteBusy) { this.remoteAgain = true; return; }
    this.remoteBusy = true;
    cx.spawn(async () => {
      do {
        this.remoteAgain = false;
        try {
          const r = await exec(`${home()}/.local/bin/omo-status`, ["list-remote"]);
          if (r.code === 0) this.remote = r.stdout;
        } catch { /* keeps the last answer */ }
        this.share();
      } while (this.remoteAgain);
      this.remoteBusy = false;
    });
  }

  refreshTints(cx) {
    cx.spawn(async () => {
      const r = await exec(`${home()}/.local/bin/omo-status`, ["tints"]).catch(() => null);
      if (r?.code !== 0) return;
      const tints = Object.fromEntries(r.stdout.split("\n").filter(Boolean).map((line) => line.split(SEP)));
      if (JSON.stringify(shared("tmux.tints") ?? null) !== JSON.stringify(tints)) setShared("tmux.tints", tints);
    });
  }

  share() {
    const out = this.local + this.remote;
    if (out === this.last && this.problem === this.sharedProblem) return;
    this.last = out;
    this.sharedProblem = this.problem;
    this.panes = parse(out);
    setShared("omo.list", { out, problem: this.problem });
    this.publish();
  }

  publish() {
    const count = (...states) => this.panes.filter((p) => states.includes(p.state)).length;
    const summary = { panes: this.panes.length, needs: count("input", "error"), working: count("working", "background"), done: count("done", "partial") };
    if (JSON.stringify(shared("omo.tmux") ?? null) !== JSON.stringify(summary)) setShared("omo.tmux", summary);
  }

  badge(t, text, color) {
    return div().px(5).py(1).flex_none().rounded(4).border_1().border_color(t.border).text_size(10).text_color(color ?? t.muted).child(text);
  }

  // A pane that has just come to done flashes once: drawn lit, then let fade.
  noteFinished(cx) {
    const seen = this.states.size > 0;
    const now = new Map(this.panes.map((p) => [p.pane, p.state]));
    for (const [pane, state] of now) {
      if (!seen || (state !== "done" && state !== "partial") || this.states.get(pane) === state) continue;
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
    if (state === "working") return this.hud ? spinner(t.working, 12, 900).mx(1) : svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (state === "background") return this.hud ? spinner(t.ansi5, 12, 2400).mx(1) : svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.ansi5).spin(2400);
    if (state === "input" || state === "error") {
      const color = state === "error" ? t.ansi1 : t.blocked;
      // netrunner's HUD: a solid tone block with dark ink and a slanted end.
      if (this.hud) return div().flex().flex_none().h(18).loop("opacity", { from: 0.55, to: 1, period: 1600 })
        .child(div().flex().items_center().h_full().px(6).bg(color).text_color(INK).child(caps(state === "error" ? "Failed" : "Needs you", 12, 700)))
        .child(div().relative().w(7).h_full().child(fill([[["0%", "0%"], ["100%", "0%"], ["0%", "100%"]]], color)));
      return div().flex_none().px(6).h(18).rounded(5).bg(color + "26").text_size(10.5).font_semibold().text_color(color)
        .flex().items_center().loop("opacity", { from: 0.55, to: 1, period: 1600 })
        .child(state === "error" ? "Failed" : "Needs you");
    }
    if (state === "done") return div().size(7).mx(3).flex_none().rounded(this.hud ? 0 : 4).bg(t.done);
    // A step done with tasks still open (omo-status's partial): a ring around a dot.
    if (state === "partial") return div().size(8).mx(2.5).flex_none().rounded(this.hud ? 0 : 4).border(1.5).border_color(t.done).flex().items_center().justify_center()
      .child(div().size(3).rounded(this.hud ? 0 : 2).bg(t.done));
    return div().size(7).mx(3).flex_none().rounded(this.hud ? 0 : 4).border(1.5).border_color(t.idle ?? t.dim);
  }

  fold(t, idle) {
    return h_flex().id("omo-idle").px(8).h(ROW_H).flex_none().gap(6).items_center().text_size(12).text_color(t.dim)
      .cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { this.showIdle = !this.showIdle; cx.notify(); })
      .child(this.hud ? caps(`${idle} idle`, 12.5) : `${idle} idle ${this.showIdle ? "▴" : "▾"}`)
      .when(this.hud, (el) => el.child(this.showIdle ? "▴" : "▾"));
  }

  header(t, s) {
    const top = s.panes.reduce((m, p) => ((RANK[p.state] ?? 0) > (RANK[m] ?? 0) ? p.state : m), null);
    const urgent = top === "input" || top === "error";
    if (this.hud) return h_flex().px(8).pt(8).h(HEAD_H).flex_none().gap(6).items_center()
      .child(div().truncate().font_family(display()).font_weight(700).text_size(13.5).text_color(urgent ? t.blocked : t.muted).child(s.name))
      .child(readout(t, s.panes.length, { status: urgent ? t.blocked : null, h: 16 }))
      .child(div().flex_1().h(1).bg(t.accent + "33"));
    return h_flex().px(8).pt(8).h(HEAD_H).flex_none().gap(6).items_center().text_size(11).font_medium()
      .child(div().truncate().text_color(urgent ? t.blocked : t.dim).child(s.name))
      .child(div().text_color(t.dim).child(String(s.panes.length)));
  }

  row(t, p, now) {
    const label = GENERIC.has(p.window) || p.window === p.project ? p.project : `${p.project} \u00b7 ${p.window}`;
    const quiet = p.state === "idle";
    const wake = p.resumeAt && p.state !== "working";
    // A goal's wait reads as a sentence: "goal continues in 3:34 · waiting on CI".
    const goalWait = wake && /^goal (continues|retries|resumes)/.test(p.msg);
    const msg = goalWait ? p.msg.replace(/^goal \w+/, (m) => `${m} ${countdown(p.resumeAt - now)}`) : p.msg;
    const flash = this.flash.get(p.pane);
    return h_flex()
      .id(`omo-${p.pane}`)
      .relative()
      .px(8)
      .h(p.msg ? ROW_MSG_H : ROW_H)
      .flex_none()
      .rounded(this.hud ? 0 : 8)
      .gap(9)
      .items_center()
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.open(p, cx))
      .when(this.hud, (el) => el.border_b(1).border_color(t.accent + "26"))
      .when(Boolean(flash), (el) => el.child(div().id(`flash-${p.pane}-${flash.gen}`).absolute().inset_0().rounded(this.hud ? 0 : 8).bg(t.done + "38")
        .opacity(flash.lit ? 1 : 0).transition("opacity", { duration: 1500, easing: "ease-out" })))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_color(quiet ? t.muted : t.foreground)
          .when(this.hud, (el) => el.font_family(display()).font_weight(600).text_size(14)).child(label))
        .when(Boolean(p.msg), (el) => el.child(div().truncate().text_size(11.5).text_color(t.dim).child(msg))))
      .when(Boolean(wake) && !goalWait, (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi5).when(this.hud, (e) => e.font_family(mono())).child(countdown(p.resumeAt - now))))
      .when(!wake && !quiet && Boolean(p.since), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).when(this.hud, (e) => e.font_family(mono())).child(duration(now - p.since))))
      .child(this.status(t, p.state));
  }

  render(cx) {
    if (this.headless) {
      // Going to a session in Herdr counts as looking at it (list-local notes it), so read at once.
      const terminal = focused()?.terminal ?? null;
      if (terminal !== this.focusSeen) { this.focusSeen = terminal; this.refresh(cx); }
      return div();
    }
    const list = shared("omo.list");
    if (list && (list.out !== this.last || list.problem !== this.problem)) {
      this.last = list.out;
      this.problem = list.problem;
      this.panes = parse(list.out ?? "");
      this.noteFinished(cx);
    }
    const t = theme();
    this.hud = isHud();
    const now = Date.now();
    const idle = this.panes.filter((p) => p.state === "idle").length;
    const sessions = sessionsWithUrgentPanesFirst(this.showIdle ? this.panes : this.panes.filter((p) => p.state !== "idle"));
    const needs = this.panes.filter((p) => p.state === "input" || p.state === "error").length;

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
      return div().id(`fly-${x.key}-${m.gen[x.key] ?? 0}`).flex_none().relative().bg(t.background)
        .top(f?.top ?? 0).opacity(f?.fade ? 0 : 1).transition("top", MOTION).transition("opacity", MOTION)
        .child(x.draw());
    };
    // A row that went, drawn where it was and fading out, under the rows sliding into its place.
    const leaving = (x) => div().id(`leaving-${x.key}-${m.step}`).absolute().left(8).right(8).top(x.y)
      .opacity(m.leaving ? 0 : 1).transition("opacity", MOTION).child(x.draw());

    const empty = !list ? "Reading omo-status…" : this.problem ?? (idle ? "Nothing needs you." : "No omo running in tmux.");
    const panesText = `${this.panes.length} pane${this.panes.length === 1 ? "" : "s"}`, needsText = `${needs} need${needs === 1 ? "s" : ""} you`;
    const spacesIcon = this.syncing
      ? (this.hud ? spinner(t.working, 13, 900) : svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.working).spin(900))
      : svg("mods/workspace-chrome/layers.svg").size(14);
    return v_flex().id("omo").size_full().min_h(0).rounded(this.hud ? 0 : 10).overflow_hidden().bg(t.background).border_1().border_color(this.hud ? t.accent + "4d" : t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(this.hud ? t.accent + "33" : t.border)
        .when(!this.hud, (el) => el.child(div().font_semibold().child("omo in tmux"))
          .child(this.badge(t, panesText))
          .when(needs > 0, (e) => e.child(this.badge(t, needsText, t.blocked))))
        .when(this.hud, (el) => el.child(hudTitle(t, "omo in tmux", 16))
          .child(div().id("omo-panes").tooltip(panesText).child(readout(t, this.panes.length)))
          .when(needs > 0, (e) => e.child(div().id("omo-needs").tooltip(needsText).child(readout(t, needs, { status: t.blocked, pulse: true })))))
        .child(div().flex_1())
        .child((this.hud ? hudButton(t, "omo-spaces", "Spaces", { icon: spacesIcon.relative() })
          : div().id("omo-spaces").size(22).flex_none().flex().items_center().justify_center().rounded(5)
            .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().child(spacesIcon))
          .tooltip("Give every tmux session running omo its own space")
          .on_click((_e, cx) => this.syncSpaces(cx))))
      .when(sessions.length === 0, (el) => el.child(div().px(12).py(8).text_size(12).text_color(t.dim).child(empty)))
      .child(v_flex().id("omo-list").relative().flex_1().min_h(0).px(8).pb(6).overflow_y_scrollbar().mode("always")
        .children([...m.exits.map(leaving), ...items.map(fly)]));
  }
}
