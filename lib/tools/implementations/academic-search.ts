import { z } from "zod";
import type { AgentTool } from "@/lib/tools/base";
import type { RawSearchResult } from "@/lib/schemas/resources";
import { getEnv } from "@/lib/config/env";

const InputSchema = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().min(1).max(6).default(4),
});

type CrossrefItem = {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string }>;
  "container-title"?: string[];
  published?: { "date-parts"?: number[][] };
  type?: string;
};

const SCHOLARLY_TYPES = new Set([
  "journal-article",
  "proceedings-article",
  "book-chapter",
  "posted-content",
  "report",
]);

function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || undefined;
}

export const academicSearchTool: AgentTool<z.infer<typeof InputSchema>, RawSearchResult[]> = {
  name: "search_academic_resources",
  inputSchema: InputSchema,
  async execute(input, context) {
    const env = getEnv();
    const url = new URL("https://api.crossref.org/works");
    url.searchParams.set("query.bibliographic", input.query);
    url.searchParams.set("rows", String(input.limit));
    url.searchParams.set(
      "select",
      "DOI,title,author,container-title,published,type",
    );
    if (env.APP_CONTACT_EMAIL) {
      url.searchParams.set("mailto", env.APP_CONTACT_EMAIL);
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": `BrickTree/0.8 educational-resource-search${env.APP_CONTACT_EMAIL ? ` (mailto:${env.APP_CONTACT_EMAIL})` : ""}`,
      },
      signal: context.signal,
    });

    if (!response.ok) {
      throw new Error(`Crossref search failed with ${response.status}.`);
    }

    const payload = (await response.json()) as {
      message?: { items?: CrossrefItem[] };
    };

    return (payload.message?.items ?? [])
      .filter((item) => Boolean(
        item.DOI &&
        item.title?.[0] &&
        (!item.type || SCHOLARLY_TYPES.has(item.type))
      ))
      .map((item) => {
        const authors = item.author
          ?.slice(0, 3)
          .map((author) => [author.given, author.family].filter(Boolean).join(" "))
          .filter(Boolean)
          .join(", ");
        const venue = cleanText(item["container-title"]?.[0]);
        const year = item.published?.["date-parts"]?.[0]?.[0];
        const description = [authors, venue, year ? String(year) : undefined]
          .filter(Boolean)
          .join(" · ");

        return {
          title: cleanText(item.title?.[0]) || item.title![0],
          // Prefer the DOI resolver over arbitrary publisher landing-page URLs.
          url: `https://doi.org/${encodeURI(item.DOI!)}`,
          source: venue ? `Crossref · ${venue}` : "Crossref",
          snippet: description || undefined,
          type: "paper" as const,
        };
      });
  },
};
