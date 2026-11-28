// priority-queue: what needs you, at the top of the netrunner layout's right column (block "queue";
// side-fit folds it or the side panel to a bar when both are open), which opens by itself when something new
// needs you and closes when nothing does. One card
// per omo agent in tmux, on this Mac or another machine:
//   - a question (omo-status's "input"): each question with its options as buttons. A click on an option
//     answers it; with several questions or a multiple choice, the picks go with Send. Comment opens a box whose
//     text goes with the picks as omo's one comment covering everything (a last "Comment:" paragraph, which the
//     board extension hands the question as its comment), or alone as an answer typed out; while the box is open, a
//     click on an option picks it rather than sending it.
//   - a failure ("error"), a finished turn ("done") or a finished step ("partial": tasks still open): the
//     "For you" part of the agent's last reply, the whole reply a click away. Seen clears it
//     (`omo-status ack`) as looking at the pane does; Reply sends the agent its next prompt.
//   - a session agent-state holds blocked (a goal blocked with a reason) that no other card covers.
// Questions, failures and blocks come first, then finished turns, each the longest waiting first, as
// `omo-status next` goes. A card names its tmux session with the session's colour (tmux-session-tint), and when it
// joined the queue: a time of day, then how long ago. A card with a question open counts down to when omo stops waiting
// (agent-state's deadlineAt: the agent then goes on without your answer, or, for a required question, leaves what it gates
// undone and stops), and one whose session has a wake-up scheduled counts down to that (resumeAt), as a bar burning down.
// Text is Markdown, and Mermaid fences are drawn by herdr-render into the preview's cache. Go to, or a
// click on a card's top line, shows the pane in Herdr (`omo-status show`). A card you answered (an option, Send
// or Reply) greys out under a spinner, below the rest, until the agent takes the answer: its pane works again,
// or its question closes. agent-state hears of an answer a few seconds after the pane goes back to work, so until it
// has, what the session asked before your answer raises no card of its own (shared "omo.queue.answered": when you
// last answered each session).
//
// Which panes need you is omo-status's own state (shared "omo.list", from the hidden omo-tmux copy), so a
// card goes once you look at its pane, however you got there, and the pane Herdr shows gets none.
// Questions with their options, titles and replies come from agent-state (127.0.0.1:4747, through the
// board tunnel), matched by omo session id, which names each omo pane's transcript (@omo_transcript).
// Answers go through agent-state's
// reply route to the session's board extension, the path Telegram replies take: the answer to an open
// question, else the next prompt, or a steer while it works.
//
// Like jobs-tmux, a hidden copy beside the status bar (props {headless: true}) does the reading, the moment
// omo.list changes and every 5 s, and publishes shared "omo.queue" ({items, problem}); the column only
// draws. The hidden copy shows the column (layout.show) when a card it hasn't shown before arrives, and
// hides it when the queue empties. Cmd+Shift+J and the status bar's queue chip toggle it. Seen adds the
// card to shared "omo.queue.dismissed", so it goes at once, and a new state of that pane comes back.
//
// The pin in a card's header keeps the card in the queue, in a Pinned group below the rest, until you unpin it or
// answer it from here: shared "omo.queue.pinned" keeps the cards as they were when pinned, and the hidden copy adds
// back those its pane no longer has, marked stale. A pinned card never opens the column, and the column doesn't
// close by itself while one is pinned.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextView, InputState, Input } from "gpui-base";
import { exec, home, appHome, theme, props, settings, shared, setShared, run, readTextFile, layout, window } from "herdr";
import { INK, isHud, spinner, display, frame, fill, caps, button as hudButton, title as hudTitle } from "./hud.js";

const SEP = "|^|";
const AGENT_STATE = "http://127.0.0.1:4747";
// The remote servers' Cyberpunk yellow, as in the Agents tree.
const REMOTE = "#fcee0a";
// omo-status's states that need you, and agent-state's blocked sessions. Rank 2 comes first.
const KINDS = {
  input: { label: "NEEDS YOU", tone: "accent", rank: 2 },
  error: { label: "FAILED", tone: "ansi1", rank: 2 },
  blocked: { label: "BLOCKED", tone: "blocked", rank: 2 },
  done: { label: "FINISHED", tone: "done", rank: 1 },
  partial: { label: "STEP DONE", tone: "done", rank: 1 },
};
const GENERIC = new Set(["bun", "node", "omo", "zsh", "bash", "fish", "sh", "mosh-client", "ssh"]);
// A reply longer than this is cut: shared values are kept on disk.
const MAX_TEXT = 20000;
// A read that hasn't come back in this long is left behind for a new one.
const STALL = 60000;
const omoStatus = () => `${home()}/.local/bin/omo-status`;
const mono = () => settings().font_family ?? "JetBrains Mono";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// Element backgrounds take one colour, so a gradient is drawn as steps between two #rrggbb colours.
function mix(a, b, f) {
  const at = (c, i) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(at(a, i) + (at(b, i) - at(a, i)) * f).toString(16).padStart(2, "0")).join("");
}
const steps = (a, b, n) => Array.from({ length: n }, (_, i) => div().flex_1().h_full().bg(mix(a, b, i / (n - 1))));

// Text and marks on a solid fill (chips, Send buttons) take the theme's background without its alpha: a
// see-through layout (netrunner's frosted glass) clears that colour, which would leave them invisible.
const solid = (c) => (typeof c === "string" && c.length === 9 ? c.slice(0, 7) : c);

const pad = (n) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
// A time of day on the 24-hour clock, with the date in front when it isn't today: "14:32", "27 Nov 14:32".
function stamp(ms, now) {
  const d = new Date(ms);
  return d.toDateString() === new Date(now).toDateString() ? hm(d) : `${d.getDate()} ${MONTHS[d.getMonth()]} ${hm(d)}`;
}
// The whole of it, for tooltips: "Fri 28 Nov, 14:32:05".
function fullStamp(ms) {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${hm(d)}:${pad(d.getSeconds())}`;
}
// Time left: "4:05", "23:41", "1:02:09".
function clock(ms) {
  const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// What a card's countdown runs to: omo stops waiting on a question and the agent goes on without your answer ("carry")
// or, for a required one, leaves the action it gates undone and ends its turn ("pause"); or a scheduled wake-up ("resume").
const gated = (c) => (c.what ? `"${c.what}"` : "what this decides");
const FUSE = {
  carry: { label: "Carries on in", then: () => "Unanswered, it goes on with its own call.", over: () => "Time's up: it goes on without your answer." },
  pause: {
    label: "Pauses in", then: (c) => `Unanswered, it leaves ${gated(c)} undone and stops.`,
    over: (c) => `Time's up: it stops, leaving ${gated(c)} undone.`,
  },
  resume: { label: "Resumes in", then: () => "A wake-up is scheduled: it picks up by itself.", over: () => "Its wake-up is due: it picks up by itself." },
};
// netrunner's HUD draws the countdown as a row of cells going dark.
const CELLS = 30;

