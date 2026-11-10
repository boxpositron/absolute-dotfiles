// :q quits omo, and :sq quits safely. Enter is caught before the editor submits, where omo handles /quit,
// so these never fire prompt hooks such as UserPromptSubmit. ctx.shutdown() waits for the agent to go idle,
// so a quit typed mid-turn happens after it.
//
// :sq (or /sq) runs the /sq checklist (.config/omo/prompts/sq.md) as a turn: trackers, logged time, git and
// memory brought up to date, then a handoff that ends in `SQ: done`, `SQ: park <open items>` or `SQ: hold <reason>`.
// Done means nothing is left: in an owt workspace that is committed and merged it runs /owt-done, which stops what
// still runs in the workspace (dev servers, watchers, containers), removes it and ends the session; outside a
// workspace the session just closes. Park means work is left: the session is filed in the session library
// (`omo-sessions file`) and quits, as is a done in a workspace that can't be finished yet. On hold it stays open.
// `SQ: ready`, from before done and park, still finishes a merged workspace and parks anything else.
//
// `omo-sessions` asks a session to quit (park, nightly idle close), to quit so it can be restarted
// (reboot), or to take a task handed over from another session, by writing requests/<session id>.json
// in its state folder. A session that starts leaves the library, however it was reopened.
import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { type FSWatcher, mkdirSync, readFileSync, rmSync, watch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const QUIT_COMMANDS = new Set([":q", ":q!", ":qa", ":wq"]);
const STATE = process.env.OMO_SESSIONS_DIR ?? join(homedir(), ".local/state/omo-sessions");
const REQUESTS = join(STATE, "requests");
const OMO_SESSIONS = join(homedir(), ".local/bin/omo-sessions");
const OWT = join(homedir(), ".local/bin/owt");

type Request = { action: "quit" | "reboot" | "message"; text?: string; handoff?: string; from?: string };

function omoSessions(args: string[]): Promise<void> {
	return new Promise((resolve) => {
		execFile(OMO_SESSIONS, args, { timeout: 20_000 }, () => resolve());
	});
}

// `owt done --check` from the session's folder: "finishable" for a committed, merged workspace, "kept" for a
// workspace that isn't, and nothing outside one.
function owtWorkspace(cwd: string): Promise<"finishable" | "kept" | undefined> {
	return new Promise((resolve) => {
		execFile(OWT, ["done", "--check"], { cwd, timeout: 60_000 }, (error, stdout) => {
			if (!error) resolve("finishable");
			else resolve(stdout.includes("workspace=") ? "kept" : undefined);
		});
	});
}

function lastAssistantText(messages: unknown): string {
	if (!Array.isArray(messages)) return "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i] as { role?: string; content?: unknown };
		if (message?.role !== "assistant") continue;
		if (typeof message.content === "string") return message.content;
		if (Array.isArray(message.content)) {
			return message.content
				.map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
				.join("\n");
		}
	}
	return "";
}

type Verdict = { kind: "done" | "park" | "hold" | "ready"; reason: string };

// The checklist's verdict: its last non-empty line, `SQ: done`, `SQ: park <open items>` or `SQ: hold <reason>`.
function verdict(text: string): Verdict | undefined {
	const last = text.trim().split("\n").at(-1)?.trim() ?? "";
	const match = /^`?SQ:\s*(done|park|hold|ready)\b\s*(.*?)`?$/i.exec(last);
	return match ? { kind: match[1].toLowerCase() as Verdict["kind"], reason: match[2] } : undefined;
}

