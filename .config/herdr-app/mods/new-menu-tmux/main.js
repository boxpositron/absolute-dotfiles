// The netrunner HUD clone of Herdr's new-menu 0.1.16 (the tab bar's + menu): a cut-corner frame drawn by the mod itself
// (mod.json overlay frame "none"), caps rows with a pink wash and edge on the hovered one, pink rules and caps headers.
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, panes, knownAgents, run, openOverlay, closeOverlay, props, window, keys, shared, setShared } from "herdr";
import { modalFrame, caps, mono } from "./hud.js";

// The last agents each machine reported, shown at once while knownAgents() checks again.
const KNOWN = "new-menu.agents";

function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class NewMenu extends View {
  init(_props, cx) {
    const machine = spaces().find(s => s.active)?.machine;
    const where = machine ?? "";
    this.hover = null;
    this.agents = shared(KNOWN)?.[where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents });
      }
      catch { this.failed = true; }
      cx.notify();
    });
  }
  // `name` is a string (an agent's own name, keeping its case) or an element (the HUD's own words, in caps).
  row(id, icon, name, action, hint = "", enabled = true) {
    const t = theme();
    const hot = enabled && this.hover === id;
    return h_flex().id(id).relative().h(30).px(10).gap(10).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, el => el.cursor_pointer())
      .when(hot, el => el.bg(t.accent + "26").child(div().absolute().top(0).bottom(0).left(0).w(2).bg(t.accent)))
      .on_hover((hovered, cx) => {
        if (hovered) this.hover = id;
        else if (this.hover === id) this.hover = null;
        cx.notify();
      })
      .on_click(() => { if (enabled) { closeOverlay(props().overlay); action(); } })
      .child(icon).child(div().flex_1().min_w(0).truncate().child(name)).child(div().flex_none().font_family(mono()).text_size(10.5).text_color(t.dim).child(hint));
  }
  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const installed = this.agents.filter(a => a.installed);
    const choices = this.failed ? installed : [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)];
    return v_flex().min_h(0).w_full().h(Math.min(491, 173 + Math.max(1, choices.length + (this.failed ? 1 : 0)) * 30)).p(8).text_size(12.8)
      .id("new-menu").relative().track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (!agent) return;
        closeOverlay(props().overlay);
        run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });
      })
      .children(modalFrame(t, 12))
      .child(this.row("terminal", svg("icons/shell.svg").size(14), caps("Terminal", 14), () => run("tab.new", { space: space?.id }), shortcut("tab.new")))
      .child(div().px(10).pt(8).pb(4).child(caps("Start an agent", 12.5, 700).text_color(t.accent)))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.map((a, i) => this.row(a.key, a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name,
          () => run("tab.new", { name: a.name, space: space?.id, argv: a.run }), a.installed ? (i < 9 ? String(i + 1) : "") : "not installed", a.installed)))
        .when(this.failed || this.agents.length === 0, el => el.child(div().px(10).py(6).text_color(t.dim).child(caps(this.failed ? "Could not check installed agents" : "Checking installed agents…", 13, 500)))))
      .child(div().h(1).mx(8).my(4).bg(t.accent + "59"))
      .child(this.row("space", div().w(14).font_family(mono()).child("+"), caps("New space", 14), () => run("space.new"), shortcut("space.new")))
      .child(this.row("worktree", svg("mods/workspace-chrome/branch.svg").size(14), caps("New worktree…", 14), () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space)))
      .child(this.row("worktree-open", svg("mods/workspace-chrome/branch.svg").size(14), caps("Open worktree\u2026", 14), () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space)));
  }
}
