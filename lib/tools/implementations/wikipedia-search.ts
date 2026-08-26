import { z } from "zod";
import type { AgentTool } from "@/lib/tools/base";
import type { RawSearchResult } from "@/lib/schemas/resources";

const InputSchema = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().min(1).max(6).default(4),
});

export const wikipediaSearchTool: AgentTool<z.infer<typeof InputSchema>, RawSearchResult[]> = {
  name: "search_wikipedia",
  inputSchema: InputSchema,
  async execute(input, context) {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "search");
    url.searchParams.set("srsearch", input.query);
    url.searchParams.set("srlimit", String(input.limit));
    url.searchParams.set("format", "json");
    url.searchParams.set("utf8", "1");

    const response = await fetch(url, {
      headers: { "User-Agent": "BrickTree/0.1 educational knowledge navigator" },
      signal: context.signal,
    });
    if (!response.ok) throw new Error(`Wikipedia search failed with ${response.status}.`);
    const payload = (await response.json()) as {
      query?: { search?: Array<{ pageid: number; title: string; snippet?: string }> };
    };

    return (payload.query?.search ?? []).map((item) => ({
      title: item.title,
      url: `https://en.wikipedia.org/?curid=${item.pageid}`,
      source: "Wikipedia",
      snippet: item.snippet?.replace(/<[^>]+>/g, ""),
      type: "reference" as const,
    }));
  },
};
