// jobs-tmux: the background jobs of every omo agent running in tmux, from `omo-status jobs`: terminal
// monitors, background commands, detached eval cells, child sessions, scheduled wake-ups and a parked
// goal's wait. A tree like the Agents list's: each tmux server (This Mac, then the other machines, in
// the remote yellow), its sessions, the panes in them that have jobs, and a row per job. Sessions and
// panes fold (kept in localStorage); a pane with no jobs isn't listed. The session and pane Herdr is on
// (shared "tmux.where") are marked, listed first and open; the header's Here / All switch shows only
// that session or every one. A click on a job shows its pane (`omo-status show <pane> exact`).
//
// Like mcp-tmux, a hidden copy beside the status bar (props {headless: true}) does the reading, since
// Herdr starts a block only once it shows and the side panel is often closed. It publishes shared
// "omo.jobs" ({out, problem, cur, count, here}) for this panel and for workspace-status-tmux's jobs chip;
// the panel only draws. This Mac is read the moment omo's state changes (the list tick folder
// omo-status touches), when Herdr's focus moves, else every 5 s; the other machines (`jobs-remote`,
// about a second each) every 15 s. A time counts up on each job, a wake-up or goal wait counts down:
// the panel ticks every second only while one is shown.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, shared, setShared, theme, props, focused, watchFolder } from "herdr";

const SEP = "|^|";
// The remote servers' Cyberpunk yellow, as in the Agents tree.
const REMOTE = "#fcee0a";
const REMOTE_ROW = REMOTE + "10", REMOTE_HOVER = REMOTE + "1f", REMOTE_SELECTED = REMOTE + "38";
const GENERIC = new Set(["bun", "node", "omo", "zsh", "bash", "fish", "sh", "mosh-client", "ssh"]);
const KINDS = {
  monitor: "Monitor", command: "Background command", cell: "Eval cell", child: "Child session",
  wakeup: "Scheduled wake-up", goal: "Goal waiting to continue",
};
const ROW_H = 26;
const omoStatus = () => `${home()}/.local/bin/omo-status`;
const listTick = () => `${home()}/.local/state/omo-status/list`;

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

// `omo-status jobs` prints a line per job, fields joined by SEP; another machine's lines carry its
// name in front of the pane and the session ("flowstate-remote/%3").
function parse(out) {
  const jobs = [];
  for (const line of (out ?? "").split("\n")) {
    const [pane, session = "", window = "", path = "", kind, start, due, ...label] = line.split(SEP);
    if (!pane || !kind) continue;
    const machine = pane.includes("/") ? pane.split("/")[0] : "";
    jobs.push({
      pane, machine, kind, window,
      session: machine && session.startsWith(`${machine}/`) ? session.slice(machine.length + 1) : session,
      project: path.split("/").filter(Boolean).pop() ?? "~",
      start: Number(start) * 1000 || null, due: Number(due) * 1000 || null, label: label.join(SEP),
    });
  }
  return jobs;
}

// Servers (This Mac first), their sessions and the panes with jobs, each in the order tmux lists them;
// only the session and pane Herdr is on move to the front of theirs.
function serverTree(jobs, cur) {
  const servers = [];
  for (const j of jobs) {
    let srv = servers.find((s) => s.machine === j.machine);
    if (!srv) servers.push(srv = { key: `srv:${j.machine}`, machine: j.machine, sessions: [], count: 0 });
    let ses = srv.sessions.find((s) => s.name === j.session);
    if (!ses) srv.sessions.push(ses = { key: `ses:${j.machine}/${j.session}`, name: j.session, machine: j.machine, panes: [], count: 0, here: cur?.machine === j.machine && cur.session === j.session });
    let pane = ses.panes.find((p) => p.pane === j.pane);
    if (!pane) ses.panes.push(pane = { key: `pane:${j.pane}`, pane: j.pane, machine: j.machine, window: j.window, project: j.project, jobs: [], here: cur?.pane === j.pane });
    pane.jobs.push(j);
    ses.count++;
    srv.count++;
  }
  const first = (a, b) => Number(b.here) - Number(a.here);
  servers.sort((a, b) => Number(Boolean(a.machine)) - Number(Boolean(b.machine)));
  for (const srv of servers) {
    srv.sessions.sort(first);
    for (const ses of srv.sessions) ses.panes.sort(first);
  }
  return servers;
}

