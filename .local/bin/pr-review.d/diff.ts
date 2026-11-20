// A PR's unified diff: its files and hunks, which new-side lines can carry an inline comment, the
// annotated text the reviewer reads, and the copy the dialog's Diff tab draws.

export type Kind = "+" | "-" | " ";
export interface DiffLine { kind: Kind; text: string; old: number | null; new: number | null }
export interface Hunk { header: string; lines: DiffLine[] }
export type FileStatus = "added" | "deleted" | "modified" | "renamed";
export interface DiffFile { path: string; old_path: string | null; status: FileStatus; binary: boolean; hunks: Hunk[] }
export interface SavedFile { path: string; old_path: string | null; status: FileStatus; skipped: string | null; hunks: Hunk[] }

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0, newNo = 0;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(raw);
      file = { path: m ? m[2] : raw.slice(11), old_path: m ? m[1] : null, status: "modified", binary: false, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      hunk = { header: raw, lines: [] };
      file.hunks.push(hunk);
      oldNo = Number(h[1]);
      newNo = Number(h[2]);
      continue;
    }
    if (!hunk) {
      if (raw.startsWith("new file mode")) file.status = "added";
      else if (raw.startsWith("deleted file mode")) file.status = "deleted";
      else if (raw.startsWith("rename from ")) { file.old_path = raw.slice(12); file.status = "renamed"; }
      else if (raw.startsWith("rename to ")) { file.path = raw.slice(10); file.status = "renamed"; }
      else if (raw.startsWith("Binary files ") || raw === "GIT binary patch") file.binary = true;
      else if (raw.startsWith("+++ ") && raw !== "+++ /dev/null") file.path = raw.slice(4).replace(/^b\//, "");
      continue;
    }
    if (raw.startsWith("+")) hunk.lines.push({ kind: "+", text: raw.slice(1), old: null, new: newNo++ });
    else if (raw.startsWith("-")) hunk.lines.push({ kind: "-", text: raw.slice(1), old: oldNo++, new: null });
    else if (raw.startsWith(" ")) hunk.lines.push({ kind: " ", text: raw.slice(1), old: oldNo++, new: newNo++ });
  }
  return files;
}

// path -> new-side line -> index of its hunk. Both forges take inline comments only on these lines.
export type LineIndex = Map<string, Map<number, number>>;

export function lineIndex(files: { path: string; hunks: Hunk[] }[]): LineIndex {
  const index: LineIndex = new Map();
  for (const f of files) {
    const lines = new Map<number, number>();
    f.hunks.forEach((h, i) => { for (const l of h.lines) if (l.new !== null) lines.set(l.new, i); });
    index.set(f.path, lines);
  }
  return index;
}

export const commentable = (index: LineIndex, path: string | null, line: number | null) =>
  path !== null && line !== null && Boolean(index.get(path)?.has(line));

export function sameHunk(index: LineIndex, path: string, a: number, b: number) {
  const lines = index.get(path);
  return lines?.has(a) === true && lines.get(a) === lines.get(b);
}

const LOCKFILES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "bun.lock", "bun.lockb", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock",
  "go.sum", "poetry.lock", "Gemfile.lock", "composer.lock", "uv.lock", "Pipfile.lock", "flake.lock", "mix.lock",
]);

export function skipReason(f: DiffFile): string | null {
  const base = f.path.split("/").pop() ?? f.path;
  if (f.binary) return "binary";
  if (LOCKFILES.has(base)) return "lockfile";
  if (/\.min\.(js|css)$|\.map$/.test(base)) return "minified";
  if (/(^|\/)(dist|node_modules)\//.test(f.path)) return "generated";
  return null;
}

// Every line carries its new-file number (removed lines none), so findings can cite real lines. A
// deleted file is one line. Files past the cap are only named: the reviewer reads them in its checkout.
export function annotate(files: DiffFile[], cap = 300_000): { text: string; skipped: string[]; omitted: string[] } {
  let text = "";
  const skipped: string[] = [], omitted: string[] = [];
  for (const f of files) {
    if (skipReason(f)) { skipped.push(f.path); continue; }
    const from = f.status === "renamed" && f.old_path ? ` from ${f.old_path}` : "";
    let chunk = `=== ${f.path} (${f.status}${from}) ===\n`;
    if (f.status === "deleted") {
      chunk += `(deleted, ${f.hunks.reduce((n, h) => n + h.lines.length, 0)} lines)\n`;
    } else {
      for (const h of f.hunks) {
        chunk += `${h.header}\n`;
        for (const l of h.lines) chunk += `${l.new === null ? "" : String(l.new)}`.padStart(6) + ` ${l.kind} ${l.text}\n`;
      }
    }
    if (text.length + chunk.length > cap) { omitted.push(f.path); continue; }
    text += `${chunk}\n`;
  }
  return { text, skipped, omitted };
}

export const saved = (files: DiffFile[]): { files: SavedFile[] } => ({
  files: files.map((f) => ({ path: f.path, old_path: f.old_path, status: f.status, skipped: skipReason(f), hunks: skipReason(f) ? [] : f.hunks })),
});
