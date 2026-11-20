// workspace-status-tmux: Herdr's `workspace-status` (base/workspace-status.js; herdr-tmux-update merges
// Herdr's later changes in). The branch is the one of the tmux pane the focused tmux client shows
// (shared "tmux.where" from tmux-context), not of the folder that client started in. The MCP chip
// counts the MCP servers of that pane's omo session (shared "omo.mcp" from mcp-tmux) and opens them;
// the omo chip counts the panes running omo in tmux (shared "omo.tmux" from omo-tmux) and opens those;
// the jobs chip counts their background jobs (shared "omo.jobs" from jobs-tmux) and opens them; the
// queue chip counts what needs you (shared "omo.queue" from priority-queue) and shows or hides its column.
// The reviews chip counts PRs in view (shared "pr.reviews") and opens their review panel.
// Each item is | key | number |, side by side across the bar with a slim black line after each, in bold: the key (icon and label) on the item's
// own colour (TINT) in white, the number on a uniform deep grey in white mono, with a line under the number in the
// state colour while the item has a status. Agents, PRDs and reviews draw Nerd Font glyphs (a robot,
// a checklist and a pull request), since Herdr loads only its shipped icons through the dotfiles link.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, focused, shared, terminals, layout, fonts, settings } from "herdr";

// Deep neon, dark enough for white text, ordered so that neighbours differ in hue: the keys that can touch (machine,
// branch, MCP) and each status colour (yellow, cyan, pink, green) against the key after it.
const TINT = {
  machine: "#0060f0", branch: "#e05500", mcp: "#00a35a", agents: "#8a00e6", omo: "#e6005c",
  jobs: "#008fa3", prds: "#b38f00", reviews: "#4433ff", queue: "#c000c0",
};
const CHECKLIST = "\u{F45E}", PULL_REQUEST = "\u{F407}", ROBOT = "\u{F06A9}";
const WHITE = "#ffffff", BLACK = "#000000", GREY = "#2f323c";

// As files-tmux/file-icons.js: a full-size Nerd Fonts 3 family, or "" when none is installed.
const PREFERRED = ["Symbols Nerd Font", "JetBrainsMono Nerd Font", "FiraCode Nerd Font", "Hack Nerd Font", "MesloLGM Nerd Font"];
let nerd = null;
function nerdFont() {
  if (nerd === null) {
    const have = fonts().filter((f) => /Nerd Font/.test(f));
    nerd = PREFERRED.find((f) => have.includes(f)) ?? have.find((f) => !/Caskaydia|Mono|Propo/.test(f)) ?? "";
  }
  return nerd;
}

function glyph(char, fallback) {
  const font = nerdFont();
  if (!font) return svg(`mods/workspace-chrome/${fallback}.svg`).size(13);
  return div().w(15).flex_none().flex().items_center().justify_center().font_family(font).text_size(13).child(char);
}

