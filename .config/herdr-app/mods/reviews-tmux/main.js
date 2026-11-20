// reviews-tmux: open PRs and their reviews from pr-review, for the tmux pane's folder or every
// folder in its session. A hidden copy reads the CLI and publishes "pr.reviews"; the panel only
// draws. Open shows the review file in a solid dialog, with findings to select and post.
import { View, div, svg, list } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, Button, Checkbox, TextView, Editor, EditorState, Input, InputState, Textarea, TextareaState } from "gpui-base";
import { exec, home, theme, props, shared, setShared, checking, readTextFile, openOverlay, closeOverlay, nextCommand } from "herdr";
import { INK, isHud, spinner, display, mono, fill, frame, modalFrame, caps, readout, button as hudButton, title as hudTitle } from "./hud.js";

const COMMAND = () => [`${home()}/.bun/bin/bun`, `${home()}/.local/bin/pr-review`];
const SEVERITIES = ["blocker", "major", "minor", "nit"];
const MODES = ["manual", "semi", "auto"];
const TONE = { blocker: "ansi1", major: "ansi3", minor: "ansi6", nit: "dim" };
const UI = { body: 13, small: 11.5, title: 16, prose: 14, gap: 8, inset: 12, radius: 6, control: 26, findingIndent: 28 };
const solid = (c) => typeof c === "string" && c.length === 9 ? c.slice(0, 7) : c;
const message = (e) => e instanceof Error ? e.message : String(e);
const refresh = () => setShared("pr.reviews.refresh", (shared("pr.reviews.refresh") ?? 0) + 1);
// The diff as one run of rows for the dialog's lazy list: each file's header, then its hunks' headers and lines, keyed by
// the file's path so a click names its line.
function diffRows(diff) {
  return (diff?.files ?? []).flatMap((file, fi) => [
    { key: `f:${file.path}`, kind: "file", file, fi },
    ...file.hunks.flatMap((hunk, hi) => [
      { key: `h:${file.path}:${hi}`, kind: "hunk", hunk, hi },
      ...hunk.lines.map((line, li) => ({ key: `l:${file.path}:${hi}:${li}`, kind: "line", path: file.path, line })),
    ]),
  ]);
}
const postedIds = (r) => new Set((r?.posted ?? []).flatMap((p) => [...p.ids, ...p.in_summary]));
const running = (data) => (data?.repos ?? []).some((r) => r.prs.some((p) => p.review?.state === "running"));
function elapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
function scope() {
  const w = shared("tmux.where"), context = shared("tmux.context")?.where;
  const all = shared("pr.reviews.scope") === "all";
  const merged = shared("pr.reviews.filter") === "merged";
  const dirs = w?.on ? [] : all
    ? [...new Set((context?.terminal === w?.terminal ? context?.panes ?? [] : []).map((p) => p.path).filter(Boolean))]
    : w?.cwd ? [w.cwd] : [];
  return { dirs, merged, on: w?.on ?? null, refresh: shared("pr.reviews.refresh"), key: JSON.stringify([w, dirs, all, merged]) };
}
async function cli(args) {
  const [command, ...prefix] = COMMAND();
  const r = await exec(command, [...prefix, ...args], { timeout: 30000 });
  const data = r.stdout.trim() ? JSON.parse(r.stdout) : null;
  if (r.code !== 0 || data?.error || !data) throw new Error(data?.error || r.stderr.trim() || `pr-review failed (${r.code})`);
  return data;
}

export default class Reviews extends View {
  init(_props, cx) {
    this.headless = Boolean(props()?.headless);
    this.file = props()?.file ?? null;
    this.history = props()?.history ?? [];
    this.data = null;
    this.problem = null;
    this.busy = false;
    this.lastRead = 0;
    this.selected = new Set();
    this.seen = new Set();
    this.code = new Map();
    this.tab = props()?.tab === "diff" ? "diff" : "findings";
    if (!this.headless) this.handle = cx.focus_handle();
    if (checking()) return;
    const panels = shared("workspace.panels") ?? ["files", "changes"];
    if (!panels.includes("reviews")) setShared("workspace.panels", [...panels, "reviews"]);
    if (!this.headless) {
      cx.spawn(async (cx) => {
        for (;;) {
          const command = await nextCommand();
          if (command === "focus") this.handle.focus();
          if (command === "open" && !this.file) {
            const pr = shared("pr.reviews")?.data?.repos.flatMap((r) => r.prs).find((p) => p.review?.file);
            if (pr) this.open(pr.review.file, "findings", pr.history ?? [pr.review]);
          }
        }
      });
    }
    if (this.headless) {
      this.tick(cx);
      cx.timer.every(1000, (cx) => this.tick(cx));
    } else if (this.file) {
      this.commentTitle = InputState.new({ placeholder: "What should change?" });
      this.commentBody = TextareaState.new({ placeholder: "Explain why and how to fix it", rows: 3 });
      this.commentTitle.on("change", (_e, cx) => cx.notify());
      this.commentBody.on("change", (_e, cx) => cx.notify());
      this.severity = "major";
      cx.timer.after(60, () => this.handle.focus());
      this.load(cx);
      cx.timer.every(3000, (cx) => { if (this.review?.state === "running") this.load(cx); });
    } else {
      cx.timer.every(1000, (cx) => {
        if (this.actionProblem && Date.now() - this.actionAt >= 10000) this.actionProblem = null;
        cx.notify();
      });
    }
  }

