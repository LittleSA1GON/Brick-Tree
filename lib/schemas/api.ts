import { z } from "zod";
import { ConceptNodeSchema, GraphContextSchema } from "./concept";
import { ExtractedDocumentSchema } from "./documents";
import { LearnerProfileSchema } from "./learning-path";
import { ResourceNodeContextSchema } from "./resources";
import { LearningTraversalSchema } from "./session";

export const ExplanationLevelSchema = z.enum([
  "simple",
  "beginner",
  "intermediate",
  "advanced",
  "expert",
]);
export type ExplanationLevel = z.infer<typeof ExplanationLevelSchema>;

export const ExplanationNodeContextSchema = ConceptNodeSchema.pick({
  id: true,
  title: true,
  shortDescription: true,
  whyItMatters: true,
  difficultyExplanation: true,
  difficultyFactors: true,
});
export type ExplanationNodeContext = z.infer<typeof ExplanationNodeContextSchema>;

export const AdaptiveExplanationSchema = z.object({
  explanation: z.string().min(1).max(4000),
  sourceSummary: z.string().max(2400).optional(),
  example: z.string().min(1).max(1800),
  keyTakeaway: z.string().min(1).max(700),
  level: ExplanationLevelSchema.optional(),
  evidence: z.array(z.object({
    documentId: z.string(),
    sectionId: z.string(),
    page: z.number().int().positive().optional(),
    heading: z.string().optional(),
  })).max(8).default([]),
});
export type AdaptiveExplanation = z.infer<typeof AdaptiveExplanationSchema>;

const NavigateRequestSchema = z
  .object({
    action: z.literal("navigate"),
    traversal: LearningTraversalSchema,
    topic: z.string().trim().min(2).max(300).optional(),
    node: ConceptNodeSchema.optional(),
    knownConcepts: z.array(z.string().trim().min(1).max(160)).max(60).optional(),
    rawKnowledgeInput: z.string().trim().max(12_000).optional(),
    goal: z.string().trim().max(700).optional(),
    learnerProfile: LearnerProfileSchema.optional(),
    graphContext: GraphContextSchema.optional(),
    documents: z.array(ExtractedDocumentSchema).max(6).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.traversal.mode === "tree" && !value.topic && !value.node) {
      ctx.addIssue({ code: "custom", message: "Tree navigation requires a topic or selected node.", path: ["topic"] });
    }
    if (value.traversal.mode === "brick" && !value.node && !(value.rawKnowledgeInput?.trim() || value.knownConcepts?.length || value.learnerProfile?.existingKnowledge.length)) {
      ctx.addIssue({ code: "custom", message: "Brick navigation requires a foundation statement, existing knowledge, or a selected node.", path: ["rawKnowledgeInput"] });
    }
    if (value.traversal.mode === "brick" && value.traversal.intent === "destination" && !(value.goal || value.learnerProfile?.goal || value.learnerProfile?.learningGoal)) {
      ctx.addIssue({ code: "custom", message: "Destination mode requires a learning goal.", path: ["goal"] });
    }
    if (value.node && !value.graphContext) {
      ctx.addIssue({ code: "custom", message: "Expanding a selected node requires graph context.", path: ["graphContext"] });
    }
  });

const ResourcesRequestSchema = z.object({
  action: z.literal("resources"),
  nodes: z.array(ResourceNodeContextSchema).min(1).max(20),
  learnerProfile: LearnerProfileSchema.optional(),
});

const ExplainRequestSchema = z.object({
  action: z.literal("explain"),
  node: ExplanationNodeContextSchema,
  level: ExplanationLevelSchema,
  learnerProfile: LearnerProfileSchema.optional(),
  documents: z.array(ExtractedDocumentSchema).max(6).optional(),
});

export const AgentRequestSchema = z.discriminatedUnion("action", [
  NavigateRequestSchema,
  ResourcesRequestSchema,
  ExplainRequestSchema,
]);
