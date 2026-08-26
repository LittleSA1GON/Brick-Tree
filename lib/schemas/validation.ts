import { z } from "zod";

export const ValidationIssueSchema = z.object({
  type: z.enum([
    "abstraction_mismatch",
    "difficulty_mismatch",
    "coverage_gap",
    "duplicate",
    "prerequisite_problem",
    "accuracy",
    "learner_mismatch",
    "complexity",
    "unsupported_by_source",
    "attribution_error",
    "citation_mismatch",
    "other",
  ]),
  message: z.string().min(1).max(600),
  affectedTitles: z.array(z.string()).max(12).optional(),
});

export const PedagogyValidationSchema = z.object({
  valid: z.boolean(),
  difficultyConsistency: z.boolean(),
  sourceFidelity: z.boolean().default(true),
  difficultyAssessment: z.string().min(1).max(900),
  coverageAssessment: z.string().min(1).max(900),
  sourceAssessment: z.string().min(1).max(900).default("No source-grounding constraint was requested."),
  issues: z.array(ValidationIssueSchema).max(12),
  recommendedRevision: z.boolean(),
});
export type PedagogyValidation = z.infer<typeof PedagogyValidationSchema>;
