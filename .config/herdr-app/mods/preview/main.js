// Preview: a rich preview of one file or folder, opened beside the
// terminal (`herdr-preview <path>`, or `pane.split {mod: "preview", props: {file}}`
// / `tab.new {mod: "preview", props: {file}}`). `props().file` is an absolute path
// (a leading ~ is expanded). What it draws depends on the kind:
//   Markdown   rendered with TextView (Rendered / Source toggle); relative links to
//              local files open here (Back returns), http(s) links open the browser.
//              TextView draws no images, so each one becomes an "Image: alt" link.
//              A file with fenced code or Mermaid is drawn in parts: the prose in TextViews,
//              each fence in a read-only code view with highlighting, each Mermaid fence as
//              the picture `herdr-render` draws with WebKit (cached per diagram)
//   HTML       the page as WebKit lays it out (`herdr-render`, tiles at the pane's width,
//              cached), with Source beside it; TextView.html when it can't be drawn
//   Word-like  .docx .doc .rtf .rtfd .odt .webarchive through `textutil`, shown as HTML
//   Images     fitted to the pane, never upscaled past 100%, with the pixel size. The zoom bar under
//              the image zooms out (-), in (+), to actual size (0), to fit (F) and to the pane's
//              width (W), keeping the middle of the view in place; scrolling pans a zoomed image.
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
// preview.reload, preview.zen, preview.prev, preview.next, preview.zoom-in, preview.zoom-out,
// preview.zoom-fit, preview.zoom-width and preview.zoom-actual. The header carries the actions on
// every kind: Copy path (Cmd+Shift+C),
// Reveal in Finder (Cmd+Shift+R), Open with the default app (Cmd+O), Reload (Cmd+R), and
// for text, code, Markdown, HTML and folders Edit in Neovim (Cmd+E: nvim in a terminal
// below the preview, in the file's folder, so the preview follows each save); Esc closes
// the preview when it is shown as an overlay. The file's folder is watched, so the
// preview follows edits (the Editor keeps its scroll position).
//
// Left and right (the arrow keys, or the arrows at the end of the header's second line) step to the
// previewable files before and after this one in its folder, in the Files tree's order, with "3 / 12"
// between them. Back and the Rendered/Source choice are kept; each image opens fitted again.
//
// Focus mode (Cmd+Shift+F, or the header's expand button) shows the file in a modal over most of
// the window, for reading Markdown or looking at an image closely: another copy of this mod, opened
// with props {file, mode, zen: true}, with larger text and no Edit. Esc, Cmd+Shift+F, its close
// button or a click beside it closes it.
//
// A file on a Herdr machine (props or "files.open" {on: "<machine>"}) previews the same way: its
// folder is listed and its file stat-ed there, and the file itself (up to 8 MB, the most `hc exec`
// passes; the first 1 MB of a larger text file) is fetched through herdr-core into the cache, where
// the steps above run on the copy. Its header shows the machine; it has no Edit or Reveal, Open
// opens the copy, and a 5-second check of the file there replaces the folder watch.
//
// In the Files panel (the netrunner layout's files-preview block, props {panel: "files"}) it shows
// the file Files puts in shared "files.open", "Files" (or Esc) goes back to the tree, and Edit
// runs nvim in the panel itself: the terminal named files-nvim (herdr-files-editor), which the
// layout's files-edit block shows. Quitting nvim brings the preview back, reloaded.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextView, Editor, EditorState } from "gpui-base";
import { exec, home, appHome, theme, props, settings, fonts, watchFolder, readTextFile, notify, openOverlay, closeOverlay, nextCommand, shared, terminals, hc, layout, run as herdrRun } from "herdr";
import { fileIcon } from "./file-icons.js";

const EDITOR = "files-nvim";
// Another machine's things, as the Agents tree marks them.
const REMOTE = "#fcee0a";
// Focus mode's share of the window, and its glyphs (Material Design icons in the Nerd Font).
const ZEN = { width: 0.94, height: 0.92 };
const ICON_EXPAND = "\u{F0293}";
const ICON_SHRINK = "\u{F0294}";
// The open focus-mode modal. Every copy of this mod shares the module, so a preview.zen key that
// reaches the modal and the preview under it closes the modal instead of opening another.
/** @type {string | null} */
let zenOverlay = null;

// Focus mode is a modal over the window, so it fills with the theme's background without its alpha: a
// see-through layout (netrunner's frosted glass) clears that colour, which would show the window through it.
const solid = (c) => (typeof c === "string" && c.length === 9 ? c.slice(0, 7) : c);
const editorState = () => `${home()}/.local/state/herdr-files`;

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

const MAX_BYTES = 1048576;
const MAX_LINES = 20000;
const MAX_ENTRIES = 500;
const MAX_PAGES = 20;
const MAX_IMAGE_PX = 3200;
const CACHE_DAYS = 7;
// Zoom in and Zoom out step through these scales (1 is actual size: one image pixel per point).
const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
// The margin around an image, and the room its floating zoom bar takes at the bottom.
const IMAGE_PAD = 16;
const ZOOM_BAR = 44;

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
const TEXT_NAMES = /^(makefile|dockerfile|readme|license|gemfile|rakefile|procfile)$/i;

// The folder entries the left and right arrows step through: what build() previews by name alone.
// Bundles (.rtfd, .key, .numbers) are folders on disk; a file it would have to sniff is left out.
function previewable(e) {
  const ext = extOf(e.name);
  if (e.dir) return WORD.has(ext) || QUICKLOOK.has(ext);
  return MD.has(ext) || HTML.has(ext) || ext === "svg" || ext === "pdf" || DIRECT.has(ext) || CONVERT.has(ext) || WORD.has(ext)
    || QUICKLOOK.has(ext) || TEXT.has(ext) || Boolean(NAME_LANG[e.name]) || TEXT_NAMES.test(e.name)
    || (e.name.startsWith(".") && TEXT.has(e.name.slice(1)));
}

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

