import { z } from "zod";

export const ResourceSourceSchema = z.enum([
  "institution",
  "academic",
  "web",
]);

export const ResourceQueryPlanSchema = z.object({
  queries: z
    .array(
      z.object({
        query: z.string().min(1).max(300),
        source: ResourceSourceSchema,
        reason: z.string().min(1).max(300),
        domains: z.array(z.string().min(1).max(120)).max(8).optional(),
      }),
    )
    .min(1)
    .max(5),
});
export type ResourceQueryPlan = z.infer<typeof ResourceQueryPlanSchema>;

export const RawSearchResultSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  source: z.string(),
  snippet: z.string().optional(),
  type: z.enum(["article", "video", "course", "documentation", "reference", "paper"]),
});
export type RawSearchResult = z.infer<typeof RawSearchResultSchema>;
