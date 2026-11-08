// The board: every omo session on every machine the omo board knows, from
// agent-state (the board's session tracker, 127.0.0.1:4747 through the board
// tunnel), in five columns: Needs you, Working, Background (the turn is over but
// a build, watcher or child session still runs), Done (finished in the last day)
// and Idle. A card has the session's title, where it runs, its question or last
// report, its to-do progress and how recently it was active: hot under an hour,
// warm under a day, cold after that. A click shows the session in Herdr with
// `omo-status open` (its space, or a new one; other machines' sessions too). Cmd+Shift+B
// opens it in the tmux layout, as does the "omo in tmux" panel's board button.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, theme, props, closeOverlay } from "herdr";

// Live sessions only, compact (no transcripts): about 12 KB where the full list is about 700 KB.
const SESSIONS = "http://127.0.0.1:4747/api/sessions?alive=1&compact=1";
const CACHE = "sessions";
const HOUR = 3600000;
const DAY = 24 * HOUR;
const COLUMNS = [
  ["needs", "Needs you"],
  ["working", "Working"],
  ["background", "Background"],
  ["done", "Done"],
  ["idle", "Idle"],
];

function column(s, now) {
  if (s.lifecycle === "blocked") return "needs";
  if (s.lifecycle === "active") return "working";
  if (s.lifecycle === "background") return "background";
  if (s.lifecycle === "done" && now - (s.lifecycleSince ?? s.lastActivity ?? 0) < DAY) return "done";
  return "idle";
}

function progress(s) {
  return s.todos?.all ? `${s.todos.done}/${s.todos.all}` : "";
}

