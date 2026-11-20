// hud.js: the netrunner layout's Cyberpunk 2077 HUD look, drawn by the mods that import it while that layout shows
// (shared "layout"). Not a block prop: Herdr keeps a block's localStorage by its props, so a prop would part each mod
// from the state it saved. This file is the source; each other mod that draws the HUD keeps an identical copy, since
// Herdr loads no import from outside a mod's folder (sync them as the Herdr README says).
import { div, svg, PathBuilder } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, fonts, settings } from "herdr";

// Dark ink for text on yellow and on filled frames, and the near-black plate under bars.
export const INK = "#05050b", PLATE = "#07060de6";
export const isHud = () => shared("layout") === "netrunner";
export const mono = () => settings().font_family ?? "JetBrains Mono";

// The condensed face, close to the game's (Brewfile's font-rajdhani), else the terminal font.
let face = null;
export function display() {
  if (face === null) face = fonts().includes("Rajdhani") ? "Rajdhani" : "";
  return face || mono();
}

// Shapes painted behind an element's content, which must be relative: points in px from its top left, or "n%" of it.
export const layer = (builder, color) => window.paint_path(builder.build(), color).absolute().top(0).left(0).size_full();
export const fill = (polygons, color) => layer(polygons.reduce((b, p) => b.add_polygon(p, true), PathBuilder.fill()), color);
export const outline = (polygon, color) => layer(PathBuilder.stroke(1).add_polygon(polygon, true), color);
// A w x h frame with its top right and bottom left corners cut by c, inset so a 1 px stroke stays inside.
export const cut = (w, h, c, i = 0) => [[i, i], [w - c, i], [w - i, c], [w - i, h - i], [c, h - i], [i, h - c]];

// The same frame for an element of any size, as pieces to add as its first children (it must be relative): a fill
// and a 1 px line, each optional. Nothing else in the element may paint into its two cut corners.
export function frame(c, { bg = null, line = null } = {}) {
  const at = () => div().absolute();
  const diagonal = (color) => layer(PathBuilder.stroke(1).move_to("0%", "0%").line_to("100%", "100%"), color);
  return [
    ...(bg ? [
      at().top(c).bottom(c).left(0).right(0).bg(bg),
      at().top(0).h(c).left(0).right(c).bg(bg),
      at().bottom(0).h(c).left(c).right(0).bg(bg),
      at().top(0).right(0).size(c).child(fill([[["0%", "0%"], ["0%", "100%"], ["100%", "100%"]]], bg)),
      at().bottom(0).left(0).size(c).child(fill([[["0%", "0%"], ["100%", "0%"], ["100%", "100%"]]], bg)),
    ] : []),
    ...(line ? [
      at().top(0).left(0).right(c).h(1).bg(line),
      at().top(c).bottom(0).right(0).w(1).bg(line),
      at().bottom(0).left(c).right(0).h(1).bg(line),
      at().top(0).bottom(c).left(0).w(1).bg(line),
      at().top(0).right(0).size(c).child(diagonal(line)),
      at().bottom(0).left(0).size(c).child(diagonal(line)),
    ] : []),
  ];
}

// A modal's own frame, for an overlay opened with frame: "none" (Herdr then draws no border, corners or shadow): the
// plate made solid, since modals stay opaque over the glass, and a pink line, its corners cut by c.
export const modalFrame = (t, c = 14) => frame(c, { bg: PLATE.slice(0, 7), line: t.accent + "99" });

// The HUD's own words, in capitals in the display face. Names people gave (tabs, sessions, files) keep their case.
export const caps = (text, size = 13, weight = 600) => div().font_family(display()).font_weight(weight).text_size(size).child(String(text).toUpperCase());

// The HUD's spinner, in place of Herdr's round one: three alternate edges of a hexagon turning, in the state's colour.
// Only an svg element spins, and Herdr loads no image through the dotfiles link, so setup-mac.sh copies hud/spinner.svg
// into Herdr's folder as a real file.
export const spinner = (color, size = 12, period = 900) => svg("hud/spinner.svg").size(size).flex_none().text_color(color).spin(period);

export const slash = (color, h = 14) => div().relative().w(10).h(h).flex_none()
  .child(layer(PathBuilder.stroke(1).move_to("100%", "0%").line_to("0%", "100%"), color));

// A number in a cut-corner frame: cyan and outlined, or filled in its state colour with dark ink, pulsing when it
// needs you.
export function readout(t, n, { status = null, pulse = false, h = 18 } = {}) {
  const text = String(n), w = 12 + text.length * 8;
  return div().relative().w(w).h(h).flex_none().flex().items_center().justify_center()
    .when(!status, (el) => el.child(fill([cut(w, h, 5)], t.working + "14")).child(outline(cut(w, h, 5, 0.5), t.working + "b3")))
    .when(Boolean(status), (el) => el.child(fill([cut(w, h, 5)], status).when(pulse, (s) => s.loop("opacity", { from: 0.45, to: 1, period: 1400 }))))
    .child(div().relative().font_family(mono()).font_weight(700).text_size(12.5).text_color(status ? INK : t.working).child(text));
}

// A button in a cut-corner frame: outlined in its tone (cyan by default), or yellow with dark ink when it is on or
// the main action. The caller adds its id's handlers.
export function button(t, id, text, { on = false, tone = null, icon = null, h = 22 } = {}) {
  const line = tone ?? t.working;
  return h_flex().id(id).relative().h(h).px(9).gap(5).flex_none().items_center().cursor_pointer()
    .children(frame(5, on ? { bg: t.blocked } : { bg: line + "14", line: line + "b3" }))
    .text_color(on ? INK : line)
    .hover((s) => (on ? s.opacity(0.85) : s.text_color(t.foreground)))
    .when(Boolean(icon), (el) => el.child(icon))
    .child(caps(text, 12.5, 700).relative());
}

export const title = (t, text, size = 15) => h_flex().gap(8).items_center().flex_none()
  .child(div().w(4).h(size - 1).bg(t.blocked))
  .child(caps(text, size, 700).text_color(t.accent));
