// prds-tmux: the Studio PRD behind each omo pane in tmux on this Mac, with its progress, from `studio-prds`
// (.local/bin). Every PRD that a pane's bound task (omo-work) belongs to is a card: its title, client and
// status, a bar with one segment per requirement line (done, in progress, open), the counts, and the panes
// working on it, each with its omo state, how long it has had it and the requirement its task is for, and
// its target or delivery date and Linear link when Studio has them. Panes on no PRD follow, grouped by the
// client omo-work found for their session (client work that should have a PRD), and panes that aren't a
// client's fold into one row at the end. Here shows only the PRDs of the tmux session Herdr is on. A click on a pane
// shows it (`omo-status show <pane> exact`); a click on a PRD's title opens it in Studio.
//
// As in jobs-tmux, a hidden copy beside the status bar (props {headless: true}) does the reading, since
// Herdr starts a block only once it shows and the side panel is often closed. It publishes shared
// "studio.prds" ({data, problem, cur}) for this panel and the status bar's PRD chip; the panel only draws.
// It reads when the omo panel's shared "omo.list" changes, handing studio-prds those rows so the panes
// aren't listed twice, else every 15 s, and republishes the pane you are in when Herdr's focus moves;
// studio-prds itself asks Studio at most once a minute unless the bound tasks change.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, shared, setShared, theme, props, focused, checking, openOverlay, nextCommand } from "herdr";
import { INK, isHud, display, frame, caps, readout, button as hudButton, title as hudTitle } from "./hud.js";

const GENERIC = new Set(["bun", "node", "omo", "zsh", "bash", "fish", "sh", "mosh-client", "ssh"]);
const studioPrds = () => `${home()}/.local/bin/studio-prds`;
const omoStatus = () => `${home()}/.local/bin/omo-status`;

function stateOf(t, state) {
  switch (state) {
    case "input": case "question": case "blocked": return { label: "needs you", color: t.blocked, rank: 0 };
    case "error": return { label: "failed", color: t.blocked, rank: 1 };
    case "done": return { label: "finished", color: t.done, rank: 2 };
    case "partial": return { label: "step done", color: t.done, rank: 2 };
    case "working": return { label: "working", color: t.working, rank: 3 };
    case "background": return { label: "background", color: t.ansi5, rank: 4 };
    default: return { label: state || "idle", color: t.dim, rank: 5 };
  }
}

const STATUS = { draft: "Draft", in_review: "In review", approved: "Approved", delivered: "Delivered", archived: "Archived" };
const project = (p) => (p.path ?? "").split("/").filter(Boolean).pop() ?? "~";
const paneLabel = (p) => (GENERIC.has(p.window) || p.window === project(p) ? `${p.session} \u00b7 ${project(p)}` : `${p.session} \u00b7 ${p.window}`);

// As the Agents tree: how long a pane has had its state.
function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// A theme colour with an alpha: the muted and dim colours may carry one already.
const tint = (c, a) => (c.length === 9 ? c.slice(0, 7) : c) + a;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (s) => {
  const [y, m, d] = String(s ?? "").slice(0, 10).split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};
const short = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

