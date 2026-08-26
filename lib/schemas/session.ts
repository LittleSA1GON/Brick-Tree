import { z } from "zod";

export const KnowledgeLevelSchema = z.enum([
  "novice",
  "beginner",
  "intermediate",
  "advanced",
  "expert",
]);

export const LanguageStyleSchema = z.enum([
  "simple",
  "conversational",
  "standard",
  "academic",
  "technical",
]);

export const DepthPreferenceSchema = z.enum(["overview", "balanced", "deep"]);

export const LearningPurposeSchema = z.enum([
  "general-learning",
  "class",
  "exam",
  "research",
  "professional",
  "project",
]);

export const SourceModeSchema = z.enum(["general", "prefer-uploaded", "uploaded-only"]);
export type SourceMode = z.infer<typeof SourceModeSchema>;


export const LearningTraversalSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("tree"),
    intent: z.enum(["decompose", "trace-prerequisites", "analyze-question"]),
  }),
  z.object({
    mode: z.literal("brick"),
    intent: z.enum(["explore", "destination"]),
  }),
]);
export type LearningTraversal = z.infer<typeof LearningTraversalSchema>;
export type TreeIntent = Extract<LearningTraversal, { mode: "tree" }>["intent"];
export type BrickIntent = Extract<LearningTraversal, { mode: "brick" }>["intent"];
