import { z } from "zod";
import { DifficultyAssessmentSchema, DifficultyLabelSchema, DifficultyScoreSchema, EvidenceReferenceSchema } from "./concept";
import {
  DepthPreferenceSchema,
  KnowledgeLevelSchema,
  LanguageStyleSchema,
  LearningPurposeSchema,
  SourceModeSchema,
} from "./session";

export const ExploreBiasSchema = z.enum([
  "balanced",
  "practical",
  "academic",
  "creative",
  "career",
  "technical",
]);
export type ExploreBias = z.infer<typeof ExploreBiasSchema>;

export const LearnerProfileSchema = z.object({
  educationLevel: z.string().max(120).default("high-school"),
  exploreBias: ExploreBiasSchema.default("balanced"),
  existingKnowledge: z.array(z.string().min(1).max(160)).max(60).default([]),
  goal: z.string().max(700).optional(),
  learningGoal: z.string().max(700).optional(),
  desiredField: z.string().max(200).optional(),
  knowledgeLevel: KnowledgeLevelSchema.optional(),
  languageStyle: LanguageStyleSchema.optional(),
  depthPreference: DepthPreferenceSchema.optional(),
  purpose: LearningPurposeSchema.optional(),
  preferredDepth: z.enum(["simple", "beginner", "intermediate", "advanced", "expert"]).optional(),
  availableStudyTime: z.string().max(160).optional(),
  preferredExamples: z.array(z.string().min(1).max(120)).max(10).optional(),
  preferredResourceTypes: z.array(z.string()).max(10).optional(),
  courseContext: z.string().max(12000).optional(),
  sourceMode: SourceModeSchema.default("general"),
  sourceDocumentIds: z.array(z.string().min(1).max(160)).max(20).default([]),
});
export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;

/**
 * Brick layer generation follows the same compact-first rule as Tree. Core
 * adjacency/difficulty fields stay required; secondary arrays and heuristic scores
 * get safe defaults so a useful layer is not discarded because a model omitted
 * nonessential metadata near the end of a response.
 */
export const LearningDirectionProposalSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(360),
  whyReachable: z.string().min(1).max(600),
  difficulty: DifficultyScoreSchema,
  difficultyLabel: DifficultyLabelSchema,
  difficultyExplanation: z.string().min(1).max(500),
  difficultyFactors: z.array(z.string().min(1).max(120)).max(5).default([]),
  satisfiedPrerequisites: z.array(z.string().min(1).max(140)).max(6).default([]),
  missingPrerequisites: z.array(z.string().min(1).max(140)).max(6).default([]),
  unlocks: z.array(z.string().min(1).max(160)).max(5).default([]),
  applications: z.array(z.string().min(1).max(160)).max(5).default([]),
  estimatedLearningTime: z.string().max(120).optional(),
  readinessScore: z.number().min(0).max(100).default(60),
  goalAlignmentScore: z.number().min(0).max(100).default(50),
  prerequisiteGapScore: z.number().min(0).max(100).default(50),
  utilityScore: z.number().min(0).max(100).default(50),
  recommendationScore: z.number().min(0).max(100).default(50),
  confidence: z.number().min(0).max(1).default(0.75),
  evidence: z.array(EvidenceReferenceSchema).max(6).default([]),
});

export type LearningDirectionProposal = z.infer<typeof LearningDirectionProposalSchema>;

export const LearningPathProposalSchema = z.object({
  learnerSummary: z.string().min(1).max(700),
  inferredAssumptions: z.array(z.string().min(1).max(180)).max(6).default([]),
  foundationAssessment: DifficultyAssessmentSchema,
  foundationSuggestions: z.array(z.string().min(1).max(120)).max(4).default([]),
  directions: z.array(LearningDirectionProposalSchema).min(3).max(6),
  recommendedTitle: z.string().min(1).max(120),
  recommendationReason: z.string().min(1).max(700),
  estimatedDestinationHeight: z.number().int().min(1).max(12).optional(),
  destinationHeightReason: z.string().min(1).max(600).optional(),
  confidence: z.number().min(0).max(1).default(0.75),
});
export type LearningPathProposal = z.infer<typeof LearningPathProposalSchema>;
