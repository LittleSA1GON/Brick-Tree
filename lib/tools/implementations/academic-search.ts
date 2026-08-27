import { z } from "zod";
import type { AgentTool } from "@/lib/tools/base";
import type { RawSearchResult } from "@/lib/schemas/resources";
import { getEnv } from "@/lib/config/env";

const InputSchema = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().min(1).max(8).default(6),
});

function doiUrl(doi?: string): string | undefined {
  if (!doi) return undefined;
  return `https://doi.org/${doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")}`;
}

async function searchCrossref(query: string, limit: number, signal?: AbortSignal): Promise<RawSearchResult[]> {
  const env = getEnv();
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query", query);
  url.searchParams.set("rows", String(limit));
  url.searchParams.set("select", "DOI,title,URL,author,publisher,published-print,published-online,type,is-referenced-by-count");
  if (env.APP_CONTACT_EMAIL) url.searchParams.set("mailto", env.APP_CONTACT_EMAIL);

  const response = await fetch(url, {
    headers: { "User-Agent": `BrickTree/0.8${env.APP_CONTACT_EMAIL ? ` (mailto:${env.APP_CONTACT_EMAIL})` : ""}` },
    signal,
  });
  if (!response.ok) throw new Error(`Crossref search failed with ${response.status}.`);
  const payload = (await response.json()) as {
    message?: { items?: Array<{
      DOI?: string;
      title?: string[];
      URL?: string;
      author?: Array<{ given?: string; family?: string }>;
      publisher?: string;
      "is-referenced-by-count"?: number;
    }> };
  };

  return (payload.message?.items ?? [])
    .filter((item) => item.title?.[0] && (item.DOI || item.URL))
    .map((item) => ({
      title: item.title![0],
      url: doiUrl(item.DOI) || item.URL!,
      source: item.publisher || "Scholarly publication",
      snippet: item.author?.slice(0, 4).map((author) => [author.given, author.family].filter(Boolean).join(" ")).join(", "),
      type: "paper" as const,
      provider: "Crossref",
      citationCount: item["is-referenced-by-count"],
      credibilitySignals: ["scholarly-index", ...(item.DOI ? ["DOI"] : [])],
    }));
}

async function searchOpenAlex(query: string, limit: number, signal?: AbortSignal): Promise<RawSearchResult[]> {
  const env = getEnv();
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(limit));
  url.searchParams.set("select", "id,doi,title,publication_date,cited_by_count,primary_location,authorships");
  if (env.OPENALEX_API_KEY) url.searchParams.set("api_key", env.OPENALEX_API_KEY);
  if (env.APP_CONTACT_EMAIL) url.searchParams.set("mailto", env.APP_CONTACT_EMAIL);

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`OpenAlex search failed with ${response.status}.`);
  const payload = (await response.json()) as {
    results?: Array<{
      id?: string;
      doi?: string;
      title?: string;
      publication_date?: string;
      cited_by_count?: number;
      primary_location?: { landing_page_url?: string; source?: { display_name?: string } };
      authorships?: Array<{ author?: { display_name?: string } }>;
    }>;
  };

  return (payload.results ?? [])
    .filter((item) => item.title && (item.doi || item.primary_location?.landing_page_url || item.id))
    .map((item) => ({
      title: item.title!,
      url: doiUrl(item.doi) || item.primary_location?.landing_page_url || item.id!,
      source: item.primary_location?.source?.display_name || "Scholarly publication",
      snippet: item.authorships?.slice(0, 4).map((authorship) => authorship.author?.display_name).filter(Boolean).join(", "),
      type: "paper" as const,
      provider: "OpenAlex",
      citationCount: item.cited_by_count,
      publishedAt: item.publication_date,
      credibilitySignals: ["scholarly-index", ...(item.doi ? ["DOI"] : [])],
    }));
}

async function searchSemanticScholar(query: string, limit: number, signal?: AbortSignal): Promise<RawSearchResult[]> {
  const apiKey = getEnv().SEMANTIC_SCHOLAR_API_KEY;
  if (!apiKey) return [];

  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query.replace(/-/g, " "));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("fields", "title,url,abstract,authors,venue,year,citationCount,externalIds");

  const response = await fetch(url, {
    headers: { "x-api-key": apiKey },
    signal,
  });
  if (!response.ok) throw new Error(`Semantic Scholar search failed with ${response.status}.`);
  const payload = (await response.json()) as {
    data?: Array<{
      title?: string;
      url?: string;
      abstract?: string;
      authors?: Array<{ name?: string }>;
      venue?: string;
      year?: number;
      citationCount?: number;
      externalIds?: { DOI?: string };
    }>;
  };

  return (payload.data ?? [])
    .filter((item) => item.title && (item.externalIds?.DOI || item.url))
    .map((item) => ({
      title: item.title!,
      url: doiUrl(item.externalIds?.DOI) || item.url!,
      source: item.venue || "Scholarly publication",
      snippet: item.abstract || item.authors?.slice(0, 4).map((author) => author.name).filter(Boolean).join(", "),
      type: "paper" as const,
      provider: "Semantic Scholar",
      citationCount: item.citationCount,
      publishedAt: item.year ? String(item.year) : undefined,
      credibilitySignals: ["scholarly-index", ...(item.externalIds?.DOI ? ["DOI"] : [])],
    }));
}

function academicKey(result: RawSearchResult): string {
  try {
    const url = new URL(result.url);
    if (url.hostname === "doi.org") return url.pathname.replace(/^\//, "").toLowerCase();
  } catch { /* use title fallback */ }
  return result.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function queryHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

function cleanAcademicResults(results: RawSearchResult[], limit: number): RawSearchResult[] {
  const seen = new Set<string>();
  return results
    .filter((item) => {
      const key = academicKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))
    .slice(0, limit);
}

export const academicSearchTool: AgentTool<z.infer<typeof InputSchema>, RawSearchResult[]> = {
  name: "search_academic_resources",
  inputSchema: InputSchema,
  async execute(input, context) {
    const env = getEnv();
    const providers: Array<{ name: string; run: () => Promise<RawSearchResult[]> }> = [
      { name: "Crossref", run: () => searchCrossref(input.query, input.limit, context.signal) },
      { name: "OpenAlex", run: () => searchOpenAlex(input.query, input.limit, context.signal) },
    ];
    if (env.SEMANTIC_SCHOLAR_API_KEY) {
      providers.push({ name: "Semantic Scholar", run: () => searchSemanticScholar(input.query, input.limit, context.signal) });
    }

    // Academic lookup is already an exceptional path. Use one index normally and
    // rotate primaries by query; touch another index only when the first one fails
    // or cannot produce enough usable literature.
    const offset = queryHash(input.query) % providers.length;
    const ordered = [...providers.slice(offset), ...providers.slice(0, offset)];
    const combined: RawSearchResult[] = [];
    const errors: string[] = [];
    const enough = Math.min(3, input.limit);

    for (const provider of ordered) {
      try {
        combined.push(...await provider.run());
        const cleaned = cleanAcademicResults(combined, input.limit);
        if (cleaned.length >= enough) return cleaned;
      } catch (error) {
        errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const cleaned = cleanAcademicResults(combined, input.limit);
    if (!cleaned.length && errors.length) throw new Error(`Academic searches failed: ${errors.join(" | ")}`);
    return cleaned;
  },
};
