import { z } from "zod";
import type { AgentTool } from "@/lib/tools/base";
import type { RawSearchResult } from "@/lib/schemas/resources";
import { getEnv } from "@/lib/config/env";

const InputSchema = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().min(1).max(6).default(4),
});

export const academicSearchTool: AgentTool<z.infer<typeof InputSchema>, RawSearchResult[]> = {
  name: "search_academic_resources",
  inputSchema: InputSchema,
  async execute(input, context) {
    const env = getEnv();
    const url = new URL("https://api.crossref.org/works");
    url.searchParams.set("query", input.query);
    url.searchParams.set("rows", String(input.limit));
    url.searchParams.set("select", "DOI,title,URL,author,published-print,published-online,type");
    if (env.APP_CONTACT_EMAIL) url.searchParams.set("mailto", env.APP_CONTACT_EMAIL);

    const response = await fetch(url, {
      headers: { "User-Agent": `BrickTree/0.1${env.APP_CONTACT_EMAIL ? ` (mailto:${env.APP_CONTACT_EMAIL})` : ""}` },
      signal: context.signal,
    });
    if (!response.ok) throw new Error(`Crossref search failed with ${response.status}.`);
    const payload = (await response.json()) as {
      message?: {
        items?: Array<{
          DOI?: string;
          title?: string[];
          URL?: string;
          author?: Array<{ given?: string; family?: string }>;
        }>;
      };
    };

    return (payload.message?.items ?? [])
      .filter((item) => item.DOI && item.title?.[0])
      .map((item) => ({
        title: item.title![0],
        url: item.URL || `https://doi.org/${encodeURIComponent(item.DOI!)}`,
        source: "Crossref",
        snippet: item.author
          ?.slice(0, 3)
          .map((author) => [author.given, author.family].filter(Boolean).join(" "))
          .join(", "),
        type: "paper" as const,
      }));
  },
};
