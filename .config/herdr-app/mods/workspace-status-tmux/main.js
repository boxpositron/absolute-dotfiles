// workspace-status-tmux: Herdr's `workspace-status` (base/workspace-status.js; herdr-tmux-update merges
// Herdr's later changes in). The branch is the one of the tmux pane the focused tmux client shows
// (shared "tmux.where" from tmux-context), not of the folder that client started in. The MCP chip
// counts the MCP servers of that pane's omo session (shared "omo.mcp" from mcp-tmux) and opens them;
// the omo chip counts the panes running omo in tmux (shared "omo.tmux" from omo-tmux) and opens those;
// the jobs chip counts their background jobs (shared "omo.jobs" from jobs-tmux) and opens them; the
// queue chip counts what needs you (shared "omo.queue" from priority-queue) and shows or hides its column.
// The reviews chip counts PRs in view (shared "pr.reviews") and opens their review panel.
//
// Two looks, chosen by the layout block's props. Without props (ash): each item is | key | number |, side by side
// with a slim black line after each, in bold: the key (icon and label) in black on cream, the number on a uniform
// deep grey in white mono, with a line under the number in the state colour while the item has a status.
// With {style: "cyberpunk"} (netrunner), a Cyberpunk 2077 HUD on a near-black plate under a thin pink line: the
// machine as a yellow tag with a slanted edge, the branch in cyan, then each item as a pink condensed label and its
// number in a cyan readout frame with two corners cut, slashes between them. A status fills the frame in the state
// colour, pulsing while something needs you, and Agents adds a gauge of one slanted tick per agent in its state's
// colour. The palette hint is a key prompt. Agents, PRDs and reviews draw Nerd Font glyphs (a robot, a checklist
// and a pull request), since Herdr loads only its shipped icons through the dotfiles link.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window as appWindow, keys, focused, shared, terminals, layout, fonts, settings } from "herdr";
import { INK, PLATE, isHud, fill, outline, cut, caps, slash, readout } from "./hud.js";

