import { z } from "zod";
import {
  DifficultyAssessmentSchema,
  DifficultyLabelSchema,
  DifficultyScoreSchema,
  EvidenceReferenceSchema,
  LevelNarrativeSchema,
} from "./concept";
import {
  DepthPreferenceSchema,
  KnowledgeLevelSchema,
  LanguageStyleSchema,
  LearningPurposeSchema,
  SourceModeSchema,
} from "./session";

function textFromUnknown(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(textFromUnknown).filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
    return parts.join("; ");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["summary", "text", "description", "title", "value", "reason", "explanation", "name"]) {
      if (record[key] !== undefined) {
        const preferred = textFromUnknown(record[key]);
        if (typeof preferred === "string" && preferred.trim()) return preferred;
      }
    }
    const parts = Object.values(record)
      .map(textFromUnknown)
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
    if (parts.length) return parts.join("; ");
  }
  return value;
}

function flexibleText(max: number, min = 1) {
  return z.preprocess(textFromUnknown, z.string().trim().min(min).max(max));
}

function flexibleOptionalText(max: number) {
  return z.preprocess(
    (value) => value === undefined || value === null || value === "" ? undefined : textFromUnknown(value),
    z.string().trim().max(max).optional(),
  );
}

function flexibleTextArray(maxItems: number, maxLength: number) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return [];
    const values = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[\n,;]+/)
        : [value];
    return values
      .map(textFromUnknown)
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  }, z.array(z.string().trim().min(1).max(maxLength)).max(maxItems).default([]));
}

function numberFromUnknown(value: unknown): unknown {
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

function difficultyLabelFromUnknown(value: unknown): unknown {
  const text = textFromUnknown(value);
  if (typeof text !== "string") return value;
  const normalized = text.trim().toLocaleLowerCase();
  const labels: Record<string, string> = {
    foundational: "Foundational",
    beginner: "Beginner",
    intermediate: "Intermediate",
    advanced: "Advanced",
    expert: "Expert",
  };
  return labels[normalized] ?? text;
}

function normalizeDifficultyAssessment(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    difficulty: numberFromUnknown(record.difficulty),
    difficultyLabel: difficultyLabelFromUnknown(record.difficultyLabel),
    difficultyExplanation: textFromUnknown(record.difficultyExplanation),
    difficultyFactors: record.difficultyFactors,
  };
}

function normalizeLevelNarrative(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    sameLevelReason: textFromUnknown(record.sameLevelReason),
    previousLevelComparison: textFromUnknown(record.previousLevelComparison),
  };
}

const FlexibleDifficultyScoreSchema = z.preprocess(numberFromUnknown, DifficultyScoreSchema);
const FlexibleDifficultyLabelSchema = z.preprocess(difficultyLabelFromUnknown, DifficultyLabelSchema);
const FlexibleDifficultyAssessmentSchema = z.preprocess(normalizeDifficultyAssessment, DifficultyAssessmentSchema);
const FlexibleLevelNarrativeSchema = z.preprocess(normalizeLevelNarrative, LevelNarrativeSchema);

function flexibleScore(min: number, max: number, fallback: number) {
  return z.preprocess(numberFromUnknown, z.number().min(min).max(max).default(fallback));
}

function flexibleOptionalInteger(min: number, max: number) {
  return z.preprocess(
    (value) => value === undefined || value === null || value === "" ? undefined : numberFromUnknown(value),
    z.number().int().min(min).max(max).optional(),
  );
}

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
  title: flexibleText(120),
  description: flexibleText(360),
  whyReachable: flexibleText(600),
  connectsFrom: flexibleTextArray(2, 140),
  difficulty: FlexibleDifficultyScoreSchema,
  difficultyLabel: FlexibleDifficultyLabelSchema,
  difficultyExplanation: flexibleText(500),
  difficultyFactors: flexibleTextArray(5, 120),
  satisfiedPrerequisites: flexibleTextArray(6, 140),
  missingPrerequisites: flexibleTextArray(6, 140),
  unlocks: flexibleTextArray(5, 160),
  applications: flexibleTextArray(5, 160),
  estimatedLearningTime: flexibleOptionalText(120),
  readinessScore: flexibleScore(0, 100, 60),
  goalAlignmentScore: flexibleScore(0, 100, 50),
  prerequisiteGapScore: flexibleScore(0, 100, 50),
  utilityScore: flexibleScore(0, 100, 50),
  recommendationScore: flexibleScore(0, 100, 50),
  confidence: flexibleScore(0, 1, 0.75),
  evidence: z.array(EvidenceReferenceSchema).max(6).default([]),
});

export type LearningDirectionProposal = z.infer<typeof LearningDirectionProposalSchema>;

export const LearningPathProposalSchema = z.object({
  learnerSummary: flexibleText(700),
  parsedFoundations: flexibleTextArray(8, 120),
  inferredAssumptions: flexibleTextArray(6, 180),
  foundationAssessment: FlexibleDifficultyAssessmentSchema,
  foundationLevelNarrative: FlexibleLevelNarrativeSchema,
  levelNarrative: FlexibleLevelNarrativeSchema,
  foundationSuggestions: flexibleTextArray(4, 120),
  directions: z.array(LearningDirectionProposalSchema).min(2).max(10),
  recommendedTitle: flexibleText(120),
  recommendationReason: flexibleText(700),
  estimatedDestinationHeight: flexibleOptionalInteger(1, 12),
  destinationHeightReason: flexibleOptionalText(600),
  confidence: flexibleScore(0, 1, 0.75),
});
export type LearningPathProposal = z.infer<typeof LearningPathProposalSchema>;