async function run(cmd, args, on, timeout) {
  return exec(cmd, args, { ...(on ? { on } : {}), ...(timeout ? { timeout } : {}) }).catch(() => ({ code: -1, stdout: "", stderr: "cannot run" }));
}

// herdr-render (~/.local/bin) draws HTML pages and Mermaid with the system WebKit, through bun.
const BUN = () => `${home()}/.bun/bin/bun`;
const RENDER = () => `${home()}/.local/bin/herdr-render`;
// Code fences name languages their own way; these are the code view's names for them.
const FENCE_LANG = {
  typescript: "js", javascript: "js", python: "python", shell: "bash", console: "bash", shellscript: "bash",
  rust: "rust", ruby: "ruby", golang: "go", kotlin: "java", "c++": "cpp", text: "text", plaintext: "text",
};

// The code font: the terminal's when it is an installed family, else JetBrains Mono, else Menlo. A name
// the code view can't find ("JetBrainsMono Nerd Font" here) silently falls back to a proportional font.
let monoCache = null;
const monoFont = () => {
  const want = String(settings().font_family ?? "");
  if (monoCache?.want !== want) {
    const have = new Set(fonts());
    monoCache = { want, font: [want, "JetBrains Mono", "Menlo"].find((f) => f && have.has(f)) ?? "Menlo" };
  }
  return monoCache.font;
};

// A read-only code view's state in the theme's colours. A language the view doesn't know shows as text.
function codeState(lang, value, size, lineNumbers, wrap = false) {
  const t = theme();
  const opts = { readonly: true, value, font_family: monoFont(), font_size: size, line_numbers: lineNumbers, folding: lineNumbers, soft_wrap: wrap,
    syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } };
  try { return EditorState.new({ ...opts, language: lang ?? "text" }); } catch { return EditorState.new({ ...opts, language: "text" }); }
}

// Markdown cut at its top-level fences: [{type: "md" | "code" | "mermaid", text, lang}].
function splitMarkdown(text) {
  const lines = text.split("\n"), out = [];
  let prose = [];
  const flush = () => { if (prose.join("").trim()) out.push({ type: "md", text: prose.join("\n") }); prose = []; };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/);
    if (!m) { prose.push(lines[i]); continue; }
    const close = new RegExp(`^ {0,3}${m[1][0] === "`" ? "`" : "~"}{${m[1].length},}\\s*$`), body = [];
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) body.push(lines[j++]);
    const lang = m[2].toLowerCase();
    flush();
    out.push(lang === "mermaid" ? { type: "mermaid", text: body.join("\n") } : { type: "code", lang: FENCE_LANG[lang] ?? EXT_LANG[lang] ?? (lang || "text"), text: body.join("\n") });
    i = j;
  }
  flush();
  return out;
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

async function listFolder(path, limit = MAX_ENTRIES, on = null) {
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 1000 ] && break; done; test -d "$1"';
  const r = await run("sh", ["-c", script, "preview", path], on);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Cannot list this folder");
  const fields = r.stdout.split("\0"), entries = [];
  for (let i = 0; i + 1 < fields.length; i += 2) if (fields[i + 1] !== ".DS_Store") entries.push({ name: fields[i + 1], dir: fields[i] === "d" });
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return { entries: entries.slice(0, limit), more: entries.length > limit };
}

// The previewable files in a folder, sorted by name as the Files tree sorts them.
async function siblingsOf(dir, on = null) {
  const { entries } = await listFolder(dir, Infinity, on);
  return { dir, on, names: entries.filter(previewable).map((e) => e.name).sort((a, b) => a.localeCompare(b)) };
}

// Where one side of an image, `len` px long, sits in a viewport side of `area` px with the fraction
// `f` of it at the viewport's centre, between margins `start` and `end`. An image that fits is
// centred (and its f is the middle); a larger one is clamped so no gap opens inside the margins, and
// f is corrected to match, so a scroll past an edge doesn't have to be undone before it moves again.
function place(len, area, f, start, end) {
  const room = area - start - end;
  if (len <= room) return { pos: Math.round(start + (room - len) / 2), f: 0.5 };
  const pos = Math.min(start, Math.max(area - end - len, area / 2 - f * len));
  return { pos: Math.round(pos), f: (area / 2 - pos) / len };
}

// Size, modified time and whether it is a folder, here or on a machine (GNU stat takes -c, macOS -f).
const STAT = 'if stat -c %s / >/dev/null 2>&1; then stat -L -c "%s|%Y|%F" "$1"; else stat -L -f "%z|%m|%HT" "$1"; fi';
async function statOf(path, on) {
  const r = await run("sh", ["-c", STAT, "_", path], on);
  if (r.code !== 0) return null;
  const [size, mtime, type] = r.stdout.trim().split("|");
  return { size: Number(size), mtime: Number(mtime) * 1000, dir: /^directory$/i.test(type ?? "") };
}

// `hc exec` keeps the first 8 MB of a program's output.
const MAX_FETCH = 8 * 1024 * 1024;

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

// A copy of a file on machine `on` in the cache, under its own name (kinds, `file` and Quick Look go by
// the name), fetched once per version: `hc exec cat` passes bytes as they are, and redirected to the
// file here nothing is decoded. Older versions of it go. `head` fetches the start of a large text file.
async function fetchRemote(path, on, st, head) {
  const key = `${cacheRoot()}/m${hash(`${on}:${path}`)}`, dir = `${key}-${st.mtime}-${st.size}${head ? "-head" : ""}`, out = `${dir}/${basename(path)}`;
  const read = head ? `head -c ${MAX_BYTES + 1}` : "cat";
  const r = await run("sh", ["-c", `mkdir -p "$1" && { [ -e "$2" ] || { hc exec --on "$3" --timeout 120 ${read} -- "$4" > "$2.part" && mv "$2.part" "$2"; } || { rm -f "$2.part"; exit 1; }; }`, "_", dir, out, on, path]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `Could not fetch it from ${on}`);
  run("sh", ["-c", 'for d in "$1"-*; do [ "$d" = "$2" ] || rm -rf "$d"; done', "_", key, dir]);
  return out;
}

