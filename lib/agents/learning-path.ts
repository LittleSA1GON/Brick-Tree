import type { AgentSpec } from "@/lib/agents/spec";
import {
  LearningPathProposalSchema,
  type LearnerProfile,
  type LearningPathProposal,
} from "@/lib/schemas/learning-path";
import type { GraphLevelDescriptor } from "@/lib/schemas/concept";
import type { BrickIntent } from "@/lib/schemas/session";
import { levelInvariantSummary } from "@/lib/graph/levels";
import { learnerFitSummary } from "@/lib/learning/learner-fit";

export type LearningPathInput = {
  knownConcepts: string[];
  intent: BrickIntent;
  goal?: string;
  learnerProfile?: LearnerProfile;
  targetLevel?: GraphLevelDescriptor;
  retrievedEvidence?: Array<{ id?: string; title?: string; text?: string; source?: string; metadata?: Record<string, unknown> }>;
  revisionFeedback?: string[];
};


function compactProfile(profile?: LearnerProfile) {
  if (!profile) return {};
  return {
    educationLevel: profile.educationLevel,
    exploreBias: profile.exploreBias,
    existingKnowledge: profile.existingKnowledge.slice(0, 20),
    goal: profile.goal,
    learningGoal: profile.learningGoal,
    desiredField: profile.desiredField,
    knowledgeLevel: profile.knowledgeLevel,
    languageStyle: profile.languageStyle,
    depthPreference: profile.depthPreference,
    purpose: profile.purpose,
    preferredDepth: profile.preferredDepth,
    availableStudyTime: profile.availableStudyTime,
    preferredExamples: profile.preferredExamples?.slice(0, 5),
    courseContext: profile.courseContext?.slice(0, 1800),
    sourceMode: profile.sourceMode,
  };
}

function compactEvidence(evidence: LearningPathInput["retrievedEvidence"]) {
  return (evidence ?? []).slice(0, 6).map((item) => ({
    id: item.id,
    title: item.title,
    source: item.source,
    text: item.text?.slice(0, 650),
    metadata: item.metadata
      ? {
          documentId: item.metadata.documentId,
          sectionId: item.metadata.sectionId,
          page: item.metadata.page,
          heading: item.metadata.heading,
        }
      : undefined,
  }));
}

