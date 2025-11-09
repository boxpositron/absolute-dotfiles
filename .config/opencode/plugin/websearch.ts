import { type Plugin, tool } from "@opencode-ai/plugin";

export const PerplexitySearch: Plugin = async (ctx) => {
    return {
        tool: {
            search: tool({
                description:
                    "Run a quick search query to search the internet for results using Perplexity AI. Use this for quick lookups, latest information, and documentation.",
                args: {
                    query: tool.schema.string().describe("Search query to execute"),
                },
                execute: async (args) => {
                    const url = "https://api.perplexity.ai/chat/completions";
                    const response = await fetch(url, {
                        method: "POST",
                        headers: {
                            Authorization: "Bearer " + process.env.PERPLEXITY_API_KEY,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            model: "sonar",
                            messages: [
                                {
                                    role: "user",
                                    content: args.query,
                                },
                            ],
                        }),
                    });
                    const data = await response.json();
                    return JSON.stringify({
                        answer: data.choices?.[0]?.message?.content,
                        citations: data.citations || [],
                        sources: data.search_results || [],
                    });
                },
            }),

            deepResearch: tool({
                description:
                    "Conduct an in-depth research using Perplexity's deep research model. Use this for exhaustive research, detailed analysis, comprehensive reports, or complex multi-source synthesis.",
                args: {
                    query: tool.schema.string().describe("Research query or topic for exhaustive analysis"),
                },
                execute: async (args) => {
                    const url = "https://api.perplexity.ai/chat/completions";
                    const response = await fetch(url, {
                        method: "POST",
                        headers: {
                            Authorization: "Bearer " + process.env.PERPLEXITY_API_KEY,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            model: "sonar-deep-research",
                            messages: [
                                {
                                    role: "user",
                                    content: args.query,
                                },
                            ],
                        }),
                    });
                    const data = await response.json();
                    return JSON.stringify({
                        report: data.choices?.[0]?.message?.content,
                        citations: data.citations || [],
                        sources: data.search_results || [],
                    });
                },
            }),
        },
    };
};
