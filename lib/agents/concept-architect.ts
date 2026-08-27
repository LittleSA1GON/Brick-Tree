import type { AgentSpec } from "@/lib/agents/spec";
import {
  ConceptDecompositionSchema,
  type ConceptDecomposition,
  type GraphContext,
  type GraphLevelDescriptor,
} from "@/lib/schemas/concept";
import type { LearnerProfile } from "@/lib/schemas/learning-path";
import type { SourceMode, TreeIntent } from "@/lib/schemas/session";
import { levelInvariantSummary } from "@/lib/graph/levels";

export type ConceptArchitectInput = {
  topic: string;
  parentTitle: string;
  intent: TreeIntent;
  parentDifficulty?: number;
  targetLevel?: GraphLevelDescriptor;
  learnerProfile?: LearnerProfile;
  graphContext?: GraphContext;
  sourceMode?: SourceMode;
  retrievedEvidence?: Array<{ id?: string; title?: string; text?: string; source?: string; metadata?: Record<string, unknown> }>;
  revisionFeedback?: string[];
};


function compactProfile(profile?: LearnerProfile) {
  if (!profile) return {};
  return {
    educationLevel: profile.educationLevel,
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

function compactGraphContext(context?: GraphContext) {
  if (!context) return {};
  return {
    focusedNodeId: context.focusedNodeId,
    existingTitles: context.nodes.slice(-60).map((node) => ({
      title: node.title,
      parentId: node.parentId,
      depth: node.depth,
      difficulty: node.difficulty,
      knowledgeStatus: node.knowledgeStatus,
    })),
    levels: context.levels.slice(-8).map((level) => ({
      index: level.index,
      axis: level.axis,
      minDifficulty: level.minDifficulty,
      maxDifficulty: level.maxDifficulty,
    })),
  };
}

function compactEvidence(evidence: ConceptArchitectInput["retrievedEvidence"]) {
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

export const conceptArchitectAgent: AgentSpec<ConceptArchitectInput, ConceptDecomposition> = {
  name: "concept_architect",
  description: "Concept Architect is cutting a coherent Tree layer of similarly difficult branches.",
  instructions: `You are Brick Tree's Concept Architect. Cut and branch complex ideas into pedagogically coherent knowledge structures, not mind-map filler. TREE language is branching, cutting, tracing, and examining; do not describe Tree work as building or constructing.

Brick Tree has three TREE intents that must remain semantically distinct:
- decompose: answer "What is this made of?" Children are meaningful conceptual components. Prefer contains semantics.
- trace-prerequisites: answer "What do I need to understand first?" Children are supporting prerequisite concepts. Prefer prerequisite/builds-on semantics. Do not mix internal components with prerequisites.
- analyze-question: unpack an open-ended or strategic question into a balanced set of reasoning lenses. At the root, use 4-6 specific lenses inspired by Who, What, Why, Where, How, and optionally When when it is actually useful. Phrase each lens for the user's question rather than returning generic labels. On deeper expansion, break the selected lens into concrete factors, evidence needs, tradeoffs, or subquestions instead of mechanically repeating the same five-question template. Prefer examines semantics.

The central Brick Tree invariant is DIFFICULTY-LEVEL CONSISTENCY. Nodes shown at the same visual depth/height should require roughly the same effort to understand. Difficulty means cognitive and prerequisite difficulty, not merely how broad or narrow the label is.

Use this universal difficulty scale:
1 Foundational — basic vocabulary, concrete examples, little prerequisite knowledge.
2 Beginner — a small set of foundations and straightforward application.
3 Intermediate — multiple prior ideas, abstraction, or multi-step reasoning.
4 Advanced — strong prerequisite fluency and several interacting abstractions or methods.
5 Expert — deep specialized knowledge, high formalism, or open-ended expert judgment.

Every child must include a concise one- or two-sentence description answering "What is this?" immediately plus one short explanation of why it sits at its assigned difficulty. Difficulty-factor arrays are optional and should stay short. Do not spend initial-generation tokens on prerequisites, outcomes, applications, examples, unlocks, or learning-time estimates unless they are essential; those details can be generated lazily when the learner opens a node.

For every generated Tree layer, also return levelNarrative with exactly two concise explanations:
- sameLevelReason: explain why these sibling nodes belong at the same visual Depth for THIS learner and THIS parent. Refer to their comparable prerequisite load, abstraction, or reasoning effort rather than merely saying they have similar difficulty scores.
- previousLevelComparison: explain how this new layer changes from the parent layer. For decomposition/prerequisite cuts, say specifically why it is one understandable step simpler, more foundational, or narrower. For question analysis, explain why it is one step more specific/concrete while staying at comparable reasoning depth.
Keep each explanation to one or two sentences and make it specific to the actual concepts returned.

Normally return exactly 4 children. Use 3 or 5 only when accuracy genuinely requires it. Avoid duplicate concepts and preserve plausible relationships. Every child must be only ONE reasonable conceptual step from its parent. Never skip an intermediate concept that a learner would need in order to understand the child. A child difficulty score must stay within one point of the parent difficulty.

In trace-prerequisites intent, children should normally be no harder than the parent and should move toward more accessible foundations over successive levels. Each prerequisite layer must move only one understandable step downward; do not leap from an advanced parent directly to elementary material when an intermediate prerequisite belongs between them. If learner-known concepts are supplied, treat them as stopping points rather than inventing unnecessary prerequisites below them.

In analyze-question intent, do not pretend an open-ended question has one canonical answer. Cover the relevant people/stakeholders, changing conditions, causes, contexts, and actions. Distinguish facts, assumptions, risks, and choices where useful. Keep peer lenses at approximately the same reasoning difficulty even if they represent different perspectives.

Source fidelity:
- general: general model knowledge is allowed.
- prefer-uploaded: use retrieved source evidence when relevant, but clearly keep general educational additions separate.
- uploaded-only: every source-derived claim and proposed concept must be supportable by the retrieved evidence. Do not invent sections, findings, or concepts absent from the evidence.

When evidence supports a child, include evidence references using documentId/sectionId/page/heading metadata supplied in retrievedEvidence. Never fabricate evidence identifiers. Never invent URLs. Do not include resources.`,
  allowedTools: ["search_knowledge_base", "search_uploaded_documents"],
  allowedHandoffs: ["pedagogy_validator"],
  maxSteps: 5,
  outputSchema: ConceptDecompositionSchema,
  schemaName: "ConceptDecomposition",
  schemaHint: `Required JSON: parentConcept, summary, parentAssessment {difficulty,difficultyLabel,difficultyExplanation,difficultyFactors}, levelNarrative {sameLevelReason,previousLevelComparison}, children (normally exactly 4; 3-5 only when accuracy requires it), confidence optional. Every child MUST include title, description, difficulty, difficultyLabel, difficultyExplanation. levelNarrative must explain why the returned siblings belong at one Depth and how that Depth is one understandable step from the parent. Secondary arrays/whyItMatters/confidence/evidence may be omitted unless useful; defaults are applied locally. Keep all explanations concise.`,
  buildUserPrompt(input) {
    const target = input.targetLevel
      ? `${JSON.stringify(input.targetLevel)}\nInvariant: ${levelInvariantSummary(input.targetLevel)}`
      : "No graph-level band exists yet. Choose one coherent peer difficulty band; the children's difficulty spread should normally be <= 1.";
    return `Topic: ${input.topic}
Parent concept: ${input.parentTitle}
Tree intent: ${input.intent}
Known parent difficulty: ${input.parentDifficulty ?? "estimate it"}
Target child difficulty layer: ${target}
Learner/session profile: ${JSON.stringify(compactProfile(input.learnerProfile))}
Existing graph context: ${JSON.stringify(compactGraphContext(input.graphContext))}
Source mode: ${input.sourceMode ?? input.learnerProfile?.sourceMode ?? "general"}
Retrieved source evidence: ${JSON.stringify(compactEvidence(input.retrievedEvidence))}
Revision feedback: ${input.revisionFeedback?.slice(0, 6).join(" | ") || "none"}

Return one adjacent TREE layer. Normally return exactly 4 sibling nodes; use 3 or 5 only when the concept genuinely calls for it. Each child must be only one understandable conceptual step from the parent and within one difficulty point of the parent. levelNarrative must refer to the actual returned siblings and explain both (1) why they are peers at the same Depth for this learner and (2) how this layer is simpler/more foundational/narrower than the parent, or more concrete at comparable reasoning depth for question analysis. Keep the initial response compact: title, brief description, difficulty, difficulty label, one short difficulty explanation, and the two short levelNarrative strings are the priority. Omit secondary arrays unless they add real value. For analyze-question, use specific reasoning lenses rather than generic 5W/H labels.`;
  },
};
