// Keeps a record of each omo session running in a tmux pane, so `omo-sessions resurrect` can reopen the ones a
// logout, reboot or crash ended, once tmux-resurrect has brought their panes back.
//
// A session closed on purpose (/quit, :q, Ctrl+D, :sq, a park or reboot request) removes its record. omo shuts down
// the same way when SIGHUP or SIGTERM ends it, with reason "quit", so this listens for those signals: a session a
// signal ended keeps its record, marked with the signal. Closing its pane or window in tmux, or `owt done`, also
// ends omo with a signal, so a detached check removes the record if the tmux server still has sessions a few
// seconds later; at a logout the server is gone by then. `omo-sessions snapshot` (each tmux-resurrect save) drops
// whatever else ended while tmux kept running, a crash included. A reload keeps the record (same session, same
// process), and a switch to another session (/new, /resume, /fork) swaps it for the new session's.
//
// One file per session, $OMO_SESSIONS_DIR/running/<session id>.json; omo-sessions describes the fields.
// Interactive sessions only: subagents and other headless sessions inherit the pane's TMUX_PANE, but the pane isn't
// theirs. Best effort, like omo-working: a failed write must never disturb the session.
import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { execFile, spawn } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RUNNING = join(process.env.OMO_SESSIONS_DIR ?? join(homedir(), ".local/state/omo-sessions"), "running");
const SIGNALS: NodeJS.Signals[] = ["SIGHUP", "SIGTERM"];
// How long the tmux server has to go after a signal before the session counts as closed in tmux.
const SETTLE_SECONDS = 5;

type Running = {
	sid: string;
	pid: number;
	cwd: string;
	sessionFile?: string;
	name?: string;
	pane: string;
	socket: string;
	server: number;
	target?: string;
	window?: string;
	tmuxSession?: string;
	startedAt: number;
	endedBy?: string;
	endedAt?: number;
};

const fileOf = (sid: string) => join(RUNNING, `${sid}.json`);

function write(record: Running) {
	try {
		mkdirSync(RUNNING, { recursive: true });
		const tmp = `${fileOf(record.sid)}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(record)}\n`);
		renameSync(tmp, fileOf(record.sid));
	} catch {}
}

function remove(sid: string) {
	try {
		rmSync(fileOf(sid), { force: true });
	} catch {}
}

// Where the pane sits in tmux, as tmux-resurrect saves it.
function place(socket: string, pane: string): Promise<Pick<Running, "target" | "window" | "tmuxSession">> {
	return new Promise((resolve) => {
		// The session less a tab mode Herdr tab's "~<window>" (omo-status tabs): tmux names a pane's session by the tab's,
		// which tmux-resurrect doesn't bring back as such.
		const format = "#{s/~[0-9]+$//:session_name}\t#{window_index}.#{pane_index}\t#{window_name}";
		execFile("tmux", ["-S", socket, "display-message", "-p", "-t", pane, format], { timeout: 1500 }, (error, stdout) => {
			const [tmuxSession, at, window] = error ? [] : stdout.replace(/\n$/, "").split("\t");
			resolve(tmuxSession ? { tmuxSession, target: `${tmuxSession}:${at}`, window } : {});
		});
	});
}

// Outlives omo: if the tmux server still has sessions once the signal has had time to end it, the pane was closed in
// tmux (or omo was stopped) while tmux carried on, and the record goes. Only this process's record: the session may
// have been reopened by then.
function settle(record: Running) {
	try {
		const script = `sleep ${SETTLE_SECONDS}; tmux -S "$1" list-sessions >/dev/null 2>&1 && grep -q "\\"pid\\":$3," "$2" && rm -f "$2"`;
		spawn("/bin/sh", ["-c", script, "omo-resurrect", record.socket, fileOf(record.sid), String(record.pid)], {
			detached: true,
			stdio: "ignore",
		}).unref();
	} catch {}
}

export default function (pi: ExtensionAPI) {
	const pane = process.env.TMUX_PANE;
	// "<socket>,<server pid>,<session index>"
	const [socket, server] = (process.env.TMUX ?? "").split(",");
	if (!pane || !socket || !server) return;
	let record: Running | undefined;
	let endedBy: string | undefined;

	const onSignal = (signal: NodeJS.Signals) => {
		// Here rather than at shutdown, which a signal during startup ends the process before.
		if (record && !endedBy) {
			const ended = { ...record, endedBy: signal, endedAt: Date.now() };
			write(ended);
			settle(ended);
		}
		endedBy ??= signal;
		// omo ends the process on these signals with its own listeners. Alone, this one would keep it alive.
		if (process.listenerCount(signal) === 1) {
			unlisten();
			process.kill(process.pid, signal);
		}
	};
	const listen = () => {
		for (const signal of SIGNALS) {
			process.off(signal, onSignal);
			process.on(signal, onSignal);
		}
	};
	const unlisten = () => {
		for (const signal of SIGNALS) process.off(signal, onSignal);
	};

	pi.on("session_start", async (_event, ctx) => {
		const sid = ctx.sessionManager.getSessionId();
		if (ctx.mode !== "tui" || !sid) return;
		endedBy = undefined;
		listen();
		record = {
			sid,
			pid: process.pid,
			cwd: ctx.cwd,
			sessionFile: ctx.sessionManager.getSessionFile(),
			name: pi.getSessionName(),
			pane,
			socket,
			server: Number(server),
			startedAt: Date.now(),
		};
		write(record);
		const where = await place(socket, pane);
		if (record?.sid !== sid) return;
		record = { ...record, ...where };
		write(record);
	});

	pi.on("session_info_changed", (event) => {
		if (!record || event.name === record.name) return;
		record = { ...record, name: event.name };
		write(record);
	});

	pi.on("session_shutdown", (event) => {
		unlisten();
		const ended = record;
		record = undefined;
		// A reload starts this session again in the same process, and that start writes the record anew. The record
		// of a session a signal ended is settle's to drop.
		if (!ended || event.reason === "reload" || (event.reason === "quit" && endedBy)) return;
		remove(ended.sid);
	});
}
