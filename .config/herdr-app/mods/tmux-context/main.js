// tmux-context: the strip above Herdr's Files and Changes panels in the netrunner layout, and the
// folder those panels show.
//
// Herdr knows a terminal's folder only from its process, and a tmux client's is wherever
// `tmux attach` started. So this asks `omo-status where <terminal>` which tmux pane the focused
// client shows and publishes that pane's folder as shared "tmux.where" ({terminal, tmux, cwd, on,
// pane, pinned, branch}; tmux: false for any other terminal), which files-tmux and changes-tmux show
// in place of Herdr's and workspace-status-tmux takes its branch from. Every tmux client in the shown
// tab gets its folder in shared "tmux.panes" ({<terminal>: {cwd}}), for pane-tmux's headers. Herdr
// keeps this running while the panel is hidden, so the headers and the status bar don't need it open. It asks again when Herdr's focus moves, when tmux changes pane, window or
// session (.tmux.conf's hooks touch ~/.local/state/omo-status/where/tick, which this watches), and
// every 3 seconds, for a `cd` and for another machine's tmux, whose hooks can't reach that file.
//
// The strip shows the owt workspace and its title (`owt title` keeps it in <git dir>/owt-title),
// the repo, the branch with its upstream and its default branch's counts, the uncommitted files,
// the Linear issue the branch names, the branch's PR and its checks (`gh pr view`, kept a
// minute), and the omo agents of the session working in this folder (a click shows the pane).
// Linear links come from ~/.config/herdr-app/linear.json ({"<workspace>": ["<team key>", ...]}),
// kept out of the dotfiles repo; an issue of any other team copies its id instead.
// The folder's name opens a list of the session's other folders: picking one pins the panels to
// that pane (shared "tmux.pins", per terminal), and "Follow the active pane" lets go.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, appHome, focused, panes, spaces, readTextFile, watchFolder, shared, setShared, theme, props, openOverlay, closeOverlay, notify, nextCommand } from "herdr";

const SEP = "|^|";
const RANK = { error: 6, input: 5, done: 4, working: 3, background: 2, idle: 1 };
// Window names tmux picks by itself say nothing about the work.
const GENERIC = new Set(["bun", "node", "omo", "zsh", "bash", "fish", "sh", "mosh-client", "ssh"]);
const POLL = 3000;
const GIT_EVERY = 10000;
const PR_FOR = 60000;
const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
// The netrunner theme's Cyberpunk yellow, which marks the server's tmux and agents.
const REMOTE = "#fcee0a";

const tickDir = () => `${home()}/.local/state/omo-status/where`;
const machineOf = (terminal) => (terminal?.includes("/") ? terminal.split("/")[0] : null);
const base = (path) => (path ?? "").split("/").filter(Boolean).pop() ?? "";
const tilde = (path) => (path ?? "").replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~");
const inside = (path, root) => Boolean(path && root) && (path === root || path.startsWith(root + "/"));
const short = (ref) => (ref ?? "").replace(/^origin\//, "");

// One `sh -c` for everything git knows, so a folder on another machine costs one round trip.
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie), as in Herdr's
// own panels: the Changes panel's folder watch would see it.
const CONTEXT = `cd "$1" 2>/dev/null || exit 3
g() { git --no-optional-locks -c core.fsmonitor=false -c diff.autoRefreshIndex=false "$@" 2>/dev/null; }
top=$(g rev-parse --show-toplevel) || exit 0
gitdir=$(g rev-parse --absolute-git-dir)
common=$(cd "$(g rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
printf 'top\\t%s\\ngitdir\\t%s\\ncommon\\t%s\\n' "$top" "$gitdir" "$common"
printf 'branch\\t%s\\n' "$(g symbolic-ref --quiet --short HEAD)"
printf 'head\\t%s\\n' "$(g rev-parse --short HEAD)"
[ -r "$gitdir/owt-title" ] && printf 'title\\t%s\\n' "$(head -n 1 "$gitdir/owt-title")"
up=$(g rev-parse --abbrev-ref '@{upstream}') && printf 'upstream\\t%s\\t%s\\n' "$up" "$(g rev-list --left-right --count '@{upstream}...HEAD')"
main=$(g symbolic-ref --quiet --short refs/remotes/origin/HEAD)
if [ -z "$main" ]; then for b in origin/main origin/master main master; do g rev-parse --verify --quiet "$b^{commit}" >/dev/null && { main=$b; break; }; done; fi
[ -n "$main" ] && printf 'base\\t%s\\t%s\\n' "$main" "$(g rev-list --left-right --count "$main...HEAD")"
printf 'changed\\t%s\\n' "$(g status --porcelain=v1 --untracked-files=all | wc -l | tr -d ' ')"
`;

