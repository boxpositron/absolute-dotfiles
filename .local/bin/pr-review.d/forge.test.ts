import { describe, expect, test } from "bun:test";
import { detect, normalizePr, parseRemote } from "./forge.ts";

describe("parseRemote", () => {
  test.each([
    ["git@github.com:octo/app.git", { host: "github.com", owner: "octo", name: "app" }],
    ["ssh://git@git.example.org:2222/team/tool.git", { host: "git.example.org", owner: "team", name: "tool" }],
    ["https://github.com/octo/app", { host: "github.com", owner: "octo", name: "app" }],
    ["https://Git.Example.org/gitea/team/tool.git/", { host: "git.example.org", owner: "team", name: "tool" }],
  ])("%s", (url, want) => expect(parseRemote(url)).toEqual(want));

  test("rejects what isn't a repo address", () => {
    expect(parseRemote("not a url")).toBeNull();
    expect(parseRemote("https://github.com/only")).toBeNull();
  });
});

describe("detect", () => {
  const tea = [{ url: "https://git.example.org", token: "tea-token", ssh_host: "ssh.example.org" }];
  const noGh = async () => null;

  test("a tea login's host or SSH host makes it Gitea", async () => {
    const byUrl = await detect({ host: "git.example.org", owner: "t", name: "r" }, tea, noGh);
    expect(byUrl).toMatchObject({ forge: "gitea", api: "https://git.example.org/api/v1", web: "https://git.example.org/t/r", token: "tea-token" });
    expect(await detect({ host: "ssh.example.org", owner: "t", name: "r" }, tea, noGh)).toMatchObject({ forge: "gitea" });
  });

  test("tea wins over gh for the same host", async () => {
    expect(await detect({ host: "git.example.org", owner: "t", name: "r" }, tea, async () => "gh-token")).toMatchObject({ forge: "gitea" });
  });

  test("a gh token makes it GitHub, with the Enterprise API path off github.com", async () => {
    const gh = async (host: string) => (host === "github.com" || host === "ghe.example.org" ? "gh-token" : null);
    expect(await detect({ host: "github.com", owner: "o", name: "r" }, [], gh)).toMatchObject({ forge: "github", api: "https://api.github.com", token: "gh-token" });
    expect(await detect({ host: "ghe.example.org", owner: "o", name: "r" }, [], gh)).toMatchObject({ api: "https://ghe.example.org/api/v3" });
  });

  test("no login names the command that fixes it", async () => {
    expect(await detect({ host: "github.com", owner: "o", name: "r" }, [], noGh)).toEqual({ problem: "no GitHub login: run gh auth login" });
    expect(await detect({ host: "other.example.org", owner: "o", name: "r" }, [], noGh)).toHaveProperty("problem");
  });
});

describe("normalizePr", () => {
  const raw = { number: 7, title: "WIP: thing", user: { login: "ann" }, head: { ref: "feat", sha: "abc" }, base: { ref: "main", sha: "def" }, html_url: "u", updated_at: "t", body: null };

  test("a closed PR with a merge time is merged", () => {
    expect(normalizePr("github", { ...raw, state: "closed", merged_at: "2026-11-01T00:00:00Z" }).state).toBe("merged");
    expect(normalizePr("github", { ...raw, state: "closed", merged_at: null }).state).toBe("closed");
    expect(normalizePr("gitea", { ...raw, state: "closed", merged: true }).state).toBe("merged");
  });

  test("Gitea's WIP prefix counts as a draft", () => {
    expect(normalizePr("gitea", { ...raw, state: "open" }).draft).toBe(true);
    expect(normalizePr("github", { ...raw, state: "open" }).draft).toBe(false);
  });
});
