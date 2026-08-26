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

export const conceptArchitectAgent: AgentSpec<ConceptArchitectInput, ConceptDecomposition> = {
  name: "concept_architect",
  description: "Concept Architect is building a coherent layer of similarly difficult knowledge bricks.",
  instructions: `You are Brick Tree's Concept Architect. Build pedagogically coherent knowledge structures, not mind-map filler.

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

Every child must include a concise one- or two-sentence description answering "What is this?" immediately. For every parent and child, explain WHY it is difficult and list the main difficulty factors.

Prefer 4-5 children. Use 3 or 6 only when accuracy requires it. Avoid duplicate concepts and preserve plausible relationships.

In trace-prerequisites intent, children should normally be no harder than the parent and should move toward more accessible foundations over successive levels. If learner-known concepts are supplied, treat them as stopping points rather than inventing unnecessary prerequisites below them.

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
  schemaHint: `JSON fields: parentConcept:string, summary:string, parentAssessment:{difficulty:1-5,difficultyLabel:'Foundational'|'Beginner'|'Intermediate'|'Advanced'|'Expert',difficultyExplanation:string,difficultyFactors:string[]}, children:3-6 items. Each child has title,description,whyItMatters,difficulty 1-5,difficultyLabel,difficultyExplanation,difficultyFactors[],prerequisites[],learningOutcomes[],applications[],examples[],whatItUnlocks[],estimatedLearningTime?,confidence 0-1,evidence:[{documentId,sectionId,page?,heading?,quote?}]. Top-level confidence 0-1.`,
  buildUserPrompt(input) {
    const target = input.targetLevel
      ? `${JSON.stringify(input.targetLevel)}\nInvariant: ${levelInvariantSummary(input.targetLevel)}`
      : "No graph-level band exists yet. Choose one coherent peer difficulty band; the children's difficulty spread should normally be <= 1.";
    return `Topic: ${input.topic}
Parent concept: ${input.parentTitle}
Tree intent: ${input.intent}
Known parent difficulty: ${input.parentDifficulty ?? "estimate it"}
Target child difficulty layer: ${target}
Learner/session profile: ${JSON.stringify(input.learnerProfile ?? {})}
Existing graph context: ${JSON.stringify(input.graphContext ?? {})}
Source mode: ${input.sourceMode ?? input.learnerProfile?.sourceMode ?? "general"}
Retrieved source evidence: ${JSON.stringify(input.retrievedEvidence ?? [])}
Revision feedback: ${input.revisionFeedback?.join(" | ") || "none"}

Return a useful layer for the requested TREE intent. Keep siblings at approximately the same understanding difficulty. Respect the learner's knowledge level, requested vernacular, depth, purpose, and known concepts. Give a concrete explanation for why each node earned its difficulty score. For analyze-question, the root layer should cover the most relevant Who/What/Why/Where/How-style lenses without forcing irrelevant categories; deeper layers should become more specific and actionable.`;
  },
};
