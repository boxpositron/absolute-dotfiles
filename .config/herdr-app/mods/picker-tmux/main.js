// Go to a tab. Drops from the Terminals layout's space chip (popup, at: "top"). Spaces with
// something that needs you come first, quiet spaces (no agent running)
// fold into "earlier". Type to filter, ↑/↓ and Enter to go, ctrl+d to close
// a tab, Esc to leave. Last rows: new work (a tab here, a space on this
// computer or on each connected machine).
// picker-tmux: Herdr's picker plus tmux. Its sessions fold into one row until
// you type; then sessions match by name and panes by window, program, folder
// or omo message. Going to one shows it through `omo-status show`: in the
// Herdr tab already on its session, else the space named after the session,
// else a new space for it.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, spaces, terminals, run, hc, exec, home, theme, settings, props, closeOverlay, openOverlay, shared, setShared } from "herdr";

const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// Space colors, kept by space id in shared "space.colors": a theme
// color name ("ansi6") or a picked #rrggbb. A space seen without one gets
// the theme color fewest spaces use, once; every mod does the same in the
// same order, so they agree, and adding or renaming spaces moves nothing.
const PROJECT_COLORS = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
function spaceColors() {
  const ids = new Set(spaces().map((p) => p.id));
  const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
  let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
  for (const p of spaces()) {
    if (kept[p.id] || p.name === "~") continue;
    const uses = (c) => Object.values(kept).filter((v) => v === c).length;
    kept[p.id] = PROJECT_COLORS.reduce((best, c) => (uses(c) < uses(best) ? c : best));
    changed = true;
  }
  if (changed) setShared("space.colors", kept);
  return kept;
}
// tmux turns control characters in its output into "_" when Herdr runs it, so
// fields split on text; -u because Herdr's environment names no UTF-8 locale.
const SEP = "|^|";
const TMUX_FORMAT = ["#{pane_id}", "#{session_name}", "#{session_attached}", "#{window_index}", "#{window_name}", "#{window_active}",
  "#{pane_index}", "#{pane_active}", "#{pane_current_command}", "#{pane_current_path}", "#{@omo_state}", "#{@omo_msg}"].join(SEP);
// omo-status's states in Herdr's words.
const OMO = { working: "working", input: "blocked", error: "blocked", done: "done", idle: "idle" };
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const PICK = new Set(["ctx", "new", "space", "tsession", "tpane"]);

// tmux sessions in tmux's order, each with its panes and the pane it shows.
function tmuxSessions(stdout) {
  const sessions = new Map();
  for (const line of stdout.split("\n")) {
    const [pane, session, attached, windowIndex, window, windowActive, paneIndex, paneActive, command, path, state, ...msg] = line.split(SEP);
    if (!pane) continue;
    const s = sessions.get(session) ?? { name: session, attached: attached !== "0", panes: [], windows: new Set(), current: null, status: null };
    const p = { pane, window, windowIndex, paneIndex, command, folder: (path ?? "").split("/").filter(Boolean).pop() ?? "~", status: OMO[state] ?? null, msg: msg.join(SEP) };
    s.panes.push(p);
    s.windows.add(windowIndex);
    if (windowActive === "1" && paneActive === "1") s.current = p;
    if ((RANK[p.status] ?? 0) > (RANK[s.status] ?? 0)) s.status = p.status;
    sessions.set(session, s);
  }
  return [...sessions.values()].map((s) => ({ ...s, current: s.current ?? s.panes[0] }));
}

function spaceColor(t, p) {
  if (p.name === "~") return t.dim;
  const c = spaceColors()[p.id] ?? PROJECT_COLORS[0];
  return c.startsWith("#") ? c : (MARK[c] ?? t[c]);
}

