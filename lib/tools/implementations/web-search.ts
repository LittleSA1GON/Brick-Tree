import { z } from "zod";
import type { AgentTool } from "@/lib/tools/base";
import type { RawSearchResult } from "@/lib/schemas/resources";
import { getEnv } from "@/lib/config/env";

const InputSchema = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().min(1).max(8).default(6),
});

function hostname(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return "Web source"; }
}

function resultType(url: string, title = "", snippet = ""): RawSearchResult["type"] {
  const text = `${url} ${title} ${snippet}`.toLowerCase();
  if (/youtube\.com|youtu\.be|vimeo\.com|\bvideo\b|\blecture\b/.test(text)) return "video";
  if (/\/docs?\/|documentation|api reference|reference manual|developer/.test(text)) return "documentation";
  if (/course|curriculum|lesson|tutorial|learn\b|training/.test(text)) return "course";
  if (/handbook|reference|encyclopedia|guidebook/.test(text)) return "reference";
  return "article";
}

function credibilitySignals(url: string): string[] {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const signals: string[] = [];
    if (parsed.protocol === "https:") signals.push("HTTPS");
    if (/\.(edu|gov|ac\.[a-z]{2})$/.test(host)) signals.push("institutional-domain");
    if (/\.gov\.[a-z]{2}$/.test(host)) signals.push("government-domain");
    return signals;
  } catch {
    return [];
  }
}

function safeResult(result: RawSearchResult): boolean {
  try {
    const url = new URL(result.url);
    return url.protocol === "https:"
      && !/wikipedia\.org|wikimedia\.org/i.test(url.hostname);
  } catch {
    return false;
  }
}

async function searchTavily(query: string, limit: number, signal?: AbortSignal): Promise<RawSearchResult[]> {
  const apiKey = getEnv().TAVILY_API_KEY;
  if (!apiKey) return [];

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: limit,
      search_depth: "basic",
      include_answer: false,
    }),
    signal,
  });
  if (!response.ok) throw new Error(`Tavily search failed with ${response.status}.`);
  const payload = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
  };

  return (payload.results ?? [])
    .filter((item): item is { title: string; url: string; content?: string; score?: number } => Boolean(item.title && item.url))
    .map((item) => ({
      title: item.title,
      url: item.url,
      source: hostname(item.url),
      snippet: item.content,
      type: resultType(item.url, item.title, item.content),
      provider: "Tavily",
      searchScore: typeof item.score === "number" ? Math.max(0, Math.min(1, item.score)) : undefined,
      credibilitySignals: credibilitySignals(item.url),
    }));
}

async function searchBrave(query: string, limit: number, signal?: AbortSignal): Promise<RawSearchResult[]> {
  const apiKey = getEnv().BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(20, limit)));
  url.searchParams.set("search_lang", "en");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal,
  });
  if (!response.ok) throw new Error(`Brave Search failed with ${response.status}.`);
  const payload = (await response.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> };
  };

  return (payload.web?.results ?? [])
    .filter((item): item is { title: string; url: string; description?: string; age?: string } => Boolean(item.title && item.url))
    .map((item) => ({
      title: item.title,
      url: item.url,
      source: hostname(item.url),
      snippet: item.description,
      type: resultType(item.url, item.title, item.description),
      provider: "Brave Search",
      publishedAt: item.age,
      credibilitySignals: credibilitySignals(item.url),
    }));
}

export const webSearchTool: AgentTool<z.infer<typeof InputSchema>, RawSearchResult[]> = {
  name: "search_web",
  inputSchema: InputSchema,
  async execute(input, context) {
    const env = getEnv();
    const configured = [Boolean(env.TAVILY_API_KEY), Boolean(env.BRAVE_SEARCH_API_KEY)].filter(Boolean).length;
    if (!configured) return [];

    const settled = await Promise.allSettled([
      searchTavily(input.query, input.limit, context.signal),
      searchBrave(input.query, input.limit, context.signal),
    ]);

    const results = settled.flatMap((item) => item.status === "fulfilled" ? item.value : []);
    if (!results.length && settled.some((item) => item.status === "rejected")) {
      const messages = settled
        .filter((item): item is PromiseRejectedResult => item.status === "rejected")
        .map((item) => item.reason instanceof Error ? item.reason.message : String(item.reason));
      throw new Error(`Configured web searches failed: ${messages.join(" | ")}`);
    }

    const seen = new Set<string>();
    return results
      .filter(safeResult)
      .filter((item) => {
        const key = item.url.replace(/\/$/, "").toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (b.searchScore ?? 0.5) - (a.searchScore ?? 0.5))
      .slice(0, input.limit * 2);
  },
};
