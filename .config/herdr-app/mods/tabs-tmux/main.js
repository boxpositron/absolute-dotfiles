import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, agents, run, openOverlay, theme, window, shared, layout, settings, fonts } from "herdr";
import { INK, PLATE, isHud, spinner, display, frame, fill, caps, readout, button as hudButton } from "./hud.js";

// The Alfred and Agents chips at the right end draw Nerd Font glyphs (a tie for Alfred, the butler, and a robot), as
// workspace-status-tmux does, since Herdr loads only its shipped icons through the dotfiles link.
const TIE = "\u{F0CE3}", ROBOT = "\u{F06A9}";
const PREFERRED = ["Symbols Nerd Font", "JetBrainsMono Nerd Font", "FiraCode Nerd Font", "Hack Nerd Font", "MesloLGM Nerd Font"];
let nerd = null;
function glyph(char) {
  if (nerd === null) {
    const have = fonts().filter((f) => /Nerd Font/.test(f));
    nerd = PREFERRED.find((f) => have.includes(f)) ?? have.find((f) => !/Caskaydia|Mono|Propo/.test(f)) ?? "";
  }
  if (!nerd) return svg("icons/agent.svg").size(13).flex_none();
  return div().w(15).flex_none().flex().items_center().justify_center().font_family(nerd).text_size(13).child(char);
}
// Agents in the gauge, most urgent first; more than MAX_TICKS show as a count only.
const GAUGE = ["blocked", "working", "done", "idle"], MAX_TICKS = 24;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Same as the agents mod: drops a status glyph, keeps a leading bracket or quote.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// A tab Herdr named (unnamed, or after its program) follows its agent's live
// title, as the agents list does; a name the person gave stays.
function label(tab, lead) {
  const prog = lead?.program?.name;
  const base = tab.named ? tab.name : prog ?? "Terminal";
  if (!lead?.program?.agent) return base;
  const live = clean(lead.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((lead.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== lead.terminal && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== lead.program.key;
  return (tab.name === prog || !tab.named) && telling ? live : base;
}

export default class Tabs extends View {
  init() {
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    this.swipe = { acc: 0, steps: 0, at: 0, last: 0 };
  }

  // One tab per wheel notch. A touchpad or smooth-scrolling mouse sends many
  // small events per gesture: a short swipe or one smoothed notch (about
  // 25 px) switches one tab, a longer swipe keeps going a tab per 60 px, at
  // most one every 100 ms so each shows.
  wheel(e) {
    if (e.delta_lines) {
      if (e.delta_lines.y) run(e.delta_lines.y > 0 ? "tab.prev" : "tab.next");
      return;
    }
    const s = this.swipe, now = Date.now();
    // Phases often arrive only as moves (a macOS touchpad included): a pause
    // or a turn starts a new gesture.
    if (e.touch_phase === "started" || now - s.at > 250 || e.delta.y * s.acc < 0) Object.assign(s, { acc: 0, steps: 0 });
    s.at = now;
    s.acc += e.delta.y;
    const need = s.steps ? 60 : 20;
    if (Math.abs(s.acc) < need || now - s.last < 100) return;
    s.acc -= Math.sign(s.acc) * need;
    s.steps++;
    s.last = now;
    run(e.delta.y > 0 ? "tab.prev" : "tab.next");
  }

  // Alfred's tab in the right column (mods/alfred): the messages from Alfred not seen yet, pink and pulsing while one
  // has buttons waiting on you, cyan while Alfred works, red when the board can't be read.
  alfred(t, hud, panel, body, stop) {
    const s = shared("alfred.chat");
    const on = panel && !panel.hidden && body?.active === "alfred";
    const status = s?.problem ? t.ansi1 : s?.waiting ? t.blocked : s?.typing ? t.working : null;
    const tip = s?.problem ? `Alfred: ${s.problem}`
      : `Alfred on Telegram: ${s?.unread ? `${s.unread} new` : "nothing new"}${s?.waiting ? `, ${s.waiting} waiting on you` : ""}${s?.typing ? ", working" : ""}`;
    const toggle = () => {
      if (on) run("layout.hide", { id: "panel" });
      else { run("layout.select", { stack: "panel-body", child: "alfred" }); run("layout.show", { id: "panel" }); }
    };
    const n = s?.unread ?? 0;
    // On, the button is yellow: the count goes in its dark ink rather than a cyan frame.
    if (hud) return hudButton(t, "panel-alfred", "Alfred", { on, icon: glyph(TIE).relative(), h: 24 })
      .child(on ? div().relative().font_family(settings().font_family ?? "JetBrains Mono").font_weight(700).text_size(12.5).child(String(n))
        : readout(t, n, { status, pulse: Boolean(s?.waiting), h: 16 }).relative())
      .tooltip(tip).on_mouse_down("left", stop).on_click(toggle);
    return h_flex().id("panel-alfred").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
      .hover(st => st.bg(t.hover)).on_mouse_down("left", stop).tooltip(tip).on_click(toggle)
      .child(glyph(TIE)).child("Alfred")
      .when(n > 0 || Boolean(status), el => el.child(div().px(5).h(16).flex().items_center().rounded(4).font_family(settings().font_family ?? "JetBrains Mono")
        .text_size(11).bg(status ?? t.accent).text_color(t.chrome.slice(0, 7)).child(String(n))));
  }

  // Every agent Herdr knows of, with a gauge of one slanted tick per agent in its state's colour in the HUD.
  agents(t, hud) {
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const tip = `${list.length} agent${list.length === 1 ? "" : "s"}${needs ? `, ${needs} need${needs === 1 ? "s" : ""} you` : ""}`;
    if (!hud) return h_flex().id("agents-chip").h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12).text_color(needs ? t.blocked : t.muted).tooltip(tip)
      .child(glyph(ROBOT)).child("Agents")
      .child(div().px(5).h(16).flex().items_center().rounded(4).font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .bg(needs ? t.blocked : t.raised).text_color(needs ? t.chrome.slice(0, 7) : t.foreground).child(String(list.length)));
    const rank = (a) => { const i = GAUGE.indexOf(a.status); return i < 0 ? GAUGE.length - 1 : i; };
    const ticks = [...list].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_TICKS);
    const W = 3, SLANT = 3, GAP = 2, H = 12;
    const tone = { blocked: t.blocked, working: t.working, done: t.done, idle: t.idle + "99" };
    const groups = GAUGE.map((s) => ticks.map((a, i) => [rank(a), i]).filter(([r]) => GAUGE[r] === s)
      .map(([, i]) => { const x = i * (W + GAP); return [[x + SLANT, 0], [x + SLANT + W, 0], [x + W, H], [x, H]]; }));
    return h_flex().id("agents-chip").h(24).px(6).gap(7).flex_none().items_center().tooltip(tip)
      .child(h_flex().items_center().gap(6).text_color(needs ? t.blocked : t.accent).child(glyph(ROBOT)).child(caps("Agents", 14)))
      .child(readout(t, list.length, { status: needs ? t.blocked : null, pulse: needs > 0, h: 16 }))
      .when(ticks.length > 0, el => el.child(div().relative().w(ticks.length * (W + GAP) + SLANT).h(H).flex_none()
        .children(GAUGE.map((s, i) => groups[i].length ? fill(groups[i], tone[s]).when(s === "blocked", (g) => g.loop("opacity", { from: 0.45, to: 1, period: 1400 })) : null).filter(Boolean))));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    // netrunner's HUD: cut-corner tabs, the shown one solid yellow with dark ink, the others outlined in pink.
    const hud = isHud();
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(hud ? 0 : 6).text_color(hud ? t.accent : t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const lead = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);
      const program = lead?.program;
      const name = label(c, lead);
      const ink = hud && c.active ? INK : null;
      return h_flex().id(`tab-${c.id}`).px(10).gap(7).items_center().flex_none().text_size(12.8)
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .when(!hud, el => el.h(29).rounded(7).border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
          .hover(s => s.bg(t.hover)))
        .when(hud, el => el.relative().h(26).children(frame(6, c.active ? { bg: t.blocked } : { bg: t.accent + "0d", line: t.accent + "59" }))
          .text_color(ink ?? t.accent).hover(s => (c.active ? s.opacity(0.9) : s.text_color(t.foreground))))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: hud ? "menu-tmux" : "menu", kind: "popup", width: 200, ...(hud ? { frame: "none" } : {}), props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(ink ?? (hud ? t.accent : t.muted)) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().when(hud, el => el.relative().font_family(display()).font_weight(c.active ? 700 : 600).text_size(14))
          .child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(hud ? spinner(ink ?? t.working, 12, 900) : svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(ink ?? t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(hud ? 0 : 3).bg(ink ?? t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(ink ?? t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    // The side panel stays as it is when the space changes. Herdr's tabs restores each space's own,
    // and the terminal it narrowed or widened was resized only after it showed, so tmux and omo
    // redrew about 0.7 s into every switch between spaces whose panels differed.
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      const toggle = () => {
        if (on) run("layout.hide", { id: "panel" });
        else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
      };
      if (hud) return hudButton(t, `panel-${id}`, label, { on, icon: svg(icon).size(13).relative(), h: 24 }).on_mouse_down("left", stop).on_click(toggle);
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(toggle).child(svg(icon).size(14)).child(label);
    };
    // The strip is the theme's chrome made solid: a layout's translucent chrome (netrunner's frosted glass) would show
    // whatever is on the desktop behind it, off the theme's colours.
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(hud ? 6 : 3).items_center()
      .bg(hud ? PLATE.slice(0, 7) : t.chrome.slice(0, 7)).border_b(1).border_color(hud ? t.accent + "73" : t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => this.wheel(e))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(hud ? 6 : 3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      // In netrunner the menus are the HUD copies of Herdr's (menu-tmux, new-menu-tmux), frameless as they draw their own.
      .child(button("tab-new", "+", () => openOverlay({ mod: hud ? "new-menu-tmux" : "new-menu", kind: "popup", width: 250, height: 512, ...(hud ? { frame: "none" } : {}) })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(Boolean(find(root, "alfred")), el => el.child(this.alfred(t, hud, panel, body, stop)))
      .child(this.agents(t, hud))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
