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
  currentLayerTitles?: string[];
  targetDirectionCount?: number;
  allowFoundationSuggestions?: boolean;
  focusTitle?: string;
  retrievedEvidence?: Array<{
    id?: string;
    title?: string;
    text?: string;
    source?: string;
    metadata?: Record<string, unknown>;
  }>;
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

BRICK IS A STACK, NOT A TREE.
- Height 0 is the learner's starting foundation row.
- Every later response creates ONE complete row directly above the current top row.
- Never branch several independent child groups from one clicked brick.
- A new row is a shared construction layer supported by the row immediately below it.
- The new row should contain exactly one more brick than the row below whenever the requested targetDirectionCount says so.
- Each new brick must name one or two exact source titles in connectsFrom. Those titles must come from currentLayerTitles when supplied.
- connectsFrom describes the local bricks directly supporting that new brick. Do not connect a brick to the entire previous row.
- Keep neighboring proposals ordered so their supporting bricks are nearby in the previous row; this produces a clean stacked wall instead of crossing branches.
- Every new brick must be only ONE reasonable conceptual step above the bricks named in connectsFrom.
- Each higher positive height must add exactly one reasonable conceptual step beyond the row below it; never jump across missing intermediate knowledge.

Difficulty scale:
1 Foundational — basic vocabulary and concrete reasoning with little prerequisite knowledge.
2 Beginner — a few foundations and straightforward application.
3 Intermediate — multiple prior ideas, abstraction, or multi-step reasoning.
4 Advanced — strong fluency and several interacting abstractions or methods.
5 Expert — deep specialized knowledge, high formalism, or open-ended expert judgment.

Every direction must state what it is, why it is reachable, connectsFrom, and briefly justify its difficulty. Keep the initial layer compact. Prerequisite lists, unlocks, applications, heuristic scores, time estimates, and evidence arrays are secondary and may be omitted unless they materially change the recommendation.

For every Brick response, return two compact layer explanations:
- foundationLevelNarrative.sameLevelReason: explain why the visible Height 0 foundation bricks can reasonably be treated as the learner's shared starting layer. foundationLevelNarrative.previousLevelComparison must explain that Height 0 is the learner-specific baseline and has no lower generated layer.
- levelNarrative.sameLevelReason: explain why all proposed bricks belong together at the same new Height for THIS learner, based on comparable prerequisite load, abstraction, and reachability.
- levelNarrative.previousLevelComparison: explain specifically why the proposed row is one reasonable learning step more complex than the row immediately below it, naming the kinds of new reasoning or knowledge added without skipping prerequisites.
Keep each explanation to one or two sentences and ground it in the actual row titles and learner profile.

Foundation behavior:
- Preserve every user-provided known concept as a foundation brick.
- foundationSuggestions are allowed only when the request explicitly permits them.
- A foundation suggestion must be a genuinely useful missing prerequisite and must not repeat supplied knowledge.
- If foundation suggestions are added on the initial map, the next generated row must still be exactly one brick wider than the resulting visible foundation row.

Destination behavior:
- When intent is destination, provide estimatedDestinationHeight from 1-12 and destinationHeightReason.
- Height is measured from the user's original foundation at 0.
- estimatedDestinationHeight is an ABSOLUTE height from original Height 0.
- Do not fabricate intermediate layers that have not been generated yet.
- Never jump straight to the destination unless it is genuinely one conceptual layer above the current row.

Explore behavior:
- Do not silently optimize toward a destination.
- Respect educationLevel, knowledgeLevel, and exploreBias as active constraints.
- Do not infer an AI or machine-learning destination merely because the learner knows algebra, Python, or statistics.
- For elementary and middle-school learners, prefer concrete, visual, practical, or foundational next steps.
- For high-school learners, stay realistically approachable without assuming college-level mathematics or specialist computing unless those prerequisites were supplied.
- For college/graduate learners, advanced directions are allowed only when adjacent prerequisites are present.
- balanced: diversify across useful adjacent directions.
- practical: favor directly usable skills and applications.
- academic: favor foundational theory and conventional subject progression.
- creative: favor design, making, expression, and cross-disciplinary applications.
- career: favor broadly useful employable skills appropriate to the learner's current level.
- technical: favor deeper technical detail while staying one adjacent step away.

Scores are heuristics from 0-100. Pick exactly one recommendedTitle from the candidate directions.

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
  schemaHint: `Required JSON: learnerSummary, foundationAssessment {difficulty,difficultyLabel,difficultyExplanation,difficultyFactors}, foundationLevelNarrative {sameLevelReason,previousLevelComparison}, levelNarrative {sameLevelReason,previousLevelComparison}, directions, recommendedTitle, recommendationReason. Every direction MUST include title, description, whyReachable, connectsFrom (1-2 exact titles from the current layer when currentLayerTitles is supplied), difficulty, difficultyLabel, difficultyExplanation. Return exactly targetDirectionCount directions when targetDirectionCount is provided. levelNarrative must explain why the row is one coherent Height and why it is exactly one learning step above the previous row. Secondary arrays, scores, confidence, evidence, and time estimates may be omitted. Destination mode should include estimatedDestinationHeight and destinationHeightReason.`,
  buildUserPrompt(input) {
    const currentLayer = input.currentLayerTitles?.length
      ? input.currentLayerTitles
      : input.knownConcepts;
    const requestedCount = input.targetDirectionCount
      ? `${input.targetDirectionCount} exactly`
      : `one more than the final visible foundation row (current ${currentLayer.length}, plus any permitted foundationSuggestions), maximum 10`;

    return `Current Brick row: ${currentLayer.slice(0, 20).join(", ")}
Known learner foundation: ${input.knownConcepts.slice(0, 20).join(", ")}
Clicked emphasis brick: ${input.focusTitle || "none"}
Brick intent: ${input.intent}
Destination: ${input.intent === "destination" ? (input.goal || input.learnerProfile?.learningGoal || input.learnerProfile?.goal || "not specified") : "none"}
Required number of bricks in the NEW row: ${requestedCount}
Foundation suggestions allowed: ${input.allowFoundationSuggestions ? "yes, only on the initial Height 0 row" : "no; return foundationSuggestions as []"}
Learner/session profile: ${JSON.stringify(compactProfile(input.learnerProfile))}
Learner-fit constraint: ${learnerFitSummary(input.learnerProfile)}
Target peer layer: ${input.targetLevel ? `${JSON.stringify(input.targetLevel)}\n${levelInvariantSummary(input.targetLevel)}` : "Choose one coherent next-step difficulty band."}
Optional source evidence: ${JSON.stringify(compactEvidence(input.retrievedEvidence))}
Revision feedback: ${input.revisionFeedback?.slice(0, 6).join(" | ") || "none"}

Construct one complete stacked Brick row above the current row. This is NOT a branching response. Every direction must connect to one or two exact titles from the current row using connectsFrom, and every direction must be only one learnable conceptual step above those supporting bricks. Keep the row ordered so neighboring new bricks rely on neighboring lower bricks. If a clicked emphasis brick is supplied, make at least one new brick meaningfully build from it without turning the whole row into a branch from that single brick. foundationLevelNarrative and levelNarrative must be specific to this Brick workspace and learner; do not reuse generic wording from another Tree or Brick. Keep the response compact.`;
  },
};
