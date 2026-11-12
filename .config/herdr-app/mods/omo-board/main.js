// The board: every omo session on every machine the omo board knows, from
// agent-state (the board's session tracker, 127.0.0.1:4747 through the board
// tunnel), in six columns: Needs you, Working, Background (the turn is over but
// a build, watcher or child session still runs), Done (finished in the last day),
// Idle and Parked (closed on purpose, from the session library: a click reopens
// one, and "Start fresh" starts a new session from its handoff). A card has the session's title, where it runs, its question or last
// report, its to-do progress and how recently it was active: hot under an hour,
// warm under a day, cold after that. A click shows the session in Herdr with
// `omo-status open` (its space, or a new one; other machines' sessions too). Cmd+Shift+B
// opens it in the netrunner layout, as does the screen button in the Agents list's header.
//
// It opens as a dialog (mod.json): centered, over a dimmed window, drawn in the netrunner colours
// with its own neon frame (`frame: "none"`). It takes the keyboard when it opens, so Esc closes it;
// a popup doesn't, and Esc used to go to the terminal underneath.
//
// `/` opens a search bar over the columns: every word typed has to appear in a card's title,
// project, machine, tmux target or text, and the columns count only what matches. Enter shows the
// first match. Esc clears the search, then closes the bar (as Backspace does on an empty one), and
// only then closes the board. The search lasts while the board is open.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, home, theme, props, settings, closeOverlay } from "herdr";

// Live sessions only, compact (no transcripts): about 12 KB where the full list is about 700 KB.
const SESSIONS = "http://127.0.0.1:4747/api/sessions?alive=1&compact=1";
const LIBRARY = "http://127.0.0.1:4747/api/library?compact=1";
const CACHE = "sessions";
const HOUR = 3600000;
const DAY = 24 * HOUR;
const COLUMNS = [
  ["needs", "Needs you"],
  ["working", "Working"],
  ["background", "Background"],
  ["done", "Done"],
  ["idle", "Idle"],
  ["parked", "Parked"],
];
const TONE = { needs: "blocked", working: "working", background: "ansi5", done: "done", idle: "idle", parked: "accent" };

function column(s, now) {
  if (s.lifecycle === "blocked") return "needs";
  if (s.lifecycle === "active") return "working";
  if (s.lifecycle === "background") return "background";
  if (s.lifecycle === "done" && now - (s.lifecycleSince ?? s.lastActivity ?? 0) < DAY) return "done";
  return "idle";
}

// What a search looks through, lower-cased: a parked card's next step counts as its text too.
function haystack(s) {
  return [s.name, s.project, s.machine, s.tmux, s.excerpt, s.handoff?.next].filter(Boolean).join(" ").toLowerCase();
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

let keysBound = false;

const mono = () => settings().font_family ?? "JetBrains Mono";

// Element backgrounds take one colour, so a gradient is drawn as steps between two #rrggbb colours.
function mix(a, b, f) {
  const at = (c, i) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(at(a, i) + (at(b, i) - at(a, i)) * f).toString(16).padStart(2, "0")).join("");
}
const steps = (a, b, n) => Array.from({ length: n }, (_, i) => div().flex_1().h_full().bg(mix(a, b, i / (n - 1))));