export default class Picker extends View {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "Go to a tab, space, agent or tmux session…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(this.rows().filter((r) => PICK.has(r.kind))[this.at], cx));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.at = null;
    this.scroll = 0;
    this.showEarlier = false;
    this.showTmux = false;
    this.tmux = [];
    this.machines = [];
    cx.spawn(async (cx) => {
      try {
        const r = await exec("tmux", ["-u", "list-panes", "-a", "-F", TMUX_FORMAT]);
        if (r.code === 0) this.tmux = tmuxSessions(r.stdout);
      } catch {}
      cx.notify();
    });
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => m.state === "connected" && !m.temporary).map((m) => m.name);
      } catch {}
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  rows() {
    const f = this.filter.toLowerCase();
    const all = agents();
    const live = terminals().filter((x) => x.state === "live");
    const teamOf = (addrs) => {
      let n = 0;
      const walk = (a) => live.filter((x) => x.parent === a).forEach((k) => (n++, walk(k.address)));
      addrs.forEach(walk);
      return n;
    };
    const groups = spaces().map((w) => {
      const ctxs = w.tabs
        .map((ctx) => {
          const mine = all.filter((a) => a.tab === ctx.id);
          return { w, ctx, mine, team: teamOf(mine.map((a) => a.address)) };
        })
        .filter((c) => !f || [w.name, c.ctx.name, ...c.mine.map((a) => a.program?.name ?? "")].join(" ").toLowerCase().includes(f));
      return { w, ctxs };
    });
    const busy = groups.filter((p) => p.w.status && p.ctxs.length);
    const quiet = groups.filter((p) => !p.w.status && p.ctxs.length);
    busy.sort((a, b) => (b.w.status === "blocked") - (a.w.status === "blocked"));
    const out = [];
    const add = (p) => {
      out.push({ kind: "head", w: p.w });
      for (const c of p.ctxs) out.push({ kind: "ctx", ...c });
    };
    busy.forEach(add);
    if (quiet.length) {
      out.push({ kind: "earlier", count: quiet.length });
      if (this.showEarlier || f) quiet.forEach(add);
    }
    if (this.tmux.length && !f) {
      out.push({ kind: "tmuxfold", count: this.tmux.length });
      if (this.showTmux) this.tmux.forEach((s) => out.push({ kind: "tsession", s }));
    } else if (this.tmux.length) {
      const hits = this.tmux
        .map((s) => ({ s, named: s.name.toLowerCase().includes(f), panes: s.panes.filter((p) => [p.window, p.command, p.folder, p.msg].join(" ").toLowerCase().includes(f)) }))
        .filter((h) => h.named || h.panes.length);
      if (hits.length) out.push({ kind: "tmuxhead" });
      for (const h of hits) {
        out.push({ kind: "tsession", s: h.s });
        h.panes.forEach((p) => out.push({ kind: "tpane", s: h.s, p }));
      }
    }
    out.push({ kind: "new" });
    out.push({ kind: "space", machine: null });
    for (const m of this.machines) out.push({ kind: "space", machine: m });
    return out;
  }

  go(r, cx) {
    if (!r) return;
    if (r.kind === "tsession" || r.kind === "tpane") return this.goTmux(r.kind === "tpane" ? r.p : r.s.current, cx);
    this.close();
    if (r.kind === "ctx") run("tab.select", { id: r.ctx.id });
    else if (r.kind === "new") run("tab.new");
    else if (r.kind === "space") run("space.new", { machine: r.machine ?? "" });
  }

  // The popup closes after the jump: closing it first would cancel the task.
  goTmux(p, cx) {
    cx.spawn(async () => {
      try {
        await exec(`${home()}/.local/bin/omo-status`, ["show", p.pane]);
      } finally {
        this.close();
      }
    });
  }

  glyph(t, st) {
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    return div().w(12).flex_none().text_color(t[st] ?? t.dim)
      .when(st === "blocked", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1600 }))
      .child(st === "idle" ? "○" : st ? "●" : "·");
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const pickable = rows.filter((r) => PICK.has(r.kind));
    // Opens on where you are.
    if (this.at === null) this.at = Math.max(0, pickable.findIndex((r) => r.kind === "ctx" && r.w.active && r.ctx.active));
    this.at = Math.min(this.at, pickable.length - 1);
    const sel = pickable[this.at];
    // One continuous strip: each row (and the group title before it) at a fixed
    // y. Scrolling moves the strip only as far as it takes to keep the selected
    // row in view, so the arrows can't run the selection off the list.
    const H = { head: 29, earlier: 35, new: 36, ctx: 32, space: 32, tmuxfold: 35, tmuxhead: 29, tsession: 32, tpane: 32 };
    const tops = [];
    let y = 0;
    rows.forEach((r) => { tops.push(y); y += H[r.kind] ?? 32; });
    const total = y;
    const height = Math.min(320, this.listHeight ?? 320);
    // Rows always sit at fixed y, short list or long, so the selection highlight can slide between them.
    const fixed = true;
    const maxScroll = Math.max(0, total - height);
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
    const si = rows.indexOf(sel);
    if (si >= 0) {
      if (tops[si] < this.scroll) this.scroll = tops[si];
      if (tops[si] + (H[sel.kind] ?? 32) > this.scroll + height) this.scroll = tops[si] + (H[sel.kind] ?? 32) - height;
    }
    const place = (el, i) =>
      fixed
        ? el.absolute().left(0).right(0).top(tops[i] - this.scroll).bottom(height - (tops[i] + (H[rows[i].kind] ?? 32) - this.scroll))
        : el;
    const visible = (i) => !fixed || (tops[i] + (H[rows[i].kind] ?? 32) > this.scroll && tops[i] < this.scroll + height);
    // Pointer movement picks the row under it; a list scrolling under a still pointer doesn't.
    const point = (r) => (_e, cx) => {
      const i = pickable.indexOf(r);
      if (i >= 0 && i !== this.at) {
        this.at = i;
        cx.notify();
      }
    };
    // One highlight for the selection, sliding to it; the "new" row sits 4px down its slot.
    const highlight = si >= 0 && div().id("pk-sel").absolute().left(4).right(4).h(32).rounded(7).bg(t.hover)
      .top(tops[si] + (sel.kind === "new" ? 4 : 0) - this.scroll)
      .transition("top", { duration: 120, easing: "ease-out" });

    const row = (r) => {
      if (r.kind === "head") {
        return h_flex()
          .px(10)
          .pt(10)
          .pb(3)
          .gap(8)
          .items_center()
          .text_size(11)
          .font_semibold()
          .text_color(t.dim)
          .child(h_flex().size(18).rounded(5).bg(spaceColor(t, r.w)).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...r.w.name][0]?.toUpperCase() ?? "?"))
          .child(r.w.name);
      }
      if (r.kind === "earlier") {
        return h_flex()
          .id("pk-earlier")
          .mt(6)
          .px(10)
          .py(6)
          .border_t(1)
          .border_color(t.border)
          .text_size(12)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            this.showEarlier = !this.showEarlier;
            cx.notify();
          })
          .child(`earlier: ${r.count} quiet space${r.count > 1 ? "s" : ""} ${this.showEarlier ? "▴" : "▾"}`);
      }
      if (r.kind === "tmuxfold") {
        return h_flex()
          .id("pk-tmux")
          .mt(6)
          .px(10)
          .py(6)
          .border_t(1)
          .border_color(t.border)
          .text_size(12)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            this.showTmux = !this.showTmux;
            cx.notify();
          })
          .child(`tmux: ${r.count} session${r.count > 1 ? "s" : ""} ${this.showTmux ? "▴" : "▾"}`);
      }
      if (r.kind === "tmuxhead") {
        return h_flex().px(10).pt(10).pb(3).gap(8).items_center().text_size(11).font_semibold().text_color(t.dim)
          .child(svg("mods/workspace-chrome/terminal.svg").size(14))
          .child("tmux");
      }
      if (r.kind === "tsession" || r.kind === "tpane") {
        const pane = r.kind === "tpane";
        const s = r.s;
        const name = pane ? r.p.window : s.name;
        const detail = pane
          ? [r.p.folder, r.p.command].filter((x) => x && x !== r.p.window).join(" · ")
          : `${s.windows.size} window${s.windows.size > 1 ? "s" : ""}${s.attached ? " · open" : ""}`;
        return h_flex()
          .id(pane ? `pk-tp-${r.p.pane}` : `pk-ts-${s.name}`)
          .mx(4)
          .px(10)
          .when(pane, (el) => el.pl(32))
          .h(32)
          .rounded(7)
          .gap(10)
          .items_center()
          .cursor_pointer()
          .on_mouse_move(point(r))
          .on_click((_e, cx) => this.go(r, cx))
          .child(this.glyph(t, pane ? r.p.status : s.status))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(name))
          .when(pane && Boolean(r.p.msg), (el) => el.child(div().max_w(220).truncate().text_size(11).text_color(t.dim).child(r.p.msg)))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(pane ? `${s.name}:${r.p.windowIndex}.${r.p.paneIndex}` : detail))
          .when(pane && Boolean(detail), (el) => el.child(div().flex_none().max_w(140).truncate().text_size(11).text_color(t.dim).child(detail)));
      }
      if (r.kind === "new" || r.kind === "space") {
        const label = r.kind === "new" ? "new tab" : r.machine ? `new space on ${r.machine}` : "new space";
        return h_flex()
          .id(r.kind === "new" ? "pk-new" : `pk-space-${r.machine ?? "here"}`)
          .mx(4)
          .when(r.kind === "new", (el) => el.mt(4))
          .px(10)
          .h(32)
          .items_center()
          .rounded(7)
          .gap(8)
          .text_color(t.muted)
          .cursor_pointer()
          .on_mouse_move(point(r))
          .on_click((_e, cx) => this.go(r, cx))
          .child(div().w(12).child("+"))
          .child(label);
      }
      const who = r.mine.map((a) => a.program?.name ?? "agent").join(" · ");
      const here = r.w.active && r.ctx.active;
      return h_flex()
        .id(`pk-${r.ctx.id}`)
        .mx(4)
        .px(10)
