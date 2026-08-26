import { z } from "zod";
import { ConceptNodeSchema, GraphContextSchema } from "./concept";
import { ExtractedDocumentSchema } from "./documents";
import { LearnerProfileSchema } from "./learning-path";
import { LearningTraversalSchema } from "./session";

export const ExplanationLevelSchema = z.enum([
  "simple",
  "beginner",
  "intermediate",
  "advanced",
  "expert",
]);
export type ExplanationLevel = z.infer<typeof ExplanationLevelSchema>;

const NavigateRequestSchema = z
  .object({
    action: z.literal("navigate"),
    traversal: LearningTraversalSchema,
    topic: z.string().trim().min(2).max(300).optional(),
    node: ConceptNodeSchema.optional(),
    knownConcepts: z.array(z.string().trim().min(1)).max(60).optional(),
    goal: z.string().trim().max(700).optional(),
    learnerProfile: LearnerProfileSchema.optional(),
    graphContext: GraphContextSchema.optional(),
    documents: z.array(ExtractedDocumentSchema).max(6).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.traversal.mode === "tree" && !value.topic && !value.node) {
      ctx.addIssue({ code: "custom", message: "Tree navigation requires a topic or selected node.", path: ["topic"] });
    }
    if (value.traversal.mode === "brick" && !value.node && !(value.knownConcepts?.length || value.learnerProfile?.existingKnowledge.length)) {
      ctx.addIssue({ code: "custom", message: "Brick navigation requires existing knowledge or a selected node.", path: ["knownConcepts"] });
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
  node: ConceptNodeSchema,
  learnerProfile: LearnerProfileSchema.optional(),
  documents: z.array(ExtractedDocumentSchema).max(6).optional(),
});

const ExplainRequestSchema = z.object({
  action: z.literal("explain"),
  node: ConceptNodeSchema,
  level: ExplanationLevelSchema,
  learnerProfile: LearnerProfileSchema.optional(),
  documents: z.array(ExtractedDocumentSchema).max(6).optional(),
});

export const AgentRequestSchema = z.discriminatedUnion("action", [
  NavigateRequestSchema,
  ResourcesRequestSchema,
  ExplainRequestSchema,
]);
