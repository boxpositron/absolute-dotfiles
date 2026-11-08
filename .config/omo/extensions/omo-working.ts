// Marks the tmux pane "working" whenever an omo turn starts, not only when you type a prompt.
// omo-notify's UserPromptSubmit hook covers typed prompts; turns started by an answer to a
// question, a finished background task, a monitor or a goal continuation fire no prompt hook,
// so the pane (its tab marker and Herdr's Agents list) kept saying idle while omo worked.
// The Stop hook still marks the end of the turn. Best effort, like omo-notify: a failed
// status update must never disturb the session, so its result is ignored.
import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const OMO_STATUS = join(homedir(), ".local/bin/omo-status");

export default function (pi: ExtensionAPI) {
	const pane = process.env.TMUX_PANE;
	if (!pane) return;
	pi.on("agent_start", () => {
		execFile(OMO_STATUS, ["set", pane, "working"], { timeout: 10_000 }, () => {});
	});
}
