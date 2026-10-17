// Enter is caught before the editor submits, where omo handles /quit, so :q never fires prompt hooks
// such as UserPromptSubmit. ctx.shutdown() waits for the agent to go idle, so :q mid-turn quits after it.
import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { Key, matchesKey } from "@earendil-works/pi-tui";

const QUIT_COMMANDS = new Set([":q", ":q!", ":qa", ":wq"]);

export default function (pi: ExtensionAPI) {
	let unsubscribe: (() => void) | undefined;

	pi.on("session_start", (_event, ctx) => {
		unsubscribe?.();
		unsubscribe = ctx.ui.onTerminalInput((data) => {
			if (!matchesKey(data, Key.enter) || !QUIT_COMMANDS.has(ctx.ui.getEditorText().trim())) {
				return undefined;
			}
			ctx.ui.setEditorText("");
			ctx.shutdown();
			return { consume: true };
		});
	});

	pi.on("session_shutdown", () => {
		unsubscribe?.();
		unsubscribe = undefined;
	});
}
