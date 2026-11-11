// changes-tmux: Herdr's `changes` (base/changes.js; herdr-tmux-update merges Herdr's later changes
// in) for tmux clients. A client's own folder is only where `tmux attach` started, so this shows the
// repo of the tmux pane the client shows, which tmux-context publishes as shared "tmux.where".
//
// Three views of the repo: Uncommitted (Herdr's: the work tree against HEAD), Branch (everything the
// branch changes since it left the default branch, uncommitted work included) and Commits (the
// commits not on the default branch, each opening its whole patch). An owt worktree (a linked
// worktree) opens on Branch, anything else on Uncommitted; a view you pick is kept per repo.
// An open file can be previewed (the preview mod), edited in nvim at its first change, or have its
// path:line copied. Herdr's Commit button is gone: it committed everything with `git add -A`.
// keys.json (or `herdr-app do changes-tmux.<command>`) can reach all of it: uncommitted, branch,
// commits pick the view; preview, edit, copy act on the open file (copy: the open commit's hash too).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, shared, run, notify, nextCommand } from "herdr";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  // A mod pane (a preview opened from here) keeps the folder its tab's client showed.
  const where = shared("tmux.where");
  const mine = f?.terminal ? where?.terminal === f.terminal : Boolean(f?.tab) && where?.tab === f.tab;
  // Until tmux-context has looked at this terminal, nothing: not the client's folder for a moment.
  if (f?.terminal && !mine) return { cwd: null, on, pending: true };
  if (mine && where.tmux) return { cwd: where.cwd, on: where.on ?? on };
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
const short = (ref) => (ref ?? "").replace(/^origin\//, "");
const VIEWS = [["working", "Uncommitted"], ["branch", "Branch"], ["commits", "Commits"]];
const MAX_FILES = 1000, MAX_COMMITS = 300, MAX_LINES = 1500;

// What a branch is measured against: origin's default branch, else main or master, and where the
// branch left it (merge-base). A git dir that isn't the common one is a linked (owt) worktree.
const BRANCH_INFO = `g() { git --no-optional-locks -c core.fsmonitor=false "$@" 2>/dev/null; }
printf 'gitdir\\t%s\\ncommon\\t%s\\n' "$(g rev-parse --path-format=absolute --git-dir)" "$(g rev-parse --path-format=absolute --git-common-dir)"
printf 'branch\\t%s\\n' "$(g symbolic-ref --quiet --short HEAD)"
main=$(g symbolic-ref --quiet --short refs/remotes/origin/HEAD)
if [ -z "$main" ]; then for b in origin/main origin/master main master; do g rev-parse --verify --quiet "$b^{commit}" >/dev/null && { main=$b; break; }; done; fi
[ -n "$main" ] && printf 'base\\t%s\\nfork\\t%s\\n' "$main" "$(g merge-base "$main" HEAD)"
g config -f .gitmodules --get-regexp '^submodule[.].*[.]path$' | while read -r _ p; do printf 'sub\\t%s\\n' "$p"; done
`;

function parseInfo(stdout) {
  const info = { subs: new Set() };
  for (const line of stdout.split("\n")) {
    const [k, ...v] = line.split("\t");
    if (k === "sub") info.subs.add(v.join("\t"));
    else if (k) info[k] = v.join("\t");
  }
  return info;
}

function numstat(stdout, stats = {}) {
  for (const entry of stdout.split("\0")) {
    const [a, d, ...parts] = entry.split("\t");
    if (!parts.length) continue;
    const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
    stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
  }
  return stats;
}

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Numbers each diff line once, so a frame only draws the rows on screen. A commit's patch holds
// several files: each "diff --git" header becomes one row naming the file, the rest of it is skipped.
function diffRows(lines) {
  let old = 0, next = 0, header = false;
  const rows = [];
  for (const line of lines) {
    if (line.startsWith("diff --git ")) { header = true; rows.push({ kind: "file", text: line.slice(line.lastIndexOf(" b/") + 3) }); continue; }
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { header = false; old = +match[1]; next = +match[2]; rows.push({ kind: "@", text: line, next }); continue; }
    if (header) { if (line.startsWith("Binary files")) rows.push({ kind: "", text: line }); continue; }
    const kind = line[0];
    if (kind === "-") rows.push({ kind, number: old++, text: untab(line.slice(1)) || " " });
    else if (kind === "+") rows.push({ kind, number: next++, text: untab(line.slice(1)) || " " });
    else if (kind === " ") { old++; rows.push({ kind, number: next++, text: untab(line.slice(1)) || " " }); }
    else rows.push({ kind: "", text: line });
  }
  return rows;
}

function statusOf(xy) {
  if (xy.includes("U") || xy === "AA" || xy === "DD") return "U";
  return xy.includes("D") ? "D" : xy === "??" || xy.includes("A") ? "A" : "M";
}

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.commits = []; this.rows = []; this.diffWidth = 0; this.firstLine = 1;
    this.viewByRepo = new Map();
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "uncommitted") this.setView("working", cx);
        else if (c === "branch" || c === "commits") this.setView(c, cx);
        else this.act(c);
      }
    });
  }

  act(command) {
    if (!this.open) return;
    if (this.mode === "commits") {
      if (command === "copy") this.copy(this.open);
      return;
    }
    const f = this.files.find((x) => x.path === this.open);
    if (!f) return;
    const file = f.status !== "D" && !f.sub;
    if (command === "copy") this.copy(file ? `${f.path}:${this.firstLine}` : f.path);
    else if (command === "preview" && !this.on && file) this.preview(f.path);
    else if (command === "edit" && file) this.edit(f.path, this.firstLine);
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading) { this.again = true; return; }
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.commits = []; this.open = null; this.info = null;
      this.setLines([]); this.error = null; this.note = null; this.watched = null; this.closed = false; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.commits = []; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const info = parseInfo((await exec("sh", ["-c", BRANCH_INFO], { cwd: root, on })).stdout);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const linked = Boolean(info.gitdir && info.common && info.gitdir !== info.common);
        const mode = this.viewByRepo.get(root) ?? (linked && info.fork ? "branch" : "working");
        let files = [], commits = [], limited = false;
        if (mode === "commits") ({ commits, limited } = await this.loadCommits(git, info));
        else ({ files, limited } = await this.loadFiles(git, mode, info, head.code === 0));
        if (key() !== context) return;
        Object.assign(this, { root, on, info, hasHead: head.code === 0, mode, files, commits, limited, error: null });
        this.watch(root, cx);
        const items = mode === "commits" ? commits.map((c) => c.sha) : files.map((f) => f.path);
        if (this.open && !items.includes(this.open)) { this.open = null; this.setLines([]); }
        // The first file's (or commit's) diff shows until you pick another.
        if (!this.open && !this.closed && items.length) this.open = items[0];
        if (this.open) {
          try { await this.load(this.open, context); }
          catch { if (key() === context) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
        }
      } catch (e) { if (key() === context) this.error = String(e); }
      finally {
        this.loading = false;
        if (this.again) { this.again = false; this.refresh(cx); }
        cx.notify();
      }
    });
  }

  async loadFiles(git, mode, info, hasHead) {
    const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
    if (status.code !== 0) throw new Error(status.stderr);
    const entries = status.stdout.split("\0").filter(Boolean);
    const untracked = entries.filter((e) => e.startsWith("?? ")).map((e) => e.slice(3));
    if (mode === "branch") {
      if (!info.fork) return { files: [], limited: false };
      const [names, stat] = await Promise.all([git(["diff", info.fork, "--name-status", "-z", "--no-renames"]), git(["diff", info.fork, "--numstat", "-z", "--no-renames"])]);
      for (const r of [names, stat]) if (r.code !== 0) throw new Error(r.stderr);
      const stats = numstat(stat.stdout), parts = names.stdout.split("\0"), files = [];
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const s = parts[i][0], path = parts[i + 1];
        files.push({ path, status: s === "U" ? "U" : s === "D" ? "D" : s === "A" ? "A" : "M", fresh: false, sub: info.subs.has(path), ...(stats[path] ?? { add: 0, del: 0 }) });
      }
      for (const path of untracked) files.push({ path, status: "A", fresh: true, add: 0, del: 0 });
      return { files: files.slice(0, MAX_FILES), limited: files.length > MAX_FILES };
    }
    const results = hasHead ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
    const stats = {};
    for (const result of results) {
      if (result.code !== 0) throw new Error(result.stderr);
      numstat(result.stdout, stats);
    }
    const files = entries.slice(0, MAX_FILES).map((entry) => {
      const xy = entry.slice(0, 2), path = entry.slice(3);
      return { path, status: statusOf(xy), fresh: xy === "??", sub: info.subs.has(path), ...(stats[path] ?? { add: 0, del: 0 }) };
    });
    return { files, limited: entries.length > MAX_FILES };
  }

  async loadCommits(git, info) {
    if (!info.fork) return { commits: [], limited: false };
    const log = await git(["log", "-z", `-n${MAX_COMMITS + 1}`, "--format=%H%x1f%h%x1f%s%x1f%ar", `${info.fork}..HEAD`]);
    if (log.code !== 0) throw new Error(log.stderr);
    const commits = log.stdout.split("\0").filter(Boolean).map((e) => {
      const [sha, abbrev, subject, when] = e.split("\x1f");
      return { sha: sha.trim(), abbrev, subject, when };
    });
    return { commits: commits.slice(0, MAX_COMMITS), limited: commits.length > MAX_COMMITS };
  }

  async load(item, context) {
    const root = this.root, on = this.on;
    let lines;
    if (this.mode === "commits") {
      const r = await exec("git", [...READ, "show", "--format=", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", item], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      lines = r.stdout.replace(/\n$/, "").split("\n");
      if (!lines.some((l) => l.startsWith("@@") || l.startsWith("Binary files"))) lines = ["No text diff in this commit"];
    } else {
      const file = this.files.find((f) => f.path === item);
      if (!file) return;
      if (file.fresh || (this.mode === "working" && !this.hasHead && file.status === "A")) {
        const text = await readTextFile(`${root}/${item}`, { on }).catch(() => null);
        if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
        else if (text.includes("\0")) lines = ["Binary file · no text diff"];
        else {
          file.add = countLines(text);
          lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, MAX_LINES).map(l => `+${l}`)];
        }
      } else if (file.sub) {
        // A submodule is a folder: git's summary of it (new commits, modified content), not a text diff.
        const since = this.mode === "branch" ? [this.info.fork] : this.hasHead ? ["HEAD"] : [];
        const r = await exec("git", [...READ, "diff", ...since, "--submodule=log", "--no-color", "--", item], { cwd: root, on });
        if (r.code !== 0) throw new Error(r.stderr);
        lines = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
        // git diff leaves out work inside the submodule (new files), which git status counts.
        if (!lines.length) {
          const inner = await exec("git", [...READ, "status", "--short"], { cwd: `${root}/${item}`, on }).catch(() => null);
          const changed = inner?.code === 0 ? inner.stdout.split("\n").filter(Boolean) : [];
          lines = changed.length ? [`Changed inside the submodule (${changed.length}):`, ...changed.slice(0, 200).map((l) => l.trim())] : ["Submodule: nothing changed in it"];
        }
      } else {
        const since = this.mode === "branch" ? [this.info.fork] : this.hasHead ? ["HEAD"] : [];
        const r = await exec("git", [...READ, "diff", ...since, "--no-ext-diff", "--no-textconv", "--no-color", "--", item], { cwd: root, on });
        if (r.code !== 0) throw new Error(r.stderr);
        const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
        lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
      }
    }
    if (key() === context && this.open === item) this.setLines(lines.slice(0, MAX_LINES).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...this.rows.map(row => (row.text.length + 1) * 7 + 50));
    this.firstLine = this.rows.find((r) => r.kind === "+")?.number ?? this.rows.find((r) => r.kind === "@")?.next ?? 1;
  }

  pick(item, cx) {
    this.open = this.open === item ? null : item; this.setLines([]); this.note = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(item, context); }
      catch (e) { if (key() === context && this.open === item) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  setView(mode, cx) {
    if (!this.root || mode === this.mode) return;
    this.viewByRepo.set(this.root, mode);
    this.mode = mode; this.open = null; this.closed = false; this.files = []; this.commits = []; this.setLines([]); this.note = null;
    this.refresh(cx);
    cx.notify();
  }

  preview(path) {
    run("pane.split", { direction: "right", mod: "preview", props: { file: `${this.root}/${path}` } });
  }

  // nvim at the file's first change, in a terminal below, started through the login shell as the
  // preview mod does (without .zshrc's XDG_CONFIG_HOME the nvim config fails).
  edit(path, line) {
    const file = `${this.root}/${path}`, root = this.root;
    exec("sh", ["-c", 'printf "%s\\n%s" "${SHELL:-/bin/zsh}" "$(command -v nvim)"'], { on: this.on })
      .then((r) => {
        const [shell, nvim] = r.stdout.split("\n");
        if (!nvim) return notify({ title: "nvim isn't installed", level: "error" });
        run("terminal.open", { argv: [shell, "-lic", 'exec "$0" "+$1" -- "$2"', nvim, String(line), file], folder: root, place: "down", name: `nvim ${path.split("/").pop()}` });
      })
      .catch(() => notify({ title: "Could not start nvim", level: "error" }));
  }

  copy(text) {
    exec("sh", ["-c", 'printf %s "$1" | /usr/bin/pbcopy', "changes", text])
      .then(() => notify({ title: `Copied ${text}`, timeout: 2500 }))
      .catch(() => null);
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "file") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.selected).font_semibold().text_color(t.foreground).child(text);
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  action(t, id, label, onClick) {
    return div().id(id).h(22).px(8).flex().flex_none().items_center().rounded(5).border_1().border_color(t.border).text_size(11).text_color(t.muted)
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => onClick()).child(label);
  }

  actions(t) {
    if (!this.open) return null;
    const bar = h_flex().h(32).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border).text_size(11.5);
    if (this.mode === "commits") {
      const c = this.commits.find((x) => x.sha === this.open);
      if (!c) return null;
      return bar.child(div().flex_none().text_color(t.dim).child(c.abbrev)).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.subject))
        .child(this.action(t, "ca-copy", "Copy hash", () => this.copy(c.sha)));
    }
    const f = this.files.find((x) => x.path === this.open);
    if (!f) return null;
    const line = this.firstLine, file = f.status !== "D" && !f.sub, where = file ? `${f.path}:${line}` : f.path;
    return bar.child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(f.sub ? `${f.path} (submodule)` : where))
      .when(!this.on && file, (el) => el.child(this.action(t, "ca-preview", "Preview", () => this.preview(f.path))))
      .when(file, (el) => el.child(this.action(t, "ca-edit", `Edit at ${line}`, () => this.edit(f.path, line))))
      .child(this.action(t, "ca-copy", "Copy path", () => this.copy(where)));
  }

  empty() {
    if (this.error) return this.error;
    if (this.loading && !this.root) return "Loading changes…";
    if (!this.root) return location().pending ? "Finding the tmux pane…" : "No folder";
    const main = short(this.info?.base);
    if (this.mode === "working") return "No uncommitted changes";
    if (!this.info?.fork) return "No main or master branch to compare with";
    if (this.info.branch && this.info.branch === main) return `This is ${main} itself: Uncommitted shows its changes`;
    return this.mode === "commits" ? `No commits that aren't on ${main}` : `Nothing here that isn't on ${main}`;
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), commits = this.mode === "commits";
    const add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const count = commits ? this.commits.length : this.files.length;
    const items = commits ? this.commits.length : this.files.length;
    const main = short(this.info?.base) || "main";
    const tips = { working: "The work tree against the last commit", branch: `Everything this branch changes since it left ${main}, uncommitted work included`, commits: `The commits that aren't on ${main}` };
    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
        .child(h_flex().h(26).p(2).gap(2).flex_none().rounded(7).bg(t.raised).children(VIEWS.map(([id, label]) =>
          div().id(`cv-${id}`).h(22).px(9).flex().items_center().rounded(5).text_size(11.5).cursor_pointer().tooltip(tips[id])
            .when((this.mode ?? "working") === id, (el) => el.bg(t.selected).font_medium().text_color(t.foreground))
            .when((this.mode ?? "working") !== id, (el) => el.text_color(t.dim).hover((s) => s.text_color(t.foreground)))
            .on_click((_e, cx) => this.setView(id, cx)).child(label))))
        .child(div().px(5).py(1).flex_none().rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${count} ${commits ? "commit" : "file"}${count === 1 ? "" : "s"}`))
        .child(div().flex_1())
        .when(!commits, (el) => el.child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`))))
      // overflow_y_scrollbar() wraps the list, so its flex sizing never reached the panel's layout.
      .child(div().flex_1().min_h(44).max_h(items * 28 + 12).relative().border_b(1).border_color(t.border)
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(6)
          .when(commits, (el) => el.children(this.commits.map((c) => h_flex().id(`commit-${c.sha}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer()
            .when(this.open === c.sha, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(c.sha, cx))
            .child(div().w(58).flex_none().text_size(11).text_color(t.dim).font_family(settings().font_family ?? "JetBrains Mono").child(c.abbrev))
            .child(div().flex_1().min_w(0).truncate().child(c.subject))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(c.when)))))
          .when(!commits, (el) => el.children(this.files.map((f) => {
            const parts = f.path.split("/"), name = parts.pop();
            return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f.path, cx))
              .child(div().w(14).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "U" ? t.ansi1 : t.blocked).child(f.status))
              .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
              .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
          })))
          .when(!items, (e) => e.child(div().p(8).text_color(t.dim).child(this.empty()))))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
      .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child(commits ? `Showing the latest ${MAX_COMMITS} commits` : `Showing the first ${MAX_FILES} changed files`)))
      .when(Boolean(this.actions(t)), (el) => el.child(this.actions(t)))
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("changes-diff", this.rows.length, 20, (i) => String(i),
            (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
        .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
        .when(!this.open && items > 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child(commits ? "Select a commit to view its changes" : "Select a file to view its changes"))))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)));
  }
}