// A file or folder on Herdr machine `on`: a folder is listed there, a file is fetched (fetchRemote) and
// previewed as a local one, under its own path and with the machine's size and time.
async function buildRemote(path, on, opts = {}) {
  const st = await statOf(path, on);
  if (!st) return { kind: "missing", path };
  const name = basename(path), ext = extOf(name), dir = dirOf(path);
  const base = { path, name, ext, dir, meta: st, label: LABEL[ext] };
  if (st.dir && !WORD.has(ext) && !QUICKLOOK.has(ext)) return { ...base, kind: "folder", label: "Folder", ...(await listFolder(path, MAX_ENTRIES, on)) };
  const texty = MD.has(ext) || HTML.has(ext) || TEXT.has(ext) || Boolean(NAME_LANG[name]) || TEXT_NAMES.test(name);
  if (st.dir || (st.size > MAX_FETCH && !texty)) {
    return { ...base, kind: "info", description: st.dir ? "A document saved as a folder" : fmtSize(st.size),
      message: st.dir ? `This kind of document can't be previewed from ${on}` : `Too big to preview from ${on} (the limit is ${fmtSize(MAX_FETCH)})` };
  }
  const head = st.size > MAX_FETCH;
  const v = await build(await fetchRemote(path, on, st, head), opts);
  return { ...v, path, name, dir, meta: st, local: v.path, ...(head ? { truncated: true, total: null } : {}) };
}

// Mermaid fences drawn by herdr-render into the cache, once per diagram and background:
// {<code>: {src, dims} | {error}}. A diagram Mermaid can't parse keeps its error, so it isn't tried again.
async function renderMermaid(segments) {
  const codes = [...new Set(segments.filter((s) => s.type === "mermaid").map((s) => s.text))];
  if (!codes.length) return {};
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
  await run("mkdir", ["-p", src]);
  await Promise.all(todo.map((x) => run("sh", ["-c", 'printf %s "$2" > "$1"', "_", `${src}/${x.key}.mmd`, x.code])));
  // The first diagram ever installs Mermaid, which takes a minute.
  const r = await run(BUN(), [RENDER(), "mermaid", cacheRoot(), bg, ...todo.map((x) => `${src}/${x.key}.mmd`)], null, 180000);
  let results = null;
  try { results = r.code === 0 ? JSON.parse(r.stdout) : null; } catch {}
  for (const [i, x] of todo.entries()) {
    const d = results?.[i];
    if (!d) { out[x.code] = { error: r.stderr.trim().split("\n").pop() || "herdr-render could not run" }; continue; }
    out[x.code] = d.error ? { error: d.error } : { src: rel(x.png), dims: { w: d.w, h: d.h } };
    run("sh", ["-c", 'printf %s "$2" > "$1"', "_", x.json, JSON.stringify(d.error ? { error: d.error } : { w: d.w, h: d.h })]);
  }
  run("rm", ["-rf", src]);
  return out;
}

// An HTML page as WebKit lays it out (herdr-render), in tiles at about the pane's width, cached per
// version and width. Null when it can't be drawn: the preview falls back to TextView.html.
async function renderHtml(path, meta, width) {
  const w = Math.max(480, Math.min(1600, Math.round((width || 1200) / 50) * 50));
  const dir = `${slot(meta, path)}-html${w}`;
  let r = null;
  try { r = JSON.parse(await readTextFile(`${dir}/tiles.json`)); } catch {}
  if (!r?.tiles?.length) {
    const res = await run(BUN(), [RENDER(), "html", path, dir, String(w)], null, 120000);
    try { r = res.code === 0 ? JSON.parse(res.stdout) : null; } catch {}
    if (!r?.tiles?.length) return null;
    run("sh", ["-c", 'printf %s "$2" > "$1/tiles.json"', "_", dir, JSON.stringify(r)]);
    prune(path, slot(meta, path));
  }
  return r.tiles.map((x) => ({ src: rel(x.file), dims: { w: x.w, h: x.h } }));
}

