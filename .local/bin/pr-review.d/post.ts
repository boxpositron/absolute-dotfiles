// The one review a Post sends: inline comments for the picked findings that sit on changed lines, and
// a body with the summary (first post only) and the picked findings that can't be inline comments.
// The event is always COMMENT: the tool never approves or requests changes.
import type { Forge } from "./forge.ts";
import type { Finding, Review } from "./review.ts";

export interface Plan { payload: Record<string, unknown>; inline: string[]; in_summary: string[] }

const capital = (s: string) => s[0].toUpperCase() + s.slice(1);
const label = (f: Finding) => `${capital(f.severity)} \u00b7 ${f.title}`;

function fence(code: string, info = "") {
  const ticks = code.includes("```") ? "````" : "```";
  return `${ticks}${info}\n${code.replace(/\n$/, "")}\n${ticks}`;
}

// GitHub offers to apply a `suggestion` fence, but only on an inline comment.
function suggestion(f: Finding, forge: Forge, inline: boolean) {
  if (!f.suggestion) return "";
  return forge === "github" && inline ? fence(f.suggestion, "suggestion") : fence(f.suggestion);
}

export const commentBody = (f: Finding, forge: Forge) =>
  [`**${label(f)}**`, f.body, suggestion(f, forge, true)].filter(Boolean).join("\n\n");

function bodySection(f: Finding, forge: Forge) {
  const where = f.path ? ` (\`${f.path}${f.line ? `:${f.line}` : ""}\`)` : "";
  return [`**${label(f)}**${where}`, f.body, suggestion(f, forge, false)].filter(Boolean).join("\n\n");
}

export function plan(forge: Forge, review: Review, picked: Finding[], first: boolean, everythingInBody = false): Plan | null {
  const inline = everythingInBody ? [] : picked.filter((f) => f.commentable && f.path && f.line);
  const rest = picked.filter((f) => !inline.includes(f));
  const body = [first ? review.summary : "", ...rest.map((f) => bodySection(f, forge))].filter(Boolean).join("\n\n---\n\n");
  if (!body && inline.length === 0) return null;
  const comments = inline.map((f) =>
    forge === "github"
      ? { path: f.path, line: f.line, side: "RIGHT", ...(f.start_line ? { start_line: f.start_line, start_side: "RIGHT" } : {}), body: commentBody(f, forge) }
      : { path: f.path, new_position: f.line, old_position: 0, body: commentBody(f, forge) });
  return {
    payload: { commit_id: review.pr.sha, event: "COMMENT", body, comments },
    inline: inline.map((f) => f.id),
    in_summary: rest.map((f) => f.id),
  };
}
