// workspace-status-tmux: Herdr's `workspace-status` (base/workspace-status.js; herdr-tmux-update merges
// Herdr's later changes in). The branch is the one of the tmux pane the focused tmux client shows
// (shared "tmux.where" from tmux-context), not of the folder that client started in. The MCP chip
// counts the MCP servers of that pane's omo session (shared "omo.mcp" from mcp-tmux) and opens them;
// the omo chip counts the panes running omo in tmux (shared "omo.tmux" from omo-tmux) and opens those;
// the jobs chip counts their background jobs (shared "omo.jobs" from jobs-tmux) and opens them.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, focused, shared, terminals, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class WorkspaceStatus extends View {
  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const f = focused(), where = shared("tmux.where");
    // A mod pane (a preview beside a tmux client), or the Files panel's nvim, keeps the branch its tab's client showed.
    const editor = f?.terminal === "files-nvim" || (Boolean(f?.terminal) && terminals().some((x) => x.address === f.terminal && x.name === "files-nvim"));
    const mine = f?.terminal && !editor ? where?.terminal === f.terminal : Boolean(f?.tab) && where?.tab === f.tab;
    const branch = mine && where.tmux ? where.branch : space?.branch;
    const mcp = mine && where.tmux && shared("omo.mcp")?.terminal === where.terminal ? shared("omo.mcp") : null;
    const omo = shared("omo.tmux");
    const jobs = shared("omo.jobs");
    const toggle = (id) => {
      const root = layout(), panel = find(root, "panel");
      if (panel && !panel.hidden && find(root, "panel-body")?.active === id) run("layout.hide", { id: "panel" });
      else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
    };
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(branch), el => el.child(label("branch", branch)))
      .when(Boolean(mcp), el => el.child(h_flex().id("mcp-chip").gap(6).items_center().cursor_pointer().hover(s => s.text_color(t.foreground))
        .tooltip(`MCP servers of the omo session in ${mcp.target}${mcp.attention ? `: ${mcp.attention} need${mcp.attention === 1 ? "s" : ""} you` : ""}`)
        .on_click(() => toggle("mcp"))
        .child(svg("mods/workspace-chrome/layers.svg").size(13)).child(`MCP ${mcp.enabled}`)
        .when(mcp.attention > 0 || mcp.configChanged, e => e.child(div().size(6).rounded(3).bg(t.blocked)))))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .when(Boolean(omo), el => el.child(h_flex().id("omo-chip").gap(6).items_center().cursor_pointer().hover(s => s.text_color(t.foreground))
        .tooltip(`omo in tmux: ${omo.panes} pane${omo.panes === 1 ? "" : "s"}${omo.needs ? `, ${omo.needs} need${omo.needs === 1 ? "s" : ""} you` : ""}${omo.working ? `, ${omo.working} working` : ""}`)
        .on_click(() => toggle("omo"))
        .child(svg("mods/workspace-chrome/terminal.svg").size(13)).child(`omo ${omo.panes}`)
        .when(omo.needs > 0, e => e.child(div().size(6).rounded(3).bg(t.blocked)))))
      .when(Boolean(jobs), el => el.child(h_flex().id("jobs-chip").gap(6).items_center().cursor_pointer().hover(s => s.text_color(t.foreground))
        .tooltip(`Background jobs of omo in tmux: ${jobs.count}${jobs.here ? `, ${jobs.here} in this session` : ""}`)
        .on_click(() => toggle("jobs"))
        .child(svg("mods/workspace-chrome/clock.svg").size(13)).child(`jobs ${jobs.count}`)
        .when(jobs.count > 0, e => e.child(div().size(6).rounded(3).bg(t.working)))))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