// What a card counts down to, if anything: omo giving up on the soonest of its open questions (from when it was asked),
// else the session's scheduled wake-up (from when the card joined the queue).
function countdownOf(it) {
  const q = (it.questions ?? []).filter((x) => x.deadlineAt).sort((a, b) => a.deadlineAt - b.deadlineAt)[0];
  if (q) return { from: q.askedAt, to: q.deadlineAt, then: q.required ? "pause" : "carry", what: q.header || null };
  return it.resumeAt > it.since ? { from: it.since, to: it.resumeAt, then: "resume", what: null } : null;
}

// omo-status list: pane, session, window, folder, state, since, wake-up, message. Another machine's pane
// and session carry its name in front ("server/%3", "server/work").
function parse(out) {
  const panes = [];
  for (const line of (out ?? "").split("\n")) {
    const [pane, session = "", win = "", path = "", state, since, , ...msg] = line.split(SEP);
    if (!pane || !KINDS[state]) continue;
    const machine = pane.includes("/") ? pane.split("/")[0] : "";
    panes.push({
      pane, machine, state, window: win, msg: msg.join(SEP),
      session: machine && session.startsWith(`${machine}/`) ? session.slice(machine.length + 1) : session,
      project: path.split("/").filter(Boolean).pop() ?? "~", since: Number(since) * 1000 || Date.now(),
    });
  }
  return panes;
}

// omo names a transcript <time>_<session id>.jsonl.
const sidOf = (path) => path.split("/").pop().replace(/\.jsonl$/, "").split("_").pop();

// What a reply says to you: the "For you:" part of omo's handoff block (Ask, For you, Now, Next), else
// its opening paragraphs.
function summaryOf(text) {
  const all = (text ?? "").trim();
  const forYou = all.match(/For you:\s*([\s\S]*?)(?=\s*\bNow:|\n\s*\n|$)/)?.[1]?.trim();
  if (forYou) return forYou;
  let out = "";
  for (const para of all.split(/\n\s*\n/)) {
    if (out && out.length + para.length > 700) break;
    out = out ? `${out}\n\n${para}` : para;
  }
  return out;
}

// The questions open in an agent-state session, each {header?, question, multiSelect?, options, askedAt, deadlineAt?,
// required?} (older collectors leave the last two out).
const questionsOf = (d) => (d.openQuestions ?? []).flatMap((q) =>
  (q.items?.length ? q.items : q.questions.map((question) => ({ question, options: [] })))
    .map((item) => ({ ...item, askedAt: q.askedAt, deadlineAt: q.deadlineAt, required: q.required })));

// The preview's cache key, so a diagram either of them drew is drawn once.
function hash(text) {
  let a = 5381, b = 52711;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = ((a << 5) + a + c) >>> 0;
    b = ((b << 5) ^ b ^ c) >>> 0;
  }
  return a.toString(16) + b.toString(16);
}

// Markdown cut at its Mermaid fences: [{type: "md" | "mermaid", text}]. Other fences stay in the prose,
// which TextView draws as code.
function splitMermaid(text) {
  const lines = text.split("\n"), out = [];
  let prose = [];
  const flush = () => { if (prose.join("").trim()) out.push({ type: "md", text: prose.join("\n") }); prose = []; };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/);
    if (!m) { prose.push(lines[i]); continue; }
    const close = new RegExp(`^ {0,3}${m[1][0] === "`" ? "`" : "~"}{${m[1].length},}\\s*$`), body = [];
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) body.push(lines[j++]);
    if (m[2].toLowerCase() === "mermaid") {
      flush();
      out.push({ type: "mermaid", text: body.join("\n") });
    } else {
      prose.push(...lines.slice(i, j + 1));
    }
    i = j;
  }
  flush();
  return out;
}

const cacheRoot = () => `${appHome()}/preview-cache`;
const rel = (abs) => abs.slice(appHome().length + 1);
const sh = (cmd, args, timeout) => exec(cmd, args, timeout ? { timeout } : {}).catch(() => ({ code: -1, stdout: "", stderr: "cannot run" }));

// Mermaid drawn by herdr-render (~/.local/bin, through bun) as the preview draws it, once per diagram and
// background: {<code>: {src, dims} | {error}}. A diagram Mermaid can't parse keeps its error.
async function renderMermaid(codes) {
  const bg = String(theme().background ?? "#0a0a14"), out = {}, todo = [];
  for (const code of codes) {
    const key = `mm-${hash(`${bg}\n${code}`)}`, png = `${cacheRoot()}/${key}.png`, json = `${cacheRoot()}/${key}.json`;
    try {
      const d = JSON.parse(await readTextFile(json));
      if (d) { out[code] = d.error ? { error: d.error } : { src: rel(png), dims: { w: d.w, h: d.h } }; continue; }
    } catch {}
    todo.push({ code, key, png, json });
  }
  if (!todo.length) return out;
  const src = `${cacheRoot()}/mm-src`;
  await sh("mkdir", ["-p", src]);
  await Promise.all(todo.map((x) => sh("sh", ["-c", 'printf %s "$2" > "$1"', "_", `${src}/${x.key}.mmd`, x.code])));
  // The first diagram ever installs Mermaid, which takes a minute.
  const r = await sh(`${home()}/.bun/bin/bun`, [`${home()}/.local/bin/herdr-render`, "mermaid", cacheRoot(), bg, ...todo.map((x) => `${src}/${x.key}.mmd`)], 180000);
  let results = null;
  try { results = r.code === 0 ? JSON.parse(r.stdout) : null; } catch {}
  for (const [i, x] of todo.entries()) {
    const d = results?.[i];
    if (!d) { out[x.code] = { error: r.stderr.trim().split("\n").pop() || "herdr-render could not run" }; continue; }
    out[x.code] = d.error ? { error: d.error } : { src: rel(x.png), dims: { w: d.w, h: d.h } };
    sh("sh", ["-c", 'printf %s "$2" > "$1"', "_", x.json, JSON.stringify(d.error ? { error: d.error } : { w: d.w, h: d.h })]);
  }
  sh("rm", ["-rf", src]);
  return out;
}

