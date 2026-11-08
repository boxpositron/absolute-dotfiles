// Keeps the tmux pane's omo state and name current for its tab marker and Herdr's Agents list.
// omo's hooks (omo-notify) fire only for typed prompts, stops and questions, so this fills the gaps:
// - every turn start marks the pane working, including turns omo starts itself (an answer to a
//   question, a finished background task, a monitor, a goal continuation);
// - omo's own name for the session labels the pane, sent when it is set or changes;
// - shutdown clears the pane, since no hook fires when omo exits, and the last state and name
//   would otherwise stay on the tab. A reload keeps them: it rebuilds this runtime in the same
//   session, and no hook would set the state again.
// Best effort, like omo-notify: a failed update must never disturb the session, so errors are ignored.
import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const OMO_STATUS = join(homedir(), ".local/bin/omo-status");

function omoStatus(args: string[], signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		execFile(OMO_STATUS, args, { timeout: 1500, signal }, () => resolve());
	});
}

export default function (pi: ExtensionAPI) {
	const pane = process.env.TMUX_PANE;
	if (!pane) return;
	let sentName: string | undefined;

	const sendName = (name: string | undefined) => {
		const value = name?.trim() ?? "";
		if (value === (sentName ?? "")) return;
		sentName = value;
		void omoStatus(["name", pane, value]);
	};

	pi.on("session_start", () => {
		sentName = undefined;
		sendName(pi.getSessionName());
	});
	pi.on("session_info_changed", (event) => sendName(event.name));
	pi.on("agent_start", () => {
		void omoStatus(["set", pane, "working"]);
	});
	pi.on("agent_settled", () => sendName(pi.getSessionName()));
	pi.on("session_shutdown", async (event) => {
		sentName = undefined;
		if (event.reason === "reload") return;
		await omoStatus(["set", pane, "clear"], event.signal);
	});
}