// Time left to a scheduled wake-up: m:ss under an hour, then hours and minutes.
function countdown(ms) {
  if (ms <= 0) return "due";
  const s = Math.ceil(ms / 1000);
  if (s < 3600) return `in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const h = Math.floor(s / 3600);
  return h < 24 ? `in ${h}h ${Math.floor((s % 3600) / 60)}m` : `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export default class Board extends View {
  // The last answer, kept in localStorage, shows at once; a fresh one follows. curl rather than fetch, because
  // the ETag header is how agent-state says "unchanged" (a 304 with no body) and fetch doesn't expose headers.
  init(_props, cx) {
    let cached = null;
    try {
      cached = JSON.parse(localStorage.getItem(CACHE) ?? "null");
    } catch {}
    this.sessions = cached?.sessions ?? [];
    this.etag = cached?.etag ?? null;
    this.fetchedAt = cached?.at ?? 0;
    this.loaded = Boolean(cached);
    this.problem = null;
    this.paintedAt = 0;
    this.handle = cx.focus_handle();
    this.refresh(cx);
    cx.timer.every(5000, (cx) => this.refresh(cx));
    // Scheduled wake-ups count down here, between fetches.
    cx.timer.every(1000, (cx) => { if (this.sessions.some((s) => s.resumeAt)) cx.notify(); });
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      let changed = !this.loaded;
      try {
        const args = ["-s", "-m", "5", "-D", "/dev/stderr", SESSIONS];
        if (this.etag) args.unshift("-H", `If-None-Match: ${this.etag}`);
        const r = await exec("curl", args);
        const status = Number(r.stderr.match(/^HTTP\/[\d.]+ (\d{3})/m)?.[1] ?? 0);
        if (r.code !== 0 || !status) throw new Error(`agent-state didn't answer (curl ${r.code}); is the board tunnel up?`);
        if (status === 200) {
          this.sessions = JSON.parse(r.stdout);
          this.etag = r.stderr.match(/^etag:\s*(\S+)/im)?.[1] ?? null;
          this.fetchedAt = Date.now();
          localStorage.setItem(CACHE, JSON.stringify({ at: this.fetchedAt, etag: this.etag, sessions: this.sessions }));
          changed = true;
        } else if (status === 304) {
          this.fetchedAt = Date.now();
        } else {
          throw new Error(`agent-state answered ${status}`);
        }
        if (this.problem) changed = true;
        this.problem = null;
      } catch (e) {
        const problem = `${e?.message ?? e}`;
        if (problem !== this.problem) changed = true;
        this.problem = problem;
      }
      this.loaded = true;
      this.busy = false;
      // Repaint for new data, and once a minute so the ages move on.
      if (changed || Date.now() - this.paintedAt > 60000) cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  // The popup closes once the session shows: closing first would cancel the task.
  open(s, cx) {
    cx.spawn(async () => {
      try {
        await exec(`${home()}/.local/bin/omo-status`, ["open", s.tmux, s.host ?? ""]);
      } finally {
        this.close();
      }
    });
  }

  card(t, s, key, now) {
    const age = now - (s.lastActivity ?? s.startedAt ?? now);
    const heat = age < HOUR ? t.working : age < DAY ? t.blocked : t.dim;
    const where = [s.machine !== "mac" ? s.machine : null, s.project, s.tmux].filter(Boolean).join(" · ");
    const text = s.excerpt ?? "";
    const done = progress(s);
    const canOpen = Boolean(s.tmux);
    return v_flex()
      .id(`card-${s.machine}-${s.sid}`)
      .flex_none()
      .p(10)
      .gap(4)
      .rounded(9)
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .when(canOpen, (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.open(s, cx)))
      .when(!canOpen, (el) => el.tooltip("Not in tmux, so it can't be shown from here"))
      .child(div().truncate().font_semibold().text_color(t.foreground).child(s.name || s.project || "omo session"))
      .child(div().truncate().text_size(11).text_color(t.dim).child(where))
      .when(Boolean(text), (el) => el.child(div().text_size(11.5).line_height(1.4).max_h(48).overflow_hidden()
        .text_color(key === "needs" ? t.foreground : t.muted).child(text)))
      .child(h_flex().pt(2).gap(8).items_center().text_size(11).text_color(t.dim)
        .child(div().size(7).flex_none().rounded(4).bg(heat))
        .child(ago(age))
        .when(Boolean(s.resumeAt), (el) => el.child(div().text_color(t.ansi5).child(`resumes ${countdown(s.resumeAt - now)}`)))
        .when(Boolean(done), (el) => el.child(h_flex().gap(4).items_center()
          .child(svg("mods/workspace-chrome/circle-check.svg").size(11))
          .child(done))));
  }

  render() {
    const t = theme();
    const now = Date.now();
    this.paintedAt = now;
    const old = this.fetchedAt && now - this.fetchedAt > 60000 ? ` · updated ${ago(now - this.fetchedAt)} ago` : "";
    const groups = Object.fromEntries(COLUMNS.map(([key]) => [key, []]));
    for (const s of this.sessions) groups[column(s, now)].push(s);
    const by = (field, dir) => (a, b) => dir * ((a[field] ?? 0) - (b[field] ?? 0));
    groups.needs.sort(by("lifecycleSince", 1));
    for (const key of ["working", "background", "done", "idle"]) groups[key].sort(by("lastActivity", -1));

    const col = ([key, title]) => {
      const list = groups[key];
      return v_flex()
        .flex_1()
        .min_w(0)
        .h_full()
        .gap(8)
        .child(h_flex().px(2).gap(6).items_center().text_size(12).font_semibold()
          .text_color(key === "needs" && list.length ? t.blocked : t.dim)
          .when(key === "needs" && list.length > 0, (el) => el.child(div().size(7).rounded(4).bg(t.blocked)
            .loop("opacity", { from: 0.35, to: 1, period: 1600 })))
          .child(title)
          .child(div().font_normal().child(String(list.length))))
        .child(v_flex().id(`col-${key}`).flex_1().min_h(0).gap(8).overflow_y_scrollbar()
          .when(list.length === 0, (el) => el.child(div().px(2).text_size(12).text_color(t.dim).child(this.loaded ? "None" : "…")))
          .children(list.map((s) => this.card(t, s, key, now))));
    };

    return v_flex()
      .id("omo-board")
      .track_focus(this.handle)
      .size_full()
      .min_h(0)
      .p(18)
      .gap(12)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        cx.stop_propagation();
        this.close();
      })
      .child(h_flex().items_center().gap(10)
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Board"))
        .child(div().flex_1().text_size(11.5).text_color(t.dim)
          .child(this.problem ?? `${this.sessions.length} omo sessions across your machines${old}`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      // The popup takes its content's height, so the columns get theirs.
      .child(h_flex().h(640).gap(12).items_start().children(COLUMNS.map(col)));
  }
}