export default class PriorityQueue extends View {
  init(_props, cx) {
    this.headless = Boolean(props()?.headless);
    if (this.headless) {
      this.sessions = [];
      this.etag = null;
      this.problem = null;
      // pane -> {since, sid}: the omo session in it, looked up again when its state changes.
      this.sids = new Map();
      // session id -> what its card shows, read again when the session's lastActivity moves.
      this.details = new Map();
      // Cards that already opened the column (or that you were looking at): they don't open it again.
      this.opened = new Set(JSON.parse(localStorage.getItem("opened") ?? "[]"));
      this.hadItems = false;
      cx.timer.every(5000, (cx) => this.refresh(cx));
      return;
    }
    this.expanded = new Set();
    this.picks = new Map();
    this.status = new Map();
    // card key -> {at, kind, questions, text}: answers sent or on their way, whose cards hold until the agent takes them.
    this.answered = new Map();
    this.replyTo = null;
    this.width = 440;
    this.diagrams = {};
    this.drawing = new Set();
    this.split = new Map();
    this.input = InputState.new({ placeholder: "Type a reply, Enter sends" });
    this.input.on("submit", (_e, cx) => this.sendTyped(cx));
    // The ages on the cards move on, and a countdown each second while one shows (render sets ticking).
    this.ticks = 0;
    cx.timer.every(1000, (cx) => { if (this.ticking || ++this.ticks % 30 === 0) cx.notify(); });
  }

  // A change while a read runs reads again in the same task: a task started by one that is ending is dropped.
  // No one read can stop the queue: one that fails keeps the cards there were and says why, and one that hasn't
  // come back in a minute (a call that never settles, or a task Herdr dropped) is left behind, its late answer
  // ignored.
  refresh(cx) {
    if (this.busy && Date.now() - this.busy < STALL) { this.again = true; return; }
    const run = (this.run ?? 0) + 1;
    this.run = run;
    cx.spawn(async () => {
      do {
        this.again = false;
        this.busy = Date.now();
        try {
          const queue = await this.read();
          if (this.run !== run) return;
          this.publish(queue);
        } catch (e) {
          if (this.run !== run) return;
          this.problem = `The queue couldn't read what needs you: ${e?.message ?? e}`;
          this.publish(shared("omo.queue")?.items ?? []);
        }
      } while (this.again);
      this.busy = 0;
    });
  }

  publish(queue) {
    const next = { items: queue, problem: this.problem };
    if (JSON.stringify(shared("omo.queue") ?? null) !== JSON.stringify(next)) setShared("omo.queue", next);
    this.steer(queue);
  }

  async read() {
    const w = shared("tmux.where");
    const looking = window()?.active && w?.tmux && w.pane ? (w.on ? `${w.on}/${w.pane}` : w.pane) : null;
    const panes = parse(shared("omo.list")?.out);
    await this.matchSessions(panes);
    await this.readSessions();
    // omo-status sets a pane working the moment its question is answered; agent-state takes a few seconds more to
    // hear it, and holds the session blocked on the question until then. So a block that began before your last
    // answer to the session raises no card, and its questions from before then make no other card a question: the
    // card you answered holds them until the agent takes the answer (release).
    const answeredAt = new Map((shared("omo.queue.answered") ?? []).map((a) => [a.sid, a.at]));
    const bySid = new Map(this.sessions.map((s) => [s.sid, s]));
    const items = [], covered = new Set();
    for (const p of panes) {
      const sid = this.sids.get(p.pane)?.sid, s = sid ? bySid.get(sid) : null;
      if (s) covered.add(s.sid);
      items.push({
        key: `${p.pane}|${p.state}|${p.since}`, kind: p.state, pane: p.pane, machine: p.machine, session: p.session,
        window: p.window, project: p.project, since: p.since, msg: p.msg, sid: s?.sid ?? null, at: s?.machine ?? null,
        name: s?.name ?? null, resumeAt: s?.resumeAt ?? null, looking: p.pane === looking,
      });
    }
    for (const s of this.sessions) {
      if (s.lifecycle !== "blocked" || covered.has(s.sid) || s.lifecycleSince < (answeredAt.get(s.sid) ?? 0)) continue;
      // agent-state can hold a Herdr tab's grouped session ("work~12:1.1"): its window is the same in the session it stands for.
      const target = s.tmux?.replace(/~\d+(?=:|$)/, "") ?? null;
      items.push({
        key: `${s.machine}/${s.sid}|blocked|${s.lifecycleSince}`, kind: "blocked", pane: null, machine: s.machine === "mac" ? "" : s.machine,
        session: target?.split(":")[0] ?? null, window: null, project: s.project ?? "", since: s.lifecycleSince ?? s.lastActivity,
        msg: s.needsDavid ?? "", sid: s.sid, at: s.machine, name: s.name ?? null, tmux: target, host: s.host ?? null,
        resumeAt: s.resumeAt ?? null, looking: false,
      });
    }
    for (const it of items) {
      if (!it.sid) continue;
      const activity = bySid.get(it.sid)?.lastActivity;
      let d = this.details.get(it.sid);
      if (d?.activity !== activity) {
        const r = await sh("curl", ["-s", "-m", "5", `${AGENT_STATE}/api/sessions/${encodeURIComponent(it.at)}/${encodeURIComponent(it.sid)}`]);
        try {
          const full = JSON.parse(r.stdout);
          if (full?.sid) {
            d = { activity, name: full.name ?? null, questions: questionsOf(full), reply: (full.lastReply?.text ?? "").slice(0, MAX_TEXT) };
            this.details.set(it.sid, d);
          }
        } catch {}
      }
      if (d) {
        const before = answeredAt.get(it.sid) ?? 0;
        const questions = it.kind === "input" ? d.questions : d.questions.filter((q) => !(q.askedAt < before));
        Object.assign(it, { name: d.name ?? it.name, questions, reply: d.reply, summary: summaryOf(d.reply) });
      }
      // A question still open is what the card is about, whatever the pane says: omo-status can call a pane done
      // once its turn ends after asking without holding the turn, or a blocked session can be waiting on one.
      if (it.questions?.length) it.kind = "input";
    }
    for (const sid of [...this.details.keys()]) if (!items.some((it) => it.sid === sid)) this.details.delete(sid);
    const dismissed = new Set(shared("omo.queue.dismissed") ?? []);
    const shown = items.filter((it) => !dismissed.has(it.key))
      .sort((a, b) => KINDS[b.kind].rank - KINDS[a.kind].rank || a.since - b.since);
    // The pane Herdr shows is in front of you: it gets no card, and won't open the column later.
    for (const it of shown) if (it.looking) this.opened.add(it.key);
    const live = shown.filter((it) => !it.looking), keys = new Set(live.map((it) => it.key));
    const pins = shared("omo.queue.pinned") ?? [], pinned = new Set(pins.map((p) => p.key));
    return [...live.map((it) => (pinned.has(it.key) ? { ...it, pinned: true } : it)),
      ...pins.filter((p) => !keys.has(p.key)).map((p) => ({ ...p, pinned: true, stale: true }))];
  }

