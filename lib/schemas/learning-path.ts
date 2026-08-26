import { z } from "zod";
import { DifficultyAssessmentSchema, DifficultyLabelSchema, DifficultyScoreSchema, EvidenceReferenceSchema } from "./concept";
import {
  DepthPreferenceSchema,
  KnowledgeLevelSchema,
  LanguageStyleSchema,
  LearningPurposeSchema,
  SourceModeSchema,
} from "./session";

/** Shared learner/session steering state. */
export const LearnerProfileSchema = z.object({
  educationLevel: z.string().max(120).optional(),
  existingKnowledge: z.array(z.string().min(1).max(160)).max(60).default([]),
  goal: z.string().max(700).optional(),
  learningGoal: z.string().max(700).optional(),
  desiredField: z.string().max(200).optional(),
  knowledgeLevel: KnowledgeLevelSchema.optional(),
  languageStyle: LanguageStyleSchema.optional(),
  depthPreference: DepthPreferenceSchema.optional(),
  purpose: LearningPurposeSchema.optional(),
  preferredDepth: z
    .enum(["simple", "beginner", "intermediate", "advanced", "expert"])
    .optional(),
  availableStudyTime: z.string().max(160).optional(),
  preferredExamples: z.array(z.string().min(1).max(120)).max(10).optional(),
  preferredResourceTypes: z.array(z.string()).max(10).optional(),
  courseContext: z.string().max(12000).optional(),
  sourceMode: SourceModeSchema.default("general"),
  sourceDocumentIds: z.array(z.string().min(1).max(160)).max(20).default([]),
});
export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;

export const LearningDirectionProposalSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  whyReachable: z.string().min(1).max(900),
  satisfiedPrerequisites: z.array(z.string()).max(12),
  missingPrerequisites: z.array(z.string()).max(12),
  unlocks: z.array(z.string()).max(12),
  applications: z.array(z.string()).max(12),
  difficulty: DifficultyScoreSchema,
  difficultyLabel: DifficultyLabelSchema,
  difficultyExplanation: z.string().min(1).max(1000),
  difficultyFactors: z.array(z.string().min(1).max(160)).max(8),
  estimatedLearningTime: z.string().max(120).optional(),
  readinessScore: z.number().min(0).max(100),
  goalAlignmentScore: z.number().min(0).max(100),
  prerequisiteGapScore: z.number().min(0).max(100),
  utilityScore: z.number().min(0).max(100),
  recommendationScore: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceReferenceSchema).max(8).default([]),
});

export const LearningPathProposalSchema = z.object({
  learnerSummary: z.string().min(1).max(1200),
  inferredAssumptions: z.array(z.string()).max(10),
  foundationAssessment: DifficultyAssessmentSchema,
  directions: z.array(LearningDirectionProposalSchema).min(3).max(6),
  recommendedTitle: z.string().min(1).max(120),
  recommendationReason: z.string().min(1).max(1200),
  confidence: z.number().min(0).max(1),
});
export type LearningPathProposal = z.infer<typeof LearningPathProposalSchema>;
