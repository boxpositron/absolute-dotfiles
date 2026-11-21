// pr-review's commands. Each prints one JSON value on stdout (an error as {"error"} with exit 1),
// since the Herdr panel and agents read it.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { detect, ForgeError, getPr, ghToken, listPrs, parseRemote, postReview, publicRepo, teaLogins, type Pr, type Remote, type Repo } from "./forge.ts";
import { annotate, lineIndex, parseDiff, saved, type DiffFile, type SavedFile } from "./diff.ts";
import { plan } from "./post.ts";
import {
  brief, checkFinding, checkReview, DEFAULT_PICKS, extractJson, MODES, modeOf, newReview, place, postedIds, readModes,
  readReview, repoKey, reviewsOf, root, setMode, writeJson, type Mode, type Review, type ReviewPr, type Source,
} from "./review.ts";

const HOME = homedir();
process.env.PATH = [join(HOME, ".bun/bin"), join(HOME, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH ?? ""].join(":");
process.env.GIT_TERMINAL_PROMPT = "0";

const REVIEW_TIMEOUT_MS = 20 * 60_000;
const LIST_TTL_MS = 30_000;
const MERGED_DAYS = 30;
const MERGED_MAX = 20;

const USAGE = `pr-review: reviews of GitHub and Gitea pull requests by omo, for Herdr's Reviews panel and for agents

  pr-review list [--merged] <dir>...          open PRs of each dir's repo (--merged adds recently merged ones)
  pr-review review <dir> <number>             starts omo's review in the background
  pr-review run <dir> <number>                the same review in the foreground
  pr-review context <dir> <number>            the PR, its mode and the annotated diff, for an agent's own review
  pr-review submit <dir> <number> --name <agent> [--file <review.json>]
                                              stores an agent's review (stdin without --file); posts it in auto mode
  pr-review manual <dir> <number>             an empty review of your own, with its diff
  pr-review add <file> --path <p> --line <n> [--start-line <m>] --severity <s> --title <t> --body <b> [--suggestion <code>]
  pr-review remove <file> <id>                removes one of your own unposted findings
  pr-review post <file> [--ids f1,f2]         posts the picked findings (default: blockers and majors)
  pr-review mode <dir> <number|-> [manual|semi|auto|inherit]
                                              shows or sets a PR's mode, or the repo's with -

PR_REVIEW_MODEL picks omo's model for reviews; PR_REVIEW_HOME moves the state (~/.local/state/pr-review).`;

class UsageError extends Error {}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function exec(cmd: string[], cwd: string, opts: { stdin?: string; timeout?: number } = {}) {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: process.env,
    stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
    stdout: "pipe",
    stderr: "pipe",
    timeout: opts.timeout,
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code, signal: proc.signalCode };
}

async function git(cwd: string, args: string[], timeout = 120_000) {
  const r = await exec(["git", ...args], cwd, { timeout });
  if (r.code !== 0) throw new Error(`git ${args[0]}: ${r.stderr.trim().split("\n").pop() || `exit ${r.code}`}`);
  return r.stdout;
}

interface Checkout { top: string; repo: Repo }
// idle: a folder with nothing to review (no repo, no origin), as against a repo that can't be read.
type Unresolved = { top: string | null; remote: Remote | null; problem: string; idle?: true };

async function resolve(dir: string): Promise<Checkout | Unresolved> {
  const top = await exec(["git", "rev-parse", "--show-toplevel"], dir).catch(() => null);
  if (!top || top.code !== 0) return { top: null, remote: null, problem: "not a git repo", idle: true };
  const path = top.stdout.trim();
  const url = await exec(["git", "remote", "get-url", "origin"], path);
  if (url.code !== 0) return { top: path, remote: null, problem: "no origin remote", idle: true };
  const remote = parseRemote(url.stdout);
  if (!remote) return { top: path, remote: null, problem: `can't read the origin URL ${url.stdout.trim()}` };
  const found = await detect(remote, teaLogins(), ghToken);
  return "problem" in found ? { top: path, remote, problem: found.problem } : { top: path, repo: found };
}

