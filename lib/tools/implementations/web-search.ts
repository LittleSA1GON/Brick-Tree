import { z } from "zod";
import type { AgentTool } from "@/lib/tools/base";
import type { RawSearchResult } from "@/lib/schemas/resources";
import { getEnv } from "@/lib/config/env";

const InputSchema = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().min(1).max(6).default(4),
});

export const webSearchTool: AgentTool<z.infer<typeof InputSchema>, RawSearchResult[]> = {
  name: "search_web",
  inputSchema: InputSchema,
  async execute(input, context) {
    const apiKey = getEnv().TAVILY_API_KEY;
    if (!apiKey) return [];
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: input.query,
        max_results: input.limit,
        search_depth: "basic",
        include_answer: false,
      }),
      signal: context.signal,
    });
    if (!response.ok) throw new Error(`Tavily search failed with ${response.status}.`);
    const payload = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (payload.results ?? [])
      .filter((item): item is { title: string; url: string; content?: string } => Boolean(item.title && item.url))
      .map((item) => ({
        title: item.title,
        url: item.url,
        source: "Tavily",
        snippet: item.content,
        type: "article" as const,
      }));
  },
};
