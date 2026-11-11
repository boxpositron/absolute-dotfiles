// Runs omo at nice 10 so agents' test runs can't starve Herdr, tmux and the window server; everything
// omo starts inherits it, however the session was launched. Lowering nice again needs root, so a
// process already at 10 or above is left alone.
import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { getPriority, setPriority } from "node:os";

const NICE = 10;

export default function (_pi: ExtensionAPI) {
	if (getPriority() < NICE) setPriority(NICE);
}