async function checkout(dir: string): Promise<Checkout> {
  const c = await resolve(dir);
  if ("problem" in c) throw new Error(c.problem);
  return c;
}

async function forgeOf(remote: Remote): Promise<Repo> {
  const found = await detect(remote, teaLogins(), ghToken);
  if ("problem" in found) throw new Error(found.problem);
  return found;
}

const reviewPr = (pr: Pr): ReviewPr => ({
  number: pr.number, title: pr.title, author: pr.author, head: pr.head, base: pr.base, sha: pr.sha,
  base_sha: pr.base_sha, merge_base: pr.merge_base, url: pr.url, state: pr.state,
});

// The PR's head and the commit it branched from. An open PR is diffed against today's base branch, as
// the forge shows it; a merged or closed one against where it branched, since its base has moved on.
async function prDiff(top: string, pr: Pr): Promise<{ head: string; base: string; files: DiffFile[] }> {
  const ref = `refs/pr-review/${pr.number}`;
  try {
    await git(top, ["fetch", "--no-tags", "--quiet", "origin", `+refs/pull/${pr.number}/head:${ref}`]);
    const fetchedBase = await git(top, ["fetch", "--no-tags", "--quiet", "origin", `+refs/heads/${pr.base}:refs/remotes/origin/${pr.base}`])
      .then(() => true, (e) => { if (pr.state === "open") throw e; return false; });
    const head = (await git(top, ["rev-parse", ref])).trim();
    let base = pr.state !== "open" ? pr.merge_base : null;
    if (!base) {
      const against = pr.state === "open" && fetchedBase ? `refs/remotes/origin/${pr.base}` : pr.base_sha;
      if (!against) throw new Error(`can't tell where #${pr.number} branched from`);
      base = (await git(top, ["merge-base", against, head])).trim();
    }
    const text = await git(top, ["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "-U3", "-M", base, head]);
    return { head, base, files: parseDiff(text) };
  } finally {
    await git(top, ["update-ref", "-d", ref]).catch(() => {});
  }
}

function diffFileOf(file: string, files: DiffFile[]) {
  const path = file.replace(/\.json$/, ".diff.json");
  writeJson(path, saved(files));
  return path;
}

function prompt(review: Review, pr: Pr, ann: ReturnType<typeof annotate>) {
  const notes = [
    ann.skipped.length ? `Left out of the diff (lockfiles, generated, minified or binary): ${ann.skipped.join(", ")}.` : "",
    ann.omitted.length ? `Too large to include here; read them in your checkout: ${ann.omitted.join(", ")}.` : "",
  ].filter(Boolean).join("\n");
  const vars: Record<string, string> = {
    repo: `${review.repo.owner}/${review.repo.name}`,
    number: String(pr.number),
    title: pr.title,
    author: pr.author,
    head: pr.head,
    base: pr.base,
    body: pr.body.trim() || "(none)",
    notes,
    diff: ann.text || "(no reviewable changes)",
  };
  return readFileSync(join(import.meta.dir, "prompt.md"), "utf8").replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}

// The answer is the text of omo's last assistant message; its cost is summed over every one.
export function readOmo(jsonl: string) {
  let answer: string | null = null, model: string | null = null, cost = 0;
  for (const line of jsonl.split("\n")) {
    if (!line.startsWith("{")) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type !== "message_end" || ev.message?.role !== "assistant") continue;
    cost += ev.message.usage?.cost?.total ?? 0;
    model = ev.message.model ?? model;
    const text = (ev.message.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    if (text.trim()) answer = text;
  }
  return { answer, model, cost };
}

let reviewer: ReturnType<typeof Bun.spawn> | null = null;

async function askOmo(cwd: string, text: string, log: string) {
  // Only tools that read. The read-only preset refuses eval and bash when no one can approve them, so
  // offering them only lets the reviewer pick a tool that fails instead of reading the code.
  const args = ["-p", "--mode", "json", "--no-session", "--permission-preset", "read-only", "--tools", "read,grep,find,ls",
    "--no-ask-user", "--omo-senpi-memory-disabled", "--omo-senpi-task-disabled"];
  if (process.env.PR_REVIEW_MODEL) args.push("--model", process.env.PR_REVIEW_MODEL);
  args.push("-", "Review the pull request above. Answer with the JSON object it asks for and nothing else.");
  const proc = Bun.spawn(["omo", ...args], {
    cwd, env: process.env, stdin: new Blob([`${text}\n\n`]), stdout: "pipe", stderr: "pipe", timeout: REVIEW_TIMEOUT_MS,
  });
  reviewer = proc;
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  reviewer = null;
  writeFileSync(log.replace(/\.log$/, ".jsonl"), out);
  if (err.trim()) appendFileSync(log, err.endsWith("\n") ? err : `${err}\n`);
  if (proc.signalCode) throw new Error(`omo was stopped (${proc.signalCode}); a review gets ${REVIEW_TIMEOUT_MS / 60_000} minutes`);
  if (code !== 0) throw new Error(`omo exited ${code}: ${err.trim().split("\n").pop() ?? ""}`);
  const result = readOmo(out);
  if (!result.answer) throw new Error("omo gave no answer");
  return result as { answer: string; model: string | null; cost: number };
}

async function runReview(file: string) {
  let review = JSON.parse(readFileSync(file, "utf8")) as Review;
  review.pid = process.pid;
  const started = Date.parse(review.started_at);
  const save = (patch: Partial<Review>) => { review = { ...review, ...patch }; writeJson(file, review); };
  const finish = (patch: Partial<Review>) => save({ ...patch, phase: null, finished_at: new Date().toISOString(), duration_ms: Date.now() - started });
  const note = (s: string) => appendFileSync(review.log, `[${new Date().toISOString()}] ${s}\n`);
  const work = join(root(), "work", basename(file, ".json"));
  let worktree: string | null = null;
  const cleanup = async () => {
    if (!worktree) return;
    const top = worktree;
    worktree = null;
    await git(top, ["worktree", "remove", "--force", work]).catch((e) => note(`worktree remove: ${message(e)}`));
    await git(top, ["worktree", "prune"]).catch(() => {});
  };
  const stop = async (signal: string) => {
    reviewer?.kill();
    finish({ state: "failed", error: `stopped by ${signal}` });
    await cleanup();
    process.exit(1);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));

  try {
    save({ phase: "fetching" });
    note(`review of ${repoKey(review.repo)}#${review.pr.number}`);
    const c = await checkout(review.checkout);
    const pr = await getPr(c.repo, review.pr.number);
    const d = await prDiff(c.top, pr);
    await git(c.top, ["worktree", "add", "--detach", "--quiet", work, d.head]);
    worktree = c.top;
    const ann = annotate(d.files);
    save({ pr: { ...reviewPr(pr), sha: d.head, merge_base: d.base }, diff_file: diffFileOf(file, d.files), skipped: ann.skipped, omitted: ann.omitted, phase: "reviewing" });
    const result = await askOmo(work, prompt(review, pr, ann), review.log);
    save({ phase: "checking", model: result.model, cost_usd: Math.round(result.cost * 10000) / 10000 });
    const checked = checkReview(extractJson(result.answer));
    const index = lineIndex(d.files);
    const findings = checked.findings.map((f, i) => place(f, `f${i + 1}`, review.source.name, index));
    finish({ state: "done", summary: checked.summary, verdict: checked.verdict, findings });
    note(`done: ${findings.length} findings`);
  } catch (e) {
    note(`failed: ${message(e)}`);
    finish({ state: "failed", error: message(e) });
  } finally {
    await cleanup();
  }
  if (review.state === "done" && modeOf(readModes(), review.repo, review.pr.number).effective === "auto") {
    await postFindings(file, null).catch((e) => {
      note(`auto post failed: ${message(e)}`);
      writeJson(file, { ...readReview(file), error: `auto post failed: ${message(e)}` });
    });
  }
  return readReview(file);
}

async function startReview(dir: string, number: number, foreground: boolean) {
  const c = await checkout(dir);
  const pr = await getPr(c.repo, number);
  const running = reviewsOf(c.repo, number).find((r) => r.review.state === "running" && r.review.source.kind === "runner" && r.review.pr.sha === pr.sha);
  if (running) return { file: running.file, state: "running" };
  const { file, review } = newReview({ source: { kind: "runner", name: "omo" }, checkout: c.top, repo: publicRepo(c.repo), pr: reviewPr(pr) });
  writeJson(file, review);
  if (foreground) {
    const done = await runReview(file);
    return { file, state: done.state, error: done.error };
  }
  const log = openSync(review.log, "a");
  const run = [process.execPath, Bun.main, "run", "--file", file];
  // A caller can end whatever its command leaves running, detached or not: Herdr's exec on another machine runs under
  // hc's service, which does. So on Linux the run gets its own systemd user unit when there is one; it records its pid.
  if (process.platform === "linux" && Bun.which("systemd-run")) {
    const env = Object.keys(process.env).filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)).flatMap((k) => ["-E", k]);
    const unit = spawnSync("systemd-run", ["--user", "--collect", "--quiet", `--property=StandardOutput=append:${review.log}`,
      `--property=StandardError=append:${review.log}`, ...env, ...run], { env: process.env, stdio: ["ignore", log, log] });
    if (unit.status === 0) return { file, state: "running" };
  }
  const child = spawn(run[0], run.slice(1), { detached: true, stdio: ["ignore", log, log], env: process.env });
  child.unref();
  writeJson(file, { ...review, pid: child.pid ?? null });
  return { file, state: "running" };
}

