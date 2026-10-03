import type { Plugin } from "@opencode-ai/plugin"

import { isClaudeOnlyCommand } from "./lib/claude-only-command-registry.ts"

export const StripClaudeOnlyCommandsPlugin: Plugin = async () => ({
  config: async (config) => {
    if (!config.command) return

    for (const name of Object.keys(config.command)) {
      if (isClaudeOnlyCommand(name)) {
        delete config.command[name]
      }
    }
  },
})
