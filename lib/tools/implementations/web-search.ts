import { z } from "zod";
import type { AgentTool } from "@/lib/tools/base";
import type { RawSearchResult } from "@/lib/schemas/resources";
import { getEnv } from "@/lib/config/env";

const InputSchema = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().min(1).max(6).default(4),
});

const TRUSTED_DOMAINS = [
  // Universities / education
  "mit.edu",
  "stanford.edu",
  "harvard.edu",
  "berkeley.edu",
  "cmu.edu",
  "caltech.edu",
  "princeton.edu",
  "yale.edu",
  "columbia.edu",
  "cornell.edu",
  "ox.ac.uk",
  "cam.ac.uk",
  "openstax.org",
  "khanacademy.org",

  // Government / research / standards institutions
  "nist.gov",
  "nasa.gov",
  "nih.gov",
  "ncbi.nlm.nih.gov",
  "cdc.gov",
  "energy.gov",
  "nsf.gov",
  "who.int",
  "oecd.org",
  "worldbank.org",
  "w3.org",
  "ietf.org",

  // Scholarly publishers / indexes
  "doi.org",
  "arxiv.org",
  "nature.com",
  "science.org",
  "acm.org",
  "ieee.org",
  "springer.com",
  "sciencedirect.com",
  "jstor.org",
  "plos.org",

  // Official technical documentation
  "developer.mozilla.org",
  "docs.python.org",
  "learn.microsoft.com",
  "docs.oracle.com",
  "react.dev",
  "nextjs.org",
  "typescriptlang.org",
  "pytorch.org",
  "tensorflow.org",
  "scikit-learn.org",
  "numpy.org",
];

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function isTrustedInstitutionalUrl(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;

  if (
    host.endsWith(".edu") ||
    host.endsWith(".gov") ||
    host.endsWith(".ac.uk") ||
    host.endsWith(".edu.au") ||
    host.endsWith(".ac.jp") ||
    host.endsWith(".ac.nz")
  ) {
    return true;
  }

  return TRUSTED_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

function sourceLabel(url: string): string {
  const host = hostnameOf(url);
  if (!host) return "Institutional source";
  return host;
}

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
        max_results: Math.min(input.limit * 2, 10),
        search_depth: "basic",
        include_answer: false,
        include_domains: TRUSTED_DOMAINS,
      }),
      signal: context.signal,
    });

    if (!response.ok) {
      throw new Error(`Tavily search failed with ${response.status}.`);
    }

    const payload = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    return (payload.results ?? [])
      .filter(
        (item): item is { title: string; url: string; content?: string } =>
          Boolean(item.title && item.url && isTrustedInstitutionalUrl(item.url)),
      )
      .slice(0, input.limit)
      .map((item) => ({
        title: item.title,
        url: item.url,
        source: sourceLabel(item.url),
        snippet: item.content,
        type: "documentation" as const,
      }));
  },
};
