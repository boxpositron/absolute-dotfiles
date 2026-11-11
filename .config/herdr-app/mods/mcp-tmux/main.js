// mcp-tmux: the MCP servers of the omo session in the tmux pane the focused client shows (else the
// first omo pane of that tmux session), from `omo-status mcp`: what omo's config gives that
// session, where each server comes from, its sign-in, how many tools it listed last, its latest
// logged problem, and the session's own latest call to it (from its transcript). omo keeps live
// connection state inside its process, so a server the session hasn't called since its config was
// read shows only what the config says.
// Herdr starts a block only once it shows, and the side panel is often closed, so a hidden copy beside
// the status bar (props {headless: true}) does the reading: it publishes shared "omo.mcp.data" for
// this panel and a summary in "omo.mcp" for workspace-status-tmux's MCP chip. The panel only draws.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { exec, home, shared, setShared, theme, nextCommand, props } from "herdr";

function target() {
  const w = shared("tmux.where");
  return w?.tmux && w.pane ? { pane: w.pane, on: w.on ?? null, terminal: w.terminal } : null;
}
const keyOf = (t) => (t ? `${t.on ?? ""}|${t.pane}` : null);

function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

const tilde = (path) => (path && path.startsWith(home()) ? `~${path.slice(home().length)}` : path ?? "");
const failed = (s) => s.lastCall && !s.lastCall.ok;
const needsYou = (s) => s.enabled && (s.auth === "needs sign-in" || s.auth === "expired" || s.issue || failed(s));

export default class Mcp extends View {
  init(_props, cx) {
    this.data = null; this.key = null; this.error = null; this.loading = false;
    this.headless = Boolean(props()?.headless);
    if (!this.headless) {
      // Herdr's tabs mod brings a space's panel back on return only for the panels listed here, which
      // its welcome sets to Files and Changes; listed, the MCP panel comes back too (tabs draws no button).
      const panels = shared("workspace.panels") ?? ["files", "changes"];
      if (!panels.includes("mcp")) setShared("workspace.panels", [...panels, "mcp"]);
      return;
    }
    this.refresh(cx);
    cx.timer.every(30000, (cx) => this.refresh(cx, true));
    cx.spawn(async (cx) => {
      for (;;) if ((await nextCommand()) === "refresh") this.refresh(cx, true);
    });
  }

  refresh(cx, force) {
    const t = target(), key = keyOf(t);
    if (!this.headless || this.loading || (!force && key === this.key)) return;
    this.key = key;
    if (!t) { this.data = null; this.error = null; this.share(key); this.publish(null); return; }
    this.loading = true;
    this.share(key);
    cx.spawn(async (cx) => {
      try {
        const r = await exec(`${home()}/.local/bin/omo-status`, ["mcp", t.pane, ...(t.on ? [t.on] : [])], { timeout: 20000 });
        if (keyOf(target()) !== key) return;
        this.error = r.code === 0 ? null : r.stderr.trim() || `omo-status exited with ${r.code}`;
        this.data = r.code === 0 && r.stdout.trim() ? JSON.parse(r.stdout) : null;
        this.publish(t);
      } catch (e) {
        if (keyOf(target()) === key) this.error = String(e?.message ?? e);
      } finally {
        // No refresh from here: Herdr drops a task started by one that is ending. render() starts
        // the next load if the focus moved meanwhile.
        this.loading = false;
        this.share(key);
        cx.notify();
      }
    });
  }

  share(key) {
    const next = { key, data: this.data, error: this.error, loading: this.loading };
    if (JSON.stringify(shared("omo.mcp.data") ?? null) !== JSON.stringify(next)) setShared("omo.mcp.data", next);
  }

  publish(t) {
    const d = this.data;
    const summary = t && d ? {
      terminal: t.terminal, pane: d.pane, target: d.target,
      total: d.servers.length, enabled: d.servers.filter((s) => s.enabled).length,
      attention: d.servers.filter(needsYou).length + d.blocked.length, configChanged: d.configChanged,
    } : null;
    if (JSON.stringify(shared("omo.mcp") ?? null) !== JSON.stringify(summary)) setShared("omo.mcp", summary);
  }

  badge(t, text, color) {
    return div().px(5).py(1).flex_none().rounded(4).border_1().border_color(t.border).text_size(10).text_color(color ?? t.muted).child(text);
  }

  note(t, text, color) {
    return div().flex_none().px(12).py(5).bg(t.raised).border_b(1).border_color(t.border).text_size(11.5).text_color(color).child(text);
  }

