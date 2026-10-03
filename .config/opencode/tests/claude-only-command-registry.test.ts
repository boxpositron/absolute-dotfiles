import { describe, expect, test } from "bun:test"

import {
  CLAUDE_ONLY_COMMAND_RULES,
  isClaudeOnlyCommand,
} from "../plugin/lib/claude-only-command-registry"

describe("claude-only command registry", () => {
  test("matches every prefix rule with a representative command", () => {
    expect(isClaudeOnlyCommand("oh-my-claudecode:ultrawork")).toBe(true)
    expect(isClaudeOnlyCommand("claude-notifications-go:settings")).toBe(true)
  })

  test("matches every exact rule", () => {
    expect(isClaudeOnlyCommand("remember:doctor")).toBe(true)
    expect(isClaudeOnlyCommand("mcp-server-dev:build-mcpb")).toBe(true)
  })

  test("preserves cross-client commands and near misses", () => {
    expect(isClaudeOnlyCommand("remember:remember")).toBe(false)
    expect(isClaudeOnlyCommand("mcp-server-dev:build-mcp-server")).toBe(false)
    expect(isClaudeOnlyCommand("mcp-server-dev:build-mcp-app")).toBe(false)
    expect(isClaudeOnlyCommand("superpowers:brainstorming")).toBe(false)
    expect(isClaudeOnlyCommand("chrome-devtools-mcp:chrome-devtools")).toBe(false)
    expect(isClaudeOnlyCommand("oh-my-claudecode")).toBe(false)
    expect(isClaudeOnlyCommand("remember:doctor-notes")).toBe(false)
  })

  test("requires a non-empty reason for every rule", () => {
    expect(CLAUDE_ONLY_COMMAND_RULES.length).toBeGreaterThan(0)
    for (const rule of CLAUDE_ONLY_COMMAND_RULES) {
      expect(rule.reason.trim().length).toBeGreaterThan(0)
    }
  })
})
