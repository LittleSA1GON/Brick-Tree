import type { ConceptEdge, ConceptNode, GraphLevelDescriptor } from "@/lib/schemas/concept";
import type { ResourceNodeContext } from "@/lib/schemas/resources";
import type { LearnerProfile, LearningPathProposal } from "@/lib/schemas/learning-path";
import type { BrickIntent, TreeIntent } from "@/lib/schemas/session";
import type { PedagogyValidation } from "@/lib/schemas/validation";
import type { AdaptiveExplanation, ExplanationLevel, ExplanationNodeContext } from "@/lib/schemas/api";
import type { AgentTraceEvent } from "@/lib/observability/trace";
import { parseBrickKnowledgeInput } from "@/lib/learning/brick-input";

export type PrimaryMode = "tree" | "brick";
export type ExperiencePhase = "landing" | "workspace";

export type TreeData = {
  root?: ConceptNode;
  parent: ConceptNode;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  level: GraphLevelDescriptor;
  validation?: PedagogyValidation;
  summary: string;
  stoppedAtKnown?: boolean;
};

export type BrickData = {
  root?: ConceptNode;
  parent?: ConceptNode;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  level: GraphLevelDescriptor;
  learningPath: LearningPathProposal;
  validation: PedagogyValidation;
};

export type ResourceBatchData = {
  items: Array<{ nodeId: string; resources: ConceptNode["resources"] }>;
};

export type WorkspaceSnapshot = {
  id: string;
  name: string;
  mode: PrimaryMode;
  treeIntent: TreeIntent;
  brickIntent: BrickIntent;
  topic: string;
  knownInput: string;
  goal: string;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  levels: GraphLevelDescriptor[];
  expandedNodeIds: string[];
  selectedNodeId?: string;
  focusedNodeId?: string;
  viewRootId?: string;
  learningPath?: LearningPathProposal;
  trace: AgentTraceEvent[];
  explanations: Record<string, AdaptiveExplanation>;
  createdAt: number;
};

export const TREE_INTENT_COPY: Record<
  TreeIntent,
  { title: string; prompt: string; placeholder: string; action: string; busy: string }
> = {
  decompose: {
    title: "Cut down",
    prompt: "What do you want to cut down?",
    placeholder: "Machine learning",
    action: "Cut into branches",
    busy: "Cutting the idea into useful parts…",
  },
  "trace-prerequisites": {
    title: "Trace roots",
    prompt: "What do you want to understand from the ground up?",
    placeholder: "Backpropagation",
    action: "Trace roots",
    busy: "Tracing the foundations underneath it…",
  },
  "analyze-question": {
    title: "Analyze a question",
    prompt: "What question do you want to unpack?",
    placeholder: "How do I stay valuable as a software engineer as AI improves?",
    action: "Map the question",
    busy: "Separating the question into useful lenses…",
  },
};

export const DEFAULT_PROFILE: LearnerProfile = {
  educationLevel: "high-school",
  exploreBias: "balanced",
  existingKnowledge: [],
  sourceMode: "general",
  sourceDocumentIds: [],
  knowledgeLevel: "beginner",
  languageStyle: "standard",
  depthPreference: "balanced",
  purpose: "general-learning",
};

export function uniqueLevels(levels: GraphLevelDescriptor[]): GraphLevelDescriptor[] {
  const map = new Map<string, GraphLevelDescriptor>();
  for (const level of levels) map.set(`${level.axis}:${level.index}`, level);
  return [...map.values()].sort((a, b) => a.index - b.index);
}

export function parseKnownConcepts(input: string): string[] {
  return parseBrickKnowledgeInput(input);
}

export function migrateNode(node: ConceptNode): ConceptNode {
  return {
    ...node,
    knowledgeStatus: node.knowledgeStatus ?? "available",
    origins: node.origins ?? [{ type: "model-knowledge" }],
  };
}

export function explanationNodeContext(node: ConceptNode): ExplanationNodeContext {
  return {
    id: node.id,
    title: node.title,
    shortDescription: node.shortDescription,
    whyItMatters: node.whyItMatters,
    difficultyExplanation: node.difficultyExplanation,
    difficultyFactors: node.difficultyFactors,
  };
}

export function explanationLearnerProfile(profile: LearnerProfile): LearnerProfile {
  return {
    educationLevel: profile.educationLevel,
    exploreBias: profile.exploreBias,
    existingKnowledge: profile.existingKnowledge.slice(0, 12),
    sourceMode: profile.sourceMode,
    sourceDocumentIds: profile.sourceDocumentIds,
    knowledgeLevel: profile.knowledgeLevel,
    languageStyle: profile.languageStyle,
    depthPreference: profile.depthPreference,
    purpose: profile.purpose,
    preferredExamples: profile.preferredExamples?.slice(0, 4),
    courseContext: profile.courseContext?.slice(0, 1200),
    learningGoal: profile.learningGoal ?? profile.goal,
  };
}

export function resourceNodeContext(node: ConceptNode): ResourceNodeContext {
  return {
    id: node.id,
    title: node.title,
    shortDescription: node.shortDescription,
    axis: node.level.axis,
    difficulty: node.difficulty,
    difficultyLabel: node.difficultyLabel,
    difficultyExplanation: node.difficultyExplanation,
    difficultyFactors: node.difficultyFactors,
    learningOutcomes: node.learningOutcomes,
    applications: node.applications,
    examples: node.examples,
  };
}

export function resourceLearnerProfile(profile: LearnerProfile): LearnerProfile {
  return {
    educationLevel: profile.educationLevel,
    exploreBias: profile.exploreBias,
    existingKnowledge: [],
    sourceMode: "general",
    sourceDocumentIds: [],
    knowledgeLevel: profile.knowledgeLevel,
    languageStyle: profile.languageStyle,
    depthPreference: profile.depthPreference,
    purpose: profile.purpose,
    preferredResourceTypes: profile.preferredResourceTypes?.slice(0, 6),
    preferredExamples: profile.preferredExamples?.slice(0, 4),
    learningGoal: profile.learningGoal ?? profile.goal,
  };
}

export function resourceProfileFingerprint(profile: LearnerProfile): string {
  return JSON.stringify({
    educationLevel: profile.educationLevel,
    knowledgeLevel: profile.knowledgeLevel,
    purpose: profile.purpose,
    exploreBias: profile.exploreBias,
    depthPreference: profile.depthPreference,
    languageStyle: profile.languageStyle,
    preferredResourceTypes: (profile.preferredResourceTypes ?? []).slice(0, 6).map((value) => value.toLowerCase()).sort(),
    preferredExamples: (profile.preferredExamples ?? []).slice(0, 4).map((value) => value.toLowerCase()).sort(),
    goal: (profile.learningGoal ?? profile.goal ?? "").slice(0, 240).toLowerCase(),
  });
}

export function explanationLevel(profile: LearnerProfile): ExplanationLevel {
  const level = profile.knowledgeLevel ?? "beginner";
  return level === "novice" ? "simple" : level;
}

export function modeAxis(mode: PrimaryMode): "Depth" | "Height" {
  return mode === "tree" ? "Depth" : "Height";
}

export function levelLabel(mode: PrimaryMode, level: number): string {
  if (mode === "tree") return `Depth ${level}`;
  return `Height ${level > 0 ? `+${level}` : level}`;
}

export function statusText(status: ConceptNode["knowledgeStatus"]): string {
  switch (status) {
    case "known": return "Known";
    case "recommended": return "Recommended";
    case "future": return "Future";
    case "missing-prerequisite": return "Missing foundation";
    default: return "Available";
  }
}