const CHECKLIST = "\u{F45E}", PULL_REQUEST = "\u{F407}", ROBOT = "\u{F06A9}";
const WHITE = "#ffffff", BLACK = "#000000", GREY = "#2f323c", CREAM = "#f4ecd8", CREAM_HOVER = "#e3d8bd";
// Agents in the gauge, most urgent first; more than MAX_TICKS show as a count only.
const GAUGE = ["blocked", "working", "done", "idle"], MAX_TICKS = 24;

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
  paletteKey() {
    const mac = appWindow()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    return parts ? parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("") : null;
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
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
    // `pulse`: the status means something needs you.
    const items = [
      mcp && { id: "mcp", mark: icon("layers"), label: "MCP", n: mcp.enabled,
        status: mcp.attention > 0 || mcp.configChanged ? t.blocked : null,
        tip: `MCP servers of the omo session in ${mcp.target}${mcp.attention ? `: ${mcp.attention} need${mcp.attention === 1 ? "s" : ""} you` : ""}`,
        click: () => toggle("mcp") },
      { id: "agents", mark: glyph(ROBOT, "square"), label: "Agents", n: list.length,
        status: needs > 0 ? t.blocked : null, pulse: needs > 0,
        tip: `${list.length} agent${list.length === 1 ? "" : "s"}${needs ? `, ${needs} need${needs === 1 ? "s" : ""} you` : ""}` },
      omo && { id: "omo", mark: icon("terminal"), label: "omo", n: omo.panes,
        status: omo.needs > 0 ? t.blocked : null, pulse: omo.needs > 0,
        tip: `omo in tmux: ${omo.panes} pane${omo.panes === 1 ? "" : "s"}${omo.needs ? `, ${omo.needs} need${omo.needs === 1 ? "s" : ""} you` : ""}${omo.working ? `, ${omo.working} working` : ""}`,
        click: () => toggle("omo") },
      jobs && { id: "jobs", mark: icon("clock"), label: "Jobs", n: jobs.count,
        status: jobs.count > 0 ? t.working : null,
        tip: `Background jobs of omo in tmux: ${jobs.count}${jobs.here ? `, ${jobs.here} in this session` : ""}`,
        click: () => toggle("jobs") },
      prds && { id: "prds", mark: glyph(CHECKLIST, "file-text"), label: "PRDs", n: prdCount,
        status: prds.problem ? t.blocked : null,
        tip: prds.problem ? `Studio PRDs of omo in tmux: ${prds.problem}` : `Studio PRDs that omo panes in tmux are working on: ${prdCount}`,
        click: () => toggle("prds") },
      reviews && { id: "reviews", mark: glyph(PULL_REQUEST, "git-compare"), label: "Reviews", n: reviewCount,
        status: reviewProblem ? t.blocked : reviewRunning ? t.working : null,
        tip: reviews.problem || `${reviewCount} open PRs in view${reviewRunning ? ", review running" : ""}${reviewProblem ? ", review problem" : ""}`,
        click: () => toggle("reviews") },
      queue && { id: "queue", mark: icon("circle-check"), label: "Queue", n: queue.length,
        status: queue.length > 0 ? (asks ? t.accent : t.done) : null, pulse: asks > 0,
        tip: `Priority queue: ${queue.length ? `${queue.length} card${queue.length === 1 ? "" : "s"}${asks ? `, ${asks} need${asks === 1 ? "s" : ""} you` : ""}` : "nothing needs you"} (⌘⇧J)`,
        click: () => run("layout.toggle", { id: "queue" }) },
    ].filter(Boolean);
    const machine = { mark: icon(space?.machine ? "server" : "monitor"), label: space?.machine ?? "This Computer" };
    const mono = settings().font_family ?? "JetBrains Mono";
    return isHud()
      ? this.hud(t, machine, branch, items, list, mono)
      : this.blocks(t, machine, branch, items, mono);
  }

  blocks(t, machine, branch, items, mono) {
    const seg = () => h_flex().h_full().flex_none().items_center();
    // The number always has a 4 px bottom border, in its own grey unless the item has a status, so numbers stay one
    // height, and as much padding above it, so the number stays centred.
    const item = (id, mark, text, { n = null, status = null, tip = null, click = null } = {}) => h_flex().id(id).h_full().flex_none().font_weight(700).border_r(1).border_color(BLACK)
      .child(seg().id(`${id}-key`).px(10).gap(6).bg(CREAM).text_color(BLACK).child(mark).child(text)
        .when(Boolean(click), (el) => el.hover((s) => s.bg(CREAM_HOVER))))
      .when(n !== null, (el) => el.child(seg().px(8).pt(4).bg(GREY).text_color(WHITE).border_b(4).border_color(status ?? GREY)
        .font_family(mono).text_size(13).child(String(n))))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .when(Boolean(click), (el) => el.cursor_pointer().on_click(click));
    const key = this.paletteKey();
    return h_flex().size_full().pr(14).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(item("machine-chip", machine.mark, machine.label))
      .when(Boolean(branch), el => el.child(item("branch-chip", icon("branch"), branch)))
      .children(items.map((c) => item(`${c.id}-chip`, c.mark, c.label, c)))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(key ? `${key}  Commands` : "Commands"));
  }

  hud(t, machine, branch, items, list, mono) {
    const gauge = () => {
      const rank = (a) => { const i = GAUGE.indexOf(a.status); return i < 0 ? GAUGE.length - 1 : i; };
      const ticks = [...list].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_TICKS);
      const W = 3, SLANT = 3, GAP = 2, H = 12;
      const tone = { blocked: t.blocked, working: t.working, done: t.done, idle: t.idle + "99" };
      const groups = GAUGE.map((s) => ticks.map((a, i) => [rank(a), i]).filter(([r]) => GAUGE[r] === s)
        .map(([, i]) => { const x = i * (W + GAP); return [[x + SLANT, 0], [x + SLANT + W, 0], [x + W, H], [x, H]]; }));
      return div().relative().w(ticks.length * (W + GAP) + SLANT).h(H).flex_none()
        .children(GAUGE.map((s, i) => groups[i].length ? fill(groups[i], tone[s]).when(s === "blocked", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1400 })) : null).filter(Boolean));
    };
    const item = (c) => h_flex().id(`${c.id}-chip`).h_full().flex_none().items_center().gap(7).px(8)
      .child(h_flex().items_center().gap(6).text_color(c.status && c.pulse ? c.status : t.accent).child(c.mark).child(caps(c.label, 14)))
      .child(readout(t, c.n, { status: c.status, pulse: Boolean(c.pulse) }))
      .when(c.id === "agents" && list.length > 0, (el) => el.child(gauge()))
      .when(Boolean(c.tip), (el) => el.tooltip(c.tip))
      .when(Boolean(c.click), (el) => el.cursor_pointer().on_click(c.click).hover((s) => s.bg(t.accent + "1f")));
    const key = this.paletteKey();
    const capWidth = key ? 18 + [...key].length * 10 : 0;
    const keycap = key && div().relative().w(capWidth).h(18).flex_none().flex().items_center().justify_center()
      .child(outline(cut(capWidth, 18, 5, 0.5), t.muted))
      .child(div().relative().font_family(mono).font_weight(700).text_size(11.5).text_color(t.foreground).child(key));
    return h_flex().relative().size_full().items_center().bg(PLATE).text_size(12)
      .child(div().absolute().top(0).left(0).right(0).h(1).bg(t.accent + "73"))
      .child(h_flex().id("machine-chip").h_full().flex_none()
        .child(h_flex().h_full().pl(12).pr(4).gap(7).items_center().bg(t.blocked).text_color(INK).child(machine.mark).child(caps(machine.label, 15, 700)))
        .child(div().relative().w(14).h_full().flex_none().child(fill([[["0%", "0%"], ["100%", "0%"], ["0%", "100%"]]], t.blocked))))
      .when(Boolean(branch), (el) => el.child(h_flex().id("branch-chip").h_full().flex_none().items_center().gap(6).pl(6).pr(8).text_color(t.working)
        .child(icon("branch")).child(div().font_family(mono).text_size(12).child(branch))))
      .children(items.flatMap((c) => [slash(t.accent + "8c"), item(c)]))
      .child(div().flex_1())
      .child(h_flex().id("palette").h_full().flex_none().items_center().gap(8).pr(12).cursor_pointer().on_click(() => run("app.palette"))
        .when(Boolean(keycap), (el) => el.child(keycap))
        .child(caps("Commands", 13.5).text_color(t.muted)))
      .child(div().relative().w(14).h_full().flex_none().child(fill([[["100%", "0%"], ["100%", "100%"], ["0%", "100%"]]], t.blocked)));
  }
}
