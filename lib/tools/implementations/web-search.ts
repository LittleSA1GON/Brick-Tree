import { z } from "zod";
import type { AgentTool } from "@/lib/tools/base";
import type { RawSearchResult } from "@/lib/schemas/resources";
import { getEnv } from "@/lib/config/env";

const InputSchema = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().min(1).max(6).default(4),
  domains: z.array(z.string().min(1).max(120)).max(8).optional(),
});

function sourceLabel(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (host.endsWith("khanacademy.org")) return "Khan Academy";
    if (host.endsWith("openstax.org")) return "OpenStax";
    if (host.endsWith("mit.edu")) return "MIT";
    if (host.endsWith("stanford.edu")) return "Stanford University";
    if (host.endsWith("harvard.edu")) return "Harvard University";
    if (host.endsWith("developer.mozilla.org")) return "MDN Web Docs";
    if (host.endsWith("docs.python.org")) return "Python Documentation";
    if (host.endsWith("developers.google.com")) return "Google for Developers";
    if (host.endsWith("nih.gov")) return "NIH";
    if (host.endsWith("nasa.gov")) return "NASA";
    return host;
  } catch {
    return "Web source";
  }
}

function resultType(url: string): RawSearchResult["type"] {
  const host = url.toLowerCase();
  if (host.includes("docs.") || host.includes("developer.mozilla.org") || host.includes("developers.google.com")) return "documentation";
  if (host.includes(".edu") || host.includes("khanacademy.org") || host.includes("openstax.org")) return "course";
  return "article";
}

export const webSearchTool: AgentTool<z.infer<typeof InputSchema>, RawSearchResult[]> = {
  name: "search_web",
  inputSchema: InputSchema,
  async execute(input, context) {
    const apiKey = getEnv().TAVILY_API_KEY;
    if (!apiKey) return [];

    const body: Record<string, unknown> = {
      api_key: apiKey,
      query: input.query,
      max_results: input.limit,
      search_depth: "basic",
      include_answer: false,
    };
    if (input.domains?.length) body.include_domains = input.domains;

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: context.signal,
    });
    if (!response.ok) throw new Error(`Tavily search failed with ${response.status}.`);
    const payload = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (payload.results ?? [])
      .filter((item): item is { title: string; url: string; content?: string } => Boolean(item.title && item.url))
      .filter((item) => !/wikipedia\.org|wikimedia\.org/i.test(item.url))
      .map((item) => ({
        title: item.title,
        url: item.url,
        source: sourceLabel(item.url),
        snippet: item.content,
        type: resultType(item.url),
      }));
  },
};
