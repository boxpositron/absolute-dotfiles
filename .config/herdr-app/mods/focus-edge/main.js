// A red edge down the right of the main terminal while the keyboard is in it: the netrunner layout's
// `focus-edge` block, right beside `main`. Herdr's pane focus ring colours all four sides, so the
// layout has none and this stands in for its right side.
import { View, div } from "gpui-kit";
import { focused } from "herdr";

// The Agents tree's edge on the pane Herdr shows (FOCUS_EDGE in agents-tmux).
const EDGE = "#ff3040";

export default class FocusEdge extends View {
  render() {
    // A tab's terminal pane has the keyboard: `pane` is null for a layout terminal block (Files' nvim)
    // or a window, and `terminal` is null for a mod pane.
    const f = focused();
    return div().size_full().when(Boolean(f?.pane && f?.terminal), (el) => el.bg(EDGE));
  }
}
