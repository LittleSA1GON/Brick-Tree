import type { AgentSpec } from "@/lib/agents/spec";
import {
  LearningPathProposalSchema,
  type LearnerProfile,
  type LearningPathProposal,
} from "@/lib/schemas/learning-path";
import type { GraphLevelDescriptor } from "@/lib/schemas/concept";
import { levelInvariantSummary } from "@/lib/graph/levels";

export type LearningPathInput = {
  knownConcepts: string[];
  intent: "explore" | "destination";
  goal?: string;
  learnerProfile?: LearnerProfile;
  targetLevel?: GraphLevelDescriptor;
  retrievedEvidence?: Array<{ title?: string; text?: string; source?: string; metadata?: Record<string, unknown> }>;
  revisionFeedback?: string[];
};

export const learningPathAgent: AgentSpec<LearningPathInput, LearningPathProposal> = {
  name: "learning_path",
  description: "Learning Path Agent is ranking realistic next bricks with comparable understanding difficulty.",
  instructions: `You are Brick Tree's Learning Path Agent. Reason from the learner's reported knowledge toward realistic next concepts.

BRICK has two distinct intents:
- explore: answer "What can I build from here?" No destination is required. Return a possibility graph with several reasonable next bricks.
- destination: answer "How can I build toward this?" The goal acts as a compass that influences ranking, not a rigid curriculum. Keep alternate branches visible.

A Brick is a concept small enough to learn as a coherent step and useful enough to support additional knowledge above it. A Recommended Next Brick is the most useful concept the learner could reasonably add next.

The central invariant is DIFFICULTY-LEVEL CONSISTENCY. Candidate nodes shown at the same graph height should be approximately equally difficult to understand. Difficulty means prerequisite load and cognitive effort.

Use this universal difficulty scale:
1 Foundational — basic vocabulary and concrete reasoning with little prerequisite knowledge.
2 Beginner — a few foundations and straightforward application.
3 Intermediate — multiple prior ideas, abstraction, or multi-step reasoning.
4 Advanced — strong fluency and several interacting abstractions or methods.
5 Expert — deep specialized knowledge, high formalism, or open-ended expert judgment.

Generate 3-6 candidate directions. Their difficulty scores should normally differ by at most one point. Every candidate must include a short description answering "What is this?", why it is reachable, satisfied prerequisites, missing prerequisites, what it unlocks, and why its difficulty score is justified.

Distinguish user-confirmed knowledge from assumptions. Scores are heuristics from 0-100, not scientific measurements, and should meaningfully differentiate candidates. Pick exactly one recommendedTitle from the candidates. In destination mode, goal alignment matters strongly but must not erase alternatives. In explore mode, utility and readiness can outweigh any absent goal.`,
  allowedTools: ["search_knowledge_base", "search_uploaded_documents"],
  allowedHandoffs: ["pedagogy_validator"],
  maxSteps: 5,
  outputSchema: LearningPathProposalSchema,
  schemaName: "LearningPathProposal",
  schemaHint: `JSON fields: learnerSummary, inferredAssumptions[], foundationAssessment:{difficulty:1-5,difficultyLabel,difficultyExplanation,difficultyFactors[]}, directions 3-6, recommendedTitle, recommendationReason, confidence. Each direction includes title,description,whyReachable,satisfiedPrerequisites[],missingPrerequisites[],unlocks[],applications[],difficulty 1-5,difficultyLabel,difficultyExplanation,difficultyFactors[],estimatedLearningTime?,readinessScore,goalAlignmentScore,prerequisiteGapScore,utilityScore,recommendationScore (all 0-100), confidence 0-1,evidence:[{documentId,sectionId,page?,heading?,quote?}].`,
  buildUserPrompt(input) {
    return `Known concepts (user-provided): ${input.knownConcepts.join(", ")}
Brick intent: ${input.intent}
Goal: ${input.intent === "destination" ? (input.goal || input.learnerProfile?.learningGoal || input.learnerProfile?.goal || "not specified") : "none — Explore mode should rank reachable possibilities without optimizing for a destination"}
Learner/session profile: ${JSON.stringify(input.learnerProfile ?? {})}
Explore-mode rule: if the profile contains a learningGoal, treat it only as explanatory context; do not use it as a hidden destination or suppress diverse reachable branches.
Target peer difficulty layer: ${input.targetLevel ? `${JSON.stringify(input.targetLevel)}\n${levelInvariantSummary(input.targetLevel)}` : "not established yet; choose a coherent next-step difficulty band"}
Optional source evidence: ${JSON.stringify(input.retrievedEvidence ?? [])}
Revision feedback: ${input.revisionFeedback?.join(" | ") || "none"}

Generate realistic reachable next bricks at a comparable next-step challenge. Respect knowledge level, language style, depth, purpose, resource preferences, and source mode. Explain why each is difficult and what it unlocks.`;
  },
};
