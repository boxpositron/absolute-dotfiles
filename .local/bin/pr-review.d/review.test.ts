import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineIndex, parseDiff } from "./diff.ts";
import { checkReview, extractJson, modeOf, place, readModes, setMode } from "./review.ts";

describe("extractJson", () => {
  test("reads a bare object, a fenced one and one wrapped in prose", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Here:\n```json\n{"a":2}\n```\n')).toEqual({ a: 2 });
    expect(extractJson('Sure. {"a":3} Done.')).toEqual({ a: 3 });
  });

  test("fails on an answer with no JSON", () => {
    expect(() => extractJson("no json here")).toThrow("not JSON");
  });
});

describe("checkReview", () => {
  const finding = { severity: "major", path: "./src/a.ts", line: 5, start_line: 3, title: " Bad ", body: "why", suggestion: null };

  test("normalises paths and ranges", () => {
    const r = checkReview({ summary: "s", verdict: "changes", findings: [finding, { ...finding, start_line: 9 }, { ...finding, path: null }] });
    expect(r.findings[0]).toEqual({ severity: "major", path: "src/a.ts", line: 5, start_line: 3, title: "Bad", body: "why", suggestion: null });
    expect(r.findings[1].start_line).toBeNull();
    expect(r.findings[2]).toMatchObject({ path: null, line: null });
  });

  test.each([
    [{ summary: "", verdict: "good", findings: [] }, "no summary"],
    [{ summary: "s", verdict: "approve", findings: [] }, "verdict"],
    [{ summary: "s", verdict: "good", findings: {} }, "findings must be a list"],
    [{ summary: "s", verdict: "good", findings: [{ ...finding, severity: "huge" }] }, "finding 1: severity"],
    [{ summary: "s", verdict: "good", findings: [{ ...finding, title: "" }] }, "finding 1 has no title"],
  ])("rejects %j", (raw, error) => expect(() => checkReview(raw)).toThrow(error));
});

test("place marks inline findings and keeps a start only in the same hunk", () => {
  const diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n one\n+two\n three\n@@ -10,1 +11,2 @@\n ten\n+eleven\n";
  const index = lineIndex(parseDiff(diff));
  const draft = { severity: "minor" as const, path: "a.ts", line: 3, start_line: 1, title: "t", body: "b", suggestion: null };
  expect(place(draft, "f1", "omo", index)).toMatchObject({ id: "f1", by: "omo", commentable: true, start_line: 1 });
  expect(place({ ...draft, line: 12, start_line: 2 }, "f2", "omo", index)).toMatchObject({ commentable: true, start_line: null });
  expect(place({ ...draft, line: 7, start_line: null }, "f3", "omo", index)).toMatchObject({ commentable: false });
});

describe("modes", () => {
  const home = mkdtempSync(join(tmpdir(), "pr-review-modes-"));
  process.env.PR_REVIEW_HOME = home;
  afterAll(() => {
    delete process.env.PR_REVIEW_HOME;
    rmSync(home, { recursive: true, force: true });
  });
  const repo = { host: "git.example.org", owner: "t", name: "r" };

  test("a PR's own mode wins over its repo's, which wins over semi", () => {
    expect(modeOf(readModes(), repo, 4)).toEqual({ repo: "semi", override: null, effective: "semi" });
    setMode(repo, null, "auto");
    setMode(repo, 4, "manual");
    expect(modeOf(readModes(), repo, 4)).toEqual({ repo: "auto", override: "manual", effective: "manual" });
    expect(modeOf(readModes(), repo, 5).effective).toBe("auto");
    setMode(repo, 4, "inherit");
    expect(modeOf(readModes(), repo, 4).effective).toBe("auto");
  });
});