export default function (pi: ExtensionAPI) {
	let unsubscribe: (() => void) | undefined;
	let watcher: FSWatcher | undefined;
	let safeQuit = false;
	let lastText = "";

	pi.on("session_start", (_event, ctx) => {
		const sid = ctx.sessionManager.getSessionId();

		const startSafeQuit = () => {
			safeQuit = true;
			ctx.ui.notify("Safe quit: syncing this session, then closing it", "info");
			pi.sendUserMessage("/sq", ctx.isIdle() ? { expandPromptTemplates: true } : { expandPromptTemplates: true, deliverAs: "followUp" });
		};

		const takeRequest = () => {
			if (!sid) return;
			const file = join(REQUESTS, `${sid}.json`);
			let request: Request;
			try {
				request = JSON.parse(readFileSync(file, "utf8")) as Request;
			} catch {
				return;
			}
			rmSync(file, { force: true });
			if (request.action === "quit" || request.action === "reboot") {
				ctx.ui.notify(request.action === "reboot" ? "Restarting this session" : "Closing this session (kept in the library)", "info");
				ctx.shutdown();
			} else if (request.action === "message" && request.text) {
				const framed = `[Handoff ${request.handoff ?? ""} from ${request.from ?? "another session"}] ${request.text}`;
				pi.sendUserMessage(framed, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
				if (request.handoff) void omoSessions(["taken", request.handoff, sid]);
			}
		};

		unsubscribe?.();
		unsubscribe = ctx.ui.onTerminalInput((data) => {
			if (!matchesKey(data, Key.enter)) return undefined;
			const text = ctx.ui.getEditorText().trim();
			if (QUIT_COMMANDS.has(text)) {
				ctx.ui.setEditorText("");
				ctx.shutdown();
				return { consume: true };
			}
			if (text === ":sq") {
				ctx.ui.setEditorText("");
				startSafeQuit();
				return { consume: true };
			}
			return undefined;
		});

		if (!sid) return;
		void omoSessions(["unfile", sid]);
		// A session started to take over a handoff says so once. Removed so sessions it starts don't claim it too.
		const handoff = process.env.OMO_HANDOFF_ID;
		if (handoff) {
			delete process.env.OMO_HANDOFF_ID;
			void omoSessions(["taken", handoff, sid]);
		}
		mkdirSync(REQUESTS, { recursive: true });
		watcher?.close();
		watcher = watch(REQUESTS, (_type, name) => {
			if (name === `${sid}.json`) takeRequest();
		});
		takeRequest();
	});

	pi.on("input", (event) => {
		if (event.source === "interactive" && event.text.trim() === "/sq") safeQuit = true;
		return { action: "continue" };
	});

	pi.on("agent_end", (event) => {
		lastText = lastAssistantText(event.messages);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!safeQuit || !ctx.isIdle()) return;
		safeQuit = false;
		const result = verdict(lastText);
		if (!result) {
			ctx.ui.notify("Safe quit stopped before it finished; the session stays open", "warning");
			return;
		}
		if (result.kind === "hold") {
			ctx.ui.notify(`Safe quit is holding: ${result.reason || "see the last message"}`, "warning");
			return;
		}
		const workspace = await owtWorkspace(ctx.cwd);
		if (result.kind !== "park" && workspace === "finishable") {
			// It stops what runs in the workspace, removes it and closes this window, so the session is not filed.
			ctx.ui.notify("Safe quit is done: cleaning up and finishing this workspace", "info");
			pi.sendUserMessage("/owt-done", { expandPromptTemplates: true });
			return;
		}
		if (result.kind === "done" && workspace === undefined) {
			// Nothing to come back to, so it stays out of the library.
			ctx.ui.notify("Safe quit is done: closing this session", "info");
			ctx.shutdown();
			return;
		}
		if (result.kind === "park") ctx.ui.notify(`Safe quit is parking this session: ${result.reason || "work is left"}`, "info");
		else if (workspace === "kept") ctx.ui.notify("This workspace can't be finished yet, so the session is parked", "info");
		const sid = ctx.sessionManager.getSessionId();
		const file = ctx.sessionManager.getSessionFile();
		if (sid) await omoSessions(["file", sid, "--reason", "sq", "--cwd", ctx.cwd, ...(file ? ["--session-file", file] : [])]);
		ctx.shutdown();
	});

	pi.on("session_shutdown", () => {
		unsubscribe?.();
		unsubscribe = undefined;
		watcher?.close();
		watcher = undefined;
	});
}