async function postFindings(file: string, ids: string[] | null) {
  const review = readReview(file);
  if (review.state !== "done") throw new Error(`the review is ${review.state}`);
  const want = ids ?? review.findings.filter((f) => DEFAULT_PICKS.includes(f.severity)).map((f) => f.id);
  const unknown = want.filter((id) => !review.findings.some((f) => f.id === id));
  if (unknown.length) throw new Error(`no finding ${unknown.join(", ")} in this review`);
  const done = postedIds(review);
  const picked = review.findings.filter((f) => want.includes(f.id) && !done.has(f.id));
  const first = review.posted.length === 0;
  const repo = await forgeOf(review.repo);
  let p = plan(repo.forge, review, picked, first);
  if (!p) throw new Error("nothing new to post");
  let res: { url: string | null };
  try {
    res = await postReview(repo, review.pr.number, p.payload);
  } catch (e) {
    if (!(e instanceof ForgeError && e.status === 422 && p.inline.length)) throw e;
    p = plan(repo.forge, review, picked, first, true)!;
    res = await postReview(repo, review.pr.number, p.payload);
  }
  const posted = { at: new Date().toISOString(), url: res.url ?? review.pr.url, ids: p.inline, in_summary: p.in_summary };
  const fresh = readReview(file);
  writeJson(file, { ...fresh, posted: [...fresh.posted, posted] });
  return { url: posted.url, ids: posted.ids, in_summary: posted.in_summary };
}