async function build(path, opts = {}) {
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
  else if (NAME_LANG[name] || TEXT_NAMES.test(name)) kind = "text";

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

  // An extension the table doesn't map goes to the code view as it is: it may know the language.
  if (kind === "text") return text(NAME_LANG[name] ?? EXT_LANG[ext] ?? (TEXT.has(ext) ? ext : null));

  if (kind === "markdown") {
    const t = await readText(path, meta.size);
    return { ...base, kind: "markdown", ...t, label: "Markdown", diagrams: await renderMermaid(splitMarkdown(t.text)) };
  }
  if (kind === "html") {
    const t = await readText(path, meta.size);
    return { ...base, kind: "html", ...t, label: "HTML", pages: await renderHtml(path, meta, opts.width) };
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
    this.panel = p.panel ?? null;
    this.zen = Boolean(p.zen);
    this.opened = this.panel ? shared("files.open") : null;
    this.path = expand(this.panel ? this.opened?.file : p.file ?? p.path);
    // The Herdr machine the file is on, or null for this Mac.
    this.on = (this.panel ? this.opened?.on : p.on) ?? null;
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
    // The previewable files beside the shown one ({dir, names}), for the left and right arrows.
    this.siblings = null;
    // An image's zoom (see scale), the fraction of it at the view's centre, and the view's size.
    this.zoom = null;
    this.focus = { x: 0.5, y: 0.5 };
    this.area = null;
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
        else if (c === "edit") this.edit(cx);
        else if (c === "back") this.back(cx);
        else if (c === "zen") this.toggleZen();
        else if (c === "prev") this.step(-1, cx);
        else if (c === "next") this.step(1, cx);
        else if (c === "zoom-in") this.zoomStep(1, cx);
        else if (c === "zoom-out") this.zoomStep(-1, cx);
        else if (c === "zoom-fit") this.setZoom("fit", cx);
        else if (c === "zoom-width") this.setZoom("width", cx);
        else if (c === "zoom-actual") this.setZoom(1, cx);
        cx.notify();
      }
    });
    // A dialog doesn't take the keyboard by itself: focus mode takes it once drawn, so its keys work.
    if (this.zen) cx.timer.after(60, () => this.handle.focus());
    cx.timer.every(5000, (cx) => this.checkStat(cx));
    if (this.panel) {
      cx.timer.every(300, (cx) => this.watchEditor(cx));
      // herdr-files-editor writes "closed" when nvim quits. This loop never ends, so what it starts lives on.
      cx.spawn(async (cx) => {
        await exec("mkdir", ["-p", editorState()]).catch(() => null);
        for (;;) {
          try { await watchFolder(editorState()); } catch { return; }
          if (!this.editing) continue;
          const closed = await readTextFile(`${editorState()}/closed`).catch(() => null);
          if (closed && closed !== this.closedSeen) this.editorDone(cx);
        }
      });
    }
    run("find", [cacheRoot(), "-mindepth", "1", "-maxdepth", "1", "-mtime", `+${CACHE_DAYS}`, "-exec", "rm", "-rf", "{}", "+"]);
    if (this.path) this.load(cx, false);
  }

  async close() {
    this.closed = true;
    if (this.zen) zenOverlay = null;
    this.code?.release();
    this.code = null;
    for (const b of this.blocks ?? []) b.state?.release();
    this.blocks = null;
  }

  load(cx, quiet) {
    const path = this.path, on = this.on, token = ++this.token;
    if (!quiet) {
      this.v = null;
      this.loading = true;
      this.zoom = null;
      this.focus = { x: 0.5, y: 0.5 };
      if (!this.keepMode) this.mode = "rendered";
      this.keepMode = false;
      cx.notify();
    }
    cx.spawn(async (cx) => {
      const listing = siblingsOf(dirOf(path), on).catch(() => null);
      let v;
      try {
        // HTML is drawn at about the pane's width.
        const opts = { width: (this.size?.width ?? 1248) - 48 };
        v = await (on ? buildRemote(path, on, opts) : build(path, opts));
      } catch (e) {
        v = { kind: "info", path, name: basename(path), dir: dirOf(path), meta: null, description: "Unreadable", message: String(e?.message ?? e) };
      }
      const siblings = await listing;
      if (token !== this.token || this.closed) return;
      this.loading = false;
      this.v = v;
      if (siblings) this.siblings = siblings;
      this.syncCode();
      this.syncBlocks();
      if (!on) this.watch(v.kind === "folder" ? path : dirOf(path), cx);
      cx.notify();
    });
  }

  // A slow safety net beside the folder watch: a symlinked file changes in another folder, and a
  // watch can fail. On a machine, where nothing is watched, it is how the preview follows edits.
  // Only a changed size or mtime reloads.
  checkStat(cx) {
    const path = this.path, on = this.on;
    if (!this.v) return;
    cx.spawn(async (cx) => {
      const now = await statOf(path, on);
      if (path !== this.path || on !== this.on || !this.v || this.closed) return;
      const was = this.v.meta;
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
          // A file came or went beside the shown one: the arrows' list follows.
          else if (!folder && changed.some((raw) => dirOf(sameFolder(raw)) === root)) this.refreshSiblings(cx);
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

  // Where the shown file sits among the previewable files beside it, and its neighbours. A file
  // missing from the list (deleted, or a kind only sniffing finds) still gets neighbours by name.
  nav() {
    const s = this.siblings, path = this.path;
    if (!s || !path || this.v?.kind === "folder" || s.dir !== dirOf(path) || s.on !== this.on) return null;
    const name = basename(path), i = s.names.indexOf(name);
    const prev = i >= 0 ? s.names[i - 1] : s.names.filter((n) => n.localeCompare(name) < 0).pop();
    const next = i >= 0 ? s.names[i + 1] : s.names.find((n) => n.localeCompare(name) > 0);
    return prev || next ? { index: i, count: s.names.length, prev, next } : null;
  }

  // The file before (-1) or after (1) this one. History is left alone, so Back still returns to the
  // page a link came from, and the Rendered/Source choice stays.
  step(delta, cx) {
    const n = this.nav(), target = n && (delta < 0 ? n.prev : n.next);
    if (!target) return;
    const dir = dirOf(this.path);
    this.path = `${dir === "/" ? "" : dir}/${target}`;
    this.keepMode = true;
    this.load(cx, false);
  }

  refreshSiblings(cx) {
    const dir = dirOf(this.path);
    cx.spawn(async (cx) => {
      const s = await siblingsOf(dir, this.on).catch(() => null);
      if (!s || this.closed || dirOf(this.path) !== dir) return;
      this.siblings = s;
      cx.notify();
    });
  }

  // The shown image's scale. this.zoom is "fit" (all of it, enlarged when small), "width" (the
  // pane's width), a number (Zoom in, Zoom out, Actual size), or null for a new image: fitted,
  // never enlarged past actual size. fit is the scale that shows all of it.
  scale(v) {
    const a = this.area;
    if (!a) return null;
    const d = v.dims ?? { w: 600, h: 400 }, z = this.zoom;
    const fit = Math.min((a.width - 2 * IMAGE_PAD) / d.w, (a.height - 2 * IMAGE_PAD - ZOOM_BAR) / d.h);
    const s = typeof z === "number" ? z : z === "fit" ? fit : z === "width" ? (a.width - 2 * IMAGE_PAD) / d.w : Math.min(1, fit);
    return { s: Math.max(0.01, s), fit };
  }

  // The next scale up or down in ZOOM_STEPS from wherever the image is now (a fit is rarely a step).
  zoomStep(dir, cx) {
    const v = this.v, now = v?.kind === "image" ? this.scale(v) : null;
    if (!now) return;
    this.settle(v, now);
    const up = ZOOM_STEPS.find((z) => z > now.s * 1.001), down = ZOOM_STEPS.filter((z) => z < now.s * 0.999).pop();
    this.zoom = dir > 0 ? (up ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]) : (down ?? ZOOM_STEPS[0]);
    cx.notify();
  }

  // Page width starts at the top of the image, as a document would.
  setZoom(zoom, cx) {
    const v = this.v, now = v?.kind === "image" ? this.scale(v) : null;
    if (v?.kind !== "image") return;
    if (now) this.settle(v, now);
    this.zoom = zoom;
    if (zoom === "width") this.focus = { x: 0.5, y: 0 };
    cx.notify();
  }

  // Sets the focus to what the view shows now: a side of the image that fits has its middle at the
  // centre, whatever an earlier pan left behind, so the next zoom grows from the middle of the view.
  settle(v, now) {
    const a = this.area, d = v.dims ?? { w: 600, h: 400 };
    const w = Math.max(1, Math.round(d.w * now.s)), h = Math.max(1, Math.round(d.h * now.s));
    this.focus = { x: place(w, a.width, this.focus.x, IMAGE_PAD, IMAGE_PAD).f, y: place(h, a.height, this.focus.y, IMAGE_PAD, IMAGE_PAD + ZOOM_BAR).f };
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
  // Opens this file in focus mode, or closes focus mode from inside it.
  toggleZen() {
    if (this.zen) return closeOverlay(props()?.overlay);
    if (zenOverlay || !this.path) return;
    zenOverlay = openOverlay({ mod: "preview", kind: "dialog", frame: "none", ...ZEN, props: { file: this.path, on: this.on, mode: this.mode, zen: true } });
  }

  reveal() { if (!this.on) exec("open", ["-R", this.path]).catch(() => {}); }
  // A machine's file opens as the copy fetched for the preview.
  openDefault() {
    const file = this.on ? this.v?.local : this.path;
    if (file) exec("open", [file]).catch(() => {});
  }

  // Text you can edit: not a Word document shown through textutil, which is "html" here too.
  canEdit() {
    if (this.on) return false;
    const kind = this.v?.kind;
    return kind === "markdown" || kind === "text" || kind === "folder" || (kind === "html" && /\.x?html?$/i.test(this.path ?? ""));
  }

  // nvim opens in a terminal below the preview, in the file's folder; the preview reloads as you save.
  // It starts through your interactive login shell, so it has what a terminal has (XDG_CONFIG_HOME
  // from .zshrc, PATH for language servers); started bare, the nvim config's theme sync fails.
  edit(cx) {
    if (!this.canEdit() || this.zen) return;
    if (this.panel) return this.editHere(cx);
    this.editBelow();
  }

  editBelow() {
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

  toTree() {
    herdrRun("layout.select", { stack: this.panel, child: `${this.panel}-tree` });
  }

  // The editor terminal (herdr-files-editor) starts once and stays: it takes "<folder>\t<file>" and
  // opens it. If nvim is still open there (its "editing" file), it is shown, never typed into.
  // Without the files-edit block (Herdr drops a block whose terminal ended), nvim opens below instead.
  editHere(cx) {
    const path = this.path, folder = this.v.kind === "folder" ? path : dirOf(path);
    if (!findNode(layout(), `${this.panel}-edit`)) {
      notify({ title: "The Files panel has no editor block", body: "Opening nvim below. Restore files-edit in layouts/netrunner.json.", level: "warning", timeout: 5000 });
      return this.editBelow();
    }
    cx.spawn(async () => {
      try {
        let term = terminals().find((x) => x.name === EDITOR && x.state === "live" && !String(x.address).includes("/"));
        if (!term) {
          const shell = (await exec("sh", ["-c", 'printf "%s" "${SHELL:-/bin/zsh}"'])).stdout.trim() || "/bin/zsh";
          // --rm: a finished terminal left under the name would get the block dropped when the layout loads.
          const started = await hc(["run", "--bg", "--json", "--no-parent", "--rm", "--name", EDITOR, "--", shell, "-lic", 'exec "$0"', `${home()}/.local/bin/herdr-files-editor`]);
          if (started.code !== 0) return notify({ title: "Could not start nvim", body: started.stderr.trim(), level: "error" });
          term = JSON.parse(started.stdout);
        }
        const open = (await readTextFile(`${editorState()}/editing`).catch(() => null))?.trim();
        if (open) {
          if (open !== path) notify({ title: `nvim still has ${basename(open)} open`, body: "Quit it (:q) to edit another file here.", timeout: 4000 });
        } else {
          this.closedSeen = await readTextFile(`${editorState()}/closed`).catch(() => null);
          const sent = await hc(["send", term.address, `${folder}\t${path}`]);
          if (sent.code !== 0) return notify({ title: "Could not open the file in nvim", body: sent.stderr.trim(), level: "error" });
        }
        this.showEditor(term.address);
      } catch (e) {
        notify({ title: "Could not start nvim", body: String(e?.message ?? e), level: "error" });
      }
    });
  }

  // The block shows the terminal only once the stack has switched, so the keyboard is handed over
  // again on the next tick of watchEditor (a timer of the view: one on a finished task never fires).
  // pane.focus finds the layout's block by the terminal name it shows, not by address.
  showEditor(address) {
    this.editing = address;
    this.focusEditor = EDITOR;
    herdrRun("layout.select", { stack: this.panel, child: `${this.panel}-edit` });
    herdrRun("pane.focus", { terminal: EDITOR });
  }

  // Hands the keyboard to nvim once its block shows; brings the preview back if the editor terminal died.
  watchEditor(cx) {
    if (this.focusEditor) {
      herdrRun("pane.focus", { terminal: this.focusEditor });
      this.focusEditor = null;
    }
    if (this.editing && !terminals().some((x) => x.address === this.editing && x.state === "live")) this.editorDone(cx);
  }

  // nvim quit (:q): the preview comes back, reloaded, with the keyboard.
  editorDone(cx) {
    this.editing = null;
    herdrRun("layout.select", { stack: this.panel, child: `${this.panel}-preview` });
    this.handle.focus();
    this.load(cx, true);
  }

  key(e, cx) {
    const k = e.keystroke, ch = e.key_char ?? e.key;
    // Zoom takes plain keys: Herdr keeps Cmd+=, Cmd+- and Cmd+0 for the window's own zoom.
    const zoomKey = this.v?.kind === "image" && !e.modifiers.platform && !e.modifiers.control && !e.modifiers.alt;
    if (k === "cmd-shift-c") this.copyPath();
    else if (k === "cmd-shift-r") this.reveal();
    else if (k === "cmd-o") this.openDefault();
    else if (k === "cmd-e") this.edit(cx);
    else if (k === "cmd-r") this.load(cx, true);
    else if (k === "cmd-[") this.back(cx);
    else if (k === "cmd-shift-f") this.toggleZen();
    else if ((k === "left" || k === "right") && this.nav()) this.step(k === "left" ? -1 : 1, cx);
    else if (zoomKey && (ch === "+" || ch === "=")) this.zoomStep(1, cx);
    else if (zoomKey && (ch === "-" || ch === "_")) this.zoomStep(-1, cx);
    else if (zoomKey && ch === "0") this.setZoom(1, cx);
    else if (zoomKey && ch === "f") this.setZoom("fit", cx);
    else if (zoomKey && ch === "w") this.setZoom("width", cx);
    else if (k === "escape" && this.panel) this.toTree();
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

  // Where this file sits among the previewable files beside it, with arrows to the ones around it.
  navPill(t, n) {
    const arrow = (id, icon, target, tip, delta) => div().id(id).size(20).flex_none().flex().items_center().justify_center().rounded(5)
      .when(Boolean(target), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(`${tip}: ${target}`).on_click((_e, cx) => this.step(delta, cx)))
      .child(svg(icon).size(12).text_color(target ? t.muted : t.border));
    return h_flex().flex_none().items_center().gap(1).p(1).rounded(6).bg(t.surface)
      .child(arrow("pv-prev", "mods/workspace-chrome/chevron-left.svg", n.prev, "Previous file (\u2190)", -1))
      .when(n.index >= 0, (el) => el.child(div().px(3).text_size(11).text_color(t.dim).child(`${n.index + 1} / ${n.count}`)))
      .child(arrow("pv-next", "mods/workspace-chrome/chevron-right.svg", n.next, "Next file (\u2192)", 1));
  }

  header(t) {
    const v = this.v, path = this.path, nav = this.nav();
    const toggle = v && (v.kind === "markdown" || (v.kind === "html" && !v.converted));
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
        .when(Boolean(this.panel), (el) => el.child(h_flex().id("pv-files").h(24).px(6).gap(4).flex_none().items_center().rounded(6).cursor_pointer()
          .text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Back to the file tree (Esc)")
          .on_click(() => this.toTree()).child(svg("mods/workspace-chrome/chevron-left.svg").size(13)).child("Files")))
        .when(this.history.length > 0, (el) => el.child(this.button(t, "pv-back", "mods/workspace-chrome/chevron-left.svg", "Back (Cmd+[)", (cx) => this.back(cx))))
        .child(fileIcon(basename(path), { dir: v?.kind === "folder", open: true, size: 15, color: v?.kind === "folder" ? t.ansi4 : t.muted }))
        .child(div().min_w(0).truncate().font_semibold().text_color(t.foreground).child(basename(path)))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(this.on ? dirOf(path) : tilde(dirOf(path))))
        .child(h_flex().flex_none().gap(1)
          .when(this.canEdit() && !this.zen, (el) => el.child(this.button(t, "pv-edit", "mods/workspace-chrome/square-pen.svg", "Edit in Neovim (Cmd+E)", (cx) => this.edit(cx))))
          .child(this.button(t, "pv-copy", "mods/workspace-chrome/files.svg", "Copy path (Cmd+Shift+C)", () => this.copyPath()))
          .when(!this.on, (el) => el.child(this.button(t, "pv-reveal", "mods/workspace-chrome/folder.svg", "Reveal in Finder (Cmd+Shift+R)", () => this.reveal())))
          .when(!this.on || Boolean(v?.local), (el) => el.child(this.button(t, "pv-open", "mods/workspace-chrome/monitor.svg",
            this.on ? "Open a copy with the default app (Cmd+O)" : "Open with the default app (Cmd+O)", () => this.openDefault())))
          .child(div().id("pv-reload").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().text_size(15).text_color(t.muted)
            .hover((st) => st.bg(t.hover)).tooltip("Reload (Cmd+R)").on_click((_e, cx) => this.load(cx, true)).child("\u21bb"))
          .child(div().id("pv-zen").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
            .font_family(monoFont()).text_size(15).text_color(this.zen ? t.foreground : t.muted).hover((st) => st.bg(t.hover))
            .tooltip(this.zen ? "Close focus mode (Esc)" : "Focus mode (Cmd+Shift+F)").on_click(() => this.toggleZen())
            .child(this.zen ? ICON_SHRINK : ICON_EXPAND))))
      .child(h_flex().gap(8).items_center()
        .when(Boolean(this.on), (el) => el.child(div().flex_none().text_size(11).text_color(REMOTE).child(this.on)))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(meta.join("  \u00b7  ") || "\u00a0"))
        // On this line, not the first, so a narrow pane (the Files panel) still has room for the name.
        .when(Boolean(toggle), (el) => el.child(h_flex().flex_none().gap(2).p(2).rounded(7).bg(t.surface)
          .child(this.segment(t, "pv-rendered", "Rendered", this.mode === "rendered", (cx) => this.setMode("rendered", cx)))
          .child(this.segment(t, "pv-source", "Source", this.mode === "source", (cx) => this.setMode("source", cx)))))
        .when(Boolean(nav), (el) => el.child(this.navPill(t, nav))));
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
      this.code = codeState(spec.lang, spec.text, this.zen ? 14 : 12, true, spec.wrap);
      this.codeKey = sig;
      this.codeText = spec.text;
    } else if (this.codeText !== spec.text) {
      this.code.set_value(spec.text);
      this.codeText = spec.text;
    }
  }

  // The parts of rendered Markdown that need more than TextView, built here as EditorState can't be
  // made while drawing; null when the file has no fence (one TextView draws it all).
  syncBlocks() {
    const v = this.v, t = theme();
    const sig = v?.kind === "markdown" ? `${this.path}|${hash(v.text)}|${t.background}|${this.zen}` : null;
    if (sig === this.blocksKey) return;
    for (const b of this.blocks ?? []) b.state?.release();
    this.blocks = null;
    this.blocksKey = sig;
    if (!sig) return;
    const segs = splitMarkdown(v.text);
    if (!segs.some((s) => s.type !== "md")) return;
    this.blocks = segs.map((s) => s.type !== "code" ? s
      : { ...s, lines: Math.max(1, s.text.split("\n").length), state: codeState(s.lang, s.text, this.zen ? 14 : 12.5, false) });
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
      .child(v_flex().w_full().max_w(this.zen ? 760 : 800).h_full().min_h(0).px(this.zen ? 40 : 28).py(this.zen ? 24 : 14).child(el));
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
          : this.blocks ? this.markdownBlocks(t, v)
          : this.prose(t, TextView.markdown(`md:${v.path}`, fixMarkdown(v.text, dir)).selectable().scrollable().size_full().text_size(this.zen ? 16 : 14).on_link_click((url, cx) => this.link(url, cx)));
        return v_flex().flex_1().min_h(0).when(Boolean(note), (el) => el.child(this.banner(t, note))).child(inner);
      }
      case "html": {
        const note = v.truncated ? `Showing the first ${fmtCount(v.shown)} lines of the file` : null;
        const inner = this.mode === "source" && !v.converted
          ? this.editor(t)
          : v.pages?.length ? this.htmlPage(t, v)
          : this.prose(t, TextView.html(`html:${v.path}`, v.converted ? v.text : fixHtml(v.text, dir)).selectable().scrollable().size_full().text_size(this.zen ? 16 : 14).on_link_click((url, cx) => this.link(url, cx)));
        return v_flex().flex_1().min_h(0).when(Boolean(note), (el) => el.child(this.banner(t, note))).child(inner);
      }
      case "image":
        return v_flex().flex_1().min_h(0).when(Boolean(v.note), (el) => el.child(this.banner(t, v.note))).child(this.picture(t, v));
      case "pages":
        return this.pages(t, v);
    }
    return null;
  }

  // Rendered Markdown in parts (syncBlocks): one scrolling column of the prose, each fence in a code
  // view sized to its lines, each Mermaid fence as its picture, never wider than the column.
  markdownBlocks(t, v) {
    const zen = this.zen, px = zen ? 40 : 28, col = Math.min(zen ? 760 : 800, this.size?.width ?? 800) - 2 * px;
    const lh = Math.round((zen ? 14 : 12.5) * 1.5);
    return v_flex().id("pv-md").flex_1().min_h(0).overflow_y_scrollbar()
      .child(h_flex().w_full().flex_none().justify_center()
        .child(v_flex().w_full().max_w(zen ? 760 : 800).px(px).py(zen ? 24 : 14).gap(12).text_color(t.foreground)
          .children(this.blocks.map((b, i) => {
            if (b.type === "md") {
              // Front matter only opens the file: a later part starting with --- is a rule.
              const text = i === 0 ? fixMarkdown(b.text, v.dir) : fixMarkdown(`\n${b.text}`, v.dir).slice(1);
              return TextView.markdown(`md:${v.path}:${i}`, text).selectable().w_full().text_size(zen ? 16 : 14).on_link_click((url, cx) => this.link(url, cx));
            }
            if (b.type === "code") {
              return div().id(`pv-code-${i}`).w_full().flex_none().h(b.lines * lh + 20).px(12).py(10).rounded(7).bg(t.surface).border_1().border_color(t.border)
                .child(Editor.new(b.state).size_full());
            }
            const d = v.diagrams?.[b.text];
            if (d?.src) {
              const f = this.fit(d.dims, col, 1e9);
              return h_flex().id(`pv-mm-${i}`).w_full().flex_none().justify_center().child(div().rounded(7).overflow_hidden().child(image(d.src).w(f.w).h(f.h)));
            }
            return v_flex().id(`pv-mm-${i}`).w_full().flex_none().gap(4)
              .child(TextView.markdown(`mm:${v.path}:${i}`, "```\n" + b.text + "\n```").w_full())
              .child(div().text_size(11).text_color(t.dim).child(`Mermaid couldn't draw this: ${d?.error ?? "not drawn"}`));
          }))));
  }

  // A page herdr-render drew: its tiles stacked as one picture at the pane's width, never enlarged.
  htmlPage(t, v) {
    const maxW = this.size ? this.size.width - 32 : 800;
    return v_flex().id("pv-page").flex_1().min_h(0).overflow_y_scrollbar().items_center().py(16)
      .child(v_flex().flex_none().rounded(6).overflow_hidden().border_1().border_color(t.border)
        .children(v.pages.map((p, i) => {
          const f = this.fit(p.dims, maxW, 1e9);
          return div().id(`pv-tile-${i}`).flex_none().child(image(p.src).w(f.w).h(f.h));
        })));
  }

  fit(dims, maxW, maxH) {
    if (!dims) return null;
    const s = Math.min(1, maxW / dims.w, maxH / dims.h);
    return { w: Math.max(1, Math.floor(dims.w * s)), h: Math.max(1, Math.floor(dims.h * s)) };
  }

  // The image at its zoom in a viewport of its own: placed by this.focus (see place), panned by the
  // scroll wheel, so a zoom keeps the middle of the view where it was. GPUI's scroll areas can't be
  // moved from code. The viewport measures itself, so Fit leaves the header and the zoom bar clear.
  picture(t, v) {
    const a = this.area, z = a ? this.scale(v) : null, d = v.dims ?? { w: 600, h: 400 };
    const w = z ? Math.max(1, Math.round(d.w * z.s)) : 0, h = z ? Math.max(1, Math.round(d.h * z.s)) : 0;
    const x = z && place(w, a.width, this.focus.x, IMAGE_PAD, IMAGE_PAD);
    const y = z && place(h, a.height, this.focus.y, IMAGE_PAD, IMAGE_PAD + ZOOM_BAR);
    return div().id("pv-image").relative().flex_1().min_h(0).overflow_hidden()
      .on_size_change((s, cx) => {
        if (this.area && Math.abs(this.area.width - s.width) < 1 && Math.abs(this.area.height - s.height) < 1) return;
        this.area = s;
        cx.notify();
      })
      .on_scroll_wheel((e, cx) => {
        if (!z) return;
        const fx = place(w, a.width, this.focus.x - e.delta.x / w, IMAGE_PAD, IMAGE_PAD).f;
        const fy = place(h, a.height, this.focus.y - e.delta.y / h, IMAGE_PAD, IMAGE_PAD + ZOOM_BAR).f;
        if (fx === this.focus.x && fy === this.focus.y) return;
        this.focus = { x: fx, y: fy };
        cx.notify();
      })
      .when(Boolean(z), (el) => el
        .child(div().absolute().left(x.pos).top(y.pos).w(w).h(h).rounded(6).overflow_hidden().child(image(v.src).w(w).h(h)))
        .child(this.zoomBar(t, z)));
  }

  zoomBar(t, z) {
    const zoom = this.zoom, auto = zoom === null;
    const button = (id, label, tip, on, act) => div().id(id).h(24).min_w(26).px(7).flex_none().flex().items_center().justify_center()
      .rounded(6).cursor_pointer().text_size(12).text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.selected))
      .hover((s) => s.bg(on ? t.selected : t.hover)).tooltip(tip).on_click((_e, cx) => act(cx)).child(label);
    return h_flex().absolute().left(0).right(0).bottom(12).justify_center()
      .child(h_flex().id("pv-zoom").flex_none().items_center().gap(2).p(3).rounded(9).bg(t.surface).border_1().border_color(t.border).shadow_lg()
        .child(button("pv-zoom-out", "\u2212", "Zoom out (-)", false, (cx) => this.zoomStep(-1, cx)))
        .child(button("pv-zoom-actual", `${Math.round(z.s * 100)}%`, "Actual size (0)", zoom === 1 || (auto && z.fit > 1), (cx) => this.setZoom(1, cx)).min_w(52))
        .child(button("pv-zoom-in", "+", "Zoom in (+)", false, (cx) => this.zoomStep(1, cx)))
        .child(div().w(1).h(14).mx(3).bg(t.border))
        .child(button("pv-zoom-fit", "Fit", "Zoom to fit: the whole image (F)", zoom === "fit" || (auto && z.fit <= 1), (cx) => this.setZoom("fit", cx)))
        .child(button("pv-zoom-width", "Width", "Zoom to page width: fill the pane's width (W)", zoom === "width", (cx) => this.setZoom("width", cx))));
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
          .child(fileIcon(e.name, { dir: e.dir, color: e.dir ? t.ansi4 : t.muted }))
          .child(div().flex_1().min_w(0).truncate().child(e.name));
      }))
      .when(v.entries.length === 0, (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child("This folder is empty")))
      .when(v.more, (el) => el.child(div().p(8).text_size(11).text_color(t.dim).child(`Showing the first ${MAX_ENTRIES} entries`)));
  }

  render(cx) {
    const t = theme();
    const o = this.panel ? shared("files.open") : null;
    // A file Files just opened. load() runs on this view's context: a task started from a spawned one
    // is dropped when that one ends, and the preview would stay on "Loading".
    if (o && o.at !== this.opened?.at) {
      this.opened = o;
      this.history = [];
      this.path = expand(o.file);
      this.on = o.on ?? null;
      this.v = null;
      this.loading = true;
      this.load(cx, true);
    }
    const body = this.body(t);
    return v_flex().id("preview").track_focus(this.handle).size_full().min_h(0).overflow_hidden().rounded(this.zen ? 10 : 8)
      .bg(this.zen ? solid(t.background) : t.background).text_color(t.foreground).text_size(13)
      .when(this.zen, (el) => el.border_1().border_color(t.accent + "99").shadow_2xl())
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
