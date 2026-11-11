# Shared agent preferences

These preferences apply across coding assistants. Host-specific orchestration belongs in each tool's own configuration.

## Commits and attribution

Never add `Co-Authored-By: Claude` or any Claude attribution to git commit messages, pull request descriptions, or generated documentation. This applies across all projects and all commit, PR, and documentation workflows.

## Identity values

Never use the email address, name, or other identity details associated with the assistant session (for example, an injected `userEmail`, git `user.name` or `user.email`, or an account identity surfaced by the environment) as a value inside any project. This covers code, config, environment files, seed and test data, credentials, account creation, and documentation. Never assume or infer these values. When a real email, name, or identity value is required, ask the user for it.

## Writing style

Do not use em dashes or en dashes in prose written for the user, including emails, messages, documents, drafts, and chat replies. Use commas, periods, colons, or parentheses instead. This applies across all projects.

## File paths and links

Every file path or link you show must open as written: the user clicks paths and links in terminal sessions to open them (Option+click in Herdr, Ctrl+click elsewhere), and follows links in rendered Markdown. This covers chat replies, code spans, and links in documents you write.

- In chat replies, write paths as absolute paths (a leading `~/` is fine) or relative to the session's working directory. Never write them relative to another folder, such as a repository root the session is not running in.
- In Markdown files, write links relative to the file's own folder, or as absolute paths.
- In chat replies, link a local file as `[label](path)` or show the bare path. Do not use image syntax (`![alt](path)`) there: the terminal shows only the alt text, so the path is lost.
- In chat replies, put a bare file or folder path in backticks (`~/Desktop/Screenshot 2026-11-11 at 16.29.10.png`), so a click anywhere on it opens the whole path, spaces and all.

## Test runs

Agents share the machine with the user's apps and with other agents, and test runners start one worker per CPU core by default. Cap test workers at 3: `jest --maxWorkers=3`, `vitest --maxWorkers=3`, and `pytest -n 3` with pytest-xdist instead of `-n auto`. Keep a project's own limit when it is lower.

## Client work

Some work is done for clients and is tracked. In omo, the `omo-work` hook names the client in each prompt's context when a session works in a client's code, and the user may also say that work is for a client. Before changing anything for that work, read `~/.config/omo-work/rules.md` and follow it: it says how the work is scoped, billed and tracked, and it stays out of this shared file. A question or a read-only look needs none of this. If that file is missing, say so and ask the user how to proceed.
