// Preview: a rich preview of one file or folder, opened beside the
// terminal (`herdr-preview <path>`, or `pane.split {mod: "preview", props: {file}}`
// / `tab.new {mod: "preview", props: {file}}`). `props().file` is an absolute path
// (a leading ~ is expanded). What it draws depends on the kind:
//   Markdown   rendered with TextView (Rendered / Source toggle); relative links to
//              local files open here (Back returns), http(s) links open the browser.
//              TextView draws no images, so each one becomes an "Image: alt" link
//   HTML       rendered with TextView.html (Rendered / Source toggle)
//   Word-like  .docx .doc .rtf .rtfd .odt .webarchive through `textutil`, shown as HTML
//   Images     fitted to the pane, never upscaled past 100%, with the pixel size;
//              HEIC and TIFF are converted by `sips`. image() only loads files inside
//              Herdr's own folder, so every image is staged (an APFS clone) into
//              ~/.config/herdr-app/preview-cache, keyed by path and mtime, pruned after a week
//   PDF        every page (up to 20) from `pdftoppm`, else the first page by Quick Look
//   Documents  a Quick Look page image (pptx, xlsx, key, numbers ...)
//   Text, code monospace Editor with line numbers and syntax highlighting, long lines
//              scroll sideways (columns stay aligned); at most 1 MB or 20,000 lines
//   Folders    a list of entries, folders first; a click previews the entry (Back returns)
//   Anything else, or a missing file: a calm info card.
// keys.json can bind preview.copy, preview.reveal, preview.open, preview.edit, preview.back,
// preview.reload. The header carries the actions on every kind: Copy path (Cmd+Shift+C),
// Reveal in Finder (Cmd+Shift+R), Open with the default app (Cmd+O), Reload (Cmd+R), and
// for text, code, Markdown, HTML and folders Edit in Neovim (Cmd+E: nvim in a terminal
// below the preview, in the file's folder, so the preview follows each save); Esc closes
// the preview when it is shown as an overlay. The file's folder is watched, so the
// preview follows edits (the Editor keeps its scroll position).

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextView, Editor, EditorState } from "gpui-base";
import { exec, home, appHome, theme, props, settings, watchFolder, notify, closeOverlay, nextCommand, run as herdrRun } from "herdr";

const MAX_BYTES = 1048576;
const MAX_LINES = 20000;
const MAX_ENTRIES = 500;
const MAX_PAGES = 20;
const MAX_IMAGE_PX = 3200;
const CACHE_DAYS = 7;

const EXT_LANG = {
  js: "js", mjs: "js", cjs: "js", jsx: "js", ts: "js", tsx: "js", mts: "js", cts: "js",
  json: "json", jsonc: "json", json5: "json", yaml: "yaml", yml: "yaml", toml: "yaml",
  py: "python", rb: "ruby", sh: "bash", bash: "bash", zsh: "bash", go: "go", rs: "rust",
  swift: "swift", css: "css", scss: "css", html: "html", htm: "html", xml: "html", svelte: "html",
  vue: "html", sql: "sql", md: "markdown", markdown: "markdown", mdx: "markdown", c: "c", h: "c",
  cpp: "cpp", cc: "cpp", hpp: "cpp", java: "java", diff: "diff", patch: "diff",
};
const NAME_LANG = { ".zshrc": "bash", ".bashrc": "bash", ".zprofile": "bash", ".profile": "bash", ".envrc": "bash" };
const LABEL = {
  md: "Markdown", markdown: "Markdown", mdx: "MDX", json: "JSON", jsonc: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML",
  js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JSX", ts: "TypeScript", tsx: "TSX", py: "Python",
  rb: "Ruby", sh: "Shell script", bash: "Shell script", zsh: "Shell script", go: "Go", rs: "Rust", swift: "Swift",
  css: "CSS", scss: "SCSS", html: "HTML", htm: "HTML", xml: "XML", sql: "SQL", csv: "CSV", tsv: "TSV", txt: "Plain text",
  log: "Log", c: "C", h: "C header", cpp: "C++", java: "Java", svg: "SVG image", pdf: "PDF document",
  docx: "Word document", doc: "Word document", rtf: "Rich text", rtfd: "Rich text", odt: "OpenDocument text",
  webarchive: "Web archive", pages: "Pages document", pptx: "PowerPoint", xlsx: "Excel workbook", key: "Keynote",
  numbers: "Numbers spreadsheet", heic: "HEIC image", tiff: "TIFF image", tif: "TIFF image",
};
const MD = new Set(["md", "markdown", "mdx"]);
const HTML = new Set(["html", "htm", "xhtml"]);
const DIRECT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"]);
const CONVERT = new Set(["heic", "heif", "tif", "tiff"]);
const WORD = new Set(["docx", "doc", "rtf", "rtfd", "odt", "webarchive", "pages"]);
const QUICKLOOK = new Set(["pptx", "ppt", "xlsx", "xls", "key", "numbers", "odp", "ods", "epub"]);
const TEXT = new Set([
  ...Object.keys(EXT_LANG), "txt", "log", "csv", "tsv", "ini", "conf", "cfg", "env", "lock", "gitignore", "kt", "php", "pl",
  "r", "tex", "rst", "org", "properties", "gradle", "lua", "zig", "graphql", "proto", "text",
]);