// A PRD's date: delivered, else its target (red once overdue or due today, the working colour within
// three days), else when it started; null when Studio has none.
function when(t, prd) {
  const delivered = day(prd.delivered_on);
  if (delivered) return { text: `delivered ${short(delivered)}`, color: t.done };
  const due = day(prd.target_on);
  if (!due) {
    const started = day(prd.started_on);
    return started ? { text: `started ${short(started)}`, color: t.dim } : null;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { text: `overdue ${-days}d`, color: t.blocked };
  if (days === 0) return { text: "due today", color: t.blocked };
  return { text: `due ${short(due)}`, color: days <= 3 ? t.working : t.dim };
}

export default class Prds extends View {
  init(_props, cx) {
    this.headless = Boolean(props()?.headless);
    if (this.headless) {
      if (checking()) return;
      this.data = null;
      this.problem = null;
      this.listSeen = shared("omo.list")?.out;
      this.refresh(cx);
      cx.timer.every(15000, (cx) => this.refresh(cx));
      // omo-tmux's hidden copy rereads the panes whenever omo's state changes: read again when its list does.
      cx.timer.every(1000, (cx) => {
        const out = shared("omo.list")?.out;
        if (out !== this.listSeen) { this.listSeen = out; this.refresh(cx); }
      });
      return;
    }
    // Herdr's tabs mod brings a space's panel back on return only for the panels listed here.
    const panels = shared("workspace.panels") ?? ["files", "changes"];
    if (!panels.includes("prds")) setShared("workspace.panels", [...panels, "prds"]);
    this.scope = localStorage.getItem("scope") === "here" ? "here" : "all";
    this.unlinkedOpen = localStorage.getItem("unlinked") === "open";
    // A failed action says so for 10 s (or until clicked away), then the panel shows Studio's own state again.
    cx.timer.every(2000, (cx) => {
      if (this.actionProblem && Date.now() - this.actionAt > 10000) { this.actionProblem = null; cx.notify(); }
    });
    // prds-tmux.read (keys.json, or herdr-app do) reads the PRD of the pane you are in, else the first one listed.
    cx.spawn(async (cx) => {
      for (;;) {
        if (await nextCommand() !== "read") continue;
        const s = shared("studio.prds");
        const prds = s?.data?.prds ?? [];
        const prd = prds.find((p) => p.panes.some((x) => x.pane === s?.cur?.pane)) ?? prds[0];
        if (prd) this.read(cx, prd);
      }
    });
  }

  // A change while a read runs reads again in the same task: a task started by one that is ending is dropped.
  refresh(cx) {
    if (!this.headless) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    cx.spawn(async () => {
      do {
        this.again = false;
        try {
          const rows = shared("omo.list")?.out;
          const r = await exec(studioPrds(), typeof rows === "string" ? ["--rows", rows] : [], { timeout: 30000 });
          if (r.code === 0) { this.data = JSON.parse(r.stdout); this.problem = this.data.problem; }
          else this.problem = r.stderr.trim() || `studio-prds failed (${r.code})`;
        } catch (e) {
          this.problem = `studio-prds didn't run: ${e?.message ?? e}`;
        }
        this.share();
      } while (this.again);
      this.busy = false;
    });
  }

  share() {
    const w = shared("tmux.where");
    const cur = w?.tmux && w.pane && !w.on ? { pane: w.pane } : null;
    const next = { data: this.data, problem: this.problem, cur };
    if (JSON.stringify(shared("studio.prds") ?? null) !== JSON.stringify(next)) setShared("studio.prds", next);
  }

  setScope(scope, cx) {
    this.scope = scope;
    localStorage.setItem("scope", scope);
    cx.notify();
  }

  toggleUnlinked(cx) {
    this.unlinkedOpen = !this.unlinkedOpen;
    localStorage.setItem("unlinked", this.unlinkedOpen ? "open" : "closed");
    cx.notify();
  }

  run(cx, command, args) {
    cx.spawn(async (cx) => {
      const r = await exec(command, args).catch((e) => ({ code: -1, stderr: String(e?.message ?? e) }));
      this.actionProblem = r.code === 0 ? null : r.stderr.trim() || `${command} failed (${r.code})`;
      this.actionAt = Date.now();
      cx.notify();
    });
  }

  // The whole PRD, fetched now from Studio as Markdown, in the preview mod's focus-mode modal.
  read(cx, prd) {
    if (this.reading) return;
    this.reading = prd.prd_id;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec(studioPrds(), ["prd", prd.prd_id], { timeout: 30000 }).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
      this.reading = null;
      const file = r.code === 0 ? r.stdout.trim() : "";
      if (file) {
        this.actionProblem = null;
        openOverlay({ mod: "preview", kind: "dialog", frame: "none", width: 0.94, height: 0.92, props: { file, zen: true } });
      } else this.actionProblem = r.stderr.trim() || `studio-prds prd failed (${r.code})`;
      this.actionAt = Date.now();
      cx.notify();
    });
  }

  action(t, id, label, onClick) {
    if (this.hud) return hudButton(t, id, label, { h: 20 }).on_click((_e, cx) => onClick(cx));
    return div().id(id).px(7).h(20).flex().items_center().rounded(4).border_1().border_color(t.border).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => onClick(cx)).child(label);
  }

  // netrunner's HUD: a small cut-corner chip of the colour, its words in capitals.
  badge(t, text, color) {
    if (this.hud) return div().relative().px(6).h(16).flex_none().flex().items_center()
      .children(frame(4, { bg: tint(color ?? t.muted, "14"), line: tint(color ?? t.muted, "80") }))
      .child(caps(text, 11, 700).relative().text_color(color ?? t.muted));
    return div().px(5).py(1).flex_none().rounded(4).border_1().border_color(t.border).text_size(10).text_color(color ?? t.muted).child(text);
  }

  bar(t, reqs) {
    if (reqs.length === 0) return div().h(6).rounded(this.hud ? 0 : 3).bg(t.border);
    return h_flex().h(6).gap(2).children(reqs.map((q, i) => div().id(`seg-${i}`).flex_1().h_full().rounded(this.hud ? 0 : 2)
      .bg(q.done ? t.done : q.task_status === "in_progress" ? t.working : t.border)
      .tooltip(`R${q.index} \u00b7 ${q.done ? "done" : q.task_status === "in_progress" ? "in progress" : "open"}: ${q.text}`)));
  }

  paneRow(t, p, cur, key, unlinked = false) {
    const s = stateOf(t, p.state);
    const here = cur?.pane === p.pane;
    const detail = p.requirement ? `R${p.requirement.index} \u00b7 ${p.requirement.text}`
      : p.task_title ? `${p.task_title}${unlinked ? " \u00b7 not on a PRD" : ""}`
      : p.task ? (unlinked ? "Its task is on no PRD" : "Bound to a task Studio didn't return")
      : unlinked && p.client ? "No task bound: omo-work bind <task>" : "No task bound";
    return h_flex().id(`${key}-${p.pane}`).px(6).py(4).gap(8).items_start().rounded(this.hud ? 0 : 6)
      .when(here, (el) => el.bg(t.selected))
      .cursor_pointer().hover((el) => el.bg(t.hover))
      .tooltip(p.msg || `${paneLabel(p)}: ${s.label}`)
      .on_click((_e, cx) => this.run(cx, omoStatus(), ["show", p.pane, "exact"]))
      .child(div().mt(5).size(7).flex_none().rounded(this.hud ? 0 : 4).bg(s.color))
      .child(v_flex().min_w(0).flex_1().gap(1)
        .child(h_flex().gap(6).items_center()
          .child(div().min_w(0).flex_1().truncate().text_size(12.5).text_color(here ? t.foreground : t.muted)
            .when(this.hud, (el) => el.font_family(display()).font_weight(600).text_size(14)).child(paneLabel(p)))
          .child(this.hud ? caps(s.label, 11.5, 700).flex_none().text_color(s.color)
            : div().flex_none().text_size(10.5).text_color(s.color).child(s.label))
          .when(Boolean(p.since), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(duration(Date.now() - p.since * 1000))))
          .when(here, (el) => el.child(this.hud ? div().flex_none().px(5).h(16).bg(t.accent).text_color(INK).flex().items_center().child(caps("here", 11, 700))
            : div().flex_none().px(5).h(16).rounded(4).bg(t.accent + "26").text_size(10).font_semibold().text_color(t.accent).flex().items_center().child("here"))))
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(detail)));
  }

  card(t, prd, cur) {
    const reqs = prd.requirements ?? [];
    const pr = prd.progress ?? { requirements: { total: 0, done: 0 }, tasks: { total: 0, done: 0 } };
    const here = Boolean(cur && prd.panes.some((p) => p.pane === cur.pane));
    const panes = [...prd.panes].sort((a, b) => stateOf(t, a.state).rank - stateOf(t, b.state).rank);
    const date = when(t, prd);
    return v_flex().id(`prd-${prd.prd_id}`).mt(8).p(10).gap(6)
      .when(!this.hud, (el) => el.rounded(8).border_1().border_color(here ? t.accent : t.border))
      .when(this.hud, (el) => el.relative().children(frame(8, { bg: t.chrome, line: here ? t.accent : t.accent + "59" })))
      .child(h_flex().gap(8).items_center()
        .child(div().min_w(0).flex_1().truncate().text_size(11.5).font_semibold().text_color(t.accent)
          .when(this.hud, (el) => el.font_family(display()).font_weight(700).text_size(13)).child(prd.client?.name ?? "No client"))
        .child(this.badge(t, STATUS[prd.status] ?? prd.status, prd.status === "approved" ? t.done : prd.status === "in_review" ? t.working : t.muted)))
      .child(div().id(`title-${prd.prd_id}`).font_semibold().text_color(t.foreground).cursor_pointer()
        .when(this.hud, (el) => el.font_family(display()).font_weight(700).text_size(16))
        .hover((s) => s.text_color(t.accent)).tooltip("Read the whole PRD")
        .on_click((_e, cx) => this.read(cx, prd))
        .child(prd.title))
      .child(h_flex().gap(6).items_center().text_size(11)
        .child(div().text_color(t.dim).child(`v${prd.version}${prd.urgency && prd.urgency !== "none" ? ` \u00b7 ${prd.urgency}` : ""}`))
        .when(Boolean(date), (el) => el.child(div().text_color(t.dim).child("\u00b7")).child(div().text_color(date.color).child(date.text)))
        .child(div().flex_1())
        .child(this.action(t, `read-${prd.prd_id}`, this.reading === prd.prd_id ? "Opening\u2026" : "Read", (cx) => this.read(cx, prd)))
        .child(this.action(t, `studio-${prd.prd_id}`, "Studio", (cx) => this.run(cx, "open", [prd.studio_url])))
        .when(Boolean(prd.linear?.url), (el) => el.child(this.action(t, `linear-${prd.prd_id}`, "Linear", (cx) => this.run(cx, "open", [prd.linear.url])))))
      .child(this.bar(t, reqs))
      .child((this.hud ? caps(`${pr.requirements.done} of ${pr.requirements.total} requirements done \u00b7 ${pr.tasks.done} of ${pr.tasks.total} tasks`, 12)
        : div().text_size(11.5).child(`${pr.requirements.done} of ${pr.requirements.total} requirements done \u00b7 ${pr.tasks.done} of ${pr.tasks.total} tasks`)).text_color(t.muted))
      .child(v_flex().gap(1).when(this.hud, (el) => el.pt(6).border_t(1).border_color(t.accent + "33")).children(panes.map((p) => this.paneRow(t, p, cur, `p-${prd.prd_id}`))));
  }

  // A client's panes on no PRD: work that should have one (omo-work bind <task> to a PRD's task).
  clientGroup(t, g, cur) {
    return v_flex().id(`client-${g.name}`).mt(6).p(8).gap(4)
      .when(!this.hud, (el) => el.rounded(8).border_1().border_color(t.border))
      .when(this.hud, (el) => el.relative().children(frame(8, { bg: t.chrome, line: t.accent + "33" })))
      .child(h_flex().gap(8).items_center()
        .child(div().min_w(0).flex_1().truncate().text_size(11.5).font_semibold().text_color(t.accent)
          .when(this.hud, (el) => el.font_family(display()).font_weight(700).text_size(13)).child(g.name))
        .when(Boolean(g.kind), (el) => el.child(this.badge(t, g.kind === "billed" ? "Billed" : "In-house", g.kind === "billed" ? t.blocked : t.muted)))
        .child(this.hud ? readout(t, g.panes.length)
          : div().flex_none().text_size(11).text_color(t.dim).child(`${g.panes.length} pane${g.panes.length === 1 ? "" : "s"}`)))
      .child(v_flex().gap(1).children(g.panes.map((p) => this.paneRow(t, p, cur, `c-${g.name}`, true))));
  }

  scopeButton(t, id, label) {
    const on = this.scope === id;
    if (this.hud) return hudButton(t, `scope-${id}`, label, { on }).on_click((_e, cx) => this.setScope(id, cx));
    return div().id(`scope-${id}`).px(8).h(22).flex().items_center().text_size(11).cursor_pointer()
      .when(on, (el) => el.bg(t.selected).text_color(t.foreground).font_semibold())
      .when(!on, (el) => el.text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => this.setScope(id, cx))
      .child(label);
  }

  render(cx) {
    if (this.headless) {
      const f = focused()?.terminal ?? null, w = shared("tmux.where");
      const key = `${f}|${w?.on ?? ""}|${w?.pane ?? ""}`;
      if (key !== this.focusSeen && !checking()) { this.focusSeen = key; this.share(); }
      return div();
    }
    const t = theme();
    this.hud = isHud();
    const shared_ = shared("studio.prds");
    const data = shared_?.data ?? null;
    const cur = shared_?.cur ?? null;
    const all = [...(data?.prds ?? []).flatMap((p) => p.panes), ...(data?.unlinked ?? [])];
    const session = cur ? all.find((p) => p.pane === cur.pane)?.session ?? null : null;
    const inScope = (p) => this.scope === "all" || (session !== null && p.session === session);
    const prds = (data?.prds ?? []).map((p) => ({ ...p, panes: p.panes.filter(inScope) })).filter((p) => p.panes.length > 0);
    const unlinked = (data?.unlinked ?? []).filter(inScope);
    const clients = [...new Set(unlinked.map((p) => p.client).filter(Boolean))].sort()
      .map((name) => { const panes = unlinked.filter((p) => p.client === name); return { name, kind: panes[0].kind, panes }; });
    const others = unlinked.filter((p) => !p.client);
    const problem = this.actionProblem ?? shared_?.problem ?? null;
    const empty = !shared_ ? "Reading studio-prds\u2026"
      : this.scope === "here" ? (session ? `No omo pane in ${session} is working on a PRD.` : "Focus a tmux pane running omo to see its PRD.")
      : "No omo pane is bound to a task that belongs to a PRD. Agents bind with omo-work bind <task>.";
    return v_flex().id("prds").size_full().min_h(0).rounded(this.hud ? 0 : 10).overflow_hidden().bg(t.background).border_1().border_color(this.hud ? t.accent + "4d" : t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(this.hud ? 46 : 42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(this.hud ? t.accent + "33" : t.border)
        .child(this.hud ? hudTitle(t, "PRDs", 17) : div().font_semibold().child("PRDs"))
        .child(this.hud ? readout(t, prds.length) : this.badge(t, `${prds.length} PRD${prds.length === 1 ? "" : "s"}`))
        .child(div().flex_1())
        .child(h_flex().flex_none().gap(this.hud ? 4 : 0)
          .when(!this.hud, (el) => el.rounded(6).border_1().border_color(t.border).overflow_hidden())
          .child(this.scopeButton(t, "here", "Here"))
          .child(this.scopeButton(t, "all", "All"))))
      .when(Boolean(problem), (el) => el.child(div().id("problem").px(12).py(6).text_size(11.5).text_color(t.blocked)
        .when(!this.hud, (el) => el.border_b(1).border_color(t.border))
        .when(this.hud, (el) => el.relative().mx(8).mt(6).children(frame(6, { bg: t.blocked + "0f", line: t.blocked + "80" })))
        .when(Boolean(this.actionProblem), (el) => el.cursor_pointer().tooltip("Click to dismiss").on_click((_e, cx) => { this.actionProblem = null; cx.notify(); }))
        .child(problem)))
      .child(v_flex().id("prds-list").relative().flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar().mode("always")
        .when(prds.length === 0, (el) => el.child(div().px(4).py(8).text_size(12).text_color(t.dim).child(empty)))
        .children(prds.map((p) => this.card(t, p, cur)))
        .when(clients.length > 0, (el) => el
          .child(this.hud ? h_flex().mt(14).px(4).gap(8).items_center().child(caps("Client work on no PRD", 12.5, 700).flex_none().text_color(t.dim))
              .child(div().flex_1().h(1).bg(t.accent + "33"))
            : div().mt(14).px(4).text_size(11).text_color(t.dim).child("Client work on no PRD"))
          .children(clients.map((g) => this.clientGroup(t, g, cur))))
        .when(others.length > 0, (el) => el
          .child(h_flex().id("unlinked").mt(10).px(6).h(26).gap(6).items_center().rounded(this.hud ? 0 : 6).cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.toggleUnlinked(cx))
            .child(svg(`mods/workspace-chrome/chevron-${this.unlinkedOpen ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
            .child(this.hud ? caps(`${others.length} pane${others.length === 1 ? "" : "s"} not on client work`, 12.5).text_color(t.dim)
              : div().text_size(12).text_color(t.dim).child(`${others.length} pane${others.length === 1 ? "" : "s"} not on client work`)))
          .when(this.unlinkedOpen, (el2) => el2.child(v_flex().gap(1).children(others.map((p) => this.paneRow(t, p, cur, "u", true)))))));
  }
}
