// Reviews on disk: the reviewer's answer checked against its schema, findings placed on the diff, the
// review files under ~/.local/state/pr-review/reviews/<host>/<owner>/<name>/<number>/, and the modes.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PublicRepo, Remote } from "./forge.ts";
import { commentable, sameHunk, type LineIndex } from "./diff.ts";

export type Severity = "blocker" | "major" | "minor" | "nit";
export type Verdict = "good" | "changes" | "questions";
export type Mode = "manual" | "semi" | "auto";
export const SEVERITIES: Severity[] = ["blocker", "major", "minor", "nit"];
export const VERDICTS: Verdict[] = ["good", "changes", "questions"];
export const MODES: Mode[] = ["manual", "semi", "auto"];
export const DEFAULT_MODE: Mode = "semi";
export const DEFAULT_PICKS: Severity[] = ["blocker", "major"];

export interface Draft {
  severity: Severity;
  path: string | null;
  line: number | null;
  start_line: number | null;
  title: string;
  body: string;
  suggestion: string | null;
}
export interface Finding extends Draft { id: string; commentable: boolean; by: string }
export interface Source { kind: "runner" | "agent" | "manual"; name: string }
export interface Posted { at: string; url: string | null; ids: string[]; in_summary: string[] }
export interface ReviewPr {
  number: number; title: string; author: string; head: string; base: string; sha: string;
  base_sha: string | null; merge_base: string | null; url: string; state: string;
}
export interface Review {
  version: 1;
  id: string;
  state: "running" | "done" | "failed";
  phase: "starting" | "fetching" | "reviewing" | "checking" | null;
  error: string | null;
  source: Source;
  checkout: string;
  repo: PublicRepo;
  pr: ReviewPr;
  pid: number | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  model: string | null;
  cost_usd: number | null;
  log: string;
  diff_file: string | null;
  skipped: string[];
  omitted: string[];
  summary: string;
  verdict: Verdict | null;
  findings: Finding[];
  posted: Posted[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const positive = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

// The answer may come bare, in a ```json fence, or with prose around one object.
export function extractJson(text: string): unknown {
  const t = text.trim();
  const fence = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/.exec(t)?.[1];
  const braces = t.indexOf("{") >= 0 ? t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1) : "";
  for (const candidate of [t, fence, braces]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch {}
  }
  throw new Error("the reviewer's answer is not JSON");
}

export function checkReview(raw: unknown): { summary: string; verdict: Verdict; findings: Draft[] } {
  if (!isObject(raw)) throw new Error("the review is not a JSON object");
  const { summary, verdict, findings } = raw;
  if (typeof summary !== "string" || !summary.trim()) throw new Error("the review has no summary");
  if (!VERDICTS.includes(verdict as Verdict)) throw new Error(`verdict must be good, changes or questions, not ${JSON.stringify(verdict)}`);
  if (!Array.isArray(findings)) throw new Error("findings must be a list");
  return { summary: summary.trim(), verdict: verdict as Verdict, findings: findings.map((f, i) => checkFinding(f, `finding ${i + 1}`)) };
}

export function checkFinding(f: unknown, at = "the finding"): Draft {
  if (!isObject(f)) throw new Error(`${at} is not an object`);
  if (!SEVERITIES.includes(f.severity as Severity)) throw new Error(`${at}: severity must be blocker, major, minor or nit`);
  if (typeof f.title !== "string" || !f.title.trim()) throw new Error(`${at} has no title`);
  if (typeof f.body !== "string") throw new Error(`${at} has no body`);
  const path = typeof f.path === "string" && f.path.trim() ? f.path.trim().replace(/^\.\//, "") : null;
  const line = path ? positive(f.line) : null;
  const start = positive(f.start_line);
  return {
    severity: f.severity as Severity,
    path,
    line,
    start_line: line && start && start < line ? start : null,
    title: f.title.trim(),
    body: f.body.trim(),
    suggestion: typeof f.suggestion === "string" && f.suggestion.length > 0 ? f.suggestion : null,
  };
}

// A range keeps its start only when GitHub could take it: both ends on new-side lines of one hunk.
export function place(draft: Draft, id: string, by: string, index: LineIndex): Finding {
  const inline = commentable(index, draft.path, draft.line);
  const start = inline && draft.start_line && sameHunk(index, draft.path!, draft.start_line, draft.line!) ? draft.start_line : null;
  return { ...draft, start_line: start, id, by, commentable: inline };
}

export const root = () => process.env.PR_REVIEW_HOME ?? join(homedir(), ".local/state/pr-review");
export const repoKey = (r: Remote) => `${r.host}/${r.owner}/${r.name}`;
export const prDir = (r: Remote, n: number) => join(root(), "reviews", r.host, r.owner, r.name, String(n));

export function writeJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
};

export function readReview(file: string): Review {
  const r = JSON.parse(readFileSync(file, "utf8")) as Review;
  if (r.state === "running" && r.pid && !alive(r.pid)) return { ...r, state: "failed", phase: null, error: "the review process stopped" };
  return r;
}

export function reviewsOf(r: Remote, n: number): { file: string; review: Review }[] {
  const dir = prDir(r, n);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".diff.json"))
    .flatMap((f) => {
      try { return [{ file: join(dir, f), review: readReview(join(dir, f)) }]; } catch { return []; }
    })
    .sort((a, b) => b.review.started_at.localeCompare(a.review.started_at));
}