  tick(cx) {
    const s = scope();
    const changed = s.key !== this.scopeKey;
    const requested = s.refresh !== this.refreshSeen;
    this.refreshSeen = s.refresh;
    if (changed) {
      this.scopeKey = s.key;
      this.data = null;
      this.problem = s.on ? "Reviews run on this Mac only" : null;
      this.share();
    }
    if (this.busy || (!changed && !requested && Date.now() - this.lastRead < (running(this.data) ? 3000 : 60000))) return;
    if (!s.dirs.length) { this.lastRead = Date.now(); this.share(); return; }
    this.busy = true;
    this.share();
    cx.spawn(async (cx) => {
      try {
        const data = await cli(["list", ...(s.merged ? ["--merged"] : []), ...s.dirs]);
        data.repos = data.repos.map((repo) => ({ ...repo, prs: repo.prs.filter((pr) => s.merged ? pr.state === "merged" : !pr.state || pr.state === "open") }));
        if (scope().key === s.key) { this.data = data; this.problem = null; }
      } catch (e) {
        if (scope().key === s.key) this.problem = message(e);
      }
      this.busy = false;
      const current = scope();
      this.lastRead = current.key === s.key && current.refresh === s.refresh ? Date.now() : 0;
      this.share();
      cx.notify();
    });
  }

  share() {
    setShared("pr.reviews", { data: this.data, problem: this.problem, busy: this.busy });
  }

  open(file, tab = "findings", history = []) {
    openOverlay({ mod: "reviews-tmux", kind: "dialog", frame: "none", width: 0.8, height: 0.78, props: { file, tab, history } });
  }

  selectReview(cx, file) {
    if (this.busy || this.posting || this.saving || this.commentAt) return;
    this.file = file;
    this.review = null;
    this.diff = null;
    this.diffPath = null;
    this.diffProblem = null;
    this.postUrl = null;
    this.postProblem = null;
    this.selected.clear();
    this.seen.clear();
    this.code.clear();
    this.load(cx);
  }

  run(cx, work) {
    cx.spawn(async (cx) => {
      try { await work(); this.actionProblem = null; }
      catch (e) { this.actionProblem = message(e); }
      this.actionAt = Date.now();
      this.starting = null;
      cx.notify();
    });
  }

  start(cx, repo, pr) {
    if (this.starting || pr.review?.state === "running") return;
    this.starting = `${repo.dir}:${pr.number}`;
    cx.notify();
    this.run(cx, async () => { await cli(["review", repo.dir, String(pr.number)]); refresh(); });
  }

  mode(cx, dir, number, mode) {
    this.run(cx, async () => { await cli(["mode", dir, number, mode]); refresh(); });
  }

  write(cx, repo, pr) {
    if (this.starting) return;
    this.starting = `${repo.dir}:${pr.number}`;
    cx.notify();
    this.run(cx, async () => {
      const result = await cli(["manual", repo.dir, String(pr.number)]);
      refresh();
      this.open(result.file, "diff", [{ file: result.file, source: { name: "you" }, started_at: new Date().toISOString() }, ...(pr.history ?? [])]);
    });
  }

  async readReview() {
    const text = await readTextFile(this.file);
    if (text === null) throw new Error("Review file is unavailable. Close and open the review again.");
    const r = JSON.parse(text);
    if (r.version !== 1 || !["running", "done", "failed"].includes(r.state) || !Array.isArray(r.findings)) {
      throw new Error("This review file does not match version 1.");
    }
    const posted = postedIds(r);
    if (this.review?.id !== r.id) { this.selected.clear(); this.seen.clear(); this.code.clear(); }
    for (const f of r.findings) {
      if (!this.seen.has(f.id) && (f.severity === "blocker" || f.severity === "major") && !posted.has(f.id)) this.selected.add(f.id);
      this.seen.add(f.id);
      if (posted.has(f.id)) this.selected.delete(f.id);
      if (f.suggestion && !this.code.has(f.id)) this.code.set(f.id, EditorState.new({
        readonly: true, value: f.suggestion, language: "text", font_family: "Menlo",
        font_size: UI.body, line_numbers: false, soft_wrap: true,
      }));
    }
    this.review = r;
    this.problem = null;
    if (r.diff_file && this.diffPath !== r.diff_file) {
      try {
        const text = await readTextFile(r.diff_file);
        if (text === null) throw new Error("The review diff is unavailable.");
        this.diff = JSON.parse(text);
        this.diffRows = diffRows(this.diff);
        this.diffPath = r.diff_file;
        this.diffProblem = null;
      } catch (e) { this.diffProblem = message(e); }
    }
  }

