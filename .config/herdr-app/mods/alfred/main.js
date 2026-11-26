// alfred: Alfred, the omo assistant you talk to on Telegram, as a tab of the right column: the same chat, to read and
// answer from the desk. omo-assistant's bridge copies everything it does in the Telegram chat to the omo board hub
// (/chat: one row per message, changed in place when the bridge edits it, reacts to it or deletes it), with David's
// own messages, and runs what is sent from here (/desk) as if it came from Telegram: text goes into Telegram first as
// a quiet "🖥" message and then to Alfred, a reply to an agent's message reaches that session, and a button pressed
// here does what the same press on the phone would. The press's answer shows above the box.
//
// The hub is reached through this Mac's board tunnel (OMO_BOARD_URL in ~/.config/omo-board/env, else
// 127.0.0.1:7700) with the desk's token, the dashboard's board token (BOARD_CONTROL_TOKEN in
// ~/.config/agent-state/server.env). Each copy long-polls the hub on its own: the tab for the messages, and a hidden
// copy beside the status bar (props {headless: true}) that publishes shared "alfred.chat" ({loaded, unread, waiting,
// typing, problem}) for the chips and posts a toast for a new message from Alfred while the tab isn't showing.
// Shared "alfred.read" is the newest of Alfred's messages seen in the tab. alfred.open (keys.json) shows the tab
// and puts the keyboard in its box.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, TextView, ScrollHandle } from "gpui-base";
import { exec, home, theme, props, shared, setShared, settings, checking, readTextFile, nextCommand, notify, layout, run } from "herdr";
import { INK, isHud, display, mono, frame, caps, readout, spinner, button as hudButton, title as hudTitle } from "./hud.js";

// Messages read at the start, and kept.
const PAGE = 200, KEEP = 400;
// The chat builds only the rows within OVERSCAN px of the screen; GAP is the space under each row.
const OVERSCAN = 900, GAP = 8;
// Seconds one read waits on the hub for news; a read not back by STALL is left behind.
const WAIT = 25, STALL = 60000;
const NOTICE_MS = 8000, DAY = 86400000;
// The buttons that wait on David: a session's choices, a retro review, a Claude sign-in.
const ANSWERABLE = /^(c|V|ca):/;

const message = (e) => (e instanceof Error ? e.message : String(e));
const solid = (c) => (typeof c === "string" && c.length === 9 ? c.slice(0, 7) : c);
const tint = (c, a) => solid(c) + a;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function tabShown() {
  const root = layout(), panel = find(root, "panel");
  return Boolean(panel && !panel.hidden && find(root, "panel-body")?.active === "alfred");
}
function showTab() {
  run("layout.select", { stack: "panel-body", child: "alfred" });
  run("layout.show", { id: "panel" });
}

const envValue = (text, key) => text?.match(new RegExp(`^(?:export\\s+)?${key}=(.*)$`, "m"))?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2") || null;

async function connect() {
  const [board, desk] = await Promise.all([
    readTextFile(`${home()}/.config/omo-board/env`).catch(() => null),
    readTextFile(`${home()}/.config/agent-state/server.env`).catch(() => null),
  ]);
  const token = envValue(desk, "BOARD_CONTROL_TOKEN");
  if (!token) throw new Error("No desk token: BOARD_CONTROL_TOKEN (the dashboard's board token) is missing from ~/.config/agent-state/server.env.");
  return { url: (envValue(board, "OMO_BOARD_URL") ?? "http://127.0.0.1:7700").replace(/\/+$/, ""), token };
}