const sameFolder = (p) => p.replace(/^\/private(?=\/(tmp|var|etc)(\/|$))/, "");
const basename = (p) => p.replace(/\/+$/, "").split("/").pop() || "/";
const dirOf = (p) => {
  const i = p.replace(/\/+$/, "").lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
};
const extOf = (name) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
};
const tilde = (p) => {
  const h = home();
  return p === h ? "~" : p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p;
};
function normalize(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}
function expand(file) {
  let p = String(file ?? "").trim();
  if (p === "~") p = home();
  else if (p.startsWith("~/")) p = `${home()}/${p.slice(2)}`;
  return p ? normalize(p) : "";
}
function hash(text) {
  let a = 5381, b = 52711;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = ((a << 5) + a + c) >>> 0;
    b = ((b << 5) ^ b ^ c) >>> 0;
  }
  return a.toString(16) + b.toString(16);
}
function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(ms) {
  const d = new Date(ms), pad = (n) => String(n).padStart(2, "0");
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fmtCount = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// Relative image paths in Markdown and HTML resolve against the file's folder.
function absolutize(target, dir) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("data:")) return target;
  let rel = target;
  try { rel = decodeURI(target); } catch {}
  return encodeURI(rel.startsWith("/") ? normalize(rel) : normalize(`${dir}/${rel}`));
}
function fixMarkdown(text, dir) {
  let out = text.replace(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/, "```yaml\n$1\n```\n\n");
  out = out.replace(/\[!\[([^\]]*)\]\([^)]*\)\]\(([^)]*)\)/g, (_m, alt, href) => `[Image: ${alt || "image"}](${href})`);
  out = out.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g, (_m, alt, t) => `[Image: ${alt || "image"}](${absolutize(t, dir)})`);
  out = out.replace(/\[([^\]]*)\]\(\s*<?([^)\s>]+)>?((?:\s+"[^"]*")?)\)/g, (_m, text, t, title) => `[${text}](${absolutize(t, dir)}${title})`);
  return fixHtml(out, dir);
}
function fixHtml(text, dir) {
  return text.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1];
    return src ? `<a href="${absolutize(src, dir)}">[Image: ${alt || "image"}]</a>` : "";
  });
}