async function cachedPrs(repo: Repo, merged: boolean): Promise<{ prs: Pr[]; problem: string | null }> {
  const file = join(root(), "cache", `${repo.host}__${repo.owner}__${repo.name}__${merged ? "merged" : "open"}.json`);
  let cached: { at: number; prs: Pr[] } | null = null;
  try { cached = JSON.parse(readFileSync(file, "utf8")); } catch {}
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return { prs: cached.prs, problem: null };
  try {
    let prs = await listPrs(repo, "open", 50);
    if (merged) {
      const since = Date.now() - MERGED_DAYS * 86_400_000;
      const closed = await listPrs(repo, "closed", 50);
      prs = [...prs, ...closed.filter((p) => p.state === "merged" && Date.parse(p.updated_at) >= since).slice(0, MERGED_MAX)];
    }
    prs = prs.map((p) => ({ ...p, body: "" }));
    writeJson(file, { at: Date.now(), prs });
    return { prs, problem: null };
  } catch (e) {
    return { prs: cached?.prs ?? [], problem: message(e) };
  }
}

async function list(dirs: string[], merged: boolean) {
  const modes = readModes();
  const resolved = await Promise.all(dirs.map((d) => resolve(d).catch((e): Unresolved => ({ top: null, remote: null, problem: message(e) }))));
  const seen = new Set<string>();
  const unique = resolved.flatMap((c, i) => {
    const key = "repo" in c ? repoKey(c.repo) : c.remote ? repoKey(c.remote) : c.top ?? dirs[i];
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ c, dir: c.top ?? dirs[i] }];
  });
  const repos = await Promise.all(unique.map(async ({ c, dir }) => {
    if (!("repo" in c)) return { dir, problem: c.problem, idle: c.idle === true, repo: null, mode: null, prs: [] };
    const { prs, problem } = await cachedPrs(c.repo, merged);
    return {
      dir,
      problem,
      repo: publicRepo(c.repo),
      mode: modeOf(modes, c.repo, null).repo,
      prs: prs.map(({ body: _body, base_sha: _base, merge_base: _mergeBase, ...pr }) => {
        const m = modeOf(modes, c.repo, pr.number);
        const all = reviewsOf(c.repo, pr.number);
        const history = all.slice(0, 10).map((r) => brief(r.file, r.review, pr.sha));
        return { ...pr, mode: m.effective, mode_override: m.override, reviews: all.length, review: history[0] ?? null, history };
      }),
    };
  }));
  return { read_at: new Date().toISOString(), repos };
}