function parseWhere(stdout) {
  let client = null, session = null;
  const list = [];
  for (const line of stdout.split("\n")) {
    const f = line.split(SEP);
    if (f[0] === "client") { client = f[1]; session = f[2] ?? null; }
    if (f[0] !== "pane") continue;
    const [, omo, pane, windowIndex, windowName, windowActive, paneActive, program, path, state, name, ...msg] = f;
    list.push({ pane, window: Number(windowIndex), windowName, active: windowActive === "1" && paneActive === "1", program, path, state, name, msg: msg.join(SEP), omo: omo === "omo" || Boolean(state) });
  }
  return client ? { client, session, panes: list } : null;
}

function parseContext(stdout) {
  const git = {};
  for (const line of stdout.split("\n")) {
    const [key, ...rest] = line.split("\t");
    if (!key) continue;
    if (key === "upstream" || key === "base") git[key] = { ref: rest[0], behind: Number(rest[1]) || 0, ahead: Number(rest[2]) || 0 };
    else if (key === "changed") git.changed = Number(rest[0]) || 0;
    else git[key] = rest.join("\t");
  }
  if (!git.top) return null;
  git.repo = git.common?.endsWith("/.git") ? base(git.common.slice(0, -5)) : base(git.common).replace(/\.git$/, "") || base(git.top);
  git.worktree = Boolean(git.gitdir && git.common && git.gitdir !== git.common);
  return git;
}

function summarizePr(j) {
  let pass = 0, fail = 0, pending = 0;
  for (const c of j.statusCheckRollup ?? []) {
    const s = String(c.conclusion || c.state || c.status || "").toUpperCase();
    if (/FAILURE|ERROR|TIMED_OUT|CANCELLED|ACTION_REQUIRED|STARTUP_FAILURE/.test(s)) fail++;
    else if ((c.status && c.status !== "COMPLETED") || /PENDING|EXPECTED|QUEUED|IN_PROGRESS|WAITING|REQUESTED/.test(s)) pending++;
    else pass++;
  }
  return { number: j.number, state: j.isDraft && j.state === "OPEN" ? "DRAFT" : j.state, url: j.url, review: j.reviewDecision || null, pass, fail, pending };
}

