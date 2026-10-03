type PrefixRule = {
  readonly kind: "prefix"
  readonly prefix: string
  readonly reason: string
}

type ExactRule = {
  readonly kind: "exact"
  readonly name: string
  readonly reason: string
}

export type ClaudeOnlyCommandRule = PrefixRule | ExactRule

export const CLAUDE_ONLY_COMMAND_RULES: readonly ClaudeOnlyCommandRule[] = [
  {
    kind: "prefix",
    prefix: "oh-my-claudecode:",
    reason: "Operates the Oh My ClaudeCode runtime and workflows.",
  },
  {
    kind: "prefix",
    prefix: "claude-notifications-go:",
    reason: "Configures notification hooks, binaries, and files for Claude Code.",
  },
  {
    kind: "exact",
    name: "remember:doctor",
    reason: "Executes diagnostics through CLAUDE_PLUGIN_ROOT; remember:remember stays because it supports multiple agent hosts.",
  },
  {
    kind: "exact",
    name: "mcp-server-dev:build-mcpb",
    reason: "Produces Anthropic MCPB bundles with claude_desktop compatibility; the server and app builders stay because they target multiple MCP hosts.",
  },
] as const

function matchesRule(name: string, rule: ClaudeOnlyCommandRule): boolean {
  switch (rule.kind) {
    case "prefix":
      return name.startsWith(rule.prefix)
    case "exact":
      return name === rule.name
    default:
      return assertNever(rule)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled rule: ${JSON.stringify(value)}`)
}

export function isClaudeOnlyCommand(name: string): boolean {
  return CLAUDE_ONLY_COMMAND_RULES.some((rule) => matchesRule(name, rule))
}