  // The omo session id in each queued pane, from its transcript's name: one tmux listing per machine.
  async matchSessions(panes) {
    const want = panes.filter((p) => this.sids.get(p.pane)?.since !== p.since);
    for (const machine of new Set(want.map((p) => p.machine))) {
      const args = ["-u", "list-panes", "-a", "-F", `#{pane_id}${SEP}#{@omo_transcript}`];
      const r = await exec(machine ? "tmux" : "/opt/homebrew/bin/tmux", args, machine ? { on: machine, timeout: 10000 } : {}).catch(() => null);
      if (r?.code !== 0) continue;
      const found = new Map();
      for (const line of r.stdout.split("\n")) {
        const [id, transcript] = line.split(SEP);
        if (id && transcript) found.set(machine ? `${machine}/${id}` : id, sidOf(transcript));
      }
      for (const p of want) if (p.machine === machine) this.sids.set(p.pane, { since: p.since, sid: found.get(p.pane) ?? null });
    }
    for (const pane of [...this.sids.keys()]) if (!panes.some((p) => p.pane === pane)) this.sids.delete(pane);
  }

  // Live sessions, compact (no transcripts). curl rather than fetch: the ETag is how agent-state says
  // "unchanged" (a 304 with no body), and fetch doesn't expose headers.
  async readSessions() {
    try {
      const args = ["-s", "-m", "5", "-D", "/dev/stderr", `${AGENT_STATE}/api/sessions?alive=1&compact=1`];
      if (this.etag) args.unshift("-H", `If-None-Match: ${this.etag}`);
      const r = await exec("curl", args);
      const status = Number(r.stderr.match(/^HTTP\/[\d.]+ (\d{3})/m)?.[1] ?? 0);
      if (r.code !== 0 || !status) throw new Error("agent-state didn't answer, so questions and replies are missing. Is the board tunnel up?");
      if (status === 200) {
        this.sessions = JSON.parse(r.stdout);
        this.etag = r.stderr.match(/^etag:\s*(\S+)/im)?.[1] ?? null;
      } else if (status !== 304) {
        throw new Error(`agent-state answered ${status}, so questions and replies are missing.`);
      }
      this.problem = null;
    } catch (e) {
      this.problem = `${e?.message ?? e}`;
    }
  }

  // Shows the column for a card it hasn't shown before; hides it when the last card goes.
  steer(items) {
    const block = find(layout(), "queue");
    const fresh = items.filter((it) => !it.pinned && !this.opened.has(it.key));
    for (const it of fresh) this.opened.add(it.key);
    this.opened = new Set([...this.opened].slice(-300));
    localStorage.setItem("opened", JSON.stringify([...this.opened]));
    if (block && fresh.length && block.hidden) run("layout.show", { id: "queue" });
    else if (block && !items.length && this.hadItems && !block.hidden) run("layout.hide", { id: "queue" });
    this.hadItems = items.length > 0;
  }

  // Markdown in parts, kept per text: splitting a long reply on every draw would cost.
  parts(text) {
    let segs = this.split.get(text);
    if (!segs) {
      if (this.split.size > 60) this.split.clear();
      segs = splitMermaid(text);
      this.split.set(text, segs);
    }
    return segs;
  }

  wantDiagrams(items, cx) {
    const codes = new Set();
    for (const it of items) {
      for (const text of [it.reply, it.msg, ...(it.questions ?? []).map((q) => q.question)]) {
        for (const s of this.parts(text ?? "")) if (s.type === "mermaid") codes.add(s.text);
      }
    }
    const todo = [...codes].filter((c) => !(c in this.diagrams) && !this.drawing.has(c));
    if (!todo.length) return;
    for (const c of todo) this.drawing.add(c);
    cx.spawn(async (cx) => {
      Object.assign(this.diagrams, await renderMermaid(todo));
      for (const c of todo) this.drawing.delete(c);
      cx.notify();
    });
  }

  goTo(it, cx) {
    cx.spawn(async (cx) => {
      const args = it.pane ? ["show", it.pane, "exact"] : ["open", it.tmux, it.host ?? ""];
      const r = await exec(omoStatus(), args).catch((e) => ({ code: -1, stderr: String(e?.message ?? e) }));
      if (r.code !== 0) {
        this.status.set(it.key, r.stderr.trim() || `omo-status ${args[0]} failed`);
        cx.notify();
      }
    });
  }

  seen(it, cx) {
    setShared("omo.queue.dismissed", [...(shared("omo.queue.dismissed") ?? []), it.key].slice(-200));
    if (it.pane) cx.spawn(async () => { await exec(omoStatus(), ["ack", it.pane]).catch(() => null); });
  }

  reply(it, text, cx) {
    if (!it.sid || !it.at || !text.trim()) return;
    // A second click while the answer is on its way, or once it went, would send it twice.
    if (this.answered.has(it.key)) return;
    const answer = { sid: it.sid, at: Date.now() };
    this.answered.set(it.key, { at: answer.at, kind: it.kind, questions: it.questions?.length ?? 0, text: text.trim() });
    setShared("omo.queue.answered", [...(shared("omo.queue.answered") ?? []), answer].slice(-100));
    this.status.set(it.key, "sending");
    cx.notify();
    cx.spawn(async (cx) => {
      const url = `${AGENT_STATE}/api/sessions/${encodeURIComponent(it.at)}/${encodeURIComponent(it.sid)}/reply`;
      const r = await exec("curl", ["-s", "-m", "15", "-X", "POST", "-H", "content-type: application/json", "-H", "x-agent-state-intent: reply",
        "--data-binary", JSON.stringify({ text: text.trim() }), url]).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
      let res = null;
      try { res = JSON.parse(r.stdout); } catch {}
      this.status.set(it.key, res?.ok ? "sent" : res?.error ?? (r.stderr.trim() || "agent-state didn't answer"));
      // An answer is the card handled, so its pin goes.
      if (res?.ok) this.unpin(it.key);
      else {
        this.answered.delete(it.key);
        setShared("omo.queue.answered", (shared("omo.queue.answered") ?? []).filter((a) => a.sid !== answer.sid || a.at !== answer.at));
      }
      cx.notify();
    });
  }

  // An answer the agent took lets its card go: the card left the queue (its pane works again), or its question
  // closed (the session's board extension answered it, and agent-state heard) and the card fell back to what its
  // pane says. A Seen rather than waiting, as that pane state was there before the answer.
  release(items, cx) {
    for (const key of [...this.answered.keys()]) {
      if (!items.some((it) => it.key === key)) { this.answered.delete(key); this.status.delete(key); }
    }
    for (const it of items) {
      const sent = this.answered.get(it.key);
      if (!sent || sent.taken || this.status.get(it.key) !== "sent") continue;
      if (it.kind === sent.kind && !(sent.questions && !it.questions?.length)) continue;
      sent.taken = true;
      cx.spawn(async () => this.seen({ ...it, pane: null }, cx));
    }
  }

  openReply(it, cx) {
    this.replyTo = this.replyTo === it.key ? null : it.key;
    this.input.set_value("");
    if (this.replyTo) this.input.focus();
    cx.notify();
  }