export const postedIds = (r: Review) => new Set(r.posted.flatMap((p) => [...p.ids, ...p.in_summary]));

export function counts(r: Review) {
  const c: Record<Severity, number> = { blocker: 0, major: 0, minor: 0, nit: 0 };
  for (const f of r.findings) c[f.severity]++;
  return c;
}

export function brief(file: string, r: Review, headSha: string) {
  return {
    file,
    state: r.state,
    phase: r.phase,
    source: r.source,
    stale: r.pr.sha !== headSha,
    sha: r.pr.sha,
    started_at: r.started_at,
    finished_at: r.finished_at,
    counts: counts(r),
    posted: postedIds(r).size,
    error: r.error,
  };
}

export function newReview(init: { source: Source; checkout: string; repo: PublicRepo; pr: ReviewPr }): { file: string; review: Review } {
  const started = new Date();
  const stamp = started.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const base = `${stamp}-${init.pr.sha.slice(0, 12)}-${init.source.kind}`;
  const dir = prDir(init.repo, init.pr.number);
  const review: Review = {
    version: 1,
    id: `${repoKey(init.repo)}/${init.pr.number}/${base}`,
    state: "running",
    phase: "starting",
    error: null,
    ...init,
    pid: process.pid,
    started_at: started.toISOString(),
    finished_at: null,
    duration_ms: null,
    model: null,
    cost_usd: null,
    log: join(dir, `${base}.log`),
    diff_file: null,
    skipped: [],
    omitted: [],
    summary: "",
    verdict: null,
    findings: [],
    posted: [],
  };
  return { file: join(dir, `${base}.json`), review };
}

interface Modes { repos: Record<string, Mode>; prs: Record<string, Mode> }
const modesFile = () => join(root(), "modes.json");

export function readModes(): Modes {
  try {
    const m = JSON.parse(readFileSync(modesFile(), "utf8"));
    return { repos: m.repos ?? {}, prs: m.prs ?? {} };
  } catch {
    return { repos: {}, prs: {} };
  }
}

export function modeOf(modes: Modes, r: Remote, n: number | null) {
  const repo = modes.repos[repoKey(r)] ?? DEFAULT_MODE;
  const override = n === null ? null : modes.prs[`${repoKey(r)}#${n}`] ?? null;
  return { repo, override, effective: override ?? repo };
}

export function setMode(r: Remote, n: number | null, mode: Mode | "inherit") {
  const modes = readModes();
  const key = n === null ? repoKey(r) : `${repoKey(r)}#${n}`;
  const table = n === null ? modes.repos : modes.prs;
  if (mode === "inherit") delete table[key];
  else table[key] = mode;
  writeJson(modesFile(), modes);
  return modeOf(modes, r, n);
}
