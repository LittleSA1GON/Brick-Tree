import { z } from "zod";

export const ResourceSourceSchema = z.enum(["academic", "web"]);

export const ResourceQueryPlanSchema = z.object({
  queries: z
    .array(
      z.object({
        query: z.string().min(1).max(300),
        source: ResourceSourceSchema,
        reason: z.string().min(1).max(300),
      }),
    )
    .min(0)
    .max(6),
});
export type ResourceQueryPlan = z.infer<typeof ResourceQueryPlanSchema>;

export const RawSearchResultSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  source: z.string(),
  snippet: z.string().optional(),
  type: z.enum(["article", "video", "course", "documentation", "reference", "paper"]),
  provider: z.string().optional(),
  searchScore: z.number().min(0).max(1).optional(),
  citationCount: z.number().int().min(0).optional(),
  publishedAt: z.string().optional(),
  credibilitySignals: z.array(z.string()).max(8).optional(),
});
export type RawSearchResult = z.infer<typeof RawSearchResultSchema>;

export const ResourceCandidateSchema = RawSearchResultSchema.extend({
  candidateId: z.string().min(1).max(80),
});
export type ResourceCandidate = z.infer<typeof ResourceCandidateSchema>;

export const ResourceSelectionSchema = z.object({
  selected: z
    .array(
      z.object({
        candidateId: z.string().min(1).max(80),
        reason: z.string().min(1).max(300),
      }),
    )
    .min(1)
    .max(5),
  summary: z.string().min(1).max(500),
});
export type ResourceSelection = z.infer<typeof ResourceSelectionSchema>;