  // The box's text, with the card's picks when it has any: the picks first, the text as a comment on them.
  sendTyped(cx) {
    const it = (shared("omo.queue")?.items ?? []).find((x) => x.key === this.replyTo);
    const text = this.input.value().trim(), picks = it ? this.answerOf(it) : "";
    if (!it || !(text || picks)) return;
    this.reply(it, picks && text ? `${picks}\n\nComment: ${text}` : picks || text, cx);
    this.input.set_value("");
    this.replyTo = null;
  }

  // A pin keeps the card as it is now, whatever its pane does next.
  togglePin(it) {
    const pins = shared("omo.queue.pinned") ?? [];
    if (pins.some((p) => p.key === it.key)) return this.unpin(it.key);
    const card = { ...it };
    delete card.looking; delete card.pinned; delete card.stale;
    setShared("omo.queue.pinned", [...pins, card].slice(-30));
  }

  unpin(key) {
    const pins = shared("omo.queue.pinned") ?? [];
    if (pins.some((p) => p.key === key)) setShared("omo.queue.pinned", pins.filter((p) => p.key !== key));
  }

  pick(it, qi, label, multi, cx) {
    const picks = { ...(this.picks.get(it.key) ?? {}) };
    const now = picks[qi] ?? [];
    picks[qi] = multi ? (now.includes(label) ? now.filter((x) => x !== label) : [...now, label]) : now[0] === label ? [] : [label];
    this.picks.set(it.key, picks);
    cx.notify();
  }

  // The picks as one answer: the labels, and with several questions each one's header or question first.
  answerOf(it) {
    const qs = it.questions ?? [], picks = this.picks.get(it.key) ?? {};
    if (qs.length === 1) return (picks[0] ?? []).join(", ");
    return qs.map((q, i) => (picks[i]?.length ? `${q.header || q.question}: ${picks[i].join(", ")}` : null)).filter(Boolean).join("\n");
  }

  markdown(t, id, text) {
    const md = (key, s) => TextView.markdown(key, s).selectable().w_full().text_size(12.5);
    const segs = this.parts(text ?? "");
    if (segs.length === 1 && segs[0].type === "md") return md(id, segs[0].text);
    return v_flex().w_full().gap(8).children(segs.map((s, i) => (s.type === "md" ? md(`${id}:${i}`, s.text) : this.diagram(t, `${id}:${i}`, s.text))));
  }

  // A Mermaid picture, never wider than the card; its source and Mermaid's error when it can't be drawn.
  diagram(t, id, code) {
    const d = this.diagrams[code];
    if (d?.src) {
      const f = Math.min(1, Math.max(120, this.width - 64) / d.dims.w);
      return h_flex().id(id).w_full().justify_center().child(div().overflow_hidden().child(image(d.src).w(d.dims.w * f).h(d.dims.h * f)));
    }
    if (d?.error) {
      return v_flex().id(id).w_full().gap(4)
        .child(TextView.markdown(`${id}:src`, "```\n" + code + "\n```").w_full().text_size(12))
        .child(div().text_size(11).text_color(t.dim).child(`Mermaid couldn't draw this: ${d.error}`));
    }
    return div().id(id).py(6).font_family(mono()).text_size(10.5).text_color(t.dim).child("DRAWING DIAGRAM\u2026");
  }

