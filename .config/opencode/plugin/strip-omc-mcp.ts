import type { Plugin } from "@opencode-ai/plugin"

const OMC_MCP_PREFIX = "oh-my-claudecode:"

export const StripOmcMcpPlugin: Plugin = async () => ({
  config: async (config) => {
    if (!config.mcp) return

    for (const name of Object.keys(config.mcp)) {
      if (name.startsWith(OMC_MCP_PREFIX)) {
        delete config.mcp[name]
      }
    }
  },
})