.h(32)
        .rounded(7)
        .gap(10)
        .items_center()
        .cursor_pointer()
        .on_mouse_move(point(r))
        .on_click((_e, cx) => this.go(r, cx))
        .child(this.glyph(t, r.ctx.status))
        .child(div().flex_1().truncate().text_color(t.foreground).when(here, (d) => d.font_semibold()).child(r.ctx.name))
        .when(r.ctx.status === "blocked", (el) => el.child(div().text_size(11).text_color(t.blocked).child("needs you")))
        .when(r.ctx.status === "done", (el) => el.child(div().text_size(11).text_color(t.done).child("finished")))
        .child(div().text_size(11).text_color(t.dim).child(who + (r.team ? `  +${r.team}` : "")));
    };

    return v_flex()
      .id("picker")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.close();
        if (k === "down") this.at = (this.at + 1) % pickable.length;
        else if (k === "up") this.at = (this.at + pickable.length - 1) % pickable.length;
        else if (k === "d" && e.modifiers.control) {
          if (sel?.kind === "ctx") {
            this.close();
            run("tab.close", { id: sel.ctx.id });
          }
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Go to…")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(
        v_flex()
          .id("pk-list")
          .on_size_change((size, cx) => {
            this.listHeight = size.height / settings().zoom;
            cx.notify();
          })
          .h(Math.min(320, total))
          .min_h(0)
          .mb(6)
          .when(fixed, (el) =>
            el.overflow_hidden().on_scroll_wheel((e, cx) => {
              this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, maxScroll));
              // The selection follows the wheel, so the next frame doesn't scroll back to it.
              while (this.at < pickable.length - 1 && tops[rows.indexOf(pickable[this.at])] < this.scroll) this.at++;
              while (this.at > 0 && tops[rows.indexOf(pickable[this.at])] + (H[pickable[this.at].kind] ?? 32) > this.scroll + height) this.at--;
              cx.notify();
            }))
          .children([highlight, ...rows.map((r, i) => (visible(i) ? place(row(r), i) : null))].filter(Boolean)),
      );
  }
}