  question(t, it, q, qi, count) {
    const chosen = this.picks.get(it.key)?.[qi] ?? [];
    const known = Boolean(it.sid && it.at), can = known && !this.answered.has(it.key);
    // One question with one answer sends on a click, unless the comment box is open to go with it.
    const now = count === 1 && !q.multiSelect && this.replyTo !== it.key;
    return v_flex().gap(6)
      .when(Boolean(q.header), (el) => el.child(this.hud ? caps(q.header, 12, 700).text_color(t.dim)
        : div().font_family(mono()).text_size(10).font_bold().text_color(t.dim).child(q.header.toUpperCase())))
      .child(this.markdown(t, `q-${it.key}-${qi}`, q.question))
      .children((q.options ?? []).map((o, oi) => {
        const on = chosen.includes(o.label);
        return v_flex().id(`opt-${it.key}-${qi}-${oi}`).px(10).py(6).gap(2)
          .when(!this.hud, (el) => el.border_1().border_color(on ? t.accent : t.border).bg(on ? t.accent + "1f" : t.background))
          .when(this.hud, (el) => el.relative().children(frame(6, { bg: on ? t.accent + "1f" : t.accent + "08", line: on ? t.accent : t.accent + "4d" })))
          .when(can, (el) => el.cursor_pointer().hover((s) => (this.hud ? s.bg(t.accent + "0d") : s.border_color(t.accent + "b3").bg(t.accent + "14")))
            .on_click((_e, cx) => {
              if (!now) return this.pick(it, qi, o.label, q.multiSelect, cx);
              // The option stays marked on the answered card.
              this.picks.set(it.key, { [qi]: [o.label] });
              this.reply(it, o.label, cx);
            }))
          .when(!known, (el) => el.tooltip("agent-state doesn't know this session: answer it in its pane"))
          .child(h_flex().gap(7).items_center()
            .when(!now, (el) => el.child(div().size(10).flex_none().rounded(this.hud ? 0 : q.multiSelect ? 2 : 5).border(1.5).border_color(on ? t.accent : t.dim).when(on, (e) => e.bg(t.accent))))
            .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child(o.label)))
          .when(Boolean(o.description), (el) => el.child(div().text_size(11.5).line_height(1.4).text_color(t.muted).child(o.description)));
      }));
  }

  body(t, it) {
    if (it.kind === "input" || (it.kind === "blocked" && it.questions?.length)) {
      const qs = it.questions?.length ? it.questions : [{ question: it.msg.replace(/^Needs your input:\s*/, "") || "It's waiting for you.", options: [] }];
      const answer = this.answerOf(it);
      return v_flex().gap(14)
        .children(qs.map((q, i) => this.question(t, it, q, i, qs.length)))
        .when(Boolean(answer) && (qs.length > 1 || qs[0].multiSelect) && !this.answered.has(it.key) && this.replyTo !== it.key, (el) => el.child(h_flex()
          .child((this.hud ? hudButton(t, `picks-${it.key}`, "Send answer", { on: true, h: 26 })
            : div().id(`picks-${it.key}`).px(10).h(26).flex().items_center().bg(t.accent).text_color(solid(t.background))
              .font_family(mono()).text_size(10.5).font_bold().cursor_pointer().hover((s) => s.opacity(0.85)).child("SEND ANSWER"))
            .tooltip(answer).on_click((_e, cx) => this.reply(it, answer, cx)))));
    }
    if (it.kind === "blocked") return this.markdown(t, `b-${it.key}`, it.msg || "Blocked.");
    const summary = it.summary || it.msg;
    const more = Boolean(it.reply) && it.reply.trim() !== summary.trim();
    const open = this.expanded.has(it.key);
    return v_flex().gap(8)
      .when(it.kind === "partial" || it.kind === "error", (el) => el.child(div().font_family(mono()).text_size(10.5).line_height(1.4).text_color(it.kind === "error" ? t.ansi1 : t.dim).child(it.msg)))
      .when(Boolean(summary), (el) => el.child(this.markdown(t, `${open ? "r" : "s"}-${it.key}`, open ? it.reply : summary)))
      .when(more, (el) => el.child(div().id(`more-${it.key}`).font_family(mono()).text_size(10.5).font_bold().text_color(t.working).cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { open ? this.expanded.delete(it.key) : this.expanded.add(it.key); cx.notify(); })
        .child(open ? "\u25b4 SUMMARY ONLY" : "\u25be FULL REPLY")));
  }

  button(t, id, label, icon, tip, onClick, tone) {
    if (this.hud) return hudButton(t, id, label, { tone, icon: svg(`mods/workspace-chrome/${icon}.svg`).size(12).relative() })
      .tooltip(tip).on_click((_e, cx) => onClick(cx));
    return h_flex().id(id).px(8).h(24).gap(5).flex_none().items_center().border_1().border_color(t.border).bg(t.background)
      .font_family(mono()).text_size(10.5).font_bold().text_color(tone ?? t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click((_e, cx) => onClick(cx))
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(12))
      .child(label);
  }

  actions(t, it) {
    const st = this.status.get(it.key), held = this.answered.has(it.key);
    const canReply = Boolean(it.sid && it.at) && !held;
    const options = Boolean(it.questions?.some((q) => q.options?.length));
    return h_flex().gap(6).items_center().pt(2)
      .when(Boolean(it.pane || it.tmux), (el) => el.child(this.button(t, `go-${it.key}`, "GO TO", "terminal", "Show this pane in Herdr", (cx) => this.goTo(it, cx))))
      .when(it.kind !== "input" && !held && !it.stale, (el) => el.child(this.button(t, `seen-${it.key}`, "SEEN", "check",
        it.pane ? "Clear it, as looking at the pane would" : "Hide it until it changes", (cx) => this.seen(it, cx), t.done)))
      .when(canReply, (el) => el.child(this.button(t, `reply-${it.key}`, options ? "COMMENT" : "REPLY", "square-pen",
        options ? "Add a comment to your picks, or type your own answer"
          : it.kind === "input" ? "Type your own answer" : "Send it a message: the next prompt, or a steer while it works", (cx) => this.openReply(it, cx))))
      .child(div().flex_1())
      .when(Boolean(st) && !held, (el) => el.child(div().min_w(0).truncate().font_family(mono()).text_size(10.5)
        .text_color(t.ansi1).tooltip(st).child(st)));
  }

  // On an answered card, above the greyed-out rest: what you answered, and that the agent hasn't taken it yet.
  heldNote(t, it, sent, now) {
    const said = sent.text.replace(/\s*\n\s*/g, " \u00b7 ");
    return v_flex().gap(4).px(10).py(7)
      .when(!this.hud, (el) => el.border_1().border_color(t.working + "4d").bg(t.working + "0f"))
      .when(this.hud, (el) => el.relative().children(frame(6, { bg: t.working + "0f", line: t.working + "80" })))
      .child(h_flex().gap(7).items_center().font_family(mono()).text_size(10.5).font_bold().text_color(t.working)
        .child(this.hud ? spinner(t.working, 12, 900) : svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900))
        .child(div().flex_1().min_w(0).truncate()
          .child(this.status.get(it.key) === "sending" ? "SENDING YOUR ANSWER\u2026" : "ANSWERED \u00b7 WAITING FOR THE AGENT"))
        .child(div().flex_none().font_normal().text_color(t.dim).child(ago(now - sent.at))))
      .child(div().text_size(11.5).line_height(1.4).text_color(t.muted).child(said.length > 240 ? `${said.slice(0, 239)}\u2026` : said));
  }

  // The reply box; on a question with options, a line over it says what goes with the text.
  replyBox(t, it) {
    const options = it.questions?.some((q) => q.options?.length), picks = options ? this.answerOf(it) : "";
    const box = this.typeBox(t, it);
    if (!options) return box;
    return v_flex().gap(5)
      .child(div().text_size(11).line_height(1.4).text_color(t.dim)
        .child(picks ? `Goes with your picks: ${picks.replace(/\n/g, " \u00b7 ")}` : "Pick options above to send them with your comment, or type your own answer."))
      .child(box);
  }

  typeBox(t, it) {
    return h_flex().h(34).pl(10).pr(4).gap(6).items_center()
      .when(!this.hud, (el) => el.border_1().border_color(t.accent + "b3").bg(t.background))
      .when(this.hud, (el) => el.relative().children(frame(6, { bg: t.accent + "0d", line: t.accent + "b3" })))
      .child(Input.new(this.input).flex_1().h_full().text_size(12.5).text_color(t.foreground))
      .child((this.hud ? hudButton(t, `send-${it.key}`, "Send", { on: true, h: 24 })
        : div().id(`send-${it.key}`).px(8).h(24).flex().flex_none().items_center().bg(t.accent).text_color(solid(t.background))
          .font_family(mono()).text_size(10.5).font_bold().cursor_pointer().hover((s) => s.opacity(0.85)).child("SEND"))
        .on_click((_e, cx) => this.sendTyped(cx)));
  }

  // A card is a block in its session's colour, as the session is in the Agents tree: a band of it across
  // the top holding the kind in a solid chip, a lighter wash of it below, and an edge of it down the left.
  // Without a session colour the kind's stands in. Cards that need you are outlined in the kind's colour. An
  // answered card goes grey, with a note of the answer under a spinner, until the agent takes it (release).
  card(t, it, now) {
    const kind = KINDS[it.kind], tone = t[kind.tone] ?? t.accent;
    const tint = it.session ? shared("tmux.tints")?.[it.machine ? `${it.machine}/${it.session}` : it.session] ?? null : null;
    const sent = this.answered.get(it.key);
    const band = (tint ?? tone).slice(0, 7), urgent = kind.rank === 2 && !sent && !this.pinned.has(it.key);
    const title = it.name || it.project || "omo";
    // The header names the session, so a project of the same name isn't repeated.
    const where = [it.project !== title && it.project !== it.session ? it.project : null, it.window && !GENERIC.has(it.window) && it.window !== it.project && it.window !== title ? it.window : null]
      .filter(Boolean).join(" \u00b7 ");
    if (this.hud) return this.hudCard(t, it, now, { kind, tone, band, urgent, title, where, sent });
    return v_flex().id(`card-${it.key}`).flex_none().overflow_hidden().bg(t.chrome).border_1().border_color(urgent ? tone : band + "59")
      .child(h_flex().id(`head-${it.key}`).h(28).flex_none().pr(10).gap(8).items_center().bg(sent ? t.dim.slice(0, 7) + "26" : band + "40").font_family(mono()).text_size(10.5)
        .when(Boolean(it.pane || it.tmux), (el) => el.cursor_pointer().tooltip("Show it in Herdr").on_click((_e, cx) => this.goTo(it, cx)))
        .child(h_flex().h_full().px(8).gap(6).flex_none().items_center().bg(sent ? t.muted : tone).text_color(solid(t.background)).font_bold()
          .when(urgent, (el) => el.child(div().size(6).bg(solid(t.background)).loop("opacity", { from: 0.3, to: 1, period: 1400 })))
          .child(sent ? (this.status.get(it.key) === "sending" ? "SENDING" : "ANSWERED") : kind.label))
        .when(Boolean(it.session), (el) => el.child(div().min_w(0).truncate().font_semibold().text_color(t.foreground).child(it.session)))
        .when(Boolean(it.machine), (el) => el.child(div().flex_none().text_color(REMOTE).child(it.machine)))
        .child(div().flex_1())
        .child(this.queuedAt(t, it, now))
        .child(this.pinButton(t, it)))
      .child(h_flex().items_stretch().bg(mix(band, "#ffffff", 0.35) + "14")
        .child(div().w(3).flex_none().bg(sent ? band + "66" : band))
        .child(this.inside(t, it, now, title, where, sent)));
  }

  // netrunner's HUD card: a cut-corner frame lined in the session's colour (the kind's while it needs you), the kind as
  // a solid chip with a slanted end, a rule of the session's colour under the header and an edge of it down the left,
  // stopping short of the cut corner.
  hudCard(t, it, now, { kind, tone, band, urgent, title, where, sent }) {
    const C = 10, chip = sent ? t.muted : tone;
    return v_flex().id(`card-${it.key}`).relative().flex_none()
      .children(frame(C, { bg: t.chrome, line: urgent ? tone : band + "99" }))
      .child(h_flex().id(`head-${it.key}`).h(32).flex_none().pl(8).pr(C + 4).gap(8).items_center().border_b(1).border_color(band + "66")
        .when(Boolean(it.pane || it.tmux), (el) => el.cursor_pointer().tooltip("Show it in Herdr").on_click((_e, cx) => this.goTo(it, cx)))
        .child(h_flex().h(20).flex_none()
          .child(h_flex().h_full().pl(7).pr(3).gap(6).items_center().bg(chip).text_color(INK)
            .when(urgent, (el) => el.child(div().size(6).bg(INK).loop("opacity", { from: 0.3, to: 1, period: 1400 })))
            .child(caps(sent ? (this.status.get(it.key) === "sending" ? "Sending" : "Answered") : kind.label, 12.5, 700)))
          .child(div().relative().w(8).h_full().child(fill([[["0%", "0%"], ["100%", "0%"], ["0%", "100%"]]], chip))))
        .when(Boolean(it.session), (el) => el.child(div().min_w(0).truncate().font_family(display()).font_weight(600).text_size(14.5).text_color(t.foreground).child(it.session)))
        .when(Boolean(it.machine), (el) => el.child(caps(it.machine, 12.5).flex_none().text_color(REMOTE)))
        .child(div().flex_1())
        .child(this.queuedAt(t, it, now))
        .child(this.pinButton(t, it)))
      .child(h_flex().items_stretch()
        .child(div().w(3).mb(C).flex_none().bg(sent ? band + "66" : band))
        .child(this.inside(t, it, now, title, where, sent)));
  }

  // When the card joined the queue, as a time of day (with the date when it isn't today), then how long ago.
  queuedAt(t, it, now) {
    return h_flex().id(`at-${it.key}`).flex_none().gap(4).items_center().font_family(mono()).text_size(10.5)
      .tooltip(`Queued ${fullStamp(it.since)}`)
      .child(div().text_color(t.muted).child(stamp(it.since, now)))
      .child(div().text_color(t.dim).child(`\u00b7 ${ago(now - it.since)}`));
  }

  // A card's countdown (countdownOf), but none once you've answered it, or on a pinned card its pane has moved past.
  countdownFor(it) {
    return this.answered.has(it.key) || it.stale ? null : countdownOf(it);
  }

  // A card's countdown, under its header: how long until the agent stops waiting on you and what it does then, the time it
  // will, and a bar burning down from when it began waiting: cyan, yellow under half, red under a fifth, the clock pulsing
  // in the last minute. The bar slides from one second's value to the next (a 1 s linear width transition); the HUD draws
  // it as a row of cells going dark from the right, the last one lit flickering.
  countdown(t, it, c, now) {
    const left = Math.max(0, c.to - now), f = Math.min(1, left / Math.max(1, c.to - c.from)), lit = Math.ceil(f * CELLS);
    const tone = (f > 0.5 ? t.working : f > 0.2 ? t.blocked : t.ansi1).slice(0, 7), fuse = FUSE[c.then];
    const label = left ? fuse.label : c.then === "resume" ? "Waking up" : "Time's up";
    const tip = c.then === "resume" ? `Its wake-up is due ${fullStamp(c.to)}.`
      : `Asked ${fullStamp(c.from)}. omo stops waiting ${fullStamp(c.to)}; typing in its question box in the pane pushes that back.`;
    return v_flex().id(`fuse-${it.key}`).gap(5).tooltip(tip)
      .child(h_flex().gap(6).items_center()
        .child(svg("mods/workspace-chrome/clock.svg").size(12).flex_none().text_color(tone))
        .child(this.hud ? caps(label, 12.5, 700).flex_none().text_color(tone)
          : div().flex_none().font_family(mono()).text_size(10.5).font_bold().text_color(tone).child(label.toUpperCase()))
        .child(div().flex_none().font_family(mono()).text_size(12.5).font_bold().text_color(tone)
          .when(left > 0 && left <= 60000, (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1000 }))
          .child(clock(left)))
        .child(div().flex_1())
        .child(div().flex_none().font_family(mono()).text_size(10.5).text_color(t.dim).child(`at ${stamp(c.to, now)}`)))
      .child(this.hud
        ? h_flex().h(6).gap(2).children(Array.from({ length: CELLS }, (_, i) => div().flex_1().h_full().bg(i < lit ? tone : tone + "1f")
          .when(i === lit - 1, (el) => el.loop("opacity", { from: 0.4, to: 1, period: 1200 }))))
        : div().h(4).w_full().bg(tone + "26")
          .child(div().h_full().w(`${(f * 100).toFixed(3)}%`).bg(tone).transition("width", { duration: 1000, easing: "linear" })))
      .child(div().text_size(11).line_height(1.4).text_color(t.muted).child(left ? fuse.then(c) : fuse.over(c)));
  }

  // The pin in a card's header, lit while the card is pinned.
  pinButton(t, it) {
    const on = this.pinned.has(it.key);
    return div().id(`pin-${it.key}`).size(20).flex().flex_none().items_center().justify_center().cursor_pointer()
      .when(!this.hud, (el) => el.rounded(4)).hover((s) => s.bg(t.hover))
      .tooltip(on ? "Unpin: it goes once it's handled" : "Pin: keep it in the queue until you unpin it")
      .on_click((_e, cx) => { cx.stop_propagation(); this.togglePin(it); })
      .child(svg("mods/workspace-chrome/pin.svg").size(12).text_color(on ? t.accent : t.dim));
  }

  // The line over the pinned cards.
  pinRule(t, n) {
    return h_flex().id("pinned-rule").flex_none().gap(8).items_center().pt(4)
      .child(svg("mods/workspace-chrome/pin.svg").size(12).flex_none().text_color(t.accent))
      .child(this.hud ? caps(`Pinned \u00b7 ${n}`, 12.5, 700).flex_none().text_color(t.accent)
        : div().flex_none().font_family(mono()).text_size(10.5).font_bold().text_color(t.accent).child(`PINNED \u00b7 ${n}`))
      .child(div().flex_1().h(1).bg(t.accent + "4d"));
  }

  // A card below its header: its countdown, or your answer while it is held, the title and where, the body, actions and
  // reply box.
  inside(t, it, now, title, where, sent) {
    const c = this.countdownFor(it);
    return v_flex().flex_1().min_w(0).px(12).py(10).gap(8)
      .when(Boolean(c), (el) => el.child(this.countdown(t, it, c, now)))
      .when(Boolean(sent), (el) => el.child(this.heldNote(t, it, sent, now)))
      .child(v_flex().gap(8).when(Boolean(sent), (el) => el.opacity(0.45))
        .child(v_flex().gap(1)
          .child(div().truncate().text_size(13.5).font_semibold().text_color(t.foreground)
            .when(this.hud, (el) => el.font_family(display()).text_size(15.5)).child(title))
          .when(Boolean(where), (el) => el.child(div().truncate().font_family(mono()).text_size(10.5).text_color(t.dim).child(where))))
        .child(this.body(t, it)))
      .child(this.actions(t, it))
      .when(this.replyTo === it.key, (el) => el.child(this.replyBox(t, it)));
  }

  render(cx) {
    if (this.headless) {
      // omo's state, a Seen, a pin, or where you are looking changed: read again.
      const w = shared("tmux.where");
      const sig = JSON.stringify([shared("omo.list")?.out ?? null, shared("omo.queue.dismissed") ?? null, shared("omo.queue.pinned") ?? null, w?.on ?? null, w?.pane ?? null, Boolean(window()?.active)]);
      if (sig !== this.sig) { this.sig = sig; this.refresh(cx); }
      return div();
    }
    const t = theme();
    this.hud = isHud();
    const data = shared("omo.queue");
    this.pinned = new Set((shared("omo.queue.pinned") ?? []).map((p) => p.key));
    // Cards you answered go below the ones still waiting on you, and pinned ones below those. A card you unpinned that
    // its pane no longer has goes at once.
    const group = (it) => (this.pinned.has(it.key) ? 2 : this.answered.has(it.key) ? 1 : 0);
    const items = (data?.items ?? []).filter((it) => !it.stale || this.pinned.has(it.key)).sort((a, b) => group(a) - group(b));
    this.release(items, cx);
    this.wantDiagrams(items, cx);
    const now = Date.now();
    const held = items.filter((it) => group(it) === 1).length, pins = items.filter((it) => group(it) === 2).length;
    const needs = items.filter((it) => group(it) === 0 && KINDS[it.kind].rank === 2).length, finished = items.length - needs - held - pins;
    // The column redraws each second while a card counts down, and the soonest countdown goes on the line under the title.
    const clocks = items.map((it) => this.countdownFor(it)).filter(Boolean);
    this.ticking = clocks.length > 0;
    const next = clocks.filter((c) => c.to > now).sort((a, b) => a.to - b.to)[0];
    const count = [needs ? `${needs} need${needs === 1 ? "s" : ""} you` : null,
      next ? `${FUSE[next.then].label.toLowerCase()} ${clock(next.to - now)}` : null, finished ? `${finished} finished` : null, held ? `${held} answered` : null,
      pins ? `${pins} pinned` : null].filter(Boolean).join(" \u00b7 ");
    return v_flex().id("priority-queue").size_full().min_h(0).rounded(this.hud ? 0 : 10).overflow_hidden().bg(t.background).border_1()
      .border_color(needs ? t.accent + "99" : this.hud ? t.accent + "4d" : t.border).text_size(13).text_color(t.foreground)
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 4) { this.width = size.width; cx.notify(); } })
      .child(h_flex().h(3).flex_none().children(steps(t.accent.slice(0, 7), t.working.slice(0, 7), 16)))
      .child(h_flex().h(46).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
        .when(this.hud, (el) => el.child(v_flex().gap(3).min_w(0).child(hudTitle(t, "Priority queue", 17))
          .child(caps(count || "all clear", 12.5).pl(12).text_color(needs ? t.accent : t.dim))))
        .when(!this.hud, (el) => el.child(h_flex().h(22).gap(3).flex_none().items_end().child(div().w(3).h(22).bg(t.accent)).child(div().w(3).h(13).bg(t.working)))
          .child(v_flex().gap(2).min_w(0)
            .child(div().font_family(mono()).text_size(13).font_bold().child("PRIORITY QUEUE"))
            .child(div().font_family(mono()).text_size(10.5).text_color(needs ? t.accent : t.dim).child(count || "all clear"))))
        .child(div().flex_1())
        .child(div().id("queue-hide").size(24).flex().flex_none().items_center().justify_center().rounded(4).cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip("Hide (\u2318\u21e7J)").on_click(() => run("layout.hide", { id: "queue" }))
          .child(svg("mods/workspace-chrome/x.svg").size(13).text_color(t.dim))))
      .when(Boolean(data?.problem), (el) => el.child(div().mx(10).mt(10).px(10).py(7).border_1().border_color(t.blocked + "66").bg(t.blocked + "14")
        .text_size(11.5).line_height(1.4).text_color(t.blocked).child(data.problem)))
      .when(items.length === 0, (el) => el.child(v_flex().flex_1().items_center().justify_center().gap(8).px(24)
        .child(svg("mods/workspace-chrome/circle-check.svg").size(22).text_color(t.done))
        .child(div().text_size(13).text_color(t.muted).child("Nothing needs you."))
        .child(div().text_size(11.5).text_center().text_color(t.dim).child("This column opens when an agent asks you something, fails or finishes."))))
      .when(items.length > 0, (el) => el.child(v_flex().id("queue-list").flex_1().min_h(0).px(10).py(10).gap(10).overflow_y_scrollbar()
        .children(items.flatMap((it, i) => (group(it) === 2 && (i === 0 || group(items[i - 1]) !== 2)
          ? [this.pinRule(t, pins), this.card(t, it, now)] : [this.card(t, it, now)])))));
  }
}
