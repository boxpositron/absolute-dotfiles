// sigils.js: each space's sigil in netrunner's sidebar, in place of its initial. A glyph on a 24-unit grid ({f} a filled
// polygon, {l} a 2-unit line, closed when c), drawn with GPUI paths since Herdr loads no image through the dotfiles link,
// on a cut-corner tile in the space's colour: neon on the plate, or solid with a dark glyph for the space you are in. A
// scanline sweeps it while an agent there works (slower in the background); it pulses in an outline while one needs you.
import { div, PathBuilder } from "gpui-kit";
import { INK, PLATE, layer, fill, outline, cut } from "./hud.js";

export const GLYPHS = {
  visor: [{ l: [[12,2],[21,7],[21,17],[12,22],[3,17],[3,7]], c: 1 }, { f: [[6,10.5],[18,10.5],[18,13.5],[6,13.5]] }],
  chip: [{ l: [[6,6],[18,6],[18,18],[6,18]], c: 1 }, { f: [[9.5,9.5],[14.5,9.5],[14.5,14.5],[9.5,14.5]] }, { f: [[7.1,2],[8.9,2],[8.9,5],[7.1,5]] }, { f: [[7.1,19],[8.9,19],[8.9,22],[7.1,22]] }, { f: [[11.1,2],[12.9,2],[12.9,5],[11.1,5]] }, { f: [[11.1,19],[12.9,19],[12.9,22],[11.1,22]] }, { f: [[15.1,2],[16.9,2],[16.9,5],[15.1,5]] }, { f: [[15.1,19],[16.9,19],[16.9,22],[15.1,22]] }],
  bolt: [{ f: [[13,2],[5,13.5],[10.5,13.5],[9,22],[19,9.5],[13.5,9.5],[15.5,2]] }],
  eye: [{ l: [[2,12],[12,5],[22,12],[12,19]], c: 1 }, { f: [[12,8.5],[15.5,12],[12,15.5],[8.5,12]] }],
  crosshair: [{ l: [[7,4],[17,4],[20,7],[20,17],[17,20],[7,20],[4,17],[4,7]], c: 1 }, { l: [[12,1],[12,8]] }, { l: [[12,16],[12,23]] }, { l: [[1,12],[8,12]] }, { l: [[16,12],[23,12]] }, { f: [[10.5,10.5],[13.5,10.5],[13.5,13.5],[10.5,13.5]] }],
  chevrons: [{ f: [[4,3],[12,7.5],[20,3],[20,6],[12,10.5],[4,6]] }, { f: [[4,9],[12,13.5],[20,9],[20,12],[12,16.5],[4,12]] }, { f: [[4,15],[12,19.5],[20,15],[20,18],[12,22.5],[4,18]] }],
  claw: [{ f: [[6,2],[9,2],[4,22],[1,22]] }, { f: [[13,2],[16,2],[11,22],[8,22]] }, { f: [[20,2],[23,2],[18,22],[15,22]] }],
  node: [{ f: [[9,9],[15,9],[15,15],[9,15]] }, { l: [[15,12],[20,12],[20,6]] }, { l: [[12,15],[12,20],[6,20]] }, { l: [[9,12],[4,12],[4,5]] }, { f: [[18.5,3],[21.5,3],[21.5,6],[18.5,6]] }, { f: [[3,18.5],[6,18.5],[6,21.5],[3,21.5]] }, { f: [[2.5,2.5],[5.5,2.5],[5.5,5.5],[2.5,5.5]] }],
  mask: [{ l: [[4,3],[20,3],[20,13],[15,21],[9,21],[4,13]], c: 1 }, { f: [[7,8],[11,9.5],[11,11.5],[7,11]] }, { f: [[17,8],[13,9.5],[13,11.5],[17,11]] }, { l: [[10,16.5],[14,16.5]] }],
  delta: [{ l: [[12,2],[22,20.5],[2,20.5]], c: 1 }, { f: [[12,9],[16.5,17.5],[7.5,17.5]] }],
  hexcore: [{ l: [[12,2],[21,7],[21,17],[12,22],[3,17],[3,7]], c: 1 }, { f: [[12,7],[16.5,9.5],[16.5,14.5],[12,17],[7.5,14.5],[7.5,9.5]] }],
  blade: [{ f: [[19,2],[22,5],[9,18],[6,15]] }, { f: [[3.5,13.5],[10.5,20.5],[9,22],[2,15]] }, { l: [[5.5,18.5],[2.5,21.5]] }],
  signal: [{ f: [[3,17],[6,17],[6,21],[3,21]] }, { f: [[8,13],[11,13],[11,21],[8,21]] }, { f: [[13,9],[16,9],[16,21],[13,21]] }, { f: [[18,4],[21,4],[21,21],[18,21]] }],
  glitch: [{ f: [[3,3.5],[15,3.5],[15,6.5],[3,6.5]] }, { f: [[8,9],[21,9],[21,12],[8,12]] }, { f: [[3,14],[13,14],[13,17],[3,17]] }, { f: [[11,19],[21,19],[21,21.5],[11,21.5]] }],
  rune: [{ f: [[4,3],[8,3],[16,14.5],[16,3],[20,3],[20,21],[16,21],[8,9.5],[8,21],[4,21]] }],
  shield: [{ l: [[12,2],[20,5],[20,12],[12,22],[4,12],[4,5]], c: 1 }, { f: [[8,9],[12,12],[16,9],[16,12.5],[12,15.5],[8,12.5]] }],
  shard: [{ l: [[12,2],[19,12],[12,22],[5,12]], c: 1 }, { f: [[12,7],[15.5,12],[12,17],[8.5,12]] }],
};
export const NAMES = Object.keys(GLYPHS);

export function sigil(t, name, tint, size, { on = false, state = null } = {}) {
  const c = Math.round(size * 0.24), inner = size * 0.64, o = (size - inner) / 2, k = inner / 24;
  const at = (p) => p.map(([x, y]) => [o + x * k, o + y * k]);
  const shapes = GLYPHS[name] ?? GLYPHS.rune;
  const fills = shapes.filter((s) => s.f).map((s) => at(s.f));
  const lines = shapes.filter((s) => s.l);
  const ink = on ? INK : tint;
  const scan = state === "working" || state === "background";
  const alarm = state === "input" ? t.accent : state === "error" ? t.ansi1 : state === "blocked" ? t.blocked : null;
  return div().relative().size(size).flex_none().overflow_hidden()
    .child(fill([cut(size, size, c)], on ? tint : PLATE.slice(0, 7)))
    .when(!on, (el) => el.child(fill([cut(size, size, c)], tint + "24")).child(outline(cut(size, size, c, 0.5), tint)))
    .child(div().absolute().top(0).left(0).size_full()
      .when(Boolean(alarm), (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1200 }))
      .when(fills.length > 0, (el) => el.child(fill(fills, ink)))
      .when(lines.length > 0, (el) => el.child(layer(lines.reduce((b, s) => b.add_polygon(at(s.l), Boolean(s.c)), PathBuilder.stroke(Math.max(1, 2 * k))), ink))))
    .when(scan, (el) => el.child(div().absolute().left(0).w(size).h(Math.max(1, Math.round(size / 12))).bg((on ? INK : tint) + "cc")
      .loop("top", { from: 0, to: size - 1, period: state === "background" ? 2600 : 1300, easing: "linear" })))
    .when(Boolean(alarm), (el) => el.child(outline(cut(size, size, c, 0.5), alarm)));
}