const unprefix = (addr) => addr.slice(addr.indexOf("/") + 1);

export default class Jobs extends View {
  init(_props, cx) {
    this.headless = Boolean(props()?.headless);
    this.jobs = [];
    this.last = null;
    if (this.headless) {
      this.local = "";
      this.remote = "";
      this.problem = null;
      this.cur = null;
      this.sessionOf = new Map();
      this.refresh(cx);
      this.refreshRemote(cx);
      cx.timer.every(5000, (cx) => this.refresh(cx));
      cx.timer.every(15000, (cx) => this.refreshRemote(cx));
      cx.spawn(async (cx) => {
        await exec("mkdir", ["-p", listTick()]).catch(() => null);
        for (;;) {
          try { await watchFolder(listTick()); } catch { return; }
          this.refresh(cx);
        }
      });
      return;
    }
    // Herdr's tabs mod brings a space's panel back on return only for the panels listed here.
    const panels = shared("workspace.panels") ?? ["files", "changes"];
    if (!panels.includes("jobs")) setShared("workspace.panels", [...panels, "jobs"]);
    this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
    this.scope = localStorage.getItem("scope") === "here" ? "here" : "all";
    this.curSeen = null;
    this.counting = false;
    // The times count up; a wake-up counts down, and only then does a second matter.
    cx.timer.every(30000, (cx) => cx.notify());
    cx.timer.every(1000, (cx) => { if (this.counting) cx.notify(); });
  }

  // A change while a read runs reads again in the same task: a task started by one that is ending is dropped.
  refresh(cx) {
    if (!this.headless) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    cx.spawn(async () => {
      do {
        this.again = false;
        let out = "", problem = null;
        try {
          const r = await exec(omoStatus(), ["jobs-here"]);
          if (/no server running/.test(r.stderr)) problem = "tmux isn't running.";
          else if (r.code === 0) out = r.stdout;
          else problem = r.stderr.trim() || `omo-status jobs-here failed (${r.code})`;
        } catch (e) {
          problem = `omo-status didn't start: ${e?.message ?? e}`;
        }
        this.local = out;
        this.problem = problem;
        await this.resolveCurrent();
        this.share();
      } while (this.again);
      this.busy = false;
    });
  }

  refreshRemote(cx) {
    if (this.remoteBusy) return;
    this.remoteBusy = true;
    cx.spawn(async () => {
      try {
        const r = await exec(omoStatus(), ["jobs-remote"], { timeout: 30000 });
        if (r.code === 0) this.remote = r.stdout;
      } catch { /* keeps the last answer */ }
      this.remoteBusy = false;
      this.share();
    });
  }

  // The tmux session the pane Herdr is on belongs to: omo.list (omo-tmux's) names it for a pane running
  // omo, and tmux itself for any other pane on this Mac.
  async resolveCurrent() {
    const w = shared("tmux.where");
    if (!w?.tmux || !w.pane) { this.cur = null; return; }
    const addr = w.on ? `${w.on}/${w.pane}` : w.pane;
    let session = null;
    for (const line of (shared("omo.list")?.out ?? "").split("\n")) {
      const [pane, name] = line.split(SEP);
      if (pane === addr) { session = w.on ? unprefix(name) : name; break; }
    }
    if (!session && !w.on) {
      if (!this.sessionOf.has(addr)) {
        const r = await exec("/opt/homebrew/bin/tmux", ["-u", "display-message", "-p", "-t", w.pane, "#{session_name}"]).catch(() => null);
        if (r?.code === 0 && r.stdout.trim()) this.sessionOf.set(addr, r.stdout.trim());
      }
      session = this.sessionOf.get(addr) ?? null;
    }
    this.cur = { machine: w.on ?? "", session, pane: addr };
  }

  share() {
    const out = this.local + this.remote;
    const jobs = parse(out);
    const here = this.cur?.session ? jobs.filter((j) => j.machine === this.cur.machine && j.session === this.cur.session).length : 0;
    const next = { out, problem: this.problem, cur: this.cur, count: jobs.length, here };
    if (JSON.stringify(shared("omo.jobs") ?? null) !== JSON.stringify(next)) setShared("omo.jobs", next);
  }

  setScope(scope, cx) {
    this.scope = scope;
    localStorage.setItem("scope", scope);
    cx.notify();
  }

