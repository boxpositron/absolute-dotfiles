import { describe, expect, test } from "bun:test";
import { plan } from "./post.ts";
import type { Finding, Review } from "./review.ts";

const finding = (over: Partial<Finding>): Finding => ({
  id: "f1", severity: "major", path: "src/a.ts", line: 10, start_line: null, commentable: true, by: "omo",
  title: "Off by one", body: "The loop skips the last item.", suggestion: null, ...over,
});
const review = { summary: "Adds paging.", pr: { sha: "abc123" } } as unknown as Review;

describe("GitHub", () => {
  test("an inline finding becomes a RIGHT-side comment, with its range and a suggestion fence", () => {
    const f = finding({ start_line: 8, suggestion: "for (i = 0; i <= n; i++)" });
    const p = plan("github", review, [f], true)!;
    expect(p.payload).toMatchObject({ commit_id: "abc123", event: "COMMENT", body: "Adds paging." });
    expect(p.payload.comments).toEqual([{
      path: "src/a.ts", line: 10, side: "RIGHT", start_line: 8, start_side: "RIGHT",
      body: "**Major \u00b7 Off by one**\n\nThe loop skips the last item.\n\n```suggestion\nfor (i = 0; i <= n; i++)\n```",
    }]);
    expect(p).toMatchObject({ inline: ["f1"], in_summary: [] });
  });

  test("a finding off the diff goes in the body with its place, and its suggestion as plain code", () => {
    const p = plan("github", review, [finding({ id: "f2", commentable: false, suggestion: "x" })], true)!;
    expect(p.payload.comments).toEqual([]);
    expect(p.payload.body).toBe("Adds paging.\n\n---\n\n**Major \u00b7 Off by one** (`src/a.ts:10`)\n\nThe loop skips the last item.\n\n```\nx\n```");
    expect(p.in_summary).toEqual(["f2"]);
  });

  test("only the first post carries the summary", () => {
    expect(plan("github", review, [finding({})], false)!.payload.body).toBe("");
  });

  test("everything can be moved into the body after an inline rejection", () => {
    const p = plan("github", review, [finding({})], false, true)!;
    expect(p).toMatchObject({ inline: [], in_summary: ["f1"] });
    expect(p.payload.body).toContain("`src/a.ts:10`");
  });

  test("nothing to say is no post", () => {
    expect(plan("github", review, [], false)).toBeNull();
  });
});

test("Gitea comments use new_position and plain code for suggestions", () => {
  const p = plan("gitea", review, [finding({ start_line: 8, suggestion: "y" })], true)!;
  expect(p.payload.comments).toEqual([{
    path: "src/a.ts", new_position: 10, old_position: 0,
    body: "**Major \u00b7 Off by one**\n\nThe loop skips the last item.\n\n```\ny\n```",
  }]);
});
