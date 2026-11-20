// The netrunner HUD clone of Herdr's toast 0.1.16. How notifications look. Anything can post one with notify({ title,
// body, level, icon, action }); replace this mod to restyle them all. Click to run its action (e.g. go to the agent) and
// dismiss it. Drawn as a cut-corner card: a solid plate lined in the level's colour, the level as a solid chip, the
// title in the display face, the body in the default font and the action as a button (the click is the card's).

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme } from "herdr";
import { INK, PLATE, frame, caps, button } from "./hud.js";

const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };

export default class Toast extends View {
  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const tone = t[DOT[p.level] ?? "accent"];
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    return h_flex()
      .id("toast")
      .relative()
      .size_full()
      .px(18)
      .gap(12)
      .items_center()
      .cursor_pointer()
      .hover((s) => s.opacity(0.92))
      .children(frame(10, { bg: PLATE.slice(0, 7), line: tone }))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .when(Boolean(p.icon), (el) => el.child(image(p.icon).relative().w(18).h(18).flex_none()))
      .child(h_flex().relative().h(18).px(7).flex_none().items_center().text_color(INK)
        .children(frame(4, { bg: tone }))
        .child(caps(p.level ?? "info", 12, 700).relative()))
      .child(
        v_flex()
          .relative()
          .flex_1()
          .min_w(0)
          .overflow_hidden()
          .child(caps(login ? `${login[1]} needs a login: run` : p.title ?? "", 15, 700).truncate().text_color(t.foreground))
          .when(!login && Boolean(p.body), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(p.body ?? "")))
          .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(12).text_color(t.muted).child(command))
            .child(button(t, "toast-login-copy", this.copied ? "Copied" : "Copy", { h: 20 })
              .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })))),
      )
      .when(Boolean(p.action?.name), (el) => el.child(button(t, "toast-action", "Open", { on: true, h: 22 })));
  }
}
