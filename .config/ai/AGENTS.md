# Shared agent preferences

These preferences apply across coding assistants. Host-specific orchestration belongs in each tool's own configuration.

## Commits and attribution

Never add `Co-Authored-By: Claude` or any Claude attribution to git commit messages, pull request descriptions, or generated documentation. This applies across all projects and all commit, PR, and documentation workflows.

## Identity values

Never use the email address, name, or other identity details associated with the assistant session (for example, an injected `userEmail`, git `user.name` or `user.email`, or an account identity surfaced by the environment) as a value inside any project. This covers code, config, environment files, seed and test data, credentials, account creation, and documentation. Never assume or infer these values. When a real email, name, or identity value is required, ask the user for it.

## Writing style

Do not use em dashes or en dashes in prose written for the user, including emails, messages, documents, drafts, and chat replies. Use commas, periods, colons, or parentheses instead. This applies across all projects.