async function call(conn, method, path, body) {
  let res;
  try {
    res = await fetch(`${conn.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${conn.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    throw new Error(`Can't reach the board at ${conn.url} (its tunnel is com.omo-board.tunnel): ${message(e)}`);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (res.ok) return data;
  const why = data?.error ?? `HTTP ${res.status}`;
  throw Object.assign(new Error(/^no route/.test(why) ? "The board hub has no desk yet: it needs the omo-board deploy with the chat copy." : why), { status: res.status });
}

const ENTITIES = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&amp;": "&" };
const decode = (text) => text.replace(/&(lt|gt|quot|#39|amp);/g, (e) => ENTITIES[e]);

// Telegram's HTML as Markdown for TextView, whose HTML view drops <br> and gaps every <p>: bold, italic, struck
// text, code, links and quotes carry over, and each line break stays a single one (a hard break). Text is escaped so
// a stray * or _ in a message stays as written; Telegram-only tags (spoilers, underline) drop away.
function markdownOf(html) {
  const buffers = [""], links = [];
  let pre = false, code = false;
  const put = (s) => { buffers[buffers.length - 1] += s; };
  for (const [, close, tag, attrs, text] of html.matchAll(/<(\/?)([a-z-]+)([^>]*)>|([^<]+)/gi)) {
    if (text !== undefined) {
      const raw = decode(text);
      put(pre || code ? raw : raw.replace(/[\\`*_[\]<>~|]/g, "\\$&").replace(/(^|\n)([#+-])/g, "$1\\$2"));
      continue;
    }
    const end = close === "/";
    switch (tag.toLowerCase()) {
      case "b": case "strong": put("**"); break;
      case "i": case "em": put("*"); break;
      case "s": case "strike": case "del": put("~~"); break;
      case "code": if (!pre) { put("`"); code = !end; } break;
      case "pre": pre = !end; put("\n```\n"); break;
      case "a":
        if (end) put(`](${links.pop() ?? ""})`);
        else { links.push(decode(attrs.match(/href="([^"]*)"/)?.[1] ?? "")); put("["); }
        break;
      case "blockquote":
        if (!end) buffers.push("");
        else if (buffers.length > 1) put(`\n${buffers.pop().trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`);
        break;
    }
  }
  return buffers.join("").split(/(```[\s\S]*?```)/).map((part, i) => (i % 2 ? part : part.replace(/\n/g, "  \n"))).join("").trim();
}
const plain = (html) => decode((html ?? "").replace(/<[^>]+>/g, ""));
const oneLine = (text, max) => {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
};
const MEDIA = { photo: "Photo", video: "Video", video_note: "Video note", voice: "Voice note", audio: "Audio", document: "File" };
function mediaLabel(media) {
  if (!media) return "";
  const length = media.seconds ? ` \u00b7 ${Math.floor(media.seconds / 60)}:${String(media.seconds % 60).padStart(2, "0")}` : "";
  return `${MEDIA[media.kind] ?? "File"}${media.name ? `: ${media.name}` : ""}${length}`;
}
const snippet = (m) => oneLine(plain(m.html) || mediaLabel(m.media), 160);
const live = (m) => !m.deleted && Date.now() - m.at < DAY && (m.buttons ?? []).flat().some((b) => ANSWERABLE.test(b.callback_data ?? ""));
const mine = (m) => m.from === "david" || m.from === "desk";
// The bridge's reactions drawn as words: 👍 on a session's question answered there, 👌 on your reply once it reached the session.
const REACTIONS = { "👍": "Seen", "👌": "Sent" };
// Answered: a reaction on it (👍, answered in its session), a button used on it (the bridge leaves one saying what was
// done), or your reply to it. An answered message counts neither as unread nor as waiting.
const repliedTo = (msgs) => new Set(msgs.filter(mine).map((m) => m.reply_to).filter(Boolean));
const answered = (m, replied) => Boolean(m.reaction) || (m.buttons ?? []).flat().some((b) => b.callback_data === "done") || replied.has(m.mid);

// What one of Alfred's messages is, from the mark the bridge starts it with.
function kindOf(t, m) {
  const text = plain(m.html).trimStart();
  if (text.startsWith("\u25c6")) return { label: / asks\b/.test(text.split("\n")[0]) ? "Question" : "Post", tone: t.blocked };
  if (text.startsWith("\u2715")) return { label: "Error", tone: t.ansi1 };
  if (text.startsWith("\u25cc")) return { label: "Progress", tone: t.working };
  if (text.startsWith("\u25b7") || text.startsWith("\u25c7")) return { label: "Task", tone: t.done };
  if (text.startsWith("\ud83d\udd11")) return { label: "Sign-in", tone: t.blocked };
  return { label: "Alfred", tone: t.working };
}

const clock = (at) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabel(at) {
  const d = new Date(at), today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// The chat as the hub has it, kept current by long polls. Each copy has its own.
class Feed {
  constructor() {
    this.conn = null;
    this.loaded = false;
    this.seq = 0;
    this.byMid = new Map();
    this.desk = [];
    this.typingUntil = 0;
    this.problem = null;
    this.failures = 0;
    this.run = 0;
    this.started = 0;
  }

  messages() {
    return (this.sorted ??= [...this.byMid.values()].sort((a, b) => a.mid - b.mid));
  }

  // Starts a read unless one is out (and not stalled), then the next as soon as it is back; after a failure the next
  // waits, longer each time. done(cx) follows every read.
  poll(cx, done) {
    if (this.started && Date.now() - this.started < STALL) return;
    const run = ++this.run;
    this.started = Date.now();
    cx.spawn(async (cx) => {
      try {
        this.conn ??= await connect();
        const data = await call(this.conn, "GET", this.loaded ? `/chat?since=${this.seq}&wait=${WAIT}` : `/chat?limit=${PAGE}`);
        if (run !== this.run) return;
        this.apply(data);
        this.problem = null;
        this.failures = 0;
        this.started = 0;
        done(cx);
        this.poll(cx, done);
      } catch (e) {
        if (run !== this.run) return;
        this.problem = message(e);
        this.failures++;
        this.started = 0;
        // A refused token is read again: it may have changed.
        if (e.status === 401 || e.status === 403) this.conn = null;
        done(cx);
        await cx.sleep(Math.min(60000, 2000 * this.failures));
        this.poll(cx, done);
      }
    });
  }

  apply(data) {
    // The hub's copy started over (head behind what was read): read it afresh.
    this.sorted = null;
    if (this.loaded && data.head < this.seq) {
      this.loaded = false;
      this.seq = 0;
      this.byMid.clear();
      return;
    }
    for (const m of data.messages ?? []) this.byMid.set(m.mid, m);
    if (this.byMid.size > KEEP) for (const mid of [...this.byMid.keys()].sort((a, b) => a - b).slice(0, this.byMid.size - KEEP)) this.byMid.delete(mid);
    this.seq = data.seq ?? this.seq;
    this.desk = data.desk ?? [];
    this.typingUntil = data.typing_ms > 0 ? Date.now() + data.typing_ms : 0;
    this.loaded = true;
  }

  async send(body) {
    this.conn ??= await connect();
    return (await call(this.conn, "POST", "/desk", body)).id;
  }
}

export default class Alfred extends View {
  init(_props, cx) {
    this.headless = Boolean(props()?.headless);
    this.feed = new Feed();
    if (this.headless) {
      if (checking()) return;
      this.typing = false;
      const done = () => this.publish();
      this.feed.poll(cx, done);
      cx.timer.every(STALL, (cx) => this.feed.poll(cx, done));
      cx.timer.every(2000, () => {
        if (this.typing && Date.now() > this.feed.typingUntil) this.publish();
      });
      cx.spawn(async () => {
        for (;;) {
          if ((await nextCommand()) !== "open") continue;
          showTab();
          setShared("alfred.focus", Date.now());
        }
      });
      return;
    }
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: "Message Alfred \u00b7 Enter sends" });
    this.input.on("submit", (_e, cx) => this.send(cx));
    // Each row's last measured height, by key, for the spacers that stand in for rows off screen; and each message's
    // Markdown, converted once.
    this.heights = new Map();
    this.md = new Map();
    this.drawnAt = 0;
    this.pinned = true;
    this.replyTo = null;
    // Sent from here and not yet in the chat: {id, text, replyTo}, until the bridge's echo of it arrives.
    this.outbox = [];
    // Presses on their way, by desk id: {mid, data}.
    this.pressing = new Map();
    this.notice = null;
    this.lastMid = 0;
    this.focusSeen = shared("alfred.focus") ?? 0;
    if (checking()) return;
    // Herdr's tabs mod brings a space's panel back on return only for the panels listed here.
    const panels = shared("workspace.panels") ?? ["files", "changes"];
    if (!panels.includes("alfred")) setShared("workspace.panels", [...panels, "alfred"]);
    const done = (cx) => this.changed(cx);
    this.feed.poll(cx, done);
    cx.timer.every(STALL, (cx) => this.feed.poll(cx, done));
    // Typing and a notice end on their own.
    cx.timer.every(1000, (cx) => {
      const typing = Date.now() < this.feed.typingUntil, notice = Boolean(this.notice && Date.now() - this.notice.at < NOTICE_MS);
      if (typing !== this.wasTyping || notice !== Boolean(this.notice)) {
        this.wasTyping = typing;
        if (!notice) this.notice = null;
        cx.notify();
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus" || command === "open") {
          this.input.focus();
          cx.notify();
        }
      }
    });
  }

  // The chips' summary, and a toast for what Alfred sent while the tab wasn't showing.
  publish() {
    const msgs = this.feed.messages();
    const newest = msgs.filter((m) => m.from === "alfred").at(-1)?.mid ?? 0;
    let read = shared("alfred.read");
    if (typeof read !== "number" && this.feed.loaded) {
      read = newest;
      setShared("alfred.read", newest);
    }
    this.typing = Date.now() < this.feed.typingUntil;
    const replied = repliedTo(msgs);
    const next = {
      loaded: this.feed.loaded,
      unread: msgs.filter((m) => m.from === "alfred" && !m.deleted && m.mid > (read ?? Infinity) && !answered(m, replied)).length,
      waiting: msgs.filter((m) => live(m) && !answered(m, replied)).length,
      typing: this.typing,
      problem: this.feed.problem,
    };
    if (JSON.stringify(shared("alfred.chat") ?? null) !== JSON.stringify(next)) setShared("alfred.chat", next);
    if (!this.feed.loaded) return;
    // What was there at the start is no news.
    if (this.toasted === undefined) {
      this.toasted = newest;
      return;
    }
    const fresh = msgs.filter((m) => m.from === "alfred" && !m.deleted && m.mid > this.toasted && m.mid > (read ?? 0));
    if (fresh.length === 0) return;
    this.toasted = fresh.at(-1).mid;
    if (tabShown()) return;
    notify({
      title: fresh.length === 1 ? "Alfred" : `Alfred \u00b7 ${fresh.length} new`,
      body: snippet(fresh.at(-1)),
      level: fresh.some(live) ? "warning" : "info",
      action: { name: "alfred.open" },
    });
  }

  changed(cx) {
    const msgs = this.feed.messages();
    const last = msgs.at(-1)?.mid ?? 0;
    if (last > this.lastMid) {
      this.lastMid = last;
      this.stick = true;
    }
    for (const d of this.feed.desk) {
      if (d.state !== "done") continue;
      if (this.pressing.has(d.id)) {
        this.pressing.delete(d.id);
        if (d.result?.text) this.say(d.result.text, d.result.ok ? "done" : "blocked");
      }
      const sent = this.outbox.find((o) => o.id === d.id);
      if (!sent) continue;
      if (!d.result?.ok) {
        this.outbox = this.outbox.filter((o) => o !== sent);
        this.say(`Not sent: ${d.result?.text ?? "the bridge refused it"}`, "blocked");
        if (!this.input.value().trim()) this.input.set_value(sent.text);
      } else if (this.feed.byMid.has(d.result.mid)) this.outbox = this.outbox.filter((o) => o !== sent);
    }
    cx.notify();
  }

  say(text, tone) {
    this.notice = { text, tone, at: Date.now() };
  }

  send(cx) {
    const text = this.input.value().trim();
    if (!text || this.sending) return;
    this.sending = true;
    const replyTo = this.replyTo;
    cx.spawn(async (cx) => {
      try {
        const id = await this.feed.send({ text, ...(replyTo ? { reply_to: replyTo } : {}) });
        this.outbox.push({ id, text, replyTo });
        this.input.set_value("");
        this.replyTo = null;
        this.stick = true;
      } catch (e) {
        this.say(`Not sent: ${message(e)}`, "blocked");
      }
      this.sending = false;
      cx.notify();
    });
    cx.notify();
  }

  press(cx, m, b) {
    if (b.url) {
      exec("open", [b.url]).catch((e) => this.say(message(e), "blocked"));
      return;
    }
    if (!b.callback_data || b.callback_data === "done") return;
    cx.spawn(async (cx) => {
      try {
        const id = await this.feed.send({ press: { mid: m.mid, data: b.callback_data } });
        this.pressing.set(id, { mid: m.mid, data: b.callback_data });
      } catch (e) {
        this.say(e.status === 409 ? "That was answered already." : message(e), "blocked");
      }
      cx.notify();
    });
  }

  reply(cx, m) {
    this.replyTo = m.mid;
    this.input.focus();
    cx.notify();
  }

  label(t, text, color, size = 11) {
    return this.hud ? caps(text, size + 0.5, 700).flex_none().text_color(color)
      : div().flex_none().text_size(size - 0.5).font_semibold().text_color(color).child(text);
  }

  chip(t, text, color) {
    if (this.hud) return div().relative().px(6).h(16).flex_none().flex().items_center()
      .children(frame(4, { bg: tint(color, "14"), line: tint(color, "80") }))
      .child(caps(text, 11, 700).relative().text_color(color));
    return div().px(5).h(16).flex().flex_none().items_center().rounded(4).border_1().border_color(tint(color, "66")).text_size(10).text_color(color).child(text);
  }

  button(t, id, text, { tone, on = false, busy = false, settled = false } = {}) {
    const color = tone ?? t.working;
    if (settled) return h_flex().id(id).h(22).px(8).flex_none().items_center().text_color(t.dim)
      .when(this.hud, (el) => el.relative().children(frame(5, { line: tint(t.dim, "66") })))
      .when(!this.hud, (el) => el.rounded(5).border_1().border_color(t.border))
      .child((this.hud ? caps(text, 12, 700) : div().text_size(11.5).child(text)).relative());
    const icon = busy ? (this.hud ? spinner(color, 11) : svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(color).spin(900)) : null;
    if (this.hud) return hudButton(t, id, text, { on, tone: color, icon });
    return h_flex().id(id).h(22).px(8).gap(5).flex_none().items_center().rounded(5).cursor_pointer()
      .when(on, (el) => el.bg(t.accent).text_color(solid(t.background)).hover((s) => s.opacity(0.85)))
      .when(!on, (el) => el.border_1().border_color(tint(color, "80")).text_color(color).hover((s) => s.bg(tint(color, "1f")).text_color(t.foreground)))
      .when(Boolean(icon), (el) => el.child(icon))
      .child(div().text_size(11.5).font_semibold().child(text));
  }

  // A message's buttons, row by row as Telegram lays them out. A press on its way spins; a handled message's buttons
  // say what was done and press no more.
  buttons(t, m, tone) {
    const pressing = [...this.pressing.values()].filter((p) => p.mid === m.mid).map((p) => p.data);
    return v_flex().gap(4).children(m.buttons.map((row, r) => h_flex().gap(4).flex_wrap().children(row.map((b, i) => {
      const id = `b-${m.mid}-${r}-${i}`;
      if (b.url) return this.button(t, id, `${b.text} \u2197`, { tone: t.muted }).on_click((_e, cx) => this.press(cx, m, b));
      if (b.callback_data === "done") return this.button(t, id, b.text, { settled: true });
      const busy = pressing.includes(b.callback_data);
      return this.button(t, id, b.text, { tone: /^o:/.test(b.callback_data ?? "") ? t.muted : tone, busy })
        .when(!busy, (el) => el.on_click((_e, cx) => this.press(cx, m, b)));
    }))));
  }

  bubble(t, m) {
    const own = mine(m);
    const kind = own ? null : kindOf(t, m);
    const tone = own ? t.accent : kind.tone;
    const quoted = m.reply_to ? this.feed.byMid.get(m.reply_to) : null;
    const who = own ? `You \u00b7 ${m.from === "desk" ? "Herdr" : "Telegram"}` : kind.label;
    const where = m.thread ? `${m.thread.machine}${m.thread.project ? ` \u00b7 ${m.thread.project}` : ""}` : null;
    const replying = this.replyTo === m.mid;
    const meta = h_flex().gap(6).items_center()
      .child(this.label(t, who, tone))
      .when(Boolean(where), (el) => el.child(this.chip(t, where, tone)))
      .child(div().flex_1())
      .when(Boolean(m.reaction), (el) => el.child(this.chip(t, REACTIONS[m.reaction] ?? m.reaction, t.done)))
      .child(div().flex_none().font_family(mono()).text_size(10.5).text_color(t.dim).child(clock(m.at)))
      .when(!own && !m.deleted, (el) => el.child(div().id(`reply-${m.mid}`).flex_none().px(4).text_size(10.5).cursor_pointer()
        .text_color(replying ? t.accent : m.thread ? t.muted : t.dim).hover((s) => s.text_color(t.accent))
        .tooltip(m.thread ? "Reply to this session" : "Reply to this message")
        .on_click((_e, cx) => this.reply(cx, m))
        .child(this.hud ? caps("Reply", 11.5, 700) : "Reply")));
    const body = v_flex().relative().gap(6).px(10).py(8).min_w(0)
      .when(this.hud, (el) => el.children(frame(6, own
        ? { bg: tint(t.accent, "14"), line: tint(t.accent, replying ? "e6" : "80") }
        : { bg: tint(tone, "0d"), line: tint(tone, replying ? "e6" : kind.label === "Alfred" ? "40" : "8c") })))
      .when(!this.hud, (el) => el.rounded(8).border_1()
        .border_color(replying ? t.accent : own ? tint(t.accent, "59") : kind.label === "Alfred" ? t.border : tint(tone, "73"))
        .bg(own ? tint(t.accent, "14") : t.surface))
      .child(meta.relative())
      .when(Boolean(quoted), (el) => el.child(h_flex().relative().gap(6).pl(8).border_l(2).border_color(tint(t.muted, "80"))
        .child(div().min_w(0).flex_1().truncate().text_size(11.5).text_color(t.dim).child(snippet(quoted)))))
      .when(Boolean(m.deleted), (el) => el.child(div().relative().italic().text_size(12).text_color(t.dim).child("Deleted")))
      .when(!m.deleted && Boolean(m.media), (el) => el.child(h_flex().relative().gap(6).items_center()
        .child(this.chip(t, mediaLabel(m.media), t.muted))))
      .when(!m.deleted && Boolean(m.html), (el) => el.child(div().relative().min_w(0).text_size(13).line_height(1.45).text_color(t.foreground)
        .child(TextView.markdown(`m-${m.mid}`, this.markdown(m)).selectable(true))))
      .when(!m.deleted && (m.buttons?.length ?? 0) > 0, (el) => el.child(div().relative().child(this.buttons(t, m, tone))));
    return h_flex().id(`msg-${m.mid}`).w_full().when(own, (el) => el.pl(28).justify_end()).when(!own, (el) => el.pr(12))
      .child(body.when(own, (el) => el.max_w_full()).when(!own, (el) => el.flex_1()));
  }

  pending(t, o) {
    return h_flex().id(`out-${o.id}`).w_full().pl(28).justify_end()
      .child(v_flex().relative().gap(4).px(10).py(8).min_w(0)
        .when(this.hud, (el) => el.children(frame(6, { bg: tint(t.accent, "0a"), line: tint(t.accent, "4d") })))
        .when(!this.hud, (el) => el.rounded(8).border_1().border_color(tint(t.accent, "40")))
        .child(h_flex().relative().gap(6).items_center()
          .child(this.label(t, "Sending", t.muted))
          .child(this.hud ? spinner(t.muted, 11) : svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.muted).spin(900)))
        .child(div().relative().text_size(13).text_color(t.muted).child(o.text)));
  }

  typingRow(t) {
    return h_flex().id("typing").gap(8).px(4).py(2).items_center()
      .child(this.hud ? spinner(t.working, 12) : svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900))
      .child(this.label(t, "Alfred is working", t.working, 11.5));
  }

  // The middle when there is nothing to list yet: connecting, offline, or an empty chat.
  emptyState(t) {
    const problem = this.feed.problem;
    const [title, body, tone] = problem ? ["Can't reach Alfred", problem, t.blocked]
      : !this.feed.loaded ? ["Connecting", "Reading the chat from the omo board\u2026", t.working]
      : ["No messages yet", "Write to Alfred below. Messages from Telegram show here too.", t.muted];
    return v_flex().flex_1().items_center().justify_center().gap(8).px(24)
      .child(div().size(36).flex().items_center().justify_center()
        .when(this.hud, (el) => el.relative().children(frame(8, { bg: tint(tone, "14"), line: tint(tone, "99") })))
        .when(!this.hud, (el) => el.rounded(18).border_1().border_color(tint(tone, "99")).bg(tint(tone, "14")))
        .child(!problem && !this.feed.loaded ? (this.hud ? spinner(tone, 16) : svg("mods/workspace-chrome/spinner.svg").size(16).text_color(tone).spin(900))
          : div().relative().text_size(16).text_color(tone).child(problem ? "!" : "\u2026")))
      .child(this.hud ? caps(title, 15, 700).text_color(tone) : div().font_semibold().text_color(tone).child(title))
      .child(div().text_size(12).text_color(t.muted).text_center().child(body))
      .when(Boolean(problem), (el) => el.child(this.button(t, "retry", "Try again", { tone })
        .on_click((_e, cx) => {
          this.feed.failures = 0;
          this.feed.started = 0;
          this.feed.poll(cx, (cx) => this.changed(cx));
        })));
  }

  // A message's Markdown, converted from its HTML once rather than on every render.
  markdown(m) {
    const done = this.md.get(m.mid);
    if (done?.html === m.html) return done.md;
    const md = markdownOf(m.html);
    this.md.set(m.mid, { html: m.html, md });
    return md;
  }

  // The chat's rows, each a key and how to draw it: a line before each day's first message, the messages, what is on
  // its way, and Alfred working.
  rows(t, msgs) {
    const rows = [];
    let day = null;
    for (const m of msgs) {
      const label = dayLabel(m.at);
      if (label !== day) {
        day = label;
        rows.push({ key: `day-${m.mid}`, draw: () => h_flex().gap(8).items_center().pt(6)
          .child(div().flex_1().h(1).bg(this.hud ? tint(t.accent, "33") : t.border))
          .child(this.label(t, label, t.dim))
          .child(div().flex_1().h(1).bg(this.hud ? tint(t.accent, "33") : t.border)) });
      }
      rows.push({ key: `msg-${m.mid}`, draw: () => this.bubble(t, m) });
    }
    for (const o of this.outbox) rows.push({ key: `out-${o.id}`, draw: () => this.pending(t, o) });
    if (Date.now() < this.feed.typingUntil) rows.push({ key: "typing", draw: () => this.typingRow(t) });
    return rows;
  }

  // Herdr renders this tab again whenever its live data changes, so a long chat built whole on every render stalled
  // it. Only the rows within OVERSCAN of the screen are built; the rest are spacers of the height they last measured
  // (a message not drawn yet counts as the average). A scroll that nears the edge of what is built draws again.
  // The chat is pinned to its end until a scroll or a press in it, and again once back at the end or when a message
  // arrives. Pinned, it reveals a mark after the last row, and does again when a drawn row grows (a message's
  // Markdown is laid out after it first shows), so a tall message shows to its bottom.
  list(t, msgs) {
    const rows = this.rows(t, msgs), z = Number(settings().zoom);
    let sum = 0, n = 0;
    for (const [key, h] of this.heights) if (key.startsWith("msg-")) { sum += h; n++; }
    const height = (key) => this.heights.get(key) ?? (key.startsWith("day-") ? 30 : n ? sum / n : 90);
    const tops = [];
    let total = 0;
    for (const r of rows) {
      tops.push(total);
      total += height(r.key);
    }
    const at = this.scroll.offset().y, view = this.scroll.viewport_size().height || 600;
    if (this.stick || at + view >= this.scroll.content_size().height - 1) this.pinned = true;
    const [lo, hi] = this.pinned ? [total - view - OVERSCAN, total] : [at - OVERSCAN, at + view + OVERSCAN];
    let from = 0, to = rows.length;
    while (from < rows.length - 1 && tops[from + 1] <= lo) from++;
    while (to > from + 1 && tops[to - 1] >= hi) to--;
    const after = to < rows.length ? total - tops[to] : 0;
    const children = [];
    if (tops[from] > 0) children.push(div().flex_none().h(tops[from]));
    for (let i = from; i < to; i++) {
      const { key, draw } = rows[i];
      children.push(div().id(`row-${key}`).flex_none().pb(GAP)
        .on_size_change((size, cx) => {
          const h = size.height / z;
          if (Math.abs((this.heights.get(key) ?? 0) - h) < 0.5) return;
          this.heights.set(key, h);
          if (this.pinned) cx.notify();
        })
        .child(draw()));
    }
    if (after > 0) children.push(div().flex_none().h(after));
    children.push(div().id("end").flex_none().h(1));
    this.drawnAt = at;
    this.stick = false;
    if (this.pinned) this.scroll.scroll_to_item(children.length - 1);
    // Rows and messages that left the chat.
    if (this.heights.size > rows.length + 50) {
      const keys = new Set(rows.map((r) => r.key));
      for (const key of this.heights.keys()) if (!keys.has(key)) this.heights.delete(key);
      for (const mid of this.md.keys()) if (!this.feed.byMid.has(mid)) this.md.delete(mid);
    }
    return v_flex().id("alfred-list").flex_1().min_h(0).px(8).py(8).overflow_y_scrollbar().track_scroll(this.scroll)
      .on_scroll_wheel((_e, cx) => {
        this.pinned = false;
        this.follow(cx);
      })
      .on_mouse_down("left", () => { this.pinned = false; })
      .on_mouse_move((_e, cx) => this.follow(cx))
      .children(children);
  }

  follow(cx) {
    if (Math.abs(this.scroll.offset().y - this.drawnAt) > OVERSCAN / 3) cx.notify();
  }

  composer(t) {
    const quoted = this.replyTo ? this.feed.byMid.get(this.replyTo) : null;
    const notice = this.notice && Date.now() - this.notice.at < NOTICE_MS ? this.notice : null;
    const noticeTone = notice ? t[notice.tone] ?? t.muted : null;
    return v_flex().flex_none().px(8).pt(6).pb(8).gap(6).border_t(1).border_color(this.hud ? tint(t.accent, "33") : t.border)
      .when(Boolean(notice), (el) => el.child(h_flex().id("notice").relative().px(10).py(5).gap(8).items_center().cursor_pointer()
        .when(this.hud, (el) => el.children(frame(5, { bg: tint(noticeTone, "14"), line: tint(noticeTone, "80") })))
        .when(!this.hud, (el) => el.rounded(6).border_1().border_color(tint(noticeTone, "80")).bg(tint(noticeTone, "14")))
        .tooltip("Click to dismiss")
        .on_click((_e, cx) => { this.notice = null; cx.notify(); })
        .child(div().relative().min_w(0).flex_1().text_size(12).text_color(noticeTone).child(notice.text))))
      .when(Boolean(quoted), (el) => el.child(h_flex().relative().px(10).py(5).gap(8).items_center()
        .when(this.hud, (el) => el.children(frame(5, { bg: tint(t.accent, "0d"), line: tint(t.accent, "66") })))
        .when(!this.hud, (el) => el.rounded(6).border_1().border_color(tint(t.accent, "66")))
        .child(this.label(t, quoted.thread ? `To ${quoted.thread.machine}${quoted.thread.project ? ` \u00b7 ${quoted.thread.project}` : ""}` : "Replying", t.accent).relative())
        .child(div().relative().min_w(0).flex_1().truncate().text_size(11.5).text_color(t.muted).child(snippet(quoted)))
        .child(div().id("reply-cancel").relative().flex_none().px(4).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .tooltip("Don't reply to it").on_click((_e, cx) => { this.replyTo = null; cx.notify(); })
          .child("\u2715"))))
      .child(h_flex().h(36).pl(10).pr(5).gap(6).items_center()
        .when(this.hud, (el) => el.relative().children(frame(6, { bg: tint(t.accent, "0d"), line: tint(t.accent, "b3") })))
        .when(!this.hud, (el) => el.rounded(8).border_1().border_color(tint(t.accent, "99")).bg(t.background))
        .child(Input.new(this.input).relative().flex_1().h_full().text_size(13).text_color(t.foreground))
        .child(this.button(t, "send", this.sending ? "Sending" : "Send", { on: true, busy: this.sending }).relative()
          .on_click((_e, cx) => this.send(cx))));
  }

  render(cx) {
    if (this.headless) return div();
    const t = theme();
    this.hud = isHud();
    const msgs = this.feed.messages();
    const focus = shared("alfred.focus") ?? 0;
    if (focus > this.focusSeen) {
      this.focusSeen = focus;
      this.stick = true;
      this.input.focus();
    }
    // Alfred's newest message counts as read once this tab shows it.
    const newest = msgs.filter((m) => m.from === "alfred").at(-1)?.mid ?? 0;
    if (newest > (shared("alfred.read") ?? 0) && tabShown()) setShared("alfred.read", newest);
    const s = shared("alfred.chat");
    const replied = repliedTo(msgs);
    const waiting = msgs.filter((m) => live(m) && !answered(m, replied)).length;
    const problem = this.feed.problem;
    const status = problem ? ["Offline", t.blocked] : Date.now() < this.feed.typingUntil ? ["Working", t.working] : s?.loaded || this.feed.loaded ? ["Telegram", t.done] : ["Connecting", t.muted];
    return v_flex().id("alfred").track_focus(this.handle).size_full().min_h(0).rounded(this.hud ? 0 : 10).overflow_hidden()
      .bg(t.background).border_1().border_color(this.hud ? tint(t.accent, "4d") : t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(this.hud ? 46 : 42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(this.hud ? tint(t.accent, "33") : t.border)
        .child(this.hud ? hudTitle(t, "Alfred", 17) : div().font_semibold().child("Alfred"))
        .when(waiting > 0, (el) => el.child(h_flex().id("waiting").gap(6).items_center().tooltip(`${waiting} message${waiting === 1 ? "" : "s"} with buttons waiting on you`)
          .child(this.hud ? readout(t, waiting, { status: t.blocked, pulse: true }) : this.chip(t, `${waiting} waiting`, t.blocked))))
        .child(div().flex_1())
        .child(h_flex().id("status").gap(6).items_center().tooltip(problem ?? "Messages here and on Telegram are the same chat")
          .child(div().size(7).flex_none().rounded(this.hud ? 0 : 4).bg(status[1])
            .when(status[0] === "Working", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1200 })))
          .child(this.label(t, status[0], status[1]))))
      .when(Boolean(problem) && msgs.length > 0, (el) => el.child(div().id("problem").mx(8).mt(6).px(10).py(5).text_size(11.5).text_color(t.blocked)
        .when(this.hud, (el) => el.relative().children(frame(5, { bg: tint(t.blocked, "0f"), line: tint(t.blocked, "80") })))
        .when(!this.hud, (el) => el.rounded(6).border_1().border_color(tint(t.blocked, "80")))
        .child(div().relative().child(`Offline, showing what was read before: ${problem}`))))
      .child(msgs.length > 0 || this.outbox.length > 0 ? this.list(t, msgs) : this.emptyState(t))
      .child(this.composer(t));
  }
}
