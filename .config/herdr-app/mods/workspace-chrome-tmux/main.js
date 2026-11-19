// Herdr's workspace-chrome (sidebar brand and footer), whose search opens picker-tmux.
// Icons stay the shipped mod's: Herdr loads no images through the dotfiles link.
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights, and for the session cards beside the scrollbar's lane), or
// back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 84 : 44 });
}

export default class WorkspaceChrome extends View {
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8)
        .when(collapsed, el => el.relative().w(32).px(0).justify_center().tooltip(label))
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(`mods/workspace-chrome/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(label));
      const ready = div().size(6).rounded_full().bg(t.accent);
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(4).pb(8).text_size(13)
        .when(collapsed, el => el.px(0).items_center())
        .child(row("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(5).right(6) : ready)))
        .child(row("machine", collapsed ? "server" : "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" }))
          // On the rail a server with a + on its corner, so it doesn't pass for the spaces' new-space buttons.
          .when(collapsed, el => el.child(div().absolute().right(5).bottom(3).size(11).rounded(6).bg(t.chrome).flex().items_center()
            .justify_center().child(svg("mods/workspace-chrome/plus.svg").size(8)))));
    }
    // Search and the sidebar toggle stay at the top either way. On the macOS rail the traffic lights fill the row's first
    // 46 px, so the row grows to hold them underneath (a drag can make the rail too, so this is checked on each render).
    const tall = collapsed && window()?.platform === "macos" && !window()?.fullscreen;
    const want = tall ? 78 : 46;
    if (Math.round(find(layout(), "brand")?.size?.px ?? want) !== want && this.asked !== want) {
      this.asked = want;
      run("layout.resize", { id: "brand", px: want });
    }
    const search = this.button("search", svg("mods/workspace-chrome/search.svg").size(15), () => run("mod.open", { name: "picker-tmux" }))
      .tooltip("Search (\u2318P)");
    const toggle = this.button("sidebar-toggle", svg("mods/workspace-chrome/sidebar.svg").size(15), toggleSidebar)
      .tooltip(collapsed ? "Expand sidebar" : "Collapse sidebar");
    if (collapsed) {
      // The 44 px rail off macOS has room for the toggle only.
      const roomy = (find(layout(), "sidebar")?.size?.px ?? 0) >= 60;
      return v_flex().size_full().bg(t.chrome).items_center().when(tall, el => el.justify_end().pb(8)).when(!tall, el => el.justify_center())
        .child(h_flex().gap(4).items_center().when(roomy, el => el.child(search)).child(toggle));
    }
    return h_flex().size_full().bg(t.chrome).pl(14).pr(10).gap(4).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !window()?.fullscreen, el => el.pl(76))
      .child(h_flex().flex_1().gap(8).items_center().child(image("frame/welcome/herdr.png").size(20).rounded(5)).child(div().font_semibold().text_color(t.foreground).child("Herdr")))
      .child(search)
      .child(toggle);
  }
}