  row(t, s) {
    const dot = !s.enabled ? t.dim : s.auth === "expired" || failed(s) ? t.ansi1 : needsYou(s) ? t.blocked : t.ansi2;
    const call = s.lastCall;
    const auth = s.auth === "none" ? null : s.auth;
    return v_flex().id(`mcp-${s.name}`).flex_none().px(8).py(6).gap(2).rounded(7).hover((st) => st.bg(t.hover))
      .child(h_flex().gap(8).items_center()
        .child(div().size(7).flex_none().rounded(4).bg(dot))
        .child(div().min_w(0).truncate().font_medium().text_color(s.enabled ? t.foreground : t.dim).child(s.name))
        .child(this.badge(t, s.source))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11).text_color(t.dim).child(!s.enabled ? "off" : s.tools === null ? "no tool list yet" : `${s.tools} tool${s.tools === 1 ? "" : "s"}`)))
      .child(h_flex().pl(15).gap(6).text_size(11).text_color(t.dim)
        .child(div().flex_none().child(s.kind))
        .child(div().min_w(0).flex_1().truncate().child(s.where))
        .when(Boolean(auth), (el) => el.child(div().flex_none().text_color(auth === "signed in" ? t.ansi2 : auth === "expired" ? t.ansi1 : t.blocked).child(auth))))
      .when(Boolean(call), (el) => el.child(div().pl(15).text_size(11).text_color(call.ok ? t.dim : t.ansi1).when(call.ok, (e) => e.truncate())
        .child(`Last call ${ago(call.at)} (${call.tool}) ${call.ok ? "worked" : `failed: ${call.error}`}`)))
      .when(Boolean(s.issue), (el) => el.child(div().pl(15).text_size(11).text_color(t.blocked).truncate().child(`${ago(s.issue.at)}: ${s.issue.message}`)));
  }

  empty() {
    if (this.error) return this.error;
    if (this.loading && !this.data) return "Reading omo's MCP config…";
    if (!target()) return "Focus a tmux client to see the MCP servers of its omo session.";
    return "No omo runs in this tmux session.";
  }

  render(cx) {
    if (this.headless) {
      const ask = shared("omo.mcp.refresh") ?? null;
      if (ask !== this.asked) { this.asked = ask; this.refresh(cx, true); }
      else if (!this.loading && keyOf(target()) !== this.key) this.refresh(cx);
      return div();
    }
    const s = shared("omo.mcp.data"), key = keyOf(target()), mine = s?.key === key;
    this.data = mine ? s.data : null;
    this.error = mine ? s.error : null;
    this.loading = !mine || Boolean(s?.loading);
    const t = theme(), d = this.data, servers = d?.servers ?? [];
    const on = servers.filter((s) => s.enabled).length, attention = servers.filter(needsYou).length;
    const trustNote = d && (d.trust === "no" || d.trust === "ask")
      ? `This project isn't trusted${d.trust === "ask" ? " yet" : ""}, so its .omo/mcp.json is skipped${d.blocked.length ? `: ${d.blocked.join(", ")}` : ""}.` : null;
    return v_flex().id("mcp").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("MCP"))
        .when(Boolean(d), (el) => el.child(this.badge(t, `${on} of ${servers.length} on`)))
        .when(attention > 0, (el) => el.child(this.badge(t, `${attention} need${attention === 1 ? "s" : ""} you`, t.blocked)))
        .child(div().flex_1())
        .child(div().id("mcp-refresh").size(24).flex().items_center().justify_center().rounded(6).cursor_pointer().text_size(14).text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Read again").on_click(() => setShared("omo.mcp.refresh", Date.now()))
          .child(this.loading ? "…" : "\u21bb")))
      .when(Boolean(d), (el) => el.child(v_flex().flex_none().px(12).py(7).gap(2).border_b(1).border_color(t.border).text_size(11.5)
        .child(h_flex().gap(6).min_w(0).child(div().flex_none().text_color(t.muted).child(`omo in ${d.target || d.pane}`)).child(div().min_w(0).truncate().text_color(t.dim).child(tilde(d.cwd))))
        .child(div().text_color(t.dim).child(`Config read ${ago(d.loadedAt)}${d.loadedAt ? "" : "?"}, at its start or last /reload`))))
      .when(Boolean(d?.configChanged), (el) => el.child(this.note(t, "An mcp.json changed after this session read it: /reload in omo to pick it up.", t.blocked)))
      .when(Boolean(trustNote), (el) => el.child(this.note(t, trustNote, t.blocked)))
      .when(Boolean(d?.notImported?.length), (el) => el.child(this.note(t, `.mcp.json isn't imported (no "claude" in importConfigs): ${d.notImported.join(", ")}`, t.dim)))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("mcp-list").absolute().inset_0().overflow_y_scroll().p(6).gap(2)
          .children(servers.map((s) => this.row(t, s)))
          .when(!servers.length, (el) => el.child(div().p(8).text_color(t.dim).child(this.empty()))))
        .child(Scrollbar.vertical("mcp-list").absolute().inset_0()))
      .child(div().flex_none().px(12).py(6).border_t(1).border_color(t.border).text_size(10.5).text_color(t.dim)
        .child("From omo's config, sign-ins and tool cache, and this session's latest call to each server. omo keeps live connections to itself."));
  }
}
