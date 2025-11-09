---
description: Interactively setup OpenCode config and MCP servers for your project
agent: setup
subtask: true
---

You are helping the user set up OpenCode configuration for their project.

## Context

Current directory: !`pwd`
Existing config check: !`test -f opencode.json && echo "EXISTS" || echo "NONE"`
Existing config content: !`test -f opencode.json && cat opencode.json || echo "{}"`

## Your Task

Follow these steps **one question at a time**. Do not ask multiple questions in the same message.

### Step 1: Check Existing Config
- If `opencode.json` already exists, ask the user if they want to:
  - Modify the existing config (merge new MCPs)
  - Start fresh (overwrite)
  - Cancel

### Step 2: Identify Project Type
Ask: "What type of project is this?"
- Web (React, Vue, Astro, Next.js, Svelte, etc.)
- Backend (Node, Python, Go, Rust, etc.)
- Mobile (React Native, Flutter, etc.)
- Data/ML (Python, Jupyter, etc.)
- General/Other

Wait for their answer before proceeding.

### Step 3: Recommend MCP Servers

Based on their project type, recommend relevant MCP servers from these available options:

**Documentation & Search**:
- `grep` (remote): Search code examples on GitHub - https://mcp.grep.app
- `astro` (remote): Astro framework documentation - https://mcp.docs.astro.build/mcp

**Local Development Tools**:
- `shadcn` (local): Shadcn UI components (for React projects)
  - Command: `npx shadcn@latest mcp`
- `chrome-devtools` (local): Browser automation and testing
  - Command: `npx chrome-devtools-mcp@latest`

**Database (Backend projects)**:
- `sqlite` (local): SQLite database operations
- `postgres` (local/remote): PostgreSQL database access
- `mongodb` (local/remote): MongoDB operations
- `supabase` (remote): Supabase PostgreSQL + auth

**Version Control**:
- `github` (remote): GitHub repository management (warning: adds many tokens to context)
- `git` (local): Local git operations

**Productivity**:
- `notion` (remote): Notion workspace integration
- `obsidian` (local): Obsidian notes integration
- `slack` (remote): Slack messaging

Present the recommendations based on project type, then ask:
"Which MCP servers would you like to install? (You can select multiple, separated by commas, or 'all' for all recommended ones)"

### Step 4: Gather Configuration Details

For each selected MCP that requires configuration:
- **Database MCPs**: Ask for connection details or note that placeholders will be created
- **Other MCPs**: Ask for any required API keys or configuration options

### Step 5: Generate Configuration

Create the `opencode.json` file with:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "autoupdate": true,
  "share": "manual",
  "instructions": ["AGENTS.md"],
  "mcp": {
    // Add selected MCPs here with proper configuration
  }
}
```

**For remote MCPs**, use this format:
```json
"mcp-name": {
  "type": "remote",
  "url": "https://mcp-url.com",
  "enabled": true
}
```

**For local MCPs**, use this format:
```json
"mcp-name": {
  "type": "local",
  "command": ["npx", "package-name"],
  "enabled": true
}
```

**For MCPs requiring environment variables**, use:
```json
"headers": {
  "API_KEY_NAME": "{env:API_KEY_NAME}"
}
```
or
```json
"environment": {
  "ENV_VAR": "{env:ENV_VAR}"
}
```

### Step 6: Create .opencode Directory (Optional)

Ask: "Would you like to create a `.opencode/` directory for custom agents and commands? (y/n)"

If yes, create:
- `.opencode/agent/` (empty, ready for custom agents)
- `.opencode/command/` (empty, ready for custom commands)

### Step 7: Environment Variables

If any MCPs require environment variables, create a `.env.example` file with placeholders:
```
# OpenCode MCP Environment Variables
# Copy this to .env and fill in your actual values

# Add required environment variables below
```

Tell the user to:
1. Copy `.env.example` to `.env`
2. Fill in their actual values
3. Make sure `.env` is in their `.gitignore`

### Step 8: Summary

Show a summary of what was created:
- ✓ Created `opencode.json` with X MCP servers
- ✓ Created `.opencode/` directory structure (if applicable)
- ✓ Created `.env.example` with environment variable placeholders (if applicable)

List all configured MCPs with brief descriptions.

Remind them:
- Run `/init` to generate project-specific AGENTS.md
- Check `.env.example` and create `.env` with actual values (if applicable)
- Use MCP tools by mentioning them in prompts (e.g., "use grep to search code examples")
- Global MCPs (time, ast-grep) are available in all projects

## Important Notes

- Ask questions **one at a time**
- Explain what each MCP does when recommending it
- Use placeholders for sensitive values
- Don't generate AGENTS.md - leave that to the user or `/init` command
- Be helpful and educational