  load(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try { await this.readReview(); }
      catch (e) { this.problem = message(e); }
      this.busy = false;
      cx.notify();
    });
  }

  post(cx) {
    if (this.posting || this.saving || this.commentAt || this.busy || this.problem || this.review?.state !== "done" || !this.selected.size) return;
    const posted = postedIds(this.review);
    const ids = this.review.findings.filter((f) => this.selected.has(f.id) && !posted.has(f.id)).map((f) => f.id);
    if (!ids.length) return;
    this.posting = true;
    this.postProblem = null;
    this.postUrl = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = await cli(["post", this.file, "--ids", ids.join(",")]);
        this.postUrl = result.url;
        for (const id of result.ids) this.selected.delete(id);
        await this.readReview();
        refresh();
      } catch (e) { this.postProblem = message(e); }
      this.posting = false;
      cx.notify();
    });
  }

  editLine(cx, path, line) {
    if (this.review?.state !== "done" || this.commentAt || this.saving || this.posting) return;
    this.commentAt = { path, line };
    this.commentProblem = null;
    this.commentTitle.focus();
    cx.notify();
  }

  saveComment(cx) {
    if (!this.commentAt || this.saving || this.posting || !this.commentTitle.value().trim()) return;
    const { path, line } = this.commentAt;
    this.saving = true;
    this.commentProblem = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await cli(["add", this.file, "--path", path, "--line", String(line),
          "--severity", this.severity, "--title", this.commentTitle.value().trim(), "--body", this.commentBody.value().trim()]);
        this.commentAt = null;
        this.commentTitle.set_value("");
        this.commentBody.set_value("");
        await this.readReview();
        refresh();
        this.tab = "findings";
      } catch (e) { this.commentProblem = message(e); }
      this.saving = false;
      cx.notify();
    });
  }

  remove(cx, f) {
    if (f.by !== "you" || postedIds(this.review).has(f.id) || this.saving || this.posting) return;
    this.saving = true;
    this.postProblem = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await cli(["remove", this.file, f.id]);
        this.selected.delete(f.id);
        this.seen.delete(f.id);
        this.code.delete(f.id);
        await this.readReview();
        refresh();
      } catch (e) { this.postProblem = message(e); }
      this.saving = false;
      cx.notify();
    });
  }

  // netrunner's HUD (the panel and the review dialog): the main action or the chosen option is the yellow button, a disabled
  // one is dimmed.
  action(t, id, label, onClick, disabled = false, primary = false) {
    if (this.hud) {
      const b = hudButton(t, id, label, { on: primary }).on_click((_e, cx) => { if (!disabled) onClick(cx); });
      return disabled ? b.opacity(0.4) : b;
    }
    return Button.new(id).px(UI.gap).h(UI.control).flex_none().flex().items_center().justify_center()
      .rounded(4).border_1().border_color(primary ? t.accent : t.border).text_size(UI.small)
      .bg(primary && !disabled ? t.accent : solid(t.chrome)).text_color(disabled ? t.dim : primary ? solid(t.background) : t.foreground)
      .disabled(disabled).cursor_pointer().focus((s) => s.border_color(t.working))
      .when(!disabled, (el) => el.hover((s) => s.bg(primary ? t.accent : t.hover)))
      .on_click((_e, cx) => onClick(cx)).child(label);
  }

  badge(t, text, color = t.muted) {
    if (this.hud) return div().relative().px(6).h(16).flex_none().flex().items_center()
      .children(frame(4, { bg: solid(color) + "14", line: solid(color) + "80" }))
      .child(caps(text, 11, 700).relative().text_color(color));
    return div().px(5).py(1).flex_none().rounded(4).border_1().border_color(t.border).text_size(UI.small).text_color(color).child(text);
  }

  // A small state word beside a PR: HUD capitals, else the usual small text.
  label(t, text, color) {
    return this.hud ? caps(text, 11.5, 600).text_color(color) : div().text_size(UI.small).text_color(color).child(text);
  }

  // HUD severity chip: a solid tone block with dark capitals and a slanted end.
  chip(t, text, color) {
    const tone = solid(color);
    return h_flex().h(18).flex_none()
      .child(h_flex().h_full().pl(7).pr(3).items_center().bg(tone).text_color(INK).child(caps(text, 11.5, 700)))
      .child(div().relative().w(7).h_full().child(fill([[["0%", "0%"], ["100%", "0%"], ["0%", "100%"]]], tone)));
  }

  // HUD close: a framed cyan square.
  closeButton(t) {
    return h_flex().id("review-close").relative().size(26).flex_none().items_center().justify_center().cursor_pointer()
      .children(frame(5, { bg: t.working + "14", line: t.working + "b3" }))
      .hover((s) => s.opacity(0.8)).tooltip("Close (Esc)")
      .on_click(() => closeOverlay(props().overlay))
      .child(svg("mods/workspace-chrome/x.svg").size(13).text_color(t.working));
  }

  // A form field's name: HUD capitals, else the usual small text.
  field(t, text) {
    return this.hud ? caps(text, 11.5, 600).text_color(t.muted) : div().text_size(UI.small).child(text);
  }

  prRow(t, repo, pr) {
    const r = pr.review, id = `${repo.dir}:${pr.number}`;
    const automated = r?.source?.kind === "manual" ? (pr.history ?? []).find((entry) =>
      entry.source?.kind !== "manual" && entry.state === "done" && SEVERITIES.some((s) => entry.counts[s] > 0)) : null;
    const counts = [automated, r?.state === "done" ? r : null].filter(Boolean);
    return v_flex().id(id).py(UI.gap).gap(6).border_b(1).border_color(this.hud ? t.accent + "33" : t.border)
      .child(div().font_semibold().text_color(t.foreground)
        .when(this.hud, (el) => el.font_family(display()).font_weight(700).text_size(15)).child(`#${pr.number} ${pr.title}`))
      .child(h_flex().gap(6).flex_wrap().text_size(UI.small).text_color(t.muted)
        .child(`${pr.author} · ${elapsed(Date.now() - Date.parse(pr.updated_at))} ago`)
        .when(pr.draft, (el) => el.child(this.badge(t, "Draft")))
        .when(pr.state === "merged", (el) => el.child(this.badge(t, "merged", t.ansi5))))
      .child(div().truncate().text_size(UI.small).text_color(t.muted).tooltip(`${pr.head} → ${pr.base}`).child(`${pr.head} → ${pr.base}`))
      .child(h_flex().gap(6).flex_wrap().items_center()
        .when(!r, (el) => el.child(this.label(t, "Not reviewed", t.dim)))
        .when(r?.state === "running", (el) => el
          .child(this.hud ? spinner(t.working, 12, 1200) : svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(1200))
          .child(this.label(t, `Reviewing ${elapsed(Date.now() - Date.parse(r.started_at))}`, t.working)))
        .when(r?.state === "failed", (el) => el.child(this.label(t, "Failed", t.ansi1).tooltip(r.error ?? "Review failed")))
        .when(r?.state === "done" && Boolean(r.error), (el) => el.child(this.badge(t, "Post failed", t.ansi1).tooltip(r.error)))
        .children(counts.map((review) => h_flex().gap(6).flex_wrap().items_center()
          .when(Boolean(review.source), (el) => el.child(div().text_size(UI.small).text_color(t.muted).child(review.source.name)))
          .children(SEVERITIES.filter((s) => review.counts[s] > 0).map((s) => this.badge(t, `${review.counts[s]} ${s}`, t[TONE[s]])))
          .when(!SEVERITIES.some((s) => review.counts[s] > 0), (el) => el.child(this.label(t, "no findings", t.muted)))))
        .when(Boolean(r?.stale), (el) => el.child(this.badge(t, "Stale", t.ansi3)))
        .when(Boolean(r?.source) && r.state !== "done", (el) => el.child(div().text_size(UI.small).text_color(t.muted).child(r.source.name)))
        .when(pr.reviews > 1, (el) => el.child(this.label(t, `${pr.reviews} reviews`, t.dim)))
        .when(r?.posted > 0, (el) => el.child(this.label(t, `${r.posted} posted`, t.dim))))
      .child(h_flex().gap(6).flex_wrap()
        .child(this.action(t, `review-${id}`, this.starting === id ? "Starting..." : r ? "Re-run" : "Review", (cx) => this.start(cx, repo, pr), Boolean(this.starting) || r?.state === "running"))
        .child(this.action(t, `write-${id}`, "Write", (cx) => this.write(cx, repo, pr), Boolean(this.starting)))
        .when(Boolean(r?.file), (el) => el.child(this.action(t, `open-${id}`, "Open", () => this.open(r.file, "findings", pr.history ?? [r]))))
        .child(this.action(t, `web-${id}`, "Web", (cx) => this.run(cx, async () => {
          const result = await exec("open", [pr.url]);
          if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not open the PR");
        })))
        .child(this.action(t, `mode-${id}`, pr.mode_override ?? `inherit (${pr.mode ?? "semi"})`, (cx) => {
          const modes = ["inherit", ...MODES], current = pr.mode_override ?? "inherit";
          this.mode(cx, repo.dir, String(pr.number), modes[(modes.indexOf(current) + 1) % modes.length]);
        }).tooltip("PR mode: click to cycle inherit, manual, semi, auto")));
  }

  // What stops a folder from being read, in words, with the fix where the CLI names one. A folder that has nothing to
  // review (no repo, no origin) is `place`; a repo that can't be reached is `access`, which is worth trying again.
  trouble(repo) {
    const p = repo.problem ?? "", where = repo.dir.replace(home(), "~");
    if (p === "not a git repo") return { kind: "place", icon: "folder", title: "Not a git repository", body: `${where} isn't inside a git repository, so there are no pull requests to review here.` };
    if (p === "no origin remote") return { kind: "place", icon: "git-branch", title: "No origin remote", body: `${where} has no origin remote to read pull requests from. Add one with git remote add origin <url>.` };
    if (/^no (GitHub )?login/.test(p)) return { kind: "access", icon: "x", title: "Not signed in", body: `${p[0].toUpperCase()}${p.slice(1)}.` };
    const api = /^(GitHub|Gitea) (\d{3})/.exec(p), named = repo.repo ? `${repo.repo.owner}/${repo.repo.name}` : where;
    if (api?.[2] === "404") return { kind: "access", icon: "search", title: "Repository not found", body: `${api[1]} has no ${named}, or your login can't see it.` };
    if (api?.[2] === "401" || api?.[2] === "403") return { kind: "access", icon: "x", title: "Access denied", body: `${api[1]} refused your login for ${named} (${api[2]}). Check gh auth status, or tea's logins for Gitea.` };
    return { kind: "access", icon: "x", title: "Couldn't read pull requests", body: p };
  }

  // A state in place of the list: a ringed icon in its tone, a title, what it means, and a way on.
  notice(t, { icon, tone, title, body = null, action = null, spin = false }) {
    const ring = solid(tone), mark = svg(`mods/workspace-chrome/${icon}.svg`).size(20).text_color(ring);
    return v_flex().id("reviews-notice").flex_1().min_h(220).items_center().justify_center().gap(10).px(24).py(28)
      .child(div().size(46).flex_none().flex().items_center().justify_center()
        .when(!this.hud, (el) => el.rounded(23).bg(`${ring}1f`).border_1().border_color(`${ring}66`))
        .when(this.hud, (el) => el.relative().children(frame(8, { bg: `${ring}1f`, line: `${ring}80` })))
        .child(spin ? mark.spin(1200) : mark))
      .child(this.hud ? caps(title, 15, 700).text_center().text_color(t.foreground)
        : div().font_semibold().text_size(UI.body + 1).text_center().text_color(t.foreground).child(title))
      .when(Boolean(body), (el) => el.child(div().max_w(340).text_size(UI.small).line_height(1.45).text_center().text_color(t.muted).child(body)))
      .when(Boolean(action), (el) => el.child(div().pt(4).child(action)));
  }

  // A repo that can't be read, among others that can: the same words as its notice, in a compact red card.
  troubleCard(t, repo) {
    const { icon, title, body } = this.trouble(repo), red = solid(t.ansi1);
    return h_flex().mt(6).p(UI.gap).gap(UI.gap).items_start()
      .when(!this.hud, (el) => el.rounded(UI.radius).border_1().border_color(`${red}55`).bg(`${red}14`))
      .when(this.hud, (el) => el.relative().children(frame(6, { bg: `${red}14`, line: `${red}80` })))
      .child(div().mt(1).flex_none().child(svg(`mods/workspace-chrome/${icon}.svg`).size(14).text_color(red)))
      .child(v_flex().min_w(0).gap(2)
        .child(this.hud ? caps(title, 12.5, 700).text_color(red) : div().font_semibold().text_size(UI.small).text_color(red).child(title))
        .child(div().text_size(UI.small).line_height(1.45).text_color(t.muted).child(body)));
  }

  panel(t) {
    const state = shared("pr.reviews"), repos = state?.data?.repos ?? [];
    const count = repos.reduce((n, r) => n + r.prs.length, 0);
    const current = shared("pr.reviews.scope") === "all" ? "all" : "here";
    const filter = shared("pr.reviews.filter") === "merged" ? "merged" : "open";
    const s = scope(), red = solid(t.ansi1);
    const name = (repo) => (repo.repo ? `${repo.repo.owner}/${repo.repo.name}` : repo.dir.replace(home(), "~"));
    // A read that failed with a list already shown keeps the list and says so above it; with nothing shown it is the notice.
    const failed = state?.problem && !s.on ? state.problem : null;
    const banner = this.actionProblem ?? (failed && repos.length ? failed : null);
    const only = repos.length === 1 && repos[0].problem ? repos[0] : null;
    const allEmpty = repos.length > 0 && repos.every((r) => !r.problem && !r.prs.length);
    const other = filter === "open" ? "merged" : "open";
    const retry = this.action(t, "retry", "Try again", () => refresh());
    const onlyTrouble = only && this.trouble(only);
    const notice = s.on ? this.notice(t, { icon: "server", tone: t.blocked, title: "Reviews run on this Mac only", body: `This pane is on ${s.on}. Focus a pane on this Mac to see its pull requests.` })
      : failed && !repos.length ? this.notice(t, { icon: "x", tone: t.ansi1, title: "Couldn't read pull requests", body: failed, action: retry })
      : !state || (state.busy && !repos.length) ? this.notice(t, { icon: "spinner", tone: t.working, title: "Reading pull requests", spin: true })
      : !s.dirs.length ? this.notice(t, { icon: "terminal", tone: t.muted, title: "No tmux pane in focus", body: "Focus a tmux pane inside a git repository to list its pull requests." })
      : only ? this.notice(t, { ...onlyTrouble, tone: t.ansi1, action: onlyTrouble.kind === "access" ? retry
        : current === "here" ? this.action(t, "show-all", "Show the whole session", () => setShared("pr.reviews.scope", "all")) : null })
      : null;
    const emptyNotice = allEmpty && this.notice(t, {
      icon: "git-compare", tone: t.working, title: `No ${filter} pull requests`,
      body: repos.length === 1
        ? `${name(repos[0])} has no ${filter} pull requests${filter === "merged" ? " from the last 30 days" : ""}.`
        : `None of the ${repos.length} repos in this session has ${filter === "open" ? "an open" : "a merged"} pull request.`,
      action: this.action(t, "show-other", `Show ${other}`, () => setShared("pr.reviews.filter", other)),
    });
    return v_flex().id("reviews").track_focus(this.handle).size_full().min_h(0).rounded(this.hud ? 0 : 10).overflow_hidden()
      .bg(t.background).border_1().border_color(this.hud ? t.accent + "4d" : t.border).text_color(t.foreground).text_size(UI.body)
      .child(h_flex().h(this.hud ? 46 : 42).flex_none().px(UI.inset).gap(UI.gap).items_center().border_b(1).border_color(this.hud ? t.accent + "33" : t.border)
        .child(this.hud ? hudTitle(t, "Reviews", 17) : div().font_semibold().child("Reviews"))
        .child(this.hud ? readout(t, count) : this.badge(t, String(count)))
        .child(div().flex_1())
        .children(["here", "all"].map((s) => this.action(t, `scope-${s}`, s === "here" ? "Here" : "All", () => setShared("pr.reviews.scope", s), false, current === s))))
      .child(h_flex().flex_none().px(UI.inset).py(6).gap(6).border_b(1).border_color(this.hud ? t.accent + "33" : t.border)
        .children(["open", "merged"].map((s) => this.action(t, `filter-${s}`, s === "open" ? "Open" : "Merged", () => setShared("pr.reviews.filter", s), false, filter === s))))
      .when(Boolean(banner), (el) => el.child(h_flex().id("review-problem").mx(UI.inset).mt(UI.gap).px(UI.gap).py(6).gap(UI.gap).items_center()
        .when(!this.hud, (el) => el.rounded(UI.radius).border_1().border_color(`${red}55`).bg(`${red}14`))
        .when(this.hud, (el) => el.relative().children(frame(6, { bg: `${red}14`, line: `${red}80` })))
        .cursor_pointer().tooltip("Dismiss")
        .on_click((_e, cx) => { this.actionProblem = null; cx.notify(); })
        .child(svg("mods/workspace-chrome/x.svg").size(13).flex_none().text_color(red))
        .child(div().flex_1().min_w(0).text_size(UI.small).text_color(red).child(banner))))
      .child(notice ? v_flex().id("reviews-list").flex_1().min_h(0).child(notice) : v_flex().id("reviews-list").flex_1().min_h(0).px(UI.inset).pb(UI.inset).overflow_y_scrollbar()
        .children(repos.map((repo) => v_flex().id(`repo-${repo.dir}`).pt(UI.inset).gap(4)
          .child(h_flex().gap(6).flex_wrap().items_center()
            .child(this.badge(t, repo.repo?.forge === "github" ? "GitHub" : repo.repo?.forge === "gitea" ? "Gitea" : "Folder"))
            .child(div().font_semibold().text_color(t.foreground).child(name(repo))))
          .when(Boolean(repo.repo), (el) => el.child(h_flex().gap(4).flex_wrap()
            .children(MODES.map((mode) => this.action(t, `repo-mode-${repo.dir}-${mode}`, mode, (cx) => this.mode(cx, repo.dir, "-", mode), false, mode === (repo.mode ?? "semi"))))))
          .when(Boolean(repo.problem), (el) => el.child(this.troubleCard(t, repo)))
          .when(!repo.problem && !repo.prs.length && !allEmpty, (el) => el.child(div().py(UI.gap).text_size(UI.small).text_color(t.dim).child(`No ${filter} pull requests.`)))
          .children(repo.prs.map((pr) => this.prRow(t, repo, pr)))))
        .when(Boolean(emptyNotice), (el) => el.child(emptyNotice)));
  }

  finding(t, f, posted) {
    const done = posted.has(f.id), checked = this.selected.has(f.id);
    const tone = done ? t.dim : t[TONE[f.severity]];
    return v_flex().id(`finding-${f.id}`).gap(UI.gap)
      .when(!this.hud, (el) => el.py(UI.inset).border_b(1).border_color(t.border))
      .when(this.hud, (el) => el.relative().p(14).children(frame(10, { bg: t.chrome, line: solid(tone) + "80" })))
      .text_color(done ? t.dim : t.foreground)
      .child(Checkbox.new(`pick-${f.id}`).checked(checked).disabled(done || this.posting).accessibility_label(`Post ${f.severity}: ${f.title}`)
        .flex().gap(UI.gap).items_start().rounded(this.hud ? 0 : 4).border_1().border_color(this.hud ? t.background : solid(t.background))
        .focus((s) => s.border_color(t.working)).cursor_pointer()
        .on_change((value, cx) => { if (value) this.selected.add(f.id); else this.selected.delete(f.id); cx.notify(); })
        .child(div().size(18).mt(1).flex_none().rounded(this.hud ? 0 : 3).border_1().border_color(done ? t.dim : checked ? t.accent : t.muted)
          .bg(checked ? t.accent : this.hud ? t.working + "14" : solid(t.background)).flex().items_center().justify_center()
          .when(checked || done, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(12).text_color(done ? t.dim : this.hud ? INK : solid(t.background)))))
        .child(v_flex().min_w(0).flex_1().gap(6)
          .child(h_flex().gap(6).flex_wrap().items_center()
            .child(this.hud ? this.chip(t, f.severity, tone) : this.badge(t, f.severity, tone))
            .child(div().text_size(UI.small).when(this.hud, (el) => el.font_family(mono())).child(`${f.path}:${f.start_line ? `${f.start_line}-` : ""}${f.line}`))
            .when(done, (el) => el.child(this.badge(t, "Posted", t.dim)))
            .when(f.by === "you", (el) => el.child(this.badge(t, "you", done ? t.dim : t.working)))
            .when(!f.commentable, (el) => el.child(div().text_size(UI.small).text_color(t.muted).child("goes in the summary"))))
          .child(div().font_semibold().child(f.title))))
      .child(v_flex().ml(UI.findingIndent).gap(UI.gap)
        .child(TextView.markdown(`body-${f.id}`, f.body).selectable().w_full().text_size(UI.prose).text_color(done ? t.dim : t.foreground))
        .when(Boolean(f.suggestion), (el) => el.child(div().h(Math.min(240, f.suggestion.split("\n").length * 20 + 24)).p(UI.gap)
          .when(!this.hud, (b) => b.rounded(UI.radius).bg(solid(t.chrome)).border_1().border_color(t.border))
          .when(this.hud, (b) => b.relative().children(frame(8, { bg: solid(t.chrome), line: t.working + "66" })))
          .child(Editor.new(this.code.get(f.id)).size_full())))
        .when(f.by === "you" && !done, (el) => el.child(h_flex()
          .child(this.action(t, `remove-${f.id}`, "Remove", (cx) => this.remove(cx, f), this.saving || this.posting)))));
  }

  // The diff in a lazy list that draws only the rows on screen: a PR of 4,000 lines, each its own Button, ran past
  // Herdr's render limit. Rows may hold no handlers, so a click on a new-side line reaches the list's one handler.
  diffView(t) {
    const rows = this.diffRows ?? [];
    return v_flex().flex_1().min_h(0).gap(UI.inset)
      .when(Boolean(this.diffProblem), (el) => el.child(div().text_color(t.ansi1).child(this.diffProblem)))
      .when(!this.diff && !this.diffProblem, (el) => el.child(div().text_color(t.muted).child("The diff will appear after the PR is fetched.")))
      .when(Boolean(this.diff), (el) => el.child(div().flex_none().text_size(UI.small).text_color(t.muted)
        .child(this.review.state === "done" ? "Click a new-side line to write a comment." : "You can write comments when this review finishes.")))
      .when(rows.length > 0, (el) => el.child(div().relative().flex_1().min_h(0)
        .child(list("review-diff", rows.length, (i) => rows[i].key, (i) => this.diffRow(t, rows[i])).size_full()
          .on_item_click((key, cx) => {
            const row = rows.find((r) => r.key === key);
            if (row?.kind === "line" && row.line.new !== null) this.editLine(cx, row.path, row.line.new);
          }))
        .child(Scrollbar.vertical("review-diff").absolute().inset_0())));
  }

  // One row of the diff: a file's path and status, a hunk's header, or a line with its old and new numbers.
  diffRow(t, row) {
    if (row.kind === "file") {
      const { file } = row;
      return v_flex().gap(6).pt(row.fi ? UI.inset : 0).pb(6)
        .child(div().font_semibold().when(this.hud, (el) => el.font_family(mono())).child(file.old_path && file.old_path !== file.path ? `${file.old_path} → ${file.path}` : file.path))
        .child(this.hud && !file.skipped ? this.label(t, file.status, t.muted)
          : div().text_size(UI.small).text_color(t.muted).child(file.skipped ? `Skipped: ${file.skipped}` : file.status));
    }
    if (row.kind === "hunk") return div().pt(row.hi ? 6 : 0).pb(1)
      .child(div().px(UI.gap).py(4).text_color(t.working).font_family(this.hud ? mono() : "Menlo").text_size(UI.small)
        .when(!this.hud, (el) => el.bg(solid(t.selected)))
        .when(this.hud, (el) => el.relative().children(frame(6, { bg: t.accent + "12", line: t.accent + "66" })))
        .child(row.hunk.header));
    const { line, path } = row;
    const color = line.kind === "+" ? t.done : line.kind === "-" ? t.ansi1 : t.foreground;
    const open = line.new !== null && this.review.state === "done" && !this.commentAt && !this.saving && !this.posting;
    return div().pb(1).child(h_flex().w_full().min_h(24).items_start().gap(UI.gap).px(6).py(2)
      .bg(line.kind === "+" || line.kind === "-" ? solid(color) + "12" : solid(t.background))
      .text_color(color).font_family("Menlo").text_size(UI.small).rounded(this.hud ? 0 : 3)
      .when(open, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)))
      .accessibility_label(`${path}, old ${line.old ?? "none"}, new ${line.new ?? "none"}: ${line.text}`)
      .child(div().w(40).flex_none().text_color(t.muted).child(line.old === null ? "" : String(line.old)))
      .child(div().w(40).flex_none().text_color(t.muted).child(line.new === null ? "" : String(line.new)))
      .child(div().w(12).flex_none().child(line.kind))
      .child(div().min_w(0).flex_1().child(line.text)));
  }

  commentForm(t) {
    return v_flex().flex_none().p(UI.inset).gap(UI.gap).border_t(1).border_color(t.working).bg(solid(t.chrome))
      .child(this.hud ? h_flex().gap(6).items_center().child(caps("Comment on", 13, 700).text_color(t.accent))
        .child(div().font_family(mono()).child(`${this.commentAt.path}:${this.commentAt.line}`))
        : div().font_semibold().child(`Comment on ${this.commentAt.path}:${this.commentAt.line}`))
      .child(h_flex().gap(6).items_center().flex_wrap().child(this.hud ? caps("Severity", 11.5, 600).text_color(t.muted) : "Severity")
        .children(SEVERITIES.map((s) => this.action(t, `severity-${s}`, s, (cx) => { this.severity = s; cx.notify(); }, this.saving, this.severity === s))))
      .child(this.field(t, "Title"))
      .child(Input.new(this.commentTitle).h(30).w_full().px(UI.gap).bg(solid(t.background)).border_1().border_color(t.border)
        .focus((s) => s.border_color(t.working)).text_color(t.foreground).accessibility_label("Comment title"))
      .child(this.field(t, "Body"))
      .child(Textarea.new(this.commentBody).h(72).w_full().px(UI.gap).bg(solid(t.background)).border_1().border_color(t.border)
        .focus((s) => s.border_color(t.working)).text_color(t.foreground).accessibility_label("Comment body"))
      .when(Boolean(this.commentProblem), (el) => el.child(div().text_color(t.ansi1).child(this.commentProblem)))
      .child(h_flex().gap(UI.gap).justify_end()
        .child(this.action(t, "comment-cancel", "Cancel", (cx) => { this.commentAt = null; this.commentTitle.set_value(""); this.commentBody.set_value(""); cx.notify(); }, this.saving))
        .child(this.action(t, "comment-save", this.saving ? "Saving..." : "Save", (cx) => this.saveComment(cx), this.saving || !this.commentTitle.value().trim(), true)));
  }

  dialog(t) {
    const r = this.review, posted = postedIds(r);
    const index = this.history.findIndex((entry) => entry.file === this.file);
    const historyBusy = this.busy || this.posting || this.saving || Boolean(this.commentAt);
    const paths = [...new Set((r?.findings ?? []).map((f) => f.path))];
    const tone = r?.verdict === "good" ? t.done : r?.verdict === "changes" ? t.ansi1 : t.ansi3;
    const rule = this.hud ? t.accent + "33" : t.border;
    const mark = (s) => this.hud ? div().font_family(mono()).child(s) : s;
    return v_flex().id("review-dialog").track_focus(this.handle).size_full().min_h(0).overflow_hidden()
      .when(!this.hud, (el) => el.rounded(UI.radius).bg(solid(t.background)).border_1().border_color(t.accent).shadow_2xl())
      .when(this.hud, (el) => el.relative().children(modalFrame(t, 16)))
      .text_size(UI.prose).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.keystroke === "escape") { cx.stop_propagation(); closeOverlay(props().overlay); } })
      .child(v_flex().flex_none().gap(UI.gap).border_b(1).border_color(rule)
        .when(!this.hud, (el) => el.p(20))
        .when(this.hud, (el) => el.px(20).pt(18).pb(14))
        .child(h_flex().gap(UI.inset).items_start()
          .child(this.hud ? h_flex().flex_1().min_w(0).gap(UI.inset).items_center()
            .child(hudTitle(t, "Review", 16))
            .when(Boolean(r), (el) => el.child(div().min_w(0).flex_1().truncate().font_family(display()).font_weight(700).text_size(18).text_color(t.foreground).child(`#${r.pr.number} ${r.pr.title}`)))
            : div().flex_1().min_w(0).font_semibold().text_size(UI.title).child(r ? `#${r.pr.number} ${r.pr.title}` : "Review"))
          .child(this.hud ? this.closeButton(t) : this.action(t, "review-close", "Esc", () => closeOverlay(props().overlay))))
        .when(Boolean(r), (el) => el.child(h_flex().gap(UI.gap).flex_wrap().text_size(UI.small).text_color(t.muted)
          .when(this.hud, (h) => h.items_center())
          .child(mark(`${r.pr.head} → ${r.pr.base}`)).child(this.badge(t, r.repo.forge === "github" ? "GitHub" : "Gitea"))
          .when(r.state === "done" && Boolean(r.verdict), (el) => el.child(this.hud ? this.chip(t, r.verdict, tone) : this.badge(t, r.verdict, tone)))
          .when(Boolean(r.source), (el) => el.child(this.badge(t, r.source.name, t.working)))
          .when(r.source?.kind === "runner", (el) => el
            .child(mark(r.model || "Model pending"))
            .child(mark(elapsed(r.state === "running" ? Date.now() - Date.parse(r.started_at) : r.duration_ms)))
            .child(mark(`$${Number(r.cost_usd ?? 0).toFixed(2)}`))))))
      .when(this.history.length > 1, (el) => el.child(h_flex().flex_none().px(20).pb(UI.gap).gap(UI.gap).items_center()
        .child(this.action(t, "history-newer", "Newer", (cx) => this.selectReview(cx, this.history[index - 1].file), historyBusy || index <= 0))
        .child(div().flex_1().min_w(0).truncate().text_size(UI.small).text_color(t.muted)
          .child(`${index + 1} / ${this.history.length} · ${r?.source?.name ?? this.history[index]?.source?.name ?? "Review"} · ${elapsed(Date.now() - Date.parse(this.history[index]?.started_at ?? new Date().toISOString()))} ago`))
        .child(this.action(t, "history-older", "Older", (cx) => this.selectReview(cx, this.history[index + 1].file), historyBusy || index < 0 || index >= this.history.length - 1))))
      .child(h_flex().flex_none().px(20).pb(UI.gap).gap(6)
        .children(["findings", "diff"].map((tab) => this.action(t, `tab-${tab}`, tab === "diff" ? "Diff" : "Findings", (cx) => { this.tab = tab; cx.notify(); }, false, this.tab === tab))))
      .child(v_flex().id("review-content").flex_1().min_h(0).when(this.tab !== "diff", (el) => el.overflow_y_scrollbar()).px(20).py(UI.inset).gap(UI.inset)
        .when(Boolean(this.problem), (el) => el.child(div().text_color(t.ansi1).child(this.problem)))
        .when(!r && !this.problem, (el) => el.child(div().text_color(t.muted).child("Reading review...")))
        .when(r?.state === "running", (el) => el.child(h_flex().gap(UI.gap).items_center()
          .child(this.hud ? spinner(t.working, 14, 1200) : svg("mods/workspace-chrome/spinner.svg").size(14).text_color(t.working).spin(1200))
          .child(`${r.phase ?? "fetching"}: review running. Findings will appear here.`)))
        .when(r?.state === "failed", (el) => el.child(v_flex().gap(UI.gap)
          .child(div().text_color(t.ansi1).child(r.error || "Review failed. Re-run from the panel."))
          .child(TextView.markdown("review-log", `Log: ${r.log}`).selectable().text_color(t.muted))))
        .when(r?.state === "done" && Boolean(r.error), (el) => el.child(TextView.markdown("review-error", r.error).selectable().text_color(t.ansi1)))
        .when(this.tab === "diff", (el) => el.child(this.diffView(t)))
        .when(this.tab === "findings", (el) => el
          .when(Boolean(r?.summary), (el) => el.child(TextView.markdown("review-summary", r.summary).selectable().w_full().text_size(UI.prose)))
          .when(r?.state === "done" && !r.findings.length, (el) => el.child(div().text_color(t.done).child("No findings.")))
          .children(paths.map((path) => v_flex().gap(this.hud ? 10 : 4).pt(UI.inset)
          .child(this.hud ? TextView.markdown(`path-${path}`, path).selectable().text_size(UI.body).text_color(t.working).font_family(mono())
            : TextView.markdown(`path-${path}`, path).selectable().text_size(UI.body).text_color(t.working))
          .children(r.findings.filter((f) => f.path === path).map((f) => this.finding(t, f, posted)))))
          .when(Boolean(r?.skipped?.length), (el) => el.child(div().text_size(UI.small).text_color(t.muted).child(`Skipped: ${r.skipped.join(", ")}`)))))
      .when(Boolean(this.commentAt) && this.tab === "diff", (el) => el.child(this.commentForm(t)))
      .child(v_flex().flex_none().px(20).py(UI.inset).gap(UI.gap).border_t(1).border_color(rule)
        .when(!this.hud, (el) => el.bg(solid(t.chrome)))
        .when(Boolean(this.postProblem), (el) => el.child(TextView.markdown("post-error", this.postProblem).selectable().text_color(t.ansi1)))
        .when(Boolean(this.postUrl), (el) => el.child(TextView.markdown("post-url", `Posted: [${this.postUrl}](${this.postUrl})`).selectable().text_color(t.done)))
        .child(h_flex().gap(UI.inset).items_center()
          .child(div().flex_1().text_size(UI.small).text_color(t.muted).child("Post selected findings as a comment."))
          .child(this.action(t, "review-post", this.posting ? "Posting..." : `Post ${this.selected.size}`, (cx) => this.post(cx),
            this.posting || this.saving || Boolean(this.commentAt) || this.busy || Boolean(this.problem) || r?.state !== "done" || !this.selected.size, true))));
  }

  render(cx) {
    if (this.headless) { if (!checking()) this.tick(cx); return div(); }
    const t = theme();
    this.hud = isHud();
    return this.file ? this.dialog(t) : this.panel(t);
  }
}