  fold(key, cx) {
    this.folded.has(key) ? this.folded.delete(key) : this.folded.add(key);
    localStorage.setItem("folded", JSON.stringify([...this.folded]));
    cx.notify();
  }

  show(j, cx) {
    cx.spawn(async (cx) => {
      const r = await exec(omoStatus(), ["show", j.pane, "exact"]).catch((e) => ({ code: -1, stderr: String(e?.message ?? e) }));
      this.showProblem = r.code === 0 ? null : r.stderr.trim() || `omo-status show failed (${r.code})`;
      cx.notify();
    });
  }

  badge(t, text, color) {
    return div().px(5).py(1).flex_none().rounded(4).border_1().border_color(t.border).text_size(10).text_color(color ?? t.muted).child(text);
  }

  // Which kind of job, drawn small: a pulsing ring (a monitor watching), a spinner (a command running),
  // and the workspace-chrome icons for the rest.
  marker(t, kind) {
    const icon = (name, color) => svg(`mods/workspace-chrome/${name}.svg`).size(12).mx(1).flex_none().text_color(color);
    if (kind === "monitor") {
      return div().size(10).mx(1).flex_none().rounded(5).border(1.5).border_color(t.working).flex().items_center().justify_center()
        .loop("opacity", { from: 0.45, to: 1, period: 2200 }).child(div().size(3).rounded(2).bg(t.working));
    }
    if (kind === "command") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(2400);
    if (kind === "cell") return icon("square", t.working);
    if (kind === "child") return icon("layers", t.ansi5);
    if (kind === "wakeup") return icon("clock", t.ansi5);
    return icon("circle-check", t.done);
  }

  // A server: This Mac, or a machine in the remote yellow. Folded, it says how many jobs it hides.
  serverRow(t, srv) {
    const open = !this.folded.has(srv.key);
    const color = srv.machine ? REMOTE : t.dim;
    return h_flex().id(srv.key).px(8).pt(8).h(30).flex_none().gap(6).items_center().text_size(11).font_medium()
      .cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => this.fold(srv.key, cx))
      .child(svg(`mods/workspace-chrome/${srv.machine ? "server" : "monitor"}.svg`).size(12).flex_none().text_color(color))
      .child(div().truncate().text_color(color).child(srv.machine || "This Mac"))
      .child(div().text_color(t.dim).child(String(srv.count)))
      .child(div().flex_1())
      .when(!open, (el) => el.child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
  }

  sessionRow(t, s) {
    const open = !this.folded.has(s.key);
    const remote = Boolean(s.machine);
    return h_flex().id(s.key).px(8).h(ROW_H).flex_none().rounded(8).gap(6).items_center()
      .when(remote, (el) => el.bg(REMOTE_ROW))
      .when(s.here, (el) => el.bg(remote ? REMOTE_SELECTED : t.selected))
      .cursor_pointer().hover((el) => el.bg(remote ? REMOTE_HOVER : t.hover))
      .on_click((_e, cx) => this.fold(s.key, cx))
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
      .child(div().min_w(0).truncate().font_medium().text_color(t.foreground).child(s.name))
      .child(div().text_size(11).text_color(t.dim).child(String(s.count)))
      .child(div().flex_1())
      .when(s.here, (el) => el.child(div().flex_none().px(5).h(16).rounded(4).bg(t.accent + "26").text_size(10).font_semibold().text_color(t.accent).flex().items_center().child("here")));
  }