export const learningPathAgent: AgentSpec<LearningPathInput, LearningPathProposal> = {
  name: "learning_path",
  description: "Learning Path Agent is constructing the next reachable Brick layer.",
  instructions: `You are Brick Tree's Learning Path Agent. Construct realistic next knowledge from what the learner already knows.

BRICK is constructive, not a curriculum generator. Think in layers of reachable knowledge:
- Height 0 is the learner's foundation.
- Height +1 is the first genuinely reachable layer and must be directly learnable from Height 0.
- Each higher positive height must add exactly one reasonable conceptual step beyond the layer below it; never jump across missing intermediate knowledge.
- In destination mode, estimate how many conceptual layers the destination is from the foundation. This is a rough educational estimate, not a promise or exact course length.

Normally generate exactly 4 candidate directions at one comparable next-step height. Use 3 or 5 only when accuracy genuinely requires it. Every candidate must be only ONE reasonable conceptual step above the current foundation or focused brick: something the learner could plausibly approach next without silently requiring an ungenerated intermediate topic. Their understanding difficulty should normally differ by at most one point, and no candidate may be more than one difficulty point above the current foundation/focused brick.

Use this universal difficulty scale:
1 Foundational — basic vocabulary and concrete reasoning with little prerequisite knowledge.
2 Beginner — a few foundations and straightforward application.
3 Intermediate — multiple prior ideas, abstraction, or multi-step reasoning.
4 Advanced — strong fluency and several interacting abstractions or methods.
5 Expert — deep specialized knowledge, high formalism, or open-ended expert judgment.

Every direction must state what it is, why it is reachable, and briefly justify its difficulty. Keep the initial layer compact. Prerequisite lists, unlocks, applications, heuristic scores, time estimates, and evidence arrays are secondary and may be omitted unless they materially change the recommendation; local defaults fill them and richer detail can be generated when the learner opens a node.

Foundation behavior:
- Preserve every user-provided known concept as a foundation brick.
- You may suggest up to four additional foundation bricks only when they are genuinely useful prerequisites the learner appears to be missing.
- foundationSuggestions must not repeat the learner's supplied known concepts.

Destination behavior:
- When intent is destination, provide estimatedDestinationHeight from 1-12 and destinationHeightReason.
- Height is measured from the user's original foundation at 0. Example: estimatedDestinationHeight 4 means the destination is roughly four conceptual layers above the starting foundation.
- estimatedDestinationHeight is always an ABSOLUTE height from the original Height 0, even when you are generating a later branch. If targetLevel is +3, the estimated destination height must be at least +3.
- Do not fabricate intermediate layers that have not been generated yet. The UI will show the destination above the current construction with an estimated remaining gap.
- Prefer directions that make progress toward the destination while preserving realistic alternatives.
- Never jump straight to the destination unless it is genuinely only one conceptual layer above the current foundation. If it is farther away, choose the immediate next layer and let later user clicks construct the remaining layers.

Explore behavior:
- Do not silently optimize toward a destination.
- Respect the learner's educationLevel, knowledgeLevel, and exploreBias before choosing topics.
- Do not infer an AI, machine-learning, or other advanced technical destination merely because the learner knows algebra, Python, or statistics. Those foundations open many directions.
- For elementary and middle-school learners, prefer concrete, visual, practical, or foundational next steps.
- For high-school learners, stay within concepts that are realistically approachable from the stated foundation without assuming college-level mathematics or specialized computing unless the learner explicitly supplied those prerequisites.
- For college/graduate learners, advanced directions are allowed only when adjacent prerequisites are present.
- balanced: diversify across useful adjacent directions instead of clustering around one fashionable field.
- practical: favor directly usable skills, tools, and applications.
- academic: favor foundational theory and conventional subject progression.
- creative: favor design, making, expression, and cross-disciplinary applications.
- career: favor broadly useful employable skills appropriate to the learner's current level.
- technical: favor deeper technical detail, but still only one adjacent conceptual step.
- Favor reachability, usefulness, learner fit, and diversity of next directions.

Scores are heuristics from 0-100, not scientific measurements. Pick exactly one recommendedTitle from the candidate directions.

Source fidelity:
- general: model knowledge is allowed.
- prefer-uploaded: use retrieved evidence where relevant.
- uploaded-only: claims and directions must be supportable by retrieved evidence.
Never invent evidence identifiers or URLs.`,
  allowedTools: ["search_knowledge_base", "search_uploaded_documents"],
  allowedHandoffs: ["pedagogy_validator"],
  maxSteps: 5,
  outputSchema: LearningPathProposalSchema,
  schemaName: "LearningPathProposal",
  schemaHint: `Required JSON: learnerSummary, foundationAssessment {difficulty,difficultyLabel,difficultyExplanation,difficultyFactors}, directions (normally exactly 4; 3-5 only when accuracy requires it), recommendedTitle, recommendationReason. Every direction MUST include title, description, whyReachable, difficulty, difficultyLabel, difficultyExplanation. Secondary arrays, scores, confidence, evidence, and time estimates may be omitted; defaults are applied locally. Destination mode should include estimatedDestinationHeight and a brief destinationHeightReason when possible.`,
  buildUserPrompt(input) {
    return `Known foundation bricks supplied by the learner: ${input.knownConcepts.slice(0, 20).join(", ")}
Brick intent: ${input.intent}
Destination: ${input.intent === "destination" ? (input.goal || input.learnerProfile?.learningGoal || input.learnerProfile?.goal || "not specified") : "none"}
Learner/session profile: ${JSON.stringify(compactProfile(input.learnerProfile))}
Learner-fit constraint: ${learnerFitSummary(input.learnerProfile)}
Target peer layer: ${input.targetLevel ? `${JSON.stringify(input.targetLevel)}\n${levelInvariantSummary(input.targetLevel)}` : "Choose one coherent next-step difficulty band."}
Optional source evidence: ${JSON.stringify(compactEvidence(input.retrievedEvidence))}
Revision feedback: ${input.revisionFeedback?.slice(0, 6).join(" | ") || "none"}

Construct exactly one adjacent Brick layer. Treat educationLevel and exploreBias as active constraints, not display metadata. Normally return exactly 4 peer directions; use 3 or 5 only when accuracy requires it. Every direction must be one realistically learnable conceptual step above the current foundation/focused brick and no more than one difficulty point harder. Keep the initial response compact and prioritize the required fields. In destination mode, estimate the absolute destination height from original Height 0 without inventing ungenerated intermediate layers.`;
  },
};