async function context(dir: string, number: number) {
  const c = await checkout(dir);
  const pr = await getPr(c.repo, number);
  const d = await prDiff(c.top, pr);
  const ann = annotate(d.files);
  return {
    repo: publicRepo(c.repo),
    pr: { ...reviewPr(pr), sha: d.head, merge_base: d.base, body: pr.body },
    mode: modeOf(readModes(), c.repo, number).effective,
    skipped: ann.skipped,
    omitted: ann.omitted,
    diff: ann.text,
    answer: "pr-review submit <dir> <number> --name <you> with JSON on stdin: {summary, verdict: good|changes|questions, findings: [{severity: blocker|major|minor|nit, path, line, start_line, title, body, suggestion}]}; line numbers are the ones in diff",
  };
}

async function stored(dir: string, number: number, source: Source, fill: (review: Review, files: DiffFile[]) => Partial<Review>) {
  const c = await checkout(dir);
  const pr = await getPr(c.repo, number);
  const d = await prDiff(c.top, pr);
  const made = newReview({ source, checkout: c.top, repo: publicRepo(c.repo), pr: { ...reviewPr(pr), sha: d.head, merge_base: d.base } });
  const ann = annotate(d.files);
  const review: Review = {
    ...made.review,
    state: "done",
    phase: null,
    pid: null,
    finished_at: new Date().toISOString(),
    duration_ms: 0,
    diff_file: diffFileOf(made.file, d.files),
    skipped: ann.skipped,
    omitted: ann.omitted,
  };
  writeJson(made.file, { ...review, ...fill(review, d.files) });
  return { file: made.file, mode: modeOf(readModes(), c.repo, number).effective };
}

async function submit(dir: string, number: number, name: string, input: string) {
  const checked = checkReview(extractJson(input));
  const { file, mode } = await stored(dir, number, { kind: "agent", name }, (_r, files) => {
    const index = lineIndex(files);
    return { summary: checked.summary, verdict: checked.verdict, findings: checked.findings.map((f, i) => place(f, `f${i + 1}`, name, index)) };
  });
  const posted = mode === "auto" ? await postFindings(file, null) : null;
  return { file, mode, posted };
}

function addFinding(file: string, flags: Record<string, string>) {
  const review = readReview(file);
  if (review.state !== "done") throw new Error("wait for the review to finish before adding to it");
  if (!review.diff_file) throw new Error("this review has no diff to comment on");
  const draft = checkFinding({
    severity: flags.severity, path: flags.path, line: Number(flags.line), start_line: flags["start-line"] ? Number(flags["start-line"]) : null,
    title: flags.title, body: flags.body ?? "", suggestion: flags.suggestion ?? null,
  });
  const { files } = JSON.parse(readFileSync(review.diff_file, "utf8")) as { files: SavedFile[] };
  const mine = review.findings.filter((f) => /^m\d+$/.test(f.id)).map((f) => Number(f.id.slice(1)));
  const id = `m${Math.max(0, ...mine) + 1}`;
  writeJson(file, { ...review, findings: [...review.findings, place(draft, id, "you", lineIndex(files))] });
  return { id };
}