  paneRow(t, p) {
    const open = !this.folded.has(p.key);
    const remote = Boolean(p.machine);
    const label = GENERIC.has(p.window) || p.window === p.project ? p.project : `${p.project} \u00b7 ${p.window}`;
    return h_flex().id(p.key).pl(22).pr(8).h(ROW_H).flex_none().rounded(8).gap(6).items_center().text_size(12.5)
      .when(remote, (el) => el.bg(REMOTE_ROW))
      .when(p.here, (el) => el.bg(remote ? REMOTE_SELECTED : t.selected))
      .cursor_pointer().hover((el) => el.bg(remote ? REMOTE_HOVER : t.hover))
      .on_click((_e, cx) => this.fold(p.key, cx))
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(10).flex_none().text_color(t.dim))
      .child(div().min_w(0).flex_1().truncate().text_color(p.here ? t.foreground : t.muted).child(label))
      .child(div().text_size(11).flex_none().text_color(t.dim).child(String(p.jobs.length)));
  }

  jobRow(t, j, i, now) {
    const remote = Boolean(j.machine);
    const time = j.due ? countdown(j.due - now) : j.start ? duration(now - j.start) : null;
    return h_flex().id(`job-${j.pane}-${i}`).pl(40).pr(8).h(ROW_H).flex_none().rounded(8).gap(8).items_center().text_size(12.5)
      .when(remote, (el) => el.bg(REMOTE_ROW))
      .cursor_pointer().hover((el) => el.bg(remote ? REMOTE_HOVER : t.hover))
      .tooltip(`${KINDS[j.kind] ?? j.kind}: ${j.label}`)
      .on_click((_e, cx) => this.show(j, cx))
      .child(this.marker(t, j.kind))
      .child(div().min_w(0).flex_1().truncate().text_color(t.foreground).child(j.label))
      .when(Boolean(time), (el) => el.child(div().flex_none().text_size(11).text_color(j.due ? t.ansi5 : t.dim).child(time)));
  }

  scopeButton(t, id, label) {
    const on = this.scope === id;
    return div().id(`scope-${id}`).px(8).h(22).flex().items_center().text_size(11).cursor_pointer()
      .when(on, (el) => el.bg(t.selected).text_color(t.foreground).font_semibold())
      .when(!on, (el) => el.text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => this.setScope(id, cx))
      .child(label);
  }

  render(cx) {
    if (this.headless) {
      // Going to another pane or terminal changes what is "here", and may be the first time its jobs matter.
      const f = focused()?.terminal ?? null, w = shared("tmux.where");
      const key = `${f}|${w?.on ?? ""}|${w?.pane ?? ""}`;
      if (key !== this.focusSeen) { this.focusSeen = key; this.refresh(cx); }
      return div();
    }
    const t = theme();
    const data = shared("omo.jobs");
    if (data && data.out !== this.last) { this.last = data.out; this.jobs = parse(data.out); }
    const cur = data?.cur ?? null;
    // Where Herdr is opens: moving to a pane unfolds its session, server and pane.
    const curKey = cur?.session ? `${cur.machine}|${cur.session}|${cur.pane}` : null;
    if (curKey !== this.curSeen) {
      this.curSeen = curKey;
      if (curKey) {
        for (const k of [`srv:${cur.machine}`, `ses:${cur.machine}/${cur.session}`, `pane:${cur.pane}`]) this.folded.delete(k);
        localStorage.setItem("folded", JSON.stringify([...this.folded]));
      }
    }
    const shown = this.scope === "here" ? this.jobs.filter((j) => cur?.session && j.machine === cur.machine && j.session === cur.session) : this.jobs;
    const servers = serverTree(shown, cur);
    const now = Date.now();
    const rows = [];
    for (const srv of servers) {
      rows.push(this.serverRow(t, srv));
      if (this.folded.has(srv.key)) continue;
      for (const ses of srv.sessions) {
        rows.push(this.sessionRow(t, ses));
        if (this.folded.has(ses.key)) continue;
        for (const p of ses.panes) {
          rows.push(this.paneRow(t, p));
          if (!this.folded.has(p.key)) p.jobs.forEach((j, i) => rows.push(this.jobRow(t, j, i, now)));
        }
      }
    }
    this.counting = shown.some((j) => j.due);
    const empty = !data ? "Reading omo-status…" : data.problem ?? this.showProblem
      ?? (this.scope === "here" ? (cur?.session ? `No background jobs in ${cur.session}.` : "Focus a tmux client to see the jobs of its session.") : "No background jobs.");
    return v_flex().id("jobs").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Jobs"))
        .child(this.badge(t, `${shown.length} job${shown.length === 1 ? "" : "s"}`))
        .child(div().flex_1())
        .child(h_flex().flex_none().rounded(6).border_1().border_color(t.border).overflow_hidden()
          .child(this.scopeButton(t, "here", "Here"))
          .child(this.scopeButton(t, "all", "All"))))
      .when(rows.length === 0, (el) => el.child(div().px(12).py(8).text_size(12).text_color(t.dim).child(empty)))
      .child(v_flex().id("jobs-list").relative().flex_1().min_h(0).px(8).pb(6).overflow_y_scrollbar().mode("always")
        .children(rows));
  }
}