// A Linear issue id at the start of a branch's last part: "someone/abc-27-fix-the-login".
function issueOf(branch) {
  const m = /(?:^|\/)([a-z][a-z0-9]{1,6})-(\d+)(?=-|$)/i.exec(branch ?? "");
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

// The session's folders, each with the pane the panels pin to: omo's first, the most urgent first.
function foldersOf(list) {
  const byPath = new Map();
  for (const p of list) {
    if (!p.path) continue;
    const f = byPath.get(p.path) ?? { path: p.path, panes: [] };
    f.panes.push(p);
    byPath.set(p.path, f);
  }
  return [...byPath.values()].map((f) => {
    const ranked = [...f.panes].sort((a, b) => Number(b.omo) - Number(a.omo) || (RANK[b.state] ?? 0) - (RANK[a.state] ?? 0));
    const agents = ranked.filter((p) => p.omo);
    return { path: f.path, pane: ranked[0].pane, agents, active: f.panes.some((p) => p.active) };
  });
}

const label = (p) => p.name || (GENERIC.has(p.windowName) ? base(p.path) || "~" : p.windowName);

export default class TmuxContext extends View {
  init(_props, cx) {
    if (props()?.picker) return;
    this.terminal = undefined;
    this.where = null;
    this.ctx = null;
    this.prs = new Map();
    this.linear = {};
    this.loadLinear(cx);
    this.resolve(cx);
    cx.timer.every(POLL, (cx) => this.resolve(cx));
    cx.timer.every(300000, (cx) => this.loadLinear(cx));
    // `tmux-context.pick` (a key in keys.json, or `herdr-app do tmux-context.pick`) opens the folder list.
    cx.spawn(async () => {
      for (;;) if ((await nextCommand()) === "pick") this.openPicker();
    });
    // tmux's hooks touch the tick file when a client changes pane, window or session.
    cx.spawn(async (cx) => {
      await exec("mkdir", ["-p", tickDir()]).catch(() => null);
      for (;;) {
        try { await watchFolder(tickDir()); } catch { return; }
        this.resolve(cx);
      }
    });
  }

  loadLinear(cx) {
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${appHome()}/linear.json`).catch(() => null);
      const teams = {};
      try {
        for (const [workspace, keys] of Object.entries(text ? JSON.parse(text) : {})) for (const k of keys ?? []) teams[String(k).toUpperCase()] = workspace;
      } catch { /* a broken file links nothing */ }
      this.linear = teams;
      cx.notify();
    });
  }

  herdrFolder() {
    const f = focused(), space = spaces().find((s) => s.active);
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    return pane?.cwd || f?.cwd || space?.folder || null;
  }

  folder() {
    const terminal = focused()?.terminal ?? null;
    if (!terminal) return this.herdrFolder();
    if (this.where?.terminal !== terminal) return null;
    return this.where.tmux ? this.where.cwd : this.herdrFolder();
  }

  ctxKey() {
    return JSON.stringify([machineOf(focused()?.terminal), this.folder()]);
  }

  resolve(cx) {
    if (this.resolving) { this.again = true; return; }
    const terminal = focused()?.terminal ?? null;
    this.terminal = terminal;
    if (!terminal) { this.where = null; this.loadContext(cx); cx.notify(); return; }
    this.resolving = true;
    cx.spawn(async (cx) => {
      let found = null;
      try {
        const r = await exec(`${home()}/.local/bin/omo-status`, ["where", terminal], { timeout: 10000 });
        if (r.code === 0) found = parseWhere(r.stdout);
      } catch { found = null; }
      this.resolving = false;
      if ((focused()?.terminal ?? null) !== terminal || this.again) { this.again = false; this.resolve(cx); return; }
      const on = machineOf(terminal), pins = shared("tmux.pins") ?? {};
      this.pinSeen = pins[terminal] ?? null;
      if (!found) this.where = { terminal, tmux: false, on };
      else {
        const pinned = found.panes.find((p) => p.pane === pins[terminal]);
        const shown = pinned ?? found.panes.find((p) => p.pane === found.client) ?? found.panes.find((p) => p.active);
        this.where = { terminal, tmux: true, on, cwd: shown?.path ?? null, pane: shown?.pane ?? null, pinned: Boolean(pinned), session: found.session, panes: found.panes };
      }
      this.publish();
      this.resolveOthers(cx, terminal);
      this.loadContext(cx);
      cx.notify();
    });
  }

  publish() {
    const w = this.where;
    if (!w) return;
    const g = this.ctx?.key === this.ctxKey() ? this.ctx.git : null;
    const published = { terminal: w.terminal, tmux: w.tmux, on: w.on, cwd: w.cwd ?? null, pane: w.pane ?? null, pinned: w.pinned ?? false, branch: g ? g.branch || g.head || null : null };
    if (JSON.stringify(shared("tmux.where")) !== JSON.stringify(published)) setShared("tmux.where", published);
  }

  // The other tmux clients in the shown tab, for their pane headers. A terminal that is no tmux
  // client is left out, and its header keeps Herdr's folder.
  resolveOthers(cx, terminal) {
    const f = focused(), pins = shared("tmux.pins") ?? {};
    const others = panes().filter((p) => p.tab === f?.tab && p.terminal && p.terminal !== terminal).map((p) => p.terminal);
    cx.spawn(async () => {
      const map = {};
      if (this.where?.tmux && this.where.terminal === terminal) map[terminal] = { cwd: this.where.cwd };
      for (const other of others) {
        const r = await exec(`${home()}/.local/bin/omo-status`, ["where", other], { timeout: 10000 }).catch(() => null);
        const found = r?.code === 0 ? parseWhere(r.stdout) : null;
        const shown = found && (found.panes.find((p) => p.pane === pins[other]) ?? found.panes.find((p) => p.pane === found.client));
        if (shown) map[other] = { cwd: shown.path };
      }
      if (JSON.stringify(shared("tmux.panes")) !== JSON.stringify(map)) setShared("tmux.panes", map);
    });
  }

  loadContext(cx) {
    const key = this.ctxKey(), folder = this.folder(), on = machineOf(focused()?.terminal);
    if (!folder) return;
    if (this.ctx?.key === key && Date.now() - this.ctx.at < GIT_EVERY) return this.loadPr(cx);
    if (this.ctxLoading === key) return;
    this.ctxLoading = key;
    cx.spawn(async (cx) => {
      let git = null;
      try {
        const r = await exec("sh", ["-c", CONTEXT, "tmux-context", folder], { on, timeout: 10000 });
        if (r.code === 0) git = parseContext(r.stdout);
      } catch { git = null; }
      this.ctxLoading = null;
      if (this.ctxKey() !== key) return;
      this.ctx = { key, at: Date.now(), folder, on, git };
      this.publish();
      this.loadPr(cx);
      cx.notify();
    });
  }

  loadPr(cx) {
    const g = this.ctx?.git, on = this.ctx?.on;
    if (!g?.branch || g.branch === short(g.base?.ref)) return;
    const key = JSON.stringify([on, g.top, g.branch]), hit = this.prs.get(key);
    if (hit && (hit.loading || Date.now() - hit.at < PR_FOR)) return;
    this.prs.set(key, { ...hit, loading: true });
    cx.spawn(async (cx) => {
      let data = null;
      try {
        const r = await exec("gh", ["pr", "view", "--json", "number,state,isDraft,url,reviewDecision,statusCheckRollup"], { cwd: g.top, on, timeout: 20000 });
        if (r.code === 0) data = summarizePr(JSON.parse(r.stdout));
      } catch { data = null; }
      this.prs.set(key, { at: Date.now(), data, loading: false });
      cx.notify();
    });
  }

  pr() {
    const g = this.ctx?.git;
    return g?.branch ? this.prs.get(JSON.stringify([this.ctx.on, g.top, g.branch])) ?? null : null;
  }

  show(p) {
    const machine = this.where?.on;
    exec(`${home()}/.local/bin/omo-status`, ["show", machine ? `${machine}/${p.pane}` : p.pane]).catch(() => null);
  }

  openIssue(id) {
    const workspace = this.linear[id.split("-")[0]];
    if (workspace) { exec("open", [`https://linear.app/${workspace}/issue/${id}`]).catch(() => null); return; }
    exec("sh", ["-c", 'printf %s "$1" | /usr/bin/pbcopy', "tmux-context", id])
      .then(() => notify({ title: `Copied ${id}`, body: "Add its team to ~/.config/herdr-app/linear.json to open it in Linear.", timeout: 4000 }))
      .catch(() => null);
  }

  openPicker() {
    const w = this.where;
    if (!w?.tmux) return;
    const folders = foldersOf(w.panes);
    openOverlay({
      mod: "tmux-context",
      kind: "popup",
      width: 420,
      height: Math.min(64 + (folders.length + 1) * 46, 460),
      props: { picker: { terminal: w.terminal, session: w.session, pinned: w.pinned ? w.pane : null, shown: w.cwd, folders } },
    });
  }

  status(t, state, size = 12) {
    if (state === "working") return svg(ICON("spinner")).size(size).flex_none().text_color(t.working).spin(900);
    if (state === "background") return svg(ICON("spinner")).size(size).flex_none().text_color(t.ansi5).spin(2400);
    if (state === "input" || state === "error") {
      const color = state === "error" ? t.ansi1 : t.blocked;
      return div().flex_none().px(6).h(17).rounded(5).bg(color + "26").text_size(10.5).font_semibold().text_color(color)
        .flex().items_center().loop("opacity", { from: 0.55, to: 1, period: 1600 }).child(state === "error" ? "Failed" : "Needs you");
    }
    if (state === "done") return div().size(7).mx(2).flex_none().rounded(4).bg(t.done);
    return div().size(7).mx(2).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  }

  chip(t, id, color, children, onClick, tip) {
    return h_flex().id(id).h(20).px(7).gap(5).flex_none().items_center().rounded(5).bg(color + "1f").text_color(color)
      .text_size(11).font_medium()
      .when(Boolean(onClick), (el) => el.cursor_pointer().hover((s) => s.bg(color + "38")).on_click(() => onClick()))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .children(children);
  }

  titleRow(t, g, w, folder) {
    const name = folder === home() || !folder ? "~" : g?.worktree ? base(g.top) : g ? g.repo : base(folder);
    const many = w?.tmux && foldersOf(w.panes ?? []).length > 1;
    const subtitle = g?.title ?? (g?.worktree ? null : g && g.top !== folder ? tilde(folder).replace(tilde(g.top), "").replace(/^\//, "") : null);
    const machine = w?.on ?? null;
    return h_flex().h(24).gap(8).items_center().min_w(0)
      .child(h_flex().id("tmux-context-folder").h(24).px(6).ml(-6).gap(6).flex_none().max_w(260).items_center().rounded(6)
        .when(Boolean(w?.tmux), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.openPicker()))
        .tooltip(w?.pinned ? `Pinned to this pane: ${tilde(folder)}. Pick "Follow the active pane" to let go.` : tilde(folder) || "No folder")
        .child(svg(ICON(w?.pinned ? "pin" : "folder")).size(14).flex_none().text_color(w?.pinned ? t.accent : t.muted))
        .child(div().min_w(0).truncate().font_semibold().child(name))
        .when(many || Boolean(w?.pinned), (el) => el.child(svg(ICON("chevron-down")).size(12).flex_none().text_color(t.dim))))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(subtitle ?? ""))
      .when(Boolean(g?.worktree), (el) => el.child(div().flex_none().max_w(200).truncate().text_size(11.5).text_color(t.dim).child(g.repo)))
      .when(Boolean(machine), (el) => el.child(h_flex().h(18).px(6).gap(4).flex_none().items_center().rounded(4).bg(REMOTE + "1f")
        .text_size(10.5).font_medium().text_color(REMOTE).child(svg(ICON("server")).size(11)).child(machine)));
  }

  branchRow(t, g, folder) {
    const row = h_flex().h(20).gap(10).items_center().min_w(0).text_size(11.5).text_color(t.dim);
    if (!folder) return row.child(div().child(""));
    if (!g) return row.child(div().child(this.ctx ? "Not a git repository" : "Reading git…"));
    const parts = [];
    const up = g.upstream, main = g.base, onMain = g.branch && g.branch === short(main?.ref);
    if (!g.branch) parts.push(div().flex_none().text_color(t.blocked).child(`detached at ${g.head}`));
    if (g.branch && !up) parts.push(div().flex_none().child("not pushed"));
    if (up) {
      if (!up.ahead && !up.behind) parts.push(div().flex_none().tooltip(`In step with ${up.ref}`).child(`synced with ${up.ref.split("/")[0]}`));
      else parts.push(h_flex().flex_none().gap(4).tooltip(`${up.ahead} to push, ${up.behind} to pull (${up.ref})`)
        .when(up.ahead > 0, (el) => el.child(div().text_color(t.ansi2).child(`↑${up.ahead}`)))
        .when(up.behind > 0, (el) => el.child(div().text_color(t.blocked).child(`↓${up.behind}`))));
    }
    if (main && !onMain) {
      const name = short(main.ref);
      const text = main.ahead && main.behind ? `${main.ahead} ahead of ${name} · ${main.behind} behind`
        : main.ahead ? `${main.ahead} ahead of ${name}` : main.behind ? `${main.behind} behind ${name}` : `even with ${name}`;
      parts.push(div().flex_none().tooltip(`${main.ahead} commits not on ${main.ref}, ${main.behind} of its commits not here`).child(text));
    }
    parts.push(div().flex_none().text_color(g.changed ? t.blocked : t.dim).child(g.changed ? `${g.changed} uncommitted` : "clean"));
    return row
      .child(h_flex().flex_1().min_w(60).gap(5).items_center()
        .child(svg(ICON("git-branch")).size(12).flex_none().text_color(t.muted))
        .child(div().min_w(0).truncate().text_color(t.foreground).child(g.branch || g.head)))
      .children(parts);
  }

  linksRow(t, g) {
    const row = h_flex().h(20).gap(6).items_center().min_w(0).text_size(11.5).text_color(t.dim);
    if (!g) return null;
    const issue = issueOf(g.branch), pr = this.pr(), onMain = g.branch && g.branch === short(g.base?.ref);
    if (issue) {
      const linked = Boolean(this.linear[issue.split("-")[0]]);
      row.child(this.chip(t, "tmux-context-issue", t.ansi4, [div().child(issue)], () => this.openIssue(issue), linked ? `Open ${issue} in Linear` : `Copy ${issue}`));
    }
    if (!g.branch || onMain) return row.when(!issue, (el) => el.child(div().child(onMain ? `On ${g.branch}` : "")));
    if (!pr || (pr.loading && !pr.data)) return row.child(div().child("Looking for a PR…"));
    if (!pr.data) return row.child(div().child("No PR"));
    const p = pr.data;
    const color = { OPEN: t.ansi2, DRAFT: t.muted, MERGED: t.ansi5, CLOSED: t.ansi1 }[p.state] ?? t.muted;
    row.child(this.chip(t, "tmux-context-pr", color, [div().child(`PR #${p.number}`), div().opacity(0.8).child(p.state.toLowerCase())], () => exec("open", [p.url]).catch(() => null), `Open ${p.url}`));
    if (p.review === "APPROVED") row.child(this.chip(t, "tmux-context-review", t.ansi2, [svg(ICON("check")).size(11), div().child("approved")]));
    if (p.review === "CHANGES_REQUESTED") row.child(this.chip(t, "tmux-context-review", t.ansi1, [div().child("changes requested")]));
    if (p.fail) row.child(this.chip(t, "tmux-context-checks", t.ansi1, [svg(ICON("x")).size(11), div().child(`${p.fail} failing`)]));
    else if (p.pending) row.child(this.chip(t, "tmux-context-checks", t.working, [svg(ICON("spinner")).size(11).spin(900), div().child(`${p.pending} running`)]));
    else if (p.pass) row.child(this.chip(t, "tmux-context-checks", t.ansi2, [svg(ICON("check")).size(11), div().child(`${p.pass} passed`)]));
    return row;
  }

  agentRow(t, w, g, folder) {
    const row = h_flex().h(22).gap(8).items_center().min_w(0).text_size(12);
    if (!w?.tmux) return row.child(div().text_size(11.5).text_color(t.dim).child(w ? "Not a tmux client: Herdr's own folder" : ""));
    // In a repo, every agent anywhere in it; elsewhere (~), only the ones in this very folder.
    const here = w.panes.filter((p) => p.omo && (g ? inside(p.path, g.top) : p.path === folder))
      .sort((a, b) => (RANK[b.state] ?? 0) - (RANK[a.state] ?? 0) || Number(b.pane === w.pane) - Number(a.pane === w.pane));
    if (!here.length) return row.child(div().text_size(11.5).text_color(t.dim).child(`No omo here in tmux session ${w.session ?? ""}`));
    const p = here[0];
    return row
      .child(h_flex().id("tmux-context-agent").flex_1().min_w(0).h(22).px(6).ml(-6).gap(8).items_center().rounded(6).cursor_pointer()
        .hover((s) => s.bg(t.hover)).tooltip(`Show this pane (${w.session}: ${p.windowName})`).on_click(() => this.show(p))
        .child(this.status(t, p.state || "idle"))
        .child(div().flex_none().max_w(240).truncate().text_color(p.state === "idle" || !p.state ? t.muted : t.foreground).child(label(p)))
        .when(Boolean(p.msg), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(p.msg))))
      .when(here.length > 1, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).tooltip(here.slice(1).map(label).join(", ")).child(`+${here.length - 1} more`)));
  }

  picker(t) {
    const { terminal, session, pinned, shown, folders } = props().picker;
    const choose = (pane) => {
      const pins = { ...(shared("tmux.pins") ?? {}) };
      if (pane) pins[terminal] = pane;
      else delete pins[terminal];
      setShared("tmux.pins", pins);
      closeOverlay(props().overlay);
    };
    const row = (id, selected, icon, title, detail, onClick) => h_flex().id(id).h(42).flex_none().px(10).gap(10).items_center().rounded(7)
      .cursor_pointer().when(selected, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click(onClick)
      .child(icon)
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().child(title))
        .when(Boolean(detail), (el) => el.child(div().truncate().text_size(11.5).text_color(t.dim).child(detail))));
    return v_flex().id("tmux-context-picker").size_full().p(6).gap(2).text_size(13).text_color(t.foreground)
      .child(div().px(10).pt(4).pb(6).text_size(11.5).font_medium().text_color(t.dim).child(`Show in Files and Changes: tmux session ${session ?? ""}`))
      .child(row("pick-follow", !pinned, svg(ICON("pin-off")).size(14).flex_none().text_color(t.muted), "Follow the active pane", "The panels go where you go in tmux", () => choose(null)))
      .children(folders.map((f) => {
        const top = f.agents[0];
        const detail = f.agents.length ? f.agents.map(label).join(", ") : tilde(f.path).split("/").slice(0, -1).join("/") || "~";
        const selected = pinned ? f.pane === pinned : false;
        return row(`pick-${f.pane}`, selected, top ? this.status(t, top.state || "idle", 13) : svg(ICON("folder")).size(14).flex_none().text_color(t.muted),
          h_flex().gap(6).child(div().child(tilde(f.path) === "~" ? "~" : base(f.path))).when(f.path === shown && !pinned, (el) => el.child(div().text_size(11).text_color(t.dim).child("active"))),
          detail, () => choose(f.pane));
      }));
  }

  render(cx) {
    const t = theme();
    if (props()?.picker) return this.picker(t);
    const terminal = focused()?.terminal ?? null, pins = shared("tmux.pins") ?? {};
    if (terminal !== this.terminal || (terminal && (pins[terminal] ?? null) !== (this.pinSeen ?? null))) this.resolve(cx);
    const w = this.where?.terminal === terminal ? this.where : null;
    const folder = this.folder();
    const ctx = this.ctx?.key === this.ctxKey() ? this.ctx : null;
    const g = ctx?.git ?? null;
    return v_flex().id("tmux-context").size_full().min_h(0).px(14).py(9).gap(4).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .when(terminal && !w, (el) => el.child(div().text_size(12).text_color(t.dim).child("Finding the tmux pane…")))
      .when(!terminal || Boolean(w), (el) => el
        .child(this.titleRow(t, g, w, folder))
        .child(this.branchRow(t, ctx ? g : null, folder))
        .when(Boolean(g), (el) => el.child(this.linksRow(t, g)))
        .child(this.agentRow(t, w, g, folder)));
  }
}