function svgSize(text) {
  const w = text.match(/<svg[^>]*\swidth\s*=\s*["']?([\d.]+)/i)?.[1];
  const hgt = text.match(/<svg[^>]*\sheight\s*=\s*["']?([\d.]+)/i)?.[1];
  if (w && hgt) return { w: Number(w), h: Number(hgt) };
  const vb = text.match(/viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i);
  return vb ? { w: Number(vb[1]), h: Number(vb[2]) } : null;
}

async function run(cmd, args) {
  return exec(cmd, args).catch(() => ({ code: -1, stdout: "", stderr: "cannot run" }));
}

// The first MAX_LINES lines and MAX_BYTES bytes, and how long the whole file is.
async function readText(path, size) {
  const [head, count] = await Promise.all([
    run("sh", ["-c", `head -n ${MAX_LINES + 1} "$1" | head -c ${MAX_BYTES + 1}`, "_", path]),
    run("sh", ["-c", 'wc -l < "$1"', "_", path]),
  ]);
  if (head.code !== 0) throw new Error(head.stderr.trim() || "Cannot read this file");
  let text = head.stdout;
  const total = count.code === 0 ? Number(count.stdout.trim()) : null;
  let lines = text.split("\n");
  const truncated = size > MAX_BYTES || lines.length > MAX_LINES || (total !== null && total > MAX_LINES);
  if (truncated) {
    if (lines.length > MAX_LINES) lines = lines.slice(0, MAX_LINES);
    text = lines.join("\n");
    if (text.length > MAX_BYTES) text = text.slice(0, MAX_BYTES);
  }
  return { text, truncated, shown: truncated ? text.split("\n").length : lines.length, total };
}

async function imageSize(path) {
  const r = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
  const w = Number(r.stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const hgt = Number(r.stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  return w && hgt ? { w, h: hgt } : null;
}

async function listFolder(path) {
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 1000 ] && break; done; test -d "$1"';
  const r = await run("sh", ["-c", script, "preview", path]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Cannot list this folder");
  const fields = r.stdout.split("\0"), entries = [];
  for (let i = 0; i + 1 < fields.length; i += 2) if (fields[i + 1] !== ".DS_Store") entries.push({ name: fields[i + 1], dir: fields[i] === "d" });
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return { entries: entries.slice(0, MAX_ENTRIES), more: entries.length > MAX_ENTRIES };
}

const cacheRoot = () => `${appHome()}/preview-cache`;
const slot = (meta, path) => `${cacheRoot()}/${hash(path)}-${meta.mtime}-${meta.size}`;
const rel = (abs) => abs.slice(appHome().length + 1);

// Drops what an older version of this file left in the cache.
function prune(path, current) {
  run("sh", ["-c", 'for f in "$1"-*; do case "$f" in "$2"*) ;; *) rm -rf "$f" ;; esac; done', "_", `${cacheRoot()}/${hash(path)}`, current]);
}

async function stage(path, out, dims, convert) {
  const big = dims && Math.max(dims.w, dims.h) > MAX_IMAGE_PX;
  const resize = big ? `-Z ${MAX_IMAGE_PX}` : "";
  const make = convert
    ? `sips -s format png ${resize} "$1" --out "$2" >/dev/null 2>&1`
    : big ? `sips ${resize} "$1" --out "$2" >/dev/null 2>&1` : 'cp -c "$1" "$2" 2>/dev/null || cp "$1" "$2"';
  await run("sh", ["-c", `mkdir -p "$(dirname "$2")" && { [ -s "$2" ] || { ${make}; }; }`, "_", path, out]);
  return (await run("test", ["-s", out])).code === 0;
}

async function build(path) {
  const st = await run("stat", ["-L", "-f", "%z|%m|%HT", path]);
  if (st.code !== 0) return { kind: "missing", path };
  const [size, mtime, type] = st.stdout.trim().split("|");
  const meta = { size: Number(size), mtime: Number(mtime) * 1000, dir: type === "Directory" };
  const name = basename(path), ext = extOf(name), dir = dirOf(path);
  const base = { path, name, ext, dir, meta, label: LABEL[ext] };

  if (meta.dir && !WORD.has(ext) && !QUICKLOOK.has(ext)) {
    const list = await listFolder(path);
    return { ...base, kind: "folder", label: "Folder", ...list };
  }

  const info = async (message) => {
    const r = await run("file", ["-b", path]);
    return { ...base, kind: "info", description: r.stdout.trim().slice(0, 160) || "Unknown", message };
  };
  const text = async (lang, extra = {}) => {
    const t = await readText(path, meta.size);
    let body = t.text;
    if (lang === "json" && !t.truncated && body.split("\n").length <= 3) {
      try { body = JSON.stringify(JSON.parse(body), null, 2); extra.formatted = true; } catch {}
    }
    return { ...base, kind: "text", lang, wrap: lang === "markdown" || ext === "txt" || ext === "rst" || ext === "org" || ext === "tex", ...t, text: body, ...extra };
  };

  let kind = "sniff";
  if (MD.has(ext)) kind = "markdown";
  else if (HTML.has(ext)) kind = "html";
  else if (ext === "svg") kind = "svg";
  else if (DIRECT.has(ext)) kind = "image";
  else if (CONVERT.has(ext)) kind = "convert";
  else if (ext === "pdf") kind = "pdf";
  else if (WORD.has(ext)) kind = "word";
  else if (QUICKLOOK.has(ext)) kind = "quicklook";
  else if (TEXT.has(ext)) kind = "text";
  else if (NAME_LANG[name] || /^(makefile|dockerfile|readme|license|gemfile|rakefile|procfile)$/i.test(name)) kind = "text";

  if (kind === "sniff") {
    if (meta.size === 0) return { ...(await text(null)), label: "Empty file" };
    const r = await run("file", ["-b", "--mime", path]);
    const mime = r.stdout.trim().split(";")[0] ?? "";
    const binary = /charset=binary/.test(r.stdout);
    if (mime === "application/pdf") kind = "pdf";
    else if (mime === "image/svg+xml") kind = "svg";
    else if (mime.startsWith("image/")) kind = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/x-icon"].includes(mime) ? "image" : "convert";
    else if (!binary) kind = "text";
    else return info();
  }

  if (kind === "text") return text(NAME_LANG[name] ?? EXT_LANG[ext] ?? null);

  if (kind === "markdown") {
    const t = await readText(path, meta.size);
    return { ...base, kind: "markdown", ...t, label: "Markdown" };
  }
  if (kind === "html") {
    const t = await readText(path, meta.size);
    return { ...base, kind: "html", ...t, label: "HTML" };
  }
  if (kind === "svg") {
    const [t, current] = [await readText(path, meta.size), slot(meta, path)];
    if (!(await stage(path, `${current}.svg`, null, false))) return info("This image could not be prepared for preview");
    prune(path, current);
    return { ...base, kind: "image", src: rel(`${current}.svg`), dims: svgSize(t.text), label: "SVG image" };
  }
  if (kind === "image" || kind === "convert") {
    const dims = await imageSize(path), current = slot(meta, path), out = `${current}.${kind === "image" ? ext : "png"}`;
    if (!(await stage(path, out, dims, kind === "convert"))) return info("This image could not be prepared for preview");
    prune(path, current);
    return { ...base, kind: "image", src: rel(out), dims, label: LABEL[ext] ?? `${ext.toUpperCase()} image` };
  }
  if (kind === "word") {
    const r = await run("textutil", ["-convert", "html", "-stdout", path]);
    if (r.code === 0 && r.stdout.trim()) return { ...base, kind: "html", text: r.stdout, truncated: false, converted: true };
    kind = "quicklook";
  }
  if (kind === "pdf") {
    const d = slot(meta, path);
    const script = 'd=$1; f=$2; mkdir -p "$d"; if [ ! -e "$d/.done" ]; then if command -v pdftoppm >/dev/null; then pdftoppm -png -r 110 -l ' + MAX_PAGES + ' "$f" "$d/page" && touch "$d/.done"; fi; fi; ls -1 "$d"/page-*.png 2>/dev/null';
    const r = await run("sh", ["-c", script, "_", d, path]);
    const files = r.stdout.split("\n").filter(Boolean).sort();
    if (files.length) {
      const pagesOut = await run("sh", ["-c", 'pdfinfo "$1" 2>/dev/null | awk \'/^Pages:/ {print $2}\'', "_", path]);
      const pages = Number(pagesOut.stdout.trim()) || files.length;
      const sizes = await Promise.all(files.map(imageSize));
      prune(path, d);
      return { ...base, kind: "pages", pages: files.map((src, i) => ({ src: rel(src), dims: sizes[i] })), total: pages, label: "PDF document" };
    }
    kind = "quicklook";
  }
  if (kind === "quicklook") {
    const d = `${slot(meta, path)}-ql`;
    const r = await run("sh", ["-c", 'd=$1; f=$2; mkdir -p "$d"; ls "$d"/*.png >/dev/null 2>&1 || qlmanage -t -s 1600 -o "$d" "$f" >/dev/null 2>&1; ls -1 "$d"/*.png 2>/dev/null | head -n 1', "_", d, path]);
    const out = r.stdout.trim();
    if (!out) return info("Quick Look has no preview for this file");
    const dims = await imageSize(out);
    prune(path, slot(meta, path));
    const note = ext === "pdf" ? "First page only (install poppler for every page)" : "Quick Look image of the first page";
    return { ...base, kind: "image", src: rel(out), dims, label: LABEL[ext] ?? "Document", note };
  }
  return info();
}

export default class Preview extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.path = expand(p.file ?? p.path);
    this.history = [];
    this.mode = p.mode === "source" ? "source" : "rendered";
    this.keepMode = true;
    this.v = null;
    this.loading = Boolean(this.path);
    this.token = 0;
    this.size = null;
    this.watching = new Set();
    this.code = null;
    this.codeKey = null;
    this.codeText = null;
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (this.closed) return;
        if (c === "focus") this.handle.focus();
        else if (c === "reload") this.load(cx, true);
        else if (c === "copy") this.copyPath();
        else if (c === "reveal") this.reveal();
        else if (c === "open") this.openDefault();
        else if (c === "edit") this.edit();
        else if (c === "back") this.back(cx);
        cx.notify();
      }
    });
    cx.timer.every(5000, (cx) => this.checkStat(cx));
    run("find", [cacheRoot(), "-mindepth", "1", "-maxdepth", "1", "-mtime", `+${CACHE_DAYS}`, "-exec", "rm", "-rf", "{}", "+"]);
    if (this.path) this.load(cx, false);
  }

  async close() {
    this.closed = true;
    this.code?.release();
    this.code = null;
  }

  load(cx, quiet) {
    const path = this.path, token = ++this.token;
    if (!quiet) {
      this.v = null;
      this.loading = true;
      if (!this.keepMode) this.mode = "rendered";
      this.keepMode = false;
      cx.notify();
    }
    cx.spawn(async (cx) => {
      let v;
      try {
        v = await build(path);
      } catch (e) {
        v = { kind: "info", path, name: basename(path), dir: dirOf(path), meta: null, description: "Unreadable", message: String(e?.message ?? e) };
      }
      if (token !== this.token || this.closed) return;
      this.loading = false;
      this.v = v;
      this.syncCode();
      this.watch(v.kind === "folder" ? path : dirOf(path), cx);
      cx.notify();
    });
  }

  // A slow safety net beside the folder watch: a symlinked file changes in another folder, and a
  // watch can fail. Only a changed size or mtime reloads.
  checkStat(cx) {
    const path = this.path;
    if (!this.v) return;
    cx.spawn(async (cx) => {
      const r = await run("stat", ["-L", "-f", "%z|%m", path]);
      if (path !== this.path || !this.v || this.closed) return;
      const was = this.v.meta, [size, mtime] = r.stdout.trim().split("|");
      const now = r.code === 0 ? { size: Number(size), mtime: Number(mtime) * 1000 } : null;
      if ((was || now) && (!was || !now || was.size !== now.size || was.mtime !== now.mtime)) this.load(cx, true);
    });
  }

  // One watcher per folder; it follows whichever file is shown from that folder.
  watch(dir, cx) {
    if (this.watching.has(dir)) return;
    this.watching.add(dir);
    cx.spawn(async (cx) => {
      try {
        while (!this.closed) {
          const changed = await watchFolder(dir);
          if (this.closed) return;
          const shown = this.v?.kind === "folder" ? this.path : dirOf(this.path);
          if (shown !== dir) continue;
          const folder = this.v?.kind === "folder", here = sameFolder(this.path), root = sameFolder(dir);
          const hit = !changed?.length || changed.some((raw) => {
            const c = sameFolder(raw);
            return c === root || (folder ? dirOf(c) === root : c === here || c.startsWith(`${here}/`));
          });
          if (hit) this.load(cx, true);
        }
      } catch {
        this.watching.delete(dir);
      }
    });
  }

  navigate(path, cx) {
    const target = expand(path);
    if (!target || target === this.path) return;
    this.history.push(this.path);
    this.path = target;
    this.load(cx, false);
  }

  back(cx) {
    const prev = this.history.pop();
    if (!prev) return;
    this.path = prev;
    this.load(cx, false);
  }

  // Links in rendered Markdown and HTML: web links open the browser, local ones preview here.
  link(url, cx) {
    if (/^(https?|mailto|tel):/i.test(url)) { exec("open", [url]).catch(() => {}); return; }
    let target = url.replace(/^file:\/\//, "").replace(/[?#].*$/, "");
    if (!target) return;
    try { target = decodeURIComponent(target); } catch {}
    this.navigate(target.startsWith("/") ? target : `${dirOf(this.path)}/${target}`, cx);
  }

  copyPath() {
    exec("sh", ["-c", 'printf %s "$1" | /usr/bin/pbcopy', "_", this.path])
      .then(() => notify({ title: "Copied path", level: "success", timeout: 1500 }))
      .catch(() => notify({ title: "Could not copy the path", level: "error" }));
  }
  reveal() { exec("open", ["-R", this.path]).catch(() => {}); }
  openDefault() { exec("open", [this.path]).catch(() => {}); }

  // Text you can edit: not a Word document shown through textutil, which is "html" here too.
  canEdit() {
    const kind = this.v?.kind;
    return kind === "markdown" || kind === "text" || kind === "folder" || (kind === "html" && /\.x?html?$/i.test(this.path ?? ""));
  }

  // nvim opens in a terminal below the preview, in the file's folder; the preview reloads as you save.
  // It starts through your interactive login shell, so it has what a terminal has (XDG_CONFIG_HOME
  // from .zshrc, PATH for language servers); started bare, the nvim config's theme sync fails.
  edit() {
    if (!this.canEdit()) return;
    const path = this.path;
    const folder = this.v.kind === "folder" ? path : dirOf(path);
    exec("sh", ["-c", 'printf "%s\\n%s" "${SHELL:-/bin/zsh}" "$(command -v nvim)"'])
      .then((r) => {
        const [shell, nvim] = r.stdout.split("\n");
        if (!nvim) return notify({ title: "nvim isn't installed", level: "error" });
        herdrRun("terminal.open", {
          argv: [shell, "-lic", 'exec "$0" -- "$1"', nvim, path],
          folder,
          place: "down",
          name: `nvim ${path.split("/").pop()}`,
        });
      })
      .catch(() => notify({ title: "Could not start nvim", level: "error" }));
  }

  key(e, cx) {
    const k = e.keystroke;
    if (k === "cmd-shift-c") this.copyPath();
    else if (k === "cmd-shift-r") this.reveal();
    else if (k === "cmd-o") this.openDefault();
    else if (k === "cmd-e") this.edit();
    else if (k === "cmd-r") this.load(cx, true);
    else if (k === "cmd-[") this.back(cx);
    else if (k === "escape") {
      const overlay = props()?.overlay;
      if (!overlay) return;
      closeOverlay(overlay);
    } else return;
    cx.stop_propagation();
  }

  // ---- drawing ------------------------------------------------------------

  button(t, id, icon, tip, onClick) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover)).tooltip(tip).on_click((_e, cx) => onClick(cx))
      .child(svg(icon).size(14).text_color(t.muted));
  }

  segment(t, id, label, on, onClick) {
    return div().id(id).h(22).px(8).flex().items_center().rounded(5).cursor_pointer().text_size(12)
      .text_color(on ? t.foreground : t.dim).when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(on ? t.selected : t.hover))
      .on_click((_e, cx) => onClick(cx)).child(label);
  }

  header(t) {
    const v = this.v, path = this.path;
    const toggle = v && (v.kind === "markdown" || (v.kind === "html" && !v.converted));
    const icon = v?.kind === "folder" ? "mods/workspace-chrome/folder.svg" : "mods/workspace-chrome/file-text.svg";
    const meta = [];
    if (v?.label) meta.push(v.label);
    if (v?.kind === "image" && v.dims) meta.push(`${v.dims.w} \u00d7 ${v.dims.h} px`);
    if (v?.kind === "pages") meta.push(`${v.total} ${v.total === 1 ? "page" : "pages"}`);
    if (v?.kind === "folder") meta.push(`${v.entries.length}${v.more ? "+" : ""} items`);
    if (v?.meta && v.kind !== "folder") meta.push(fmtSize(v.meta.size));
    if (v?.meta) meta.push(`Modified ${fmtDate(v.meta.mtime)}`);
    if (v?.formatted) meta.push("formatted");
    return v_flex().flex_none().gap(1).px(12).py(7).border_b(1).border_color(t.border)
      .child(h_flex().h(28).gap(6).items_center()
        .when(this.history.length > 0, (el) => el.child(this.button(t, "pv-back", "mods/workspace-chrome/chevron-left.svg", "Back (Cmd+[)", (cx) => this.back(cx))))
        .child(svg(icon).size(14).flex_none().text_color(t.muted))
        .child(div().min_w(0).truncate().font_semibold().text_color(t.foreground).child(basename(path)))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(tilde(dirOf(path))))
        .when(Boolean(toggle), (el) => el.child(h_flex().flex_none().gap(2).p(2).rounded(7).bg(t.surface)
          .child(this.segment(t, "pv-rendered", "Rendered", this.mode === "rendered", (cx) => this.setMode("rendered", cx)))
          .child(this.segment(t, "pv-source", "Source", this.mode === "source", (cx) => this.setMode("source", cx)))))
        .child(h_flex().flex_none().gap(1)
          .when(this.canEdit(), (el) => el.child(this.button(t, "pv-edit", "mods/workspace-chrome/square-pen.svg", "Edit in Neovim (Cmd+E)", () => this.edit())))
          .child(this.button(t, "pv-copy", "mods/workspace-chrome/files.svg", "Copy path (Cmd+Shift+C)", () => this.copyPath()))
          .child(this.button(t, "pv-reveal", "mods/workspace-chrome/folder.svg", "Reveal in Finder (Cmd+Shift+R)", () => this.reveal()))
          .child(this.button(t, "pv-open", "mods/workspace-chrome/monitor.svg", "Open with the default app (Cmd+O)", () => this.openDefault()))
          .child(div().id("pv-reload").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().text_size(15).text_color(t.muted)
            .hover((st) => st.bg(t.hover)).tooltip("Reload (Cmd+R)").on_click((_e, cx) => this.load(cx, true)).child("\u21bb"))))
      .child(div().truncate().text_size(11).text_color(t.dim).child(meta.join("  \u00b7  ") || "\u00a0"));
  }

  banner(t, text) {
    return div().flex_none().px(12).py(5).bg(t.surface).border_b(1).border_color(t.border).text_size(11.5).text_color(t.muted).child(text);
  }

  centered(t, ...children) {
    return v_flex().flex_1().min_h(0).items_center().justify_center().p(24).gap(8).children(children);
  }

  card(t, title, lines, symbol) {
    return this.centered(t,
      svg(symbol ?? "mods/workspace-chrome/file-text.svg").size(34).text_color(t.dim),
      div().text_size(14).font_semibold().text_color(t.foreground).child(title),
      ...lines.filter(Boolean).map((l) => div().max_w(460).text_size(12).text_color(t.muted).child(l)));
  }

  // What the Editor shows for the current view and mode, or null when it shows none.
  codeSpec() {
    const v = this.v;
    if (v?.kind === "text") return { text: v.text, lang: v.lang, wrap: v.wrap };
    if (v?.kind === "markdown" && this.mode === "source") return { text: v.text, lang: "markdown", wrap: true };
    if (v?.kind === "html" && !v.converted && this.mode === "source") return { text: v.text, lang: "html", wrap: false };
    return null;
  }

  // EditorState.new is refused during render, so this runs from loads and clicks. The state is
  // kept between loads, so a reload updates the text in place and the scroll position stays.
  syncCode() {
    const spec = this.codeSpec();
    if (!spec) {
      this.code?.release();
      this.code = null;
      this.codeKey = null;
      return;
    }
    const t = theme(), sig = `${this.path}|${spec.lang}|${spec.wrap}|${t.background}|${t.ansi5}`;
    if (this.codeKey !== sig) {
      this.code?.release();
      this.code = EditorState.new({
        language: spec.lang ?? "text", readonly: true, value: spec.text, font_family: settings().font_family, font_size: 12,
        line_numbers: true, soft_wrap: spec.wrap,
        syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 },
      });
      this.codeKey = sig;
      this.codeText = spec.text;
    } else if (this.codeText !== spec.text) {
      this.code.set_value(spec.text);
      this.codeText = spec.text;
    }
  }

  editor(t) {
    return this.code ? Editor.new(this.code).flex_1().min_h(0) : div().flex_1();
  }

  setMode(mode, cx) {
    this.mode = mode;
    this.syncCode();
    cx.notify();
  }

  prose(t, el) {
    return h_flex().flex_1().min_h(0).justify_center().text_color(t.foreground)
      .child(v_flex().w_full().max_w(800).h_full().min_h(0).px(28).py(14).child(el));
  }

  body(t) {
    const v = this.v;
    if (!this.path) return this.card(t, "No file to preview", ["Open one with herdr-preview <path>"]);
    if (!v) return this.centered(t, div().text_size(12).text_color(t.dim).child(this.loading ? "Loading\u2026" : ""));
    const dir = v.dir;
    switch (v.kind) {
      case "missing":
        return this.card(t, "File not found", [tilde(v.path), "It may have been moved or deleted. It appears here again if it comes back."]);
      case "info":
        return this.card(t, v.message ?? "No preview for this kind of file", [
          v.description,
          v.meta ? `${fmtSize(v.meta.size)}  \u00b7  Modified ${fmtDate(v.meta.mtime)}` : null,
          "Use the buttons above to copy the path, reveal it in Finder or open it.",
        ]);
      case "folder":
        return this.folder(t, v);
      case "text": {
        const note = v.truncated ? `Showing the first ${fmtCount(v.shown)} lines${v.total ? ` of ${fmtCount(v.total)}` : ""} (${fmtSize(v.meta.size)} file, preview limited to 1 MB or ${fmtCount(MAX_LINES)} lines)` : null;
        return v_flex().flex_1().min_h(0).when(Boolean(note), (el) => el.child(this.banner(t, note)))
          .child(this.editor(t));
      }
      case "markdown": {
        const note = v.truncated ? `Showing the first ${fmtCount(v.shown)} lines of the file` : null;
        const inner = this.mode === "source"
          ? this.editor(t)
          : this.prose(t, TextView.markdown(`md:${v.path}`, fixMarkdown(v.text, dir)).selectable().scrollable().size_full().text_size(14).on_link_click((url, cx) => this.link(url, cx)));
        return v_flex().flex_1().min_h(0).when(Boolean(note), (el) => el.child(this.banner(t, note))).child(inner);
      }
      case "html": {
        const note = v.truncated ? `Showing the first ${fmtCount(v.shown)} lines of the file` : null;
        const inner = this.mode === "source" && !v.converted
          ? this.editor(t)
          : this.prose(t, TextView.html(`html:${v.path}`, v.converted ? v.text : fixHtml(v.text, dir)).selectable().scrollable().size_full().text_size(14).on_link_click((url, cx) => this.link(url, cx)));
        return v_flex().flex_1().min_h(0).when(Boolean(note), (el) => el.child(this.banner(t, note))).child(inner);
      }
      case "image":
        return v_flex().flex_1().min_h(0).when(Boolean(v.note), (el) => el.child(this.banner(t, v.note))).child(this.picture(t, v));
      case "pages":
        return this.pages(t, v);
    }
    return null;
  }

  fit(dims, maxW, maxH) {
    if (!dims) return null;
    const s = Math.min(1, maxW / dims.w, maxH / dims.h);
    return { w: Math.max(1, Math.floor(dims.w * s)), h: Math.max(1, Math.floor(dims.h * s)) };
  }

  picture(t, v) {
    const area = this.size ? { w: this.size.width - 32, h: this.size.height - 130 } : null;
    const f = area && this.fit(v.dims ?? { w: 600, h: 400 }, area.w, area.h);
    return v_flex().flex_1().min_h(0).items_center().justify_center().p(16)
      .when(Boolean(f), (el) => el.child(div().rounded(6).overflow_hidden().child(image(v.src).w(f.w).h(f.h))));
  }

  pages(t, v) {
    const maxW = this.size ? this.size.width - 48 : 600;
    const more = v.total > v.pages.length ? this.banner(t, `Showing the first ${v.pages.length} of ${v.total} pages`) : null;
    return v_flex().flex_1().min_h(0)
      .when(Boolean(more), (el) => el.child(more))
      .child(v_flex().id("pv-pages").flex_1().min_h(0).overflow_y_scrollbar().items_center().gap(14).py(16)
        .children(v.pages.map((p, i) => {
          const f = this.fit(p.dims ?? { w: 850, h: 1100 }, maxW, 1e9);
          return div().id(`pv-page-${i}`).flex_none().rounded(4).overflow_hidden().border_1().border_color(t.border).child(image(p.src).w(f.w).h(f.h));
        })));
  }

  folder(t, v) {
    return v_flex().id("pv-folder").flex_1().min_h(0).overflow_y_scrollbar().p(6)
      .children(v.entries.map((e) => {
        const target = `${v.path === "/" ? "" : v.path}/${e.name}`;
        return h_flex().id(`pv-e-${e.name}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.navigate(target, cx))
          .child(svg(e.dir ? "mods/workspace-chrome/folder.svg" : "mods/workspace-chrome/file-text.svg").size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().min_w(0).truncate().child(e.name));
      }))
      .when(v.entries.length === 0, (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child("This folder is empty")))
      .when(v.more, (el) => el.child(div().p(8).text_size(11).text_color(t.dim).child(`Showing the first ${MAX_ENTRIES} entries`)));
  }

  render(cx) {
    const t = theme();
    const body = this.body(t);
    return v_flex().id("preview").track_focus(this.handle).size_full().min_h(0).overflow_hidden().rounded(8)
      .bg(t.background).text_color(t.foreground).text_size(13)
      .on_size_change((s, cx) => {
        if (this.size && Math.abs(this.size.width - s.width) < 1 && Math.abs(this.size.height - s.height) < 1) return;
        this.size = s;
        cx.notify();
      })
      .on_mouse_down("left", () => this.handle.focus())
      .on_key_down((e, cx) => this.key(e, cx))
      .child(this.header(t))
      .child(body);
  }
}
