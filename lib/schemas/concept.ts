import { z } from "zod";

export const GraphAxisSchema = z.enum(["depth", "height"]);
export type GraphAxis = z.infer<typeof GraphAxisSchema>;

export const DifficultyScoreSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export type DifficultyScore = z.infer<typeof DifficultyScoreSchema>;

export const DifficultyLabelSchema = z.enum([
  "Foundational",
  "Beginner",
  "Intermediate",
  "Advanced",
  "Expert",
]);
export type DifficultyLabel = z.infer<typeof DifficultyLabelSchema>;

/**
 * A graph level describes the approximate *difficulty of understanding* shared by
 * nodes occupying one visual depth/height. It is intentionally not a taxonomy
 * such as "topic -> principle -> technique".
 */
export const GraphLevelDescriptorSchema = z.object({
  axis: GraphAxisSchema,
  index: z.number().int().min(0).max(20),
  difficulty: DifficultyScoreSchema,
  minDifficulty: DifficultyScoreSchema,
  maxDifficulty: DifficultyScoreSchema,
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(420),
  peerRule: z.string().min(1).max(420),
});
export type GraphLevelDescriptor = z.infer<typeof GraphLevelDescriptorSchema>;

export const ResourceTypeSchema = z.enum([
  "article",
  "video",
  "course",
  "documentation",
  "reference",
  "paper",
]);

export const ResourceLinkSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  source: z.string().min(1),
  type: ResourceTypeSchema,
  description: z.string().optional(),
  verified: z.boolean(),
});
export type ResourceLink = z.infer<typeof ResourceLinkSchema>;

export const EvidenceReferenceSchema = z.object({
  documentId: z.string().min(1),
  sectionId: z.string().min(1),
  page: z.number().int().positive().optional(),
  heading: z.string().max(240).optional(),
  quote: z.string().max(800).optional(),
});
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const KnowledgeOriginSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("model-knowledge") }),
  z.object({
    type: z.literal("uploaded-source"),
    documentId: z.string().min(1),
    evidence: z.array(EvidenceReferenceSchema).min(1).max(12),
  }),
  z.object({
    type: z.literal("external-resource"),
    url: z.string().url(),
  }),
]);
export type KnowledgeOrigin = z.infer<typeof KnowledgeOriginSchema>;

export const ConceptStatusSchema = z.enum([
  "generated",
  "validated",
  "needs-review",
]);

export const KnowledgeStatusSchema = z.enum([
  "known",
  "available",
  "recommended",
  "future",
  "missing-prerequisite",
]);

export const ConceptNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(300),
  normalizedTitle: z.string().min(1).max(340),
  shortDescription: z.string().min(1).max(420),
  detailedExplanation: z.string().max(5000).optional(),
  parentId: z.string().optional(),
  childIds: z.array(z.string()),
  depth: z.number().int().min(0).max(20),
  level: GraphLevelDescriptorSchema,
  difficulty: DifficultyScoreSchema,
  difficultyLabel: DifficultyLabelSchema,
  difficultyExplanation: z.string().min(1).max(1000),
  difficultyFactors: z.array(z.string().min(1).max(160)).max(8),
  prerequisites: z.array(z.string()).max(12),
  learningOutcomes: z.array(z.string()).max(12),
  applications: z.array(z.string()).max(12),
  examples: z.array(z.string()).max(10),
  whyItMatters: z.string().max(1200).optional(),
  whatItUnlocks: z.array(z.string()).max(12).optional(),
  estimatedLearningTime: z.string().max(120).optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: ConceptStatusSchema,
  knowledgeStatus: KnowledgeStatusSchema,
  resources: z.array(ResourceLinkSchema),
  origins: z.array(KnowledgeOriginSchema).max(8),
});
export type ConceptNode = z.infer<typeof ConceptNodeSchema>;

export const RelationshipTypeSchema = z.enum([
  "contains",
  "prerequisite",
  "builds-on",
  "leads-to",
  "related",
  "examines",
]);

export const ConceptEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  relationshipType: RelationshipTypeSchema,
  label: z.string().max(120).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type ConceptEdge = z.infer<typeof ConceptEdgeSchema>;

export const DifficultyAssessmentSchema = z.object({
  difficulty: DifficultyScoreSchema,
  difficultyLabel: DifficultyLabelSchema,
  difficultyExplanation: z.string().min(1).max(1000),
  difficultyFactors: z.array(z.string().min(1).max(160)).max(8),
});
export type DifficultyAssessment = z.infer<typeof DifficultyAssessmentSchema>;

export const ConceptChildProposalSchema = z.object({
  title: z.string().min(1).max(180),
  description: z.string().min(1).max(420),
  whyItMatters: z.string().min(1).max(900),
  difficulty: DifficultyScoreSchema,
  difficultyLabel: DifficultyLabelSchema,
  difficultyExplanation: z.string().min(1).max(1000),
  difficultyFactors: z.array(z.string().min(1).max(160)).max(8),
  prerequisites: z.array(z.string()).max(10),
  learningOutcomes: z.array(z.string()).max(10),
  applications: z.array(z.string()).max(10),
  examples: z.array(z.string()).max(6),
  whatItUnlocks: z.array(z.string()).max(10),
  estimatedLearningTime: z.string().max(120).optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceReferenceSchema).max(8).default([]),
});

export const ConceptDecompositionSchema = z.object({
  parentConcept: z.string().min(1).max(300),
  summary: z.string().min(1).max(900),
  parentAssessment: DifficultyAssessmentSchema,
  children: z.array(ConceptChildProposalSchema).min(3).max(6),
  confidence: z.number().min(0).max(1),
});
export type ConceptDecomposition = z.infer<typeof ConceptDecompositionSchema>;

export const GraphContextSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      normalizedTitle: z.string(),
      parentId: z.string().optional(),
      depth: z.number().int().min(0),
      difficulty: DifficultyScoreSchema,
      knowledgeStatus: KnowledgeStatusSchema,
      level: GraphLevelDescriptorSchema,
    }),
  ).max(250),
  levels: z.array(GraphLevelDescriptorSchema).max(20),
  focusedNodeId: z.string().optional(),
});
export type GraphContext = z.infer<typeof GraphContextSchema>;
