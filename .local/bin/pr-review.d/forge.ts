// Which forge a repo lives on, the login that reaches it, and the few API calls pr-review makes.
// GitHub logins come from `gh` (its token per host), Gitea logins from tea's config: no hostnames
// are written here.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Forge = "github" | "gitea";
export type PrState = "open" | "merged" | "closed";

export interface Remote { host: string; owner: string; name: string }
export interface PublicRepo extends Remote { forge: Forge; web: string }
export interface Repo extends PublicRepo { api: string; token: string }
export interface TeaLogin { url: string; token: string; ssh_host?: string }

export interface Pr {
  number: number;
  title: string;
  author: string;
  head: string;
  base: string;
  sha: string;
  base_sha: string | null;
  merge_base: string | null;
  draft: boolean;
  url: string;
  updated_at: string;
  state: PrState;
  body: string;
}

export class ForgeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// git@host:owner/name.git, ssh://git@host:2222/owner/name.git or https://host/owner/name(.git).
// A Gitea served under a path keeps owner and name as the last two parts.
export function parseRemote(url: string): Remote | null {
  const u = url.trim();
  let host: string, path: string;
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/\/)(.+)$/.exec(u);
  if (!u.includes("://") && scp) {
    host = scp[1];
    path = scp[2];
  } else {
    let parsed: URL;
    try { parsed = new URL(u); } catch { return null; }
    if (!parsed.hostname) return null;
    host = parsed.hostname;
    path = parsed.pathname;
  }
  const parts = path.replace(/\.git\/?$/, "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { host: host.toLowerCase(), owner: parts[parts.length - 2], name: parts[parts.length - 1] };
}

const hostOf = (url: string) => {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
};

export const publicRepo = (r: PublicRepo): PublicRepo => ({ forge: r.forge, host: r.host, owner: r.owner, name: r.name, web: r.web });

// A tea login whose address or SSH host is the remote's host makes it Gitea; else a gh token for the
// host makes it GitHub.
export async function detect(
  remote: Remote,
  tea: TeaLogin[],
  ghToken: (host: string) => Promise<string | null>,
): Promise<Repo | { problem: string }> {
  const login = tea.find((l) => hostOf(l.url) === remote.host || (l.ssh_host ?? "").toLowerCase() === remote.host);
  if (login) {
    const base = login.url.replace(/\/+$/, "");
    return { ...remote, forge: "gitea", web: `${base}/${remote.owner}/${remote.name}`, api: `${base}/api/v1`, token: login.token };
  }
  const token = await ghToken(remote.host);
  if (token) {
    const api = remote.host === "github.com" ? "https://api.github.com" : `https://${remote.host}/api/v3`;
    return { ...remote, forge: "github", web: `https://${remote.host}/${remote.owner}/${remote.name}`, api, token };
  }
  if (remote.host === "github.com") return { problem: "no GitHub login: run gh auth login" };
  return { problem: `no login for ${remote.host}: tea login add (Gitea) or gh auth login --hostname ${remote.host} (GitHub)` };
}

export function teaLogins(): TeaLogin[] {
  const dir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  const file = join(dir, "tea", "config.yml");
  if (!existsSync(file)) return [];
  const config = Bun.YAML.parse(readFileSync(file, "utf8")) as { logins?: TeaLogin[] } | null;
  return (config?.logins ?? []).filter((l) => l?.url && l?.token);
}

const ghTokens = new Map<string, string | null>();
export async function ghToken(host: string): Promise<string | null> {
  if (host === "github.com" && process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (ghTokens.has(host)) return ghTokens.get(host) ?? null;
  if (!Bun.which("gh")) return null;
  const proc = Bun.spawn(["gh", "auth", "token", "--hostname", host], { env: process.env, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const token = code === 0 && out.trim() ? out.trim() : null;
  ghTokens.set(host, token);
  return token;
}

export async function api(repo: Repo, method: string, path: string, body?: unknown): Promise<any> {
  const headers: Record<string, string> = repo.forge === "github"
    ? { Authorization: `Bearer ${repo.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
    : { Authorization: `token ${repo.token}`, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(repo.api + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = [j.message, ...(Array.isArray(j.errors) ? j.errors.map((e: any) => (typeof e === "string" ? e : e.message ?? JSON.stringify(e))) : [])]
        .filter(Boolean).join("; ") || detail;
    } catch {}
    throw new ForgeError(`${repo.forge === "github" ? "GitHub" : "Gitea"} ${res.status}: ${detail}`, res.status);
  }
  return text ? JSON.parse(text) : null;
}

const repoPath = (r: Remote) => `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;

export function normalizePr(forge: Forge, raw: any): Pr {
  const merged = Boolean(raw.merged_at) || raw.merged === true;
  const title = String(raw.title ?? "");
  return {
    number: raw.number,
    title,
    author: raw.user?.login ?? "",
    head: raw.head?.ref ?? "",
    base: raw.base?.ref ?? "",
    sha: raw.head?.sha ?? "",
    base_sha: raw.base?.sha ?? null,
    merge_base: raw.merge_base ?? null,
    // Older Gitea has no draft flag, only the WIP title prefix.
    draft: Boolean(raw.draft) || (forge === "gitea" && /^\s*(\[wip\]|wip:)/i.test(title)),
    url: raw.html_url ?? "",
    updated_at: raw.updated_at ?? "",
    state: raw.state === "open" ? "open" : merged ? "merged" : "closed",
    body: String(raw.body ?? ""),
  };
}

// Newest first.
export async function listPrs(repo: Repo, state: "open" | "closed", limit: number): Promise<Pr[]> {
  const query = repo.forge === "github"
    ? `state=${state}&per_page=${limit}&sort=updated&direction=desc`
    : `state=${state}&limit=${limit}&sort=recentupdate`;
  const raw = await api(repo, "GET", `${repoPath(repo)}/pulls?${query}`);
  return (raw ?? []).map((p: any) => normalizePr(repo.forge, p));
}

export async function getPr(repo: Repo, number: number): Promise<Pr> {
  return normalizePr(repo.forge, await api(repo, "GET", `${repoPath(repo)}/pulls/${number}`));
}

export async function postReview(repo: Repo, number: number, payload: unknown): Promise<{ url: string | null }> {
  const res = await api(repo, "POST", `${repoPath(repo)}/pulls/${number}/reviews`, payload);
  return { url: res?.html_url ?? null };
}
