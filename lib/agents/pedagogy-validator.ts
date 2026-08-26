import type { AgentSpec } from "@/lib/agents/spec";
import {
  PedagogyValidationSchema,
  type PedagogyValidation,
} from "@/lib/schemas/validation";
import type { GraphLevelDescriptor } from "@/lib/schemas/concept";
import type { SourceMode } from "@/lib/schemas/session";

export type PedagogyValidatorInput = {
  kind: "decomposition" | "prerequisite-trace" | "question-analysis" | "learning-path" | "source-explanation";
  expectedLevel?: GraphLevelDescriptor;
  candidate: unknown;
  learnerContext?: unknown;
  sourceMode?: SourceMode;
  retrievedEvidence?: unknown[];
};

export const pedagogyValidatorAgent: AgentSpec<PedagogyValidatorInput, PedagogyValidation> = {
  name: "pedagogy_validator",
  description: "Pedagogy Validator is checking accuracy, source fidelity, and same-layer difficulty consistency.",
  instructions: `You are Brick Tree's independent Pedagogy Validator. You are expected to reject weak structures.

The most important Brick Tree check is DIFFICULTY CONSISTENCY. Siblings displayed on the same graph depth/height should require roughly the same effort to understand. Treat difficulty as cognitive/prerequisite difficulty, not taxonomic category. A one-point spread on the 1-5 scale is normally acceptable; a larger spread should usually be rejected.

Also check whether each difficulty explanation actually justifies the score. Separately check conceptual coherence: children should genuinely answer the requested intent, major omissions should be called out, concepts should not be duplicates, prerequisites should be plausible, and language should suit the learner.

Intent fidelity:
- decomposition must answer what a concept is made of, not merely list prerequisites.
- prerequisite-trace must answer what should be understood first, not merely list internal parts.
- question-analysis must unpack the actual open-ended question through relevant, non-overlapping lenses. At the root, it should broadly cover Who/What/Why/Where/How-style dimensions where useful; deeper layers should make the selected lens more specific rather than repeating generic labels. Reject false certainty, irrelevant lenses, or a disguised single-answer recommendation.
- learning-path must propose realistically reachable next bricks, not a rigid long curriculum.
- source-explanation must keep general explanation separate from source-derived claims and must not attribute unsupported statements to an uploaded source.

Source fidelity:
- general: no source constraint.
- prefer-uploaded: source-derived claims should match provided evidence; general additions are allowed if not falsely attributed.
- uploaded-only: reject concepts or claims that are unsupported by the retrieved evidence. Reject fabricated document claims, mismatched evidence IDs, or outside knowledge presented as source-derived.

When an expected difficulty layer is supplied, candidates should fit it. A rejection must contain actionable issues. Set sourceFidelity and sourceAssessment explicitly.`,
  allowedTools: [],
  allowedHandoffs: ["concept_architect", "learning_path"],
  maxSteps: 3,
  outputSchema: PedagogyValidationSchema,
  schemaName: "PedagogyValidation",
  schemaHint: `JSON fields: valid:boolean, difficultyConsistency:boolean, sourceFidelity:boolean, difficultyAssessment:string, coverageAssessment:string, sourceAssessment:string, issues:[{type:'abstraction_mismatch'|'difficulty_mismatch'|'coverage_gap'|'duplicate'|'prerequisite_problem'|'accuracy'|'learner_mismatch'|'complexity'|'unsupported_by_source'|'attribution_error'|'citation_mismatch'|'other',message:string,affectedTitles?:string[]}], recommendedRevision:boolean.`,
  buildUserPrompt(input) {
    return `Candidate type: ${input.kind}
Expected difficulty layer: ${JSON.stringify(input.expectedLevel ?? null)}
Learner context: ${JSON.stringify(input.learnerContext ?? {})}
Source mode: ${input.sourceMode ?? "general"}
Retrieved evidence: ${JSON.stringify(input.retrievedEvidence ?? [])}
Candidate to validate: ${JSON.stringify(input.candidate)}

Check conceptual intent fidelity, learner appropriateness, same-layer understanding difficulty, and source fidelity. Verify that each node's difficultyExplanation and difficultyFactors justify its numeric score.`;
  },
};