function removeFinding(file: string, id: string) {
  const review = readReview(file);
  const f = review.findings.find((x) => x.id === id);
  if (!f) throw new Error(`no finding ${id} in this review`);
  if (f.by !== "you") throw new Error("only your own findings can be removed");
  if (postedIds(review).has(id)) throw new Error(`${id} is already posted`);
  writeJson(file, { ...review, findings: review.findings.filter((x) => x.id !== id) });
  return { removed: id };
}

function flagsOf(args: string[]) {
  const flags: Record<string, string> = {}, rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (name === "merged") { flags.merged = "1"; continue; }
      if (i + 1 >= args.length) throw new UsageError(`--${name} needs a value`);
      flags[name] = args[++i];
    } else rest.push(a);
  }
  return { flags, rest };
}

function prArgs(rest: string[], usage: string): [string, number] {
  const n = Number(rest[1]);
  if (!rest[0] || !Number.isInteger(n) || n <= 0) throw new UsageError(usage);
  return [rest[0], n];
}

async function command(argv: string[]): Promise<unknown> {
  const [cmd, ...args] = argv;
  const { flags, rest } = flagsOf(args);
  switch (cmd) {
    case "list":
      if (!rest.length) throw new UsageError("pr-review list [--merged] <dir>...");
      return list(rest, flags.merged === "1");
    case "review":
      return startReview(...prArgs(rest, "pr-review review <dir> <number>"), false);
    case "run":
      if (flags.file) { const r = await runReview(flags.file); return { file: flags.file, state: r.state, error: r.error }; }
      return startReview(...prArgs(rest, "pr-review run <dir> <number>"), true);
    case "context":
      return context(...prArgs(rest, "pr-review context <dir> <number>"));
    case "submit": {
      const [dir, n] = prArgs(rest, "pr-review submit <dir> <number> --name <agent> [--file <review.json>]");
      if (!flags.name) throw new UsageError("pr-review submit needs --name <agent>");
      const input = flags.file ? readFileSync(flags.file, "utf8") : await Bun.stdin.text();
      return submit(dir, n, flags.name, input);
    }
    case "manual": {
      const [dir, n] = prArgs(rest, "pr-review manual <dir> <number>");
      const { file } = await stored(dir, n, { kind: "manual", name: "you" }, () => ({ findings: [] }));
      return { file };
    }
    case "add":
      if (!rest[0]) throw new UsageError("pr-review add <file> --path <p> --line <n> --severity <s> --title <t> --body <b>");
      return addFinding(rest[0], flags);
    case "remove":
      if (!rest[0] || !rest[1]) throw new UsageError("pr-review remove <file> <id>");
      return removeFinding(rest[0], rest[1]);
    case "post":
      if (!rest[0]) throw new UsageError("pr-review post <file> [--ids f1,f2]");
      return postFindings(rest[0], flags.ids ? flags.ids.split(",").map((s) => s.trim()).filter(Boolean) : null);
    case "mode": {
      const [dir, which, mode] = rest;
      const n = which === "-" ? null : Number(which);
      if (!dir || (n !== null && (!Number.isInteger(n) || n <= 0))) throw new UsageError("pr-review mode <dir> <number|-> [manual|semi|auto|inherit]");
      if (mode && mode !== "inherit" && !MODES.includes(mode as Mode)) throw new UsageError("the mode is manual, semi, auto or inherit");
      const c = await resolve(dir);
      const remote = "repo" in c ? c.repo : c.remote;
      if (!remote) throw new Error((c as Unresolved).problem);
      return mode ? setMode(remote, n, mode as Mode | "inherit") : modeOf(readModes(), remote, n);
    }
    default:
      throw new UsageError(USAGE);
  }
}

export async function main(argv: string[]) {
  try {
    console.log(JSON.stringify(await command(argv)));
  } catch (e) {
    if (e instanceof UsageError && !argv.length) { console.error(e.message); process.exit(2); }
    console.log(JSON.stringify({ error: message(e) }));
    process.exit(1);
  }
}
