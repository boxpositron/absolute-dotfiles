import { describe, expect, test } from "bun:test";
import { annotate, commentable, lineIndex, parseDiff, sameHunk, skipReason } from "./diff.ts";

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@
 import a from "a";
-const x = 1;
+const x = 2;
+const y = 3;
 export { a };
 export { x };
@@ -20,3 +21,3 @@ function f() {
   return 1;
-  // old
+  // new
 }
diff --git a/docs/new.md b/docs/new.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/docs/new.md
@@ -0,0 +1,2 @@
+# New
+text
diff --git a/old.txt b/old.txt
deleted file mode 100644
index 4444444..0000000
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-gone
-too
diff --git a/lib/a.js b/lib/b.js
similarity index 90%
rename from lib/a.js
rename to lib/b.js
index 5555555..6666666 100644
--- a/lib/a.js
+++ b/lib/b.js
@@ -1,1 +1,1 @@
-old
+new
diff --git a/logo.png b/logo.png
index 7777777..8888888 100644
Binary files a/logo.png and b/logo.png differ
`;

describe("parseDiff", () => {
  const files = parseDiff(DIFF);

  test("reads each file's path and status", () => {
    expect(files.map((f) => [f.path, f.status, f.binary])).toEqual([
      ["src/app.ts", "modified", false],
      ["docs/new.md", "added", false],
      ["old.txt", "deleted", false],
      ["lib/b.js", "renamed", false],
      ["logo.png", "modified", true],
    ]);
    expect(files[3].old_path).toBe("lib/a.js");
  });

  test("numbers lines on both sides from each hunk header", () => {
    const [first, second] = files[0].hunks;
    expect(first.lines.map((l) => [l.kind, l.old, l.new])).toEqual([
      [" ", 1, 1], ["-", 2, null], ["+", null, 2], ["+", null, 3], [" ", 3, 4], [" ", 4, 5],
    ]);
    expect(second.lines.map((l) => [l.kind, l.old, l.new])).toEqual([[" ", 20, 21], ["-", 21, null], ["+", null, 22], [" ", 22, 23]]);
  });

  test("a removed line that starts with dashes stays a removed line", () => {
    const [f] = parseDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,1 @@\n--- not a header\n keep\n");
    expect(f.hunks[0].lines.map((l) => [l.kind, l.text])).toEqual([["-", "-- not a header"], [" ", "keep"]]);
  });
});

describe("commentable lines", () => {
  const index = lineIndex(parseDiff(DIFF));

  test("added and context lines on the new side take comments, others don't", () => {
    expect(commentable(index, "src/app.ts", 2)).toBe(true);
    expect(commentable(index, "src/app.ts", 5)).toBe(true);
    expect(commentable(index, "src/app.ts", 10)).toBe(false);
    expect(commentable(index, "old.txt", 1)).toBe(false);
    expect(commentable(index, "nope.ts", 1)).toBe(false);
    expect(commentable(index, null, 1)).toBe(false);
  });

  test("a range must sit in one hunk", () => {
    expect(sameHunk(index, "src/app.ts", 1, 5)).toBe(true);
    expect(sameHunk(index, "src/app.ts", 5, 22)).toBe(false);
  });
});

describe("annotate", () => {
  const files = parseDiff(DIFF);

  test("prefixes new-side numbers, folds deletions and skips binaries", () => {
    const { text, skipped } = annotate(files);
    expect(text).toContain("     3 + const y = 3;\n");
    expect(text).toContain("       - const x = 1;\n");
    expect(text).toContain("=== lib/b.js (renamed from lib/a.js) ===");
    expect(text).toContain("(deleted, 2 lines)");
    expect(skipped).toEqual(["logo.png"]);
  });

  test("names the files past the cap instead of including them", () => {
    const { text, omitted } = annotate(files, 400);
    expect(omitted.length).toBeGreaterThan(0);
    for (const path of omitted) expect(text).not.toContain(`=== ${path} `);
  });
});

test("skipReason leaves out lockfiles, generated and minified files", () => {
  const f = (path: string, binary = false) => ({ path, old_path: null, status: "modified" as const, binary, hunks: [] });
  expect(skipReason(f("web/bun.lock"))).toBe("lockfile");
  expect(skipReason(f("dist/app.js"))).toBe("generated");
  expect(skipReason(f("vendor.min.js"))).toBe("minified");
  expect(skipReason(f("a.png", true))).toBe("binary");
  expect(skipReason(f("src/dist.ts"))).toBeNull();
});