const icon = (name) => svg(`mods/workspace-chrome/${name}.svg`).size(13);

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
  // binding the hint stays useful ("Commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  Commands` : "Commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const mono = settings().font_family ?? "JetBrains Mono";
    const seg = () => h_flex().h_full().flex_none().items_center();
    // The number always has a 4 px bottom border, in its own grey unless the item has a status, so numbers stay one
    // height, and as much padding above it, so the number stays centred.
    const item = (id, color, mark, text, { n = null, status = null, tip = null, click = null } = {}) => h_flex().id(id).h_full().flex_none().font_weight(700).border_r(1).border_color(BLACK)
      .child(seg().id(`${id}-key`).px(10).gap(6).bg(color).text_color(WHITE).child(mark).child(text)
        .when(Boolean(click), (el) => el.hover((s) => s.bg(`${color}cc`))))
      .when(n !== null, (el) => el.child(seg().px(8).pt(4).bg(GREY).text_color(WHITE).border_b(4).border_color(status ?? GREY)
        .font_family(mono).text_size(13).child(String(n))))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .when(Boolean(click), (el) => el.cursor_pointer().on_click(click));
    const f = focused(), where = shared("tmux.where");
    // A mod pane (a preview beside a tmux client), or the Files panel's nvim, keeps the branch its tab's client showed.
    const editor = f?.terminal === "files-nvim" || (Boolean(f?.terminal) && terminals().some((x) => x.address === f.terminal && x.name === "files-nvim"));
    const mine = f?.terminal && !editor ? where?.terminal === f.terminal : Boolean(f?.tab) && where?.tab === f.tab;
    const branch = mine && where.tmux ? where.branch : space?.branch;
    const mcp = mine && where.tmux && shared("omo.mcp")?.terminal === where.terminal ? shared("omo.mcp") : null;
    const omo = shared("omo.tmux");
    const jobs = shared("omo.jobs");
    const prds = shared("studio.prds");
    const prdCount = prds?.data?.prds?.length ?? 0;
    const reviews = shared("pr.reviews");
    const reviewRepos = reviews?.data?.repos ?? [];
    const reviewPrs = reviewRepos.flatMap((r) => r.prs);
    const reviewCount = reviewPrs.filter((p) => !p.state || p.state === "open").length;
    const reviewRunning = reviewPrs.some((p) => p.review?.state === "running");
    const reviewProblem = reviews?.problem || reviewRepos.some((r) => r.problem && !r.idle) || reviewPrs.some((p) => p.review?.state === "failed" || p.review?.error);
    const queue = shared("omo.queue")?.items;
    const asks = queue?.filter((i) => i.kind === "input" || i.kind === "error" || i.kind === "blocked").length ?? 0;
    const toggle = (id) => {
      const root = layout(), panel = find(root, "panel");
      if (panel && !panel.hidden && find(root, "panel-body")?.active === id) run("layout.hide", { id: "panel" });
      else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
    };
    return h_flex().size_full().pr(14).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(item("machine-chip", TINT.machine, icon(space?.machine ? "server" : "monitor"), space?.machine ?? "This Computer"))
      .when(Boolean(branch), el => el.child(item("branch-chip", TINT.branch, icon("branch"), branch)))
      .when(Boolean(mcp), el => el.child(item("mcp-chip", TINT.mcp, icon("layers"), "MCP", {
        n: mcp.enabled,
        status: mcp.attention > 0 || mcp.configChanged ? t.blocked : null,
        tip: `MCP servers of the omo session in ${mcp.target}${mcp.attention ? `: ${mcp.attention} need${mcp.attention === 1 ? "s" : ""} you` : ""}`,
        click: () => toggle("mcp"),
      })))
      .child(item("agents-chip", TINT.agents, glyph(ROBOT, "square"), "Agents", {
        n: list.length,
        status: needs > 0 ? t.blocked : null,
        tip: `${list.length} agent${list.length === 1 ? "" : "s"}${needs ? `, ${needs} need${needs === 1 ? "s" : ""} you` : ""}`,
      }))
      .when(Boolean(omo), el => el.child(item("omo-chip", TINT.omo, icon("terminal"), "omo", {
        n: omo.panes,
        status: omo.needs > 0 ? t.blocked : null,
        tip: `omo in tmux: ${omo.panes} pane${omo.panes === 1 ? "" : "s"}${omo.needs ? `, ${omo.needs} need${omo.needs === 1 ? "s" : ""} you` : ""}${omo.working ? `, ${omo.working} working` : ""}`,
        click: () => toggle("omo"),
      })))
      .when(Boolean(jobs), el => el.child(item("jobs-chip", TINT.jobs, icon("clock"), "Jobs", {
        n: jobs.count,
        status: jobs.count > 0 ? t.working : null,
        tip: `Background jobs of omo in tmux: ${jobs.count}${jobs.here ? `, ${jobs.here} in this session` : ""}`,
        click: () => toggle("jobs"),
      })))
      .when(Boolean(prds), el => el.child(item("prds-chip", TINT.prds, glyph(CHECKLIST, "file-text"), "PRDs", {
        n: prdCount,
        status: prds.problem ? t.blocked : null,
        tip: prds.problem ? `Studio PRDs of omo in tmux: ${prds.problem}` : `Studio PRDs that omo panes in tmux are working on: ${prdCount}`,
        click: () => toggle("prds"),
      })))
      .when(Boolean(reviews), el => el.child(item("reviews-chip", TINT.reviews, glyph(PULL_REQUEST, "git-compare"), "Reviews", {
        n: reviewCount,
        status: reviewProblem ? t.blocked : reviewRunning ? t.working : null,
        tip: reviews.problem || `${reviewCount} open PRs in view${reviewRunning ? ", review running" : ""}${reviewProblem ? ", review problem" : ""}`,
        click: () => toggle("reviews"),
      })))
      .when(Boolean(queue), el => el.child(item("queue-chip", TINT.queue, icon("circle-check"), "Queue", {
        n: queue.length,
        status: queue.length > 0 ? (asks ? t.accent : t.done) : null,
        tip: `Priority queue: ${queue.length ? `${queue.length} card${queue.length === 1 ? "" : "s"}${asks ? `, ${asks} need${asks === 1 ? "s" : ""} you` : ""}` : "nothing needs you"} (⌘⇧J)`,
        click: () => run("layout.toggle", { id: "queue" }),
      })))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