export default class Board extends View {
  // The last answer, kept in localStorage, shows at once; a fresh one follows. curl rather than fetch, because
  // the ETag header is how agent-state says "unchanged" (a 304 with no body) and fetch doesn't expose headers.
  init(_props, cx) {
    let cached = null;
    try {
      cached = JSON.parse(localStorage.getItem(CACHE) ?? "null");
    } catch {}
    this.sessions = cached?.sessions ?? [];
    this.parked = [];
    this.parkedBody = "";
    this.etag = cached?.etag ?? null;
    this.fetchedAt = cached?.at ?? 0;
    this.loaded = Boolean(cached);
    this.problem = null;
    this.paintedAt = 0;
    this.handle = cx.focus_handle();
    this.query = "";
    this.searching = false;
    this.inputFocused = false;
    this.first = null;
    this.input = InputState.new({ placeholder: "title, project, machine, tmux or text" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.openFirst(cx));
    this.input.on("focus", () => { this.inputFocused = true; });
    this.input.on("blur", () => { this.inputFocused = false; });
    // Esc and Backspace are bound rather than heard in on_key_down: the search field turns Esc into an
    // action it lets pass, and the dialog's own Esc binding closed the whole board before any key
    // listener ran; the field itself eats Backspace. A binding in the board's context comes before the
    // dialog's, and one on an empty field ("OmoBoardSearchEmpty > Input") before the field's own.
    if (!keysBound) {
      keysBound = true;
      cx.bind_keys([
        { keystroke: "escape", action: "omo-board-escape", context: "OmoBoard" },
        { keystroke: "backspace", action: "omo-board-backspace", context: "OmoBoardSearchEmpty > Input" },
      ]);
    }
    // The keyboard, once the board has drawn: Esc then reaches it.
    cx.timer.after(60, () => this.handle.focus());
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
        // The parked sessions are a short list, read whole each time.
        const library = await exec("curl", ["-s", "-m", "5", LIBRARY]);
        if (library.code === 0 && library.stdout !== this.parkedBody) {
          const parked = JSON.parse(library.stdout);
          if (Array.isArray(parked)) {
            this.parked = parked;
            this.parkedBody = library.stdout;
            changed = true;
          }
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

  // Shows the search bar and gives it the keyboard, or hides it, empty, and gives the keyboard back to the board.
  search(on, cx) {
    this.searching = on;
    if (on) {
      this.input.focus();
    } else {
      this.input.set_value("");
      this.query = "";
      this.handle.focus();
    }
    cx.notify();
  }

  // Esc: clears the search, then closes it, and only then closes the board.
  escape(cx) {
    if (!this.searching) return this.close();
    if (this.query) {
      this.input.set_value("");
      this.query = "";
      cx.notify();
    } else {
      this.search(false, cx);
    }
  }

  // Enter in the search: the first match, in column order, opens as a click on it would.
  openFirst(cx) {
    const hit = this.first;
    if (!hit) return;
    if (hit.key === "parked") this.reopen(hit.s, false, cx);
    else if (hit.s.tmux) this.open(hit.s, cx);
  }

  // The board closes once the session shows: closing first would cancel the task.
  open(s, cx) {
    cx.spawn(async () => {
      try {
        await exec(`${home()}/.local/bin/omo-status`, ["open", s.tmux, s.host ?? ""]);
      } finally {
        this.close();
      }
    });
  }

  // Reopens a parked session, or starts a new one from its handoff, and shows it.
  reopen(s, fresh, cx) {
    cx.spawn(async () => {
      try {
        await exec(`${home()}/.local/bin/omo-sessions`, ["open", s.machine, s.sid, ...(fresh ? ["--fresh"] : [])]);
      } finally {
        this.close();
      }
    });
  }

  shell(t, id, tone, body) {
    return h_flex().id(id).items_stretch().flex_none().rounded(4).overflow_hidden().bg(t.chrome).border_1().border_color(t.border)
      .hover((st) => st.bg(t.hover).border_color(tone + "b3"))
      .child(div().w(3).flex_none().bg(tone))
      .child(v_flex().flex_1().min_w(0).px(11).py(9).gap(4).child(body));
  }

  where(s) {
    return [s.machine !== "mac" ? s.machine : null, s.project, s.tmux].filter(Boolean).join(" · ");
  }

  parkedCard(t, s, now) {
    const tone = t[TONE.parked], next = s.handoff?.next;
    return this.shell(t, `parked-${s.machine}-${s.sid}`, tone, v_flex().gap(4)
      .child(div().truncate().font_semibold().text_color(t.foreground).child(s.name || s.project || "omo session"))
      .child(div().truncate().font_family(mono()).text_size(10.5).text_color(t.dim).child(this.where(s)))
      .when(Boolean(s.excerpt), (el) => el.child(div().text_size(11.5).line_height(1.4).max_h(48).overflow_hidden().text_color(t.muted).child(s.excerpt)))
      .when(Boolean(next), (el) => el.child(div().truncate().text_size(11.5).text_color(t.muted).child(`Next: ${next}`)))
      .child(h_flex().pt(3).gap(8).items_center().font_family(mono()).text_size(10.5).text_color(t.dim)
        .child(ago(now - s.parkedAt))
        .child(div().flex_1())
        .child(div().id(`fresh-${s.machine}-${s.sid}`).px(6).h(20).flex().items_center().rounded(3).border_1().border_color(tone + "66")
          .text_color(tone).cursor_pointer().hover((st) => st.bg(tone + "1f")).tooltip("Start a new session from this handoff")
          .on_click((_e, cx) => { cx.stop_propagation(); this.reopen(s, true, cx); })
          .child("START FRESH"))))
      .cursor_pointer().tooltip("Reopen this session").on_click((_e, cx) => this.reopen(s, false, cx));
  }

  card(t, s, key, now) {
    const tone = t[TONE[key]] ?? t.dim;
    const age = now - (s.lastActivity ?? s.startedAt ?? now);
    const heat = age < HOUR ? t.working : age < DAY ? t.blocked : t.dim;
    const text = s.excerpt ?? "";
    const done = progress(s);
    const canOpen = Boolean(s.tmux);
    return this.shell(t, `card-${s.machine}-${s.sid}`, tone, v_flex().gap(4)
      .child(div().truncate().font_semibold().text_color(t.foreground).child(s.name || s.project || "omo session"))
      .child(div().truncate().font_family(mono()).text_size(10.5).text_color(t.dim).child(this.where(s)))
      .when(Boolean(text), (el) => el.child(div().text_size(11.5).line_height(1.4).max_h(48).overflow_hidden()
        .text_color(key === "needs" ? t.foreground : t.muted).child(text)))
      .child(h_flex().pt(3).gap(8).items_center().font_family(mono()).text_size(10.5).text_color(t.dim)
        .child(div().size(6).flex_none().rounded(3).bg(heat))
        .child(ago(age))
        .when(Boolean(s.resumeAt), (el) => el.child(div().text_color(t.ansi5).child(`resumes ${countdown(s.resumeAt - now)}`)))
        .when(Boolean(done), (el) => el.child(h_flex().gap(4).items_center()
          .child(svg("mods/workspace-chrome/circle-check.svg").size(11))
          .child(done)))))
      .when(canOpen, (el) => el.cursor_pointer().on_click((_e, cx) => this.open(s, cx)))
      .when(!canOpen, (el) => el.tooltip("Not in tmux, so it can't be shown from here"));
  }

  render() {
    const t = theme();
    const now = Date.now();
    this.paintedAt = now;
    const groups = Object.fromEntries(COLUMNS.map(([key]) => [key, []]));
    for (const s of this.sessions) groups[column(s, now)].push(s);
    groups.parked = this.parked;
    const by = (field, dir) => (a, b) => dir * ((a[field] ?? 0) - (b[field] ?? 0));
    groups.needs.sort(by("lifecycleSince", 1));
    for (const key of ["working", "background", "done", "idle"]) groups[key].sort(by("lastActivity", -1));
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const filtering = words.length > 0;
    if (filtering) {
      for (const [key] of COLUMNS) groups[key] = groups[key].filter((s) => { const h = haystack(s); return words.every((w) => h.includes(w)); });
    }
    const firstKey = COLUMNS.map(([key]) => key).find((key) => groups[key].length);
    this.first = filtering && firstKey ? { key: firstKey, s: groups[firstKey][0] } : null;
    const hits = COLUMNS.reduce((n, [key]) => n + groups[key].length, 0);
    const machines = new Set(this.sessions.map((s) => s.machine)).size;
    const stale = !this.fetchedAt || now - this.fetchedAt > 60000;
    const live = this.problem ? t.ansi1 : stale ? t.blocked : t.working;

    const col = ([key, title]) => {
      const list = groups[key], tone = t[TONE[key]] ?? t.dim, lit = list.length > 0;
      return v_flex().flex_1().min_w(0).h_full().gap(10)
        .child(v_flex().flex_none().gap(7)
          .child(h_flex().h(20).gap(8).items_center()
            .when(key === "needs" && lit, (el) => el.child(div().size(7).flex_none().rounded(4).bg(tone).loop("opacity", { from: 0.3, to: 1, period: 1400 })))
            .child(div().font_family(mono()).text_size(11.5).font_bold().text_color(lit ? tone : t.dim).child(title.toUpperCase()))
            .child(div().flex_1())
            .child(div().px(6).h(18).flex().items_center().rounded(3).border_1().border_color(lit ? tone + "73" : t.border)
              .font_family(mono()).text_size(10.5).text_color(lit ? tone : t.dim).child(String(list.length).padStart(2, "0"))))
          .child(h_flex().h(2).flex_none().child(div().w(48).h_full().bg(lit ? tone : t.border)).child(div().flex_1().h_full().bg(lit ? tone + "2e" : t.border))))
        .child(v_flex().id(`col-${key}`).flex_1().min_h(0).gap(8).overflow_y_scrollbar()
          .when(!lit, (el) => el.child(div().px(2).py(4).font_family(mono()).text_size(11).text_color(t.dim).child(filtering ? "// no matches" : this.loaded ? "// empty" : "// loading")))
          .children(list.map((s) => (key === "parked" ? this.parkedCard(t, s, now) : this.card(t, s, key, now)))));
    };

    return v_flex()
      .id("omo-board")
      .track_focus(this.handle)
      .size_full()
      .min_h(0)
      .rounded(6)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.accent + "d9")
      .shadow_2xl()
      .text_size(13)
      .text_color(t.foreground)
      .key_context("OmoBoard")
      .on_action("omo-board-escape", (_e, cx) => this.escape(cx))
      .on_key_down((e, cx) => {
        const k = e.keystroke;
        // `/` opens the search, or takes the keyboard back to it; typed inside it, it's text.
        if ((k === "/" || e.key_char === "/") && !(this.searching && this.inputFocused)) {
          cx.stop_propagation();
          return this.search(true, cx);
        }
      })
      .child(h_flex().h(3).flex_none().children(steps(t.accent.slice(0, 7), t.working.slice(0, 7), 24)))
      .child(h_flex().h(62).flex_none().px(22).gap(14).items_center().border_b(1).border_color(t.border)
        .child(h_flex().h(30).gap(3).flex_none().items_end().child(div().w(4).h(30).bg(t.accent)).child(div().w(4).h(18).bg(t.working)))
        .child(v_flex().gap(3)
          .child(h_flex().gap(10).items_center()
            .child(div().font_family(mono()).text_size(16).font_bold().text_color(t.foreground).child("OMO // BOARD"))
            .child(h_flex().px(6).h(18).gap(5).items_center().rounded(3).border_1().border_color(live + "66")
              .child(div().size(6).rounded(3).bg(live).when(!this.problem && !stale, (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1800 })))
              .child(div().font_family(mono()).text_size(10).font_bold().text_color(live)
                .child(this.problem ? "OFFLINE" : stale ? `STALE ${ago(now - this.fetchedAt)}` : "LIVE"))))
          .child(div().font_family(mono()).text_size(11).text_color(this.problem ? t.ansi1 : t.dim)
            .child(this.problem ?? `${this.sessions.length} sessions · ${machines} machine${machines === 1 ? "" : "s"} · ${this.parked.length} parked`)))
        .child(div().flex_1())
        .child(h_flex().id("board-search").px(8).h(26).gap(6).items_center().rounded(3).border_1()
          .border_color(this.searching ? t.accent + "b3" : t.border)
          .font_family(mono()).text_size(11).font_bold().text_color(this.searching ? t.accent : t.dim).cursor_pointer()
          .hover((st) => st.bg(t.accent + "1f").text_color(t.accent)).tooltip("Search the board (/)")
          .on_click((_e, cx) => this.search(true, cx))
          .child(svg("mods/workspace-chrome/search.svg").size(12))
          .child("/"))
        .child(div().id("board-esc").px(8).h(26).flex().items_center().rounded(3).border_1().border_color(t.working + "80")
          .font_family(mono()).text_size(11).font_bold().text_color(t.working).cursor_pointer()
          .hover((st) => st.bg(t.working + "1f")).tooltip("Close (Esc)").on_click(() => this.close())
          .child("ESC")))
      // Backspace closes an empty search: its binding matches only while the field is empty, so with text
      // the field's own Backspace deletes as usual.
      .when(this.searching, (el) => el.child(h_flex().when(!this.query, (bar) => bar.key_context("OmoBoardSearchEmpty"))
        .on_action("omo-board-backspace", (_e, cx) => this.search(false, cx))
        .h(40).flex_none().mx(20).mt(14).pl(12).pr(10).gap(10).items_center()
        .rounded(4).border_1().border_color(t.accent + "b3").bg(t.chrome)
        .child(div().font_family(mono()).text_size(13).font_bold().text_color(t.accent).child("/"))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))
        .child(div().flex_none().font_family(mono()).text_size(10.5).font_bold().text_color(filtering ? (hits ? t.working : t.ansi1) : t.dim)
          .child(filtering ? `${String(hits).padStart(2, "0")} MATCH${hits === 1 ? "" : "ES"}` : "TYPE TO FILTER"))
        .child(div().id("board-search-esc").px(6).h(20).flex().flex_none().items_center().rounded(3).border_1().border_color(t.border)
          .font_family(mono()).text_size(10).text_color(t.dim).cursor_pointer().hover((st) => st.text_color(t.foreground))
          .tooltip(this.query ? "Clear (Esc)" : "Close the search (Esc)")
          .on_click((_e, cx) => (this.query ? (this.input.set_value(""), (this.query = ""), this.input.focus(), cx.notify()) : this.search(false, cx)))
          .child(this.query ? "ESC CLEAR" : "ESC CLOSE"))))
      .child(h_flex().flex_1().min_h(0).px(20).pt(16).pb(14).gap(14).children(COLUMNS.map(col)))
      .child(h_flex().h(28).flex_none().px(22).gap(8).items_center().border_t(1).border_color(t.border)
        .font_family(mono()).text_size(10.5).text_color(t.dim)
        .child(div().text_color(t.accent).child(">"))
        .child(this.searching ? "enter shows the first match · esc clears, then closes the search" : "click a card to show it in Herdr · a parked card reopens it · / searches")
        .child(div().flex_1())
        .child(`agent-state · ${this.fetchedAt ? `read ${ago(now - this.fetchedAt)} ago` : "not read yet"}`));
  }
}
