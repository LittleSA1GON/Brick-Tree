import { z } from "zod";
import { AgentRuntime } from "@/lib/agents/runtime";
import { createAgentRegistry } from "@/lib/agents";
import { createToolRegistry } from "@/lib/tools";
import { TraceCollector } from "@/lib/observability/trace";
import { getEnv } from "@/lib/config/env";
import {
  type ConceptDecomposition,
  type ConceptEdge,
  type ConceptNode,
  type DifficultyAssessment,
  type EvidenceReference,
  type GraphContext,
  type GraphLevelDescriptor,
  type KnowledgeOrigin,
  type ResourceLink,
} from "@/lib/schemas/concept";
import type { LearnerProfile, LearningPathProposal } from "@/lib/schemas/learning-path";
import type { PedagogyValidation } from "@/lib/schemas/validation";
import type { ExtractedDocument } from "@/lib/schemas/documents";
import type { BrickIntent, SourceMode, TreeIntent } from "@/lib/schemas/session";
import {
  difficultyConsistencyIssues,
  difficultyLabel,
  levelFromDifficulties,
  suggestedNextLevel,
} from "@/lib/graph/levels";
import { conceptId, edgeId } from "@/lib/graph/graph-utils";
import { normalizeConceptTitle } from "@/lib/utils/text";
import { LLMConfigurationError } from "@/lib/llm/provider";
import { createLLMProvider } from "@/lib/llm/factory";
import { AdaptiveExplanationSchema, ExplanationLevelSchema, type AdaptiveExplanation, type ExplanationLevel, type ExplanationNodeContext } from "@/lib/schemas/api";
import type { RawSearchResult, ResourceCandidate, ResourceNodeContext, ResourceQueryPlan, ResourceSelection } from "@/lib/schemas/resources";
import type { RetrievedChunk } from "@/lib/schemas/documents";
import { evidenceCoverageFindings, verifiedEvidenceReferences } from "@/lib/documents/provenance";
import { learnerFitIssues } from "@/lib/learning/learner-fit";
import { buildResourceStrategy, resourceTypeFit, type ResourceStrategy } from "@/lib/agents/resource-strategy";

const agents = createAgentRegistry();
const tools = createToolRegistry();
const runtime = new AgentRuntime(agents, tools);

const RESOURCE_CACHE_TTL_MS = 20 * 60 * 1000;
const RESOURCE_CACHE_LIMIT = 200;
const resourceCache = new Map<string, { expiresAt: number; resources: ResourceLink[] }>();

function resourceCacheKey(node: ResourceNodeContext, profile: LearnerProfile | undefined, strategy: ResourceStrategy, mode: string): string {
  return JSON.stringify({
    title: normalizeConceptTitle(node.title),
    description: normalizeConceptTitle(node.shortDescription).slice(0, 180),
    difficulty: node.difficulty,
    intent: strategy.intent,
    targetTypes: strategy.targetTypes,
    maxPapers: strategy.maxPapers,
    educationLevel: profile?.educationLevel ?? "high-school",
    knowledgeLevel: profile?.knowledgeLevel ?? "beginner",
    purpose: profile?.purpose ?? "general-learning",
    exploreBias: profile?.exploreBias ?? "balanced",
    depthPreference: profile?.depthPreference ?? "balanced",
    languageStyle: profile?.languageStyle ?? "standard",
    preferredResourceTypes: (profile?.preferredResourceTypes ?? []).slice(0, 6).map((value) => value.toLowerCase()).sort(),
    preferredExamples: (profile?.preferredExamples ?? []).slice(0, 4).map((value) => value.toLowerCase()).sort(),
    goal: (profile?.learningGoal ?? profile?.goal ?? "").slice(0, 240).toLowerCase(),
    mode,
  });
}

function cacheResources(key: string, resources: ResourceLink[]): void {
  if (!resources.length) return;
  if (resourceCache.size >= RESOURCE_CACHE_LIMIT) {
    const oldest = resourceCache.keys().next().value as string | undefined;
    if (oldest) resourceCache.delete(oldest);
  }
  resourceCache.set(key, { expiresAt: Date.now() + RESOURCE_CACHE_TTL_MS, resources });
}

export type WorkflowEnvelope<T> = {
  data: T;
  trace: ReturnType<TraceCollector["list"]>;
  warnings: string[];
};

function existingLevel(
  context: GraphContext | undefined,
  axis: "depth" | "height",
  index: number,
): GraphLevelDescriptor | undefined {
  return context?.levels.find((item) => item.axis === axis && item.index === index);
}

function normalizedAssessment(assessment: DifficultyAssessment): DifficultyAssessment {
  return { ...assessment, difficultyLabel: difficultyLabel(assessment.difficulty) };
}

function normalizedKnown(profile?: LearnerProfile, additional: string[] = []): Set<string> {
  return new Set(
    [...(profile?.existingKnowledge ?? []), ...additional]
      .map(normalizeConceptTitle)
      .filter(Boolean),
  );
}

function sourceMode(profile?: LearnerProfile): SourceMode {
  return profile?.sourceMode ?? "general";
}

function treeRelationship(intent: TreeIntent): ConceptEdge["relationshipType"] {
  if (intent === "decompose") return "contains";
  if (intent === "analyze-question") return "examines";
  return "prerequisite";
}

function treeValidationKind(intent: TreeIntent): "decomposition" | "prerequisite-trace" | "question-analysis" {
  if (intent === "decompose") return "decomposition";
  if (intent === "analyze-question") return "question-analysis";
  return "prerequisite-trace";
}

function treeQuery(intent: TreeIntent, topic: string): string {
  if (intent === "decompose") return `${topic} major concepts components structure`;
  if (intent === "analyze-question") return `${topic} stakeholders changes causes contexts actions risks tradeoffs evidence`;
  return `${topic} prerequisites foundations concepts to understand first`;
}

function evidenceOrigins(evidence: EvidenceReference[]): KnowledgeOrigin[] {
  if (!evidence.length) return [{ type: "model-knowledge" }];
  const grouped = new Map<string, EvidenceReference[]>();
  for (const ref of evidence) {
    const items = grouped.get(ref.documentId) ?? [];
    items.push(ref);
    grouped.set(ref.documentId, items);
  }
  return [...grouped.entries()].map(([documentId, refs]) => ({
    type: "uploaded-source" as const,
    documentId,
    evidence: refs,
  }));
}

function rootNode(
  title: string,
  axis: "depth" | "height",
  description: string,
  assessment: DifficultyAssessment,
  knowledgeStatus: ConceptNode["knowledgeStatus"] = "available",
  levelNarrative?: { description: string; peerRule: string },
): ConceptNode {
  const normalized = normalizedAssessment(assessment);
  const baseLevel = levelFromDifficulties(axis, 0, [normalized.difficulty]);
  const level: GraphLevelDescriptor = levelNarrative
    ? { ...baseLevel, description: levelNarrative.description.slice(0, 420), peerRule: levelNarrative.peerRule.slice(0, 420) }
    : baseLevel;
  return {
    id: conceptId(undefined, title),
    title,
    normalizedTitle: normalizeConceptTitle(title),
    shortDescription: description,
    childIds: [],
    depth: 0,
    level,
    difficulty: normalized.difficulty,
    difficultyLabel: normalized.difficultyLabel,
    difficultyExplanation: normalized.difficultyExplanation,
    difficultyFactors: normalized.difficultyFactors,
    prerequisites: [],
    learningOutcomes: [],
    applications: [],
    examples: [],
    whyItMatters: description,
    whatItUnlocks: [],
    confidence: 1,
    status: "validated",
    knowledgeStatus,
    resources: [],
    origins: [{ type: "model-knowledge" }],
  };
}


const BRICK_MAX_ROW_SIZE = 10;

function truncateLevelText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 420);
}

function narrateLevel(
  level: GraphLevelDescriptor,
  description: string,
  peerRule: string,
): GraphLevelDescriptor {
  return {
    ...level,
    description: truncateLevelText(description),
    peerRule: truncateLevelText(peerRule),
  };
}

function brickKnownTitles(
  knownConcepts: string[],
  proposal: LearningPathProposal,
  preferParsed = false,
): string[] {
  const source = preferParsed && proposal.parsedFoundations.length
    ? proposal.parsedFoundations
    : knownConcepts;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of source) {
    if (typeof value !== "string") continue;
    const title = value.trim();
    const key = normalizeConceptTitle(title);
    if (!title || !key || seen.has(key)) continue;
    seen.add(key);
    unique.push(title);
    if (unique.length >= BRICK_MAX_ROW_SIZE - 1) break;
  }
  return unique;
}

function brickFoundationTitles(
  knownConcepts: string[],
  proposal: LearningPathProposal,
  preferParsed = false,
): string[] {
  const supplied = brickKnownTitles(knownConcepts, proposal, preferParsed);
  const suppliedKeys = new Set(supplied.map(normalizeConceptTitle));
  const roomForSuggestions = Math.max(
    0,
    BRICK_MAX_ROW_SIZE - 1 - supplied.length,
  );
  const suggestions = proposal.foundationSuggestions
    .map((value) => value.trim())
    .filter(
      (value) => value && !suppliedKeys.has(normalizeConceptTitle(value)),
    )
    .slice(0, roomForSuggestions);

  return [...supplied, ...suggestions];
}

function desiredBrickRowSize(lowerRowCount: number): number {
  return Math.max(
    2,
    Math.min(BRICK_MAX_ROW_SIZE, lowerRowCount + 1),
  );
}

function addBrickStackShapeChecks(
  validation: PedagogyValidation,
  lowerRowCount: number,
  upperRowCount: number,
): PedagogyValidation {
  const expected = desiredBrickRowSize(lowerRowCount);
  if (upperRowCount === expected) return validation;
  const message = `Brick layers must stack instead of branch: a row with ${lowerRowCount} brick${lowerRowCount === 1 ? "" : "s"} should produce ${expected} bricks in the next row, but ${upperRowCount} were returned.`;
  return {
    ...validation,
    valid: false,
    recommendedRevision: true,
    coverageAssessment: `${validation.coverageAssessment} Stack-shape check: ${message}`,
    issues: [
      ...validation.issues,
      { type: "coverage_gap" as const, message },
    ].slice(0, 12),
  };
}

type BrickLayerNode = Pick<ConceptNode, "id" | "title" | "normalizedTitle" | "difficulty">;

function addBrickNoveltyChecks(
  validation: PedagogyValidation,
  directionTitles: string[],
  existingTitles: string[],
): PedagogyValidation {
  const existing = new Set(existingTitles.map(normalizeConceptTitle));
  const repeats = directionTitles.filter((title) => existing.has(normalizeConceptTitle(title)));
  if (!repeats.length) return validation;
  const message = `A new Brick row must add new knowledge instead of repeating bricks already in the stack: ${[...new Set(repeats)].join(", ")}.`;
  return {
    ...validation,
    valid: false,
    recommendedRevision: true,
    coverageAssessment: `${validation.coverageAssessment} Novelty check: ${message}`,
    issues: [
      ...validation.issues,
      { type: "duplicate" as const, message, affectedTitles: [...new Set(repeats)] },
    ].slice(0, 12),
  };
}

function orderDirectionsForBrickStack(
  directions: LearningPathProposal["directions"],
  lowerNodes: BrickLayerNode[],
): LearningPathProposal["directions"] {
  const lowerIndex = new Map(lowerNodes.map((node, index) => [node.normalizedTitle, index]));
  return directions
    .map((direction, originalIndex) => {
      const anchors = (direction.connectsFrom ?? [])
        .map((title) => lowerIndex.get(normalizeConceptTitle(title)))
        .filter((value): value is number => value !== undefined);
      const anchor = anchors.length
        ? anchors.reduce((sum, value) => sum + value, 0) / anchors.length
        : originalIndex * Math.max(1, lowerNodes.length - 1) / Math.max(1, directions.length - 1);
      return { direction, originalIndex, anchor };
    })
    .sort((a, b) => a.anchor - b.anchor || a.originalIndex - b.originalIndex)
    .map((item) => item.direction);
}

function brickSupportNodes(
  lowerNodes: BrickLayerNode[],
  upperIndex: number,
  upperCount: number,
  connectsFrom: string[],
): BrickLayerNode[] {
  if (!lowerNodes.length) return [];
  if (lowerNodes.length === 1) return [lowerNodes[0]];

  const position = upperCount <= 1
    ? 0
    : upperIndex * (lowerNodes.length - 1) / (upperCount - 1);
  const leftIndex = Math.max(0, Math.min(lowerNodes.length - 1, Math.floor(position)));
  const rightIndex = Math.max(0, Math.min(lowerNodes.length - 1, Math.ceil(position)));
  const local = [...new Set([leftIndex, rightIndex])].map((index) => lowerNodes[index]);
  const requested = new Set(connectsFrom.map(normalizeConceptTitle));
  const matched = local.filter((node) => requested.has(node.normalizedTitle));
  return matched.length ? matched : local;
}

function brickStackEdges(
  lowerNodes: BrickLayerNode[],
  upperNodes: ConceptNode[],
  directions: LearningPathProposal["directions"],
): ConceptEdge[] {
  const edges: ConceptEdge[] = [];
  upperNodes.forEach((node, index) => {
    const direction = directions[index];
    const supports = brickSupportNodes(
      lowerNodes,
      index,
      upperNodes.length,
      direction?.connectsFrom ?? [],
    );
    for (const source of supports) {
      edges.push({
        id: edgeId(source.id, node.id, "leads-to"),
        source: source.id,
        target: node.id,
        relationshipType: "leads-to",
        label: "supports",
        confidence: direction?.confidence,
      });
    }
  });
  return edges;
}

function childrenFromDecomposition(
  parent: ConceptNode,
  level: GraphLevelDescriptor,
  decomposition: ConceptDecomposition,
  validated: boolean,
  intent: TreeIntent,
  profile?: LearnerProfile,
  graphContext?: GraphContext,
  retrievedEvidence: RetrievedChunk[] = [],
): { nodes: ConceptNode[]; edges: ConceptEdge[] } {
  const seen = new Set<string>();
  const known = normalizedKnown(profile);
  const existingByTitle = new Map<string, { id: string; knowledgeStatus: ConceptNode["knowledgeStatus"] }>(
    (graphContext?.nodes ?? []).map((node) => [node.normalizedTitle, { id: node.id, knowledgeStatus: node.knowledgeStatus }]),
  );
  const nodes: ConceptNode[] = [];
  const edges: ConceptEdge[] = [];
  for (const child of decomposition.children) {
    const normalizedTitle = normalizeConceptTitle(child.title);
    if (!normalizedTitle || seen.has(normalizedTitle)) continue;
    seen.add(normalizedTitle);
    const existing = existingByTitle.get(normalizedTitle);
    const id = existing?.id ?? conceptId(parent.id, child.title);
    if (id === parent.id) continue;
    const isKnown = known.has(normalizedTitle) || existing?.knowledgeStatus === "known";
    const knowledgeStatus: ConceptNode["knowledgeStatus"] = isKnown
      ? "known"
      : intent === "trace-prerequisites"
        ? "missing-prerequisite"
        : "available";
    if (!existing) nodes.push({
      id,
      title: child.title.trim(),
      normalizedTitle,
      shortDescription: child.description,
      parentId: parent.id,
      childIds: [],
      depth: parent.depth + 1,
      level,
      difficulty: child.difficulty,
      difficultyLabel: difficultyLabel(child.difficulty),
      difficultyExplanation: child.difficultyExplanation,
      difficultyFactors: child.difficultyFactors,
      prerequisites: child.prerequisites,
      learningOutcomes: child.learningOutcomes,
      applications: child.applications,
      examples: child.examples,
      whyItMatters: child.whyItMatters,
      whatItUnlocks: child.whatItUnlocks,
      estimatedLearningTime: child.estimatedLearningTime,
      confidence: child.confidence,
      status: validated ? "validated" : "needs-review",
      knowledgeStatus,
      resources: [],
      origins: evidenceOrigins(verifiedEvidenceReferences(child.evidence ?? [], retrievedEvidence)),
    });
    const relationshipType = treeRelationship(intent);
    edges.push({
      id: edgeId(parent.id, id, relationshipType),
      source: parent.id,
      target: id,
      relationshipType,
      label: intent === "trace-prerequisites" ? "understand first" : intent === "analyze-question" ? "examine" : undefined,
      confidence: child.confidence,
    });
  }
  return { nodes, edges };
}

function addDeterministicDifficultyChecks(
  validation: PedagogyValidation,
  scores: number[],
  expectedLevel?: GraphLevelDescriptor,
): PedagogyValidation {
  const issues = difficultyConsistencyIssues(scores, expectedLevel);
  if (!issues.length) return validation;
  return {
    ...validation,
    valid: false,
    difficultyConsistency: false,
    difficultyAssessment: `${validation.difficultyAssessment} Deterministic check: ${issues.join(" ")}`,
    recommendedRevision: true,
    issues: [
      ...validation.issues,
      ...issues.map((message) => ({ type: "difficulty_mismatch" as const, message })),
    ].slice(0, 12),
  };
}

function addDeterministicTitleChecks(
  validation: PedagogyValidation,
  titles: string[],
  parentTitle?: string,
): PedagogyValidation {
  const normalized = titles.map(normalizeConceptTitle).filter(Boolean);
  const counts = new Map<string, number>();
  for (const title of normalized) counts.set(title, (counts.get(title) ?? 0) + 1);
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([title]) => title);
  const parentKey = parentTitle ? normalizeConceptTitle(parentTitle) : undefined;
  const repeatsParent = parentKey ? normalized.filter((title) => title === parentKey) : [];
  const uniqueChildren = new Set(normalized.filter((title) => !parentKey || title !== parentKey));

  const issues: PedagogyValidation["issues"] = [];
  if (duplicates.length) {
    issues.push({
      type: "duplicate",
      message: `Duplicate concept proposals are not allowed on one layer: ${duplicates.join(", ")}.`,
      affectedTitles: duplicates,
    });
  }
  if (repeatsParent.length) {
    issues.push({
      type: "duplicate",
      message: "A child concept cannot simply repeat the parent concept.",
      affectedTitles: parentTitle ? [parentTitle] : undefined,
    });
  }
  if (uniqueChildren.size < 3) {
    issues.push({
      type: "coverage_gap",
      message: `Only ${uniqueChildren.size} unique usable concept${uniqueChildren.size === 1 ? "" : "s"} remain after normalization; a layer needs at least three.`,
    });
  }
  if (!issues.length) return validation;
  return {
    ...validation,
    valid: false,
    recommendedRevision: true,
    issues: [...validation.issues, ...issues].slice(0, 12),
    coverageAssessment: `${validation.coverageAssessment} Deterministic graph checks found duplicate/self-repeating or insufficient unique concepts.`,
  };
}


function deterministicValidationBaseline(label: string): PedagogyValidation {
  return {
    valid: true,
    difficultyConsistency: true,
    sourceFidelity: true,
    difficultyAssessment: `${label} passed deterministic difficulty checks.`,
    coverageAssessment: `${label} passed deterministic coverage checks.`,
    sourceAssessment: "No unsupported source references were detected.",
    issues: [],
    recommendedRevision: false,
  };
}

function addAdjacentStepChecks(
  validation: PedagogyValidation,
  parentDifficulty: number,
  scores: number[],
  direction: "tree" | "brick",
): PedagogyValidation {
  const issues = scores.flatMap((score, index) => {
    const tooFar = Math.abs(score - parentDifficulty) > 1;
    const brickMovesBackward = direction === "brick" && score < parentDifficulty;
    if (!tooFar && !brickMovesBackward) return [];
    const message = direction === "tree"
      ? `Child ${index + 1} is too large a conceptual jump from its parent; adjacent Tree layers must stay within one difficulty step.`
      : `Brick ${index + 1} is not a reasonable one-layer construction step from its foundation; adjacent Brick layers must stay at the same difficulty or move up by one.`;
    return [message];
  });

  if (!issues.length) return validation;
  return {
    ...validation,
    valid: false,
    difficultyConsistency: false,
    recommendedRevision: true,
    difficultyAssessment: `${validation.difficultyAssessment} Adjacent-layer check: ${issues.join(" ")}`,
    issues: [
      ...validation.issues,
      ...issues.map((message) => ({ type: "difficulty_mismatch" as const, message })),
    ].slice(0, 12),
  };
}


function addLearnerFitChecks(
  validation: PedagogyValidation,
  proposal: LearningPathProposal,
  profile: LearnerProfile | undefined,
  intent: BrickIntent,
): PedagogyValidation {
  const findings = learnerFitIssues(profile, proposal.directions, intent);
  if (!findings.length) return validation;
  return {
    ...validation,
    valid: false,
    recommendedRevision: true,
    coverageAssessment: `${validation.coverageAssessment} Learner-fit check: ${findings.map((finding) => finding.message).join(" ")}`,
    issues: [
      ...validation.issues,
      ...findings.map((finding) => ({
        type: "learner_mismatch" as const,
        message: finding.message,
        affectedTitles: [finding.title],
      })),
    ].slice(0, 12),
  };
}


function addDestinationHeightChecks(
  validation: PedagogyValidation,
  proposal: LearningPathProposal,
  intent: BrickIntent,
  minimumHeight: number,
): PedagogyValidation {
  if (intent !== "destination") return validation;

  const height = proposal.estimatedDestinationHeight;
  const issues: string[] = [];
  if (height === undefined) {
    issues.push("Destination mode must estimate the destination height from the original Height 0 foundation.");
  } else if (height < minimumHeight) {
    issues.push(`Destination height +${height} cannot sit below the current construction layer +${minimumHeight}.`);
  }
  if (!proposal.destinationHeightReason?.trim()) {
    issues.push("Destination mode must briefly explain why the destination is estimated at that height.");
  }

  if (!issues.length) return validation;
  return {
    ...validation,
    valid: false,
    recommendedRevision: true,
    coverageAssessment: `${validation.coverageAssessment} Destination-height check: ${issues.join(" ")}`,
    issues: [
      ...validation.issues,
      ...issues.map((message) => ({ type: "coverage_gap" as const, message })),
    ].slice(0, 12),
  };
}

function addDeterministicSourceChecks(
  validation: PedagogyValidation,
  groups: Array<{ title: string; evidence: EvidenceReference[] }>,
  chunks: RetrievedChunk[],
  mode: SourceMode,
): PedagogyValidation {
  if (mode === "general") return validation;
  const findings = evidenceCoverageFindings(groups, chunks, mode === "uploaded-only");
  if (!findings.length) return validation;
  return {
    ...validation,
    valid: false,
    sourceFidelity: false,
    sourceAssessment: `${validation.sourceAssessment} Deterministic provenance check found unsupported or mismatched evidence references.`,
    recommendedRevision: true,
    issues: [
      ...validation.issues,
      ...findings.map((finding) => ({
        type: finding.type,
        message: finding.message,
        affectedTitles: [finding.title],
      })),
    ].slice(0, 12),
  };
}

async function sourceEvidence(input: {
  agentName: "concept_architect" | "learning_path";
  query: string;
  trace: TraceCollector;
  profile?: LearnerProfile;
  documents?: ExtractedDocument[];
}): Promise<RetrievedChunk[]> {
  const mode = sourceMode(input.profile);
  if (mode === "general") return [];
  const chunks: RetrievedChunk[] = [];

  const selectedDocumentIds = new Set(input.profile?.sourceDocumentIds ?? []);
  const selectedDocuments = (input.documents ?? []).filter((document) => {
    // With no learner profile, supplied documents are assumed intentional. Once
    // a profile exists, an empty selection means the learner explicitly has no
    // uploaded source enabled for grounding.
    if (!input.profile) return true;
    return selectedDocumentIds.has(document.id);
  });

  if (selectedDocuments.length) {
    try {
      chunks.push(
        ...((await runtime.executeTool(
          input.agentName,
          "search_uploaded_documents",
          { query: input.query, topK: 6 },
          input.trace,
          { documents: selectedDocuments },
        )) as RetrievedChunk[]),
      );
    } catch (error) {
      input.trace.add("error", `Uploaded-source retrieval failed: ${error instanceof Error ? error.message : String(error)}`, {
        agent: input.agentName,
      });
    }
  }

  if (mode !== "uploaded-only" && getEnv().LOCAL_RAG_BASE_URL) {
    try {
      chunks.push(
        ...((await runtime.executeTool(
          input.agentName,
          "search_knowledge_base",
          { query: input.query, topK: 5 },
          input.trace,
        )) as RetrievedChunk[]),
      );
    } catch (error) {
      input.trace.add("error", `Configured knowledge retrieval failed: ${error instanceof Error ? error.message : String(error)}`, {
        agent: input.agentName,
      });
    }
  }

  const unique = new Map<string, RetrievedChunk>();
  for (const chunk of chunks) unique.set(chunk.id, chunk);
  return [...unique.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 8);
}

export async function navigateTree(input: {
  intent: TreeIntent;
  topic: string;
  parentNode?: ConceptNode;
  graphContext?: GraphContext;
  learnerProfile?: LearnerProfile;
  documents?: ExtractedDocument[];
}): Promise<WorkflowEnvelope<{
  root?: ConceptNode;
  parent: ConceptNode;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  level: GraphLevelDescriptor;
  validation?: PedagogyValidation;
  summary: string;
  stoppedAtKnown?: boolean;
}>> {
  const trace = new TraceCollector();
  const warnings: string[] = [];
  const known = normalizedKnown(input.learnerProfile);

  if (input.intent === "trace-prerequisites" && input.parentNode && known.has(input.parentNode.normalizedTitle)) {
    trace.add("agent_finish", `${input.parentNode.title} is already marked as understood, so root tracing stopped here.`, {
      agent: "concept_architect",
    });
    return {
      data: {
        parent: { ...input.parentNode, knowledgeStatus: "known" },
        nodes: [],
        edges: [],
        level: input.parentNode.level,
        summary: `You already understand ${input.parentNode.title}. Brick Tree can build upward from this known brick instead of tracing further down.`,
        stoppedAtKnown: true,
      },
      trace: trace.list(),
      warnings,
    };
  }

  if (sourceMode(input.learnerProfile) === "uploaded-only" && !input.documents?.length) {
    throw new Error("Uploaded Only mode requires at least one uploaded document.");
  }

  const childIndex = (input.parentNode?.depth ?? 0) + 1;
  const targetLevel = existingLevel(input.graphContext, "depth", childIndex) ?? (
    input.parentNode
      ? input.intent === "analyze-question"
        ? levelFromDifficulties("depth", childIndex, [input.parentNode.difficulty])
        : suggestedNextLevel("depth", childIndex, input.parentNode.difficulty)
      : undefined
  );
  const retrievedEvidence = await sourceEvidence({
    agentName: "concept_architect",
    query: treeQuery(input.intent, input.topic),
    trace,
    profile: input.learnerProfile,
    documents: input.documents,
  });

  if (sourceMode(input.learnerProfile) === "uploaded-only" && !retrievedEvidence.length) {
    throw new Error("No relevant evidence was found in the uploaded-only sources for this concept.");
  }

  let revisionFeedback: string[] = [];
  let finalValidation: PedagogyValidation | undefined;
  let finalDecomposition: ConceptDecomposition | undefined;
  let finalNodes: ConceptNode[] = [];
  let finalEdges: ConceptEdge[] = [];
  let finalLevel: GraphLevelDescriptor | undefined;
  let parent: ConceptNode | undefined = input.parentNode;

  for (let revision = 0; revision <= getEnv().AGENT_MAX_REVISIONS; revision += 1) {
    const architect = await runtime.run<any, ConceptDecomposition>(
      "concept_architect",
      {
        topic: input.topic,
        parentTitle: input.parentNode?.title ?? input.topic,
        intent: input.intent,
        parentDifficulty: input.parentNode?.difficulty,
        targetLevel,
        learnerProfile: input.learnerProfile,
        graphContext: input.graphContext,
        sourceMode: sourceMode(input.learnerProfile),
        retrievedEvidence,
        revisionFeedback,
      },
      trace,
    );
    finalDecomposition = architect.data;

    if (!parent) {
      const parentKnown = known.has(normalizeConceptTitle(input.topic));
      parent = rootNode(
        input.topic,
        "depth",
        finalDecomposition.summary,
        finalDecomposition.parentAssessment,
        parentKnown ? "known" : "available",
        {
          description: `Depth 0 is the learner-specific baseline for ${input.topic}. ${finalDecomposition.parentAssessment.difficultyExplanation}`,
          peerRule: `This Tree has one root at Depth 0. The agent assessed ${input.topic} at ${finalDecomposition.parentAssessment.difficulty}/5 (${finalDecomposition.parentAssessment.difficultyLabel}), which becomes the reference point for every later cut in this workspace.`,
        },
      );
    }

    const candidateScores = finalDecomposition.children.map((child) => child.difficulty);
    const baseLevel = targetLevel ?? levelFromDifficulties("depth", childIndex, candidateScores);
    finalLevel = narrateLevel(
      baseLevel,
      finalDecomposition.levelNarrative.previousLevelComparison,
      finalDecomposition.levelNarrative.sameLevelReason,
    );

    let validationBase = deterministicValidationBaseline("Tree branch");
    if (getEnv().PEDAGOGY_VALIDATION_MODE === "llm") {
      runtime.handoff(
        "concept_architect",
        "pedagogy_validator",
        trace,
        {
          summary: `Concept Architect handed a ${input.intent === "decompose" ? "component" : input.intent === "analyze-question" ? "question-lens" : "prerequisite"} layer to Pedagogy Validator.`,
          context: {
            intent: input.intent,
            parentTitle: parent.title,
            candidateTitles: finalDecomposition.children.map((child) => child.title),
            expectedLevel: finalLevel,
            learnerProfile: input.learnerProfile ?? null,
          },
        },
      );
      const validator = await runtime.run<any, PedagogyValidation>(
        "pedagogy_validator",
        {
          kind: treeValidationKind(input.intent),
          expectedLevel: finalLevel,
          candidate: finalDecomposition,
          learnerContext: input.learnerProfile,
          sourceMode: sourceMode(input.learnerProfile),
          retrievedEvidence,
        },
        trace,
      );
      validationBase = validator.data;
    }
    finalValidation = addAdjacentStepChecks(
      addDeterministicTitleChecks(
        addDeterministicSourceChecks(
          addDeterministicDifficultyChecks(validationBase, candidateScores, finalLevel),
          finalDecomposition.children.map((child) => ({ title: child.title, evidence: child.evidence ?? [] })),
          retrievedEvidence,
          sourceMode(input.learnerProfile),
        ),
        finalDecomposition.children.map((child) => child.title),
        parent.title,
      ),
      parent.difficulty,
      candidateScores,
      "tree",
    );

    trace.add("validation", finalValidation.difficultyAssessment, {
      agent: "pedagogy_validator",
      metadata: {
        valid: finalValidation.valid,
        difficultyConsistency: finalValidation.difficultyConsistency,
        sourceFidelity: finalValidation.sourceFidelity,
      },
    });

    const mapped = childrenFromDecomposition(
      parent,
      finalLevel,
      finalDecomposition,
      finalValidation.valid && finalValidation.difficultyConsistency && finalValidation.sourceFidelity,
      input.intent,
      input.learnerProfile,
      input.graphContext,
      retrievedEvidence,
    );
    finalNodes = mapped.nodes;
    finalEdges = mapped.edges;

    const reusedTargets = finalEdges
      .map((edge) => input.graphContext?.nodes.find((node) => node.id === edge.target))
      .filter((node): node is NonNullable<typeof node> => Boolean(node));
    if (reusedTargets.length) {
      trace.add("validation", `Reused ${reusedTargets.length} existing concept${reusedTargets.length === 1 ? "" : "s"} instead of duplicating graph nodes.`, {
        agent: "pedagogy_validator",
        metadata: { titles: reusedTargets.map((node) => node.title) },
      });
      const reuseIssues = difficultyConsistencyIssues(
        [...finalNodes.map((node) => node.difficulty), ...reusedTargets.map((node) => node.difficulty)],
        finalLevel,
      );
      if (reuseIssues.length) {
        finalValidation = {
          ...finalValidation,
          valid: false,
          difficultyConsistency: false,
          recommendedRevision: true,
          issues: [
            ...finalValidation.issues,
            ...reuseIssues.map((message) => ({ type: "difficulty_mismatch" as const, message })),
          ].slice(0, 12),
        };
      }
    }

    if (finalValidation.valid && finalValidation.difficultyConsistency && finalValidation.sourceFidelity) break;
    if (revision >= getEnv().AGENT_MAX_REVISIONS || !finalValidation.recommendedRevision) break;

    revisionFeedback = finalValidation.issues.map((issue) => issue.message);
    runtime.handoff(
      "pedagogy_validator",
      "concept_architect",
      trace,
      {
        summary: "Pedagogy Validator requested a bounded revision for conceptual, source, or difficulty consistency.",
        context: {
          issues: finalValidation.issues,
          expectedLevel: finalLevel,
          revision: revision + 1,
        },
      },
    );
    trace.add("revision", `Revision cycle ${revision + 1}: ${revisionFeedback.join(" | ")}`, {
      agent: "concept_architect",
    });
  }

  if (!parent || !finalValidation || !finalDecomposition || !finalLevel) {
    throw new Error("Concept workflow did not complete.");
  }

  const validated = finalValidation.valid && finalValidation.difficultyConsistency && finalValidation.sourceFidelity;
  if (!validated) {
    warnings.push("This branch could not be fully validated after the bounded revision cycle, so it is marked needs review.");
  }
  finalNodes = finalNodes.map((node) => ({ ...node, status: validated ? "validated" : "needs-review" }));

  const updatedParent = { ...parent, childIds: [...new Set(finalEdges.map((edge) => edge.target))] };
  const knownChildren = finalEdges.flatMap((edge) => {
    const node = finalNodes.find((item) => item.id === edge.target)
      ?? input.graphContext?.nodes.find((item) => item.id === edge.target);
    return node?.knowledgeStatus === "known" ? [node] : [];
  });
  const summary = input.intent === "trace-prerequisites" && knownChildren.length
    ? `${finalDecomposition.summary} Known stopping point${knownChildren.length === 1 ? "" : "s"}: ${knownChildren.map((node) => node.title).join(", ")}.`
    : finalDecomposition.summary;

  return {
    data: {
      root: input.parentNode ? undefined : updatedParent,
      parent: updatedParent,
      nodes: finalNodes,
      edges: finalEdges,
      level: finalLevel,
      validation: finalValidation,
      summary,
    },
    trace: trace.list(),
    warnings,
  };
}

function foundationNodesFromLearningPath(
  root: ConceptNode,
  knownConcepts: string[],
  proposal: LearningPathProposal,
  preferParsed = false,
): ConceptNode[] {
  const titles = brickFoundationTitles(knownConcepts, proposal, preferParsed);
  const suppliedKeys = new Set(
    brickKnownTitles(knownConcepts, proposal, preferParsed).map((value) => normalizeConceptTitle(value)).filter(Boolean),
  );
  const level = root.level;

  return titles.map((title) => {
    const isSupplied = suppliedKeys.has(normalizeConceptTitle(title));
    return {
      id: conceptId(root.id, `foundation:${title}`),
      title,
      normalizedTitle: normalizeConceptTitle(title),
      shortDescription: isSupplied
        ? "A foundation you told Brick Tree you already understand."
        : "A nearby foundation Brick Tree suggests adding before constructing higher.",
      parentId: root.id,
      childIds: [],
      depth: 0,
      level,
      difficulty: proposal.foundationAssessment.difficulty,
      difficultyLabel: difficultyLabel(proposal.foundationAssessment.difficulty),
      difficultyExplanation: proposal.foundationAssessment.difficultyExplanation,
      difficultyFactors: proposal.foundationAssessment.difficultyFactors,
      prerequisites: [],
      learningOutcomes: [],
      applications: [],
      examples: [],
      whyItMatters: isSupplied
        ? "This brick is part of the learner's stated starting foundation."
        : "Adding this missing foundation keeps the next layer to one reasonable learning step.",
      whatItUnlocks: [],
      confidence: 1,
      status: "validated",
      knowledgeStatus: isSupplied ? "known" : "missing-prerequisite",
      resources: [],
      origins: [{ type: "model-knowledge" as const }],
    } satisfies ConceptNode;
  });
}

function candidateNodesFromLearningPath(
  root: ConceptNode,
  foundations: ConceptNode[],
  proposal: LearningPathProposal,
  level: GraphLevelDescriptor,
  validated: boolean,
  retrievedEvidence: RetrievedChunk[] = [],
): { nodes: ConceptNode[]; edges: ConceptEdge[] } {
  const orderedDirections = orderDirectionsForBrickStack(proposal.directions, foundations);
  const directions = orderedDirections.map((direction, index) => {
    const id = conceptId(root.id, direction.title);
    const knowledgeStatus: ConceptNode["knowledgeStatus"] = direction.title === proposal.recommendedTitle
      ? "recommended"
      : direction.missingPrerequisites.length === 0 || direction.readinessScore >= 70
        ? "available"
        : "future";
    const supports = brickSupportNodes(
      foundations,
      index,
      orderedDirections.length,
      direction.connectsFrom ?? [],
    );
    return {
      id,
      title: direction.title,
      normalizedTitle: normalizeConceptTitle(direction.title),
      parentId: supports[0]?.id ?? root.id,
      childIds: [],
      depth: 1,
      level,
      shortDescription: direction.description,
      difficulty: direction.difficulty,
      difficultyLabel: difficultyLabel(direction.difficulty),
      difficultyExplanation: direction.difficultyExplanation,
      difficultyFactors: direction.difficultyFactors,
      prerequisites: [...direction.satisfiedPrerequisites, ...direction.missingPrerequisites],
      learningOutcomes: direction.unlocks,
      applications: direction.applications,
      examples: [],
      whyItMatters: direction.whyReachable,
      whatItUnlocks: direction.unlocks,
      estimatedLearningTime: direction.estimatedLearningTime,
      confidence: direction.confidence,
      status: validated ? "validated" : "needs-review",
      knowledgeStatus,
      resources: [],
      origins: evidenceOrigins(verifiedEvidenceReferences(direction.evidence ?? [], retrievedEvidence)),
    } satisfies ConceptNode;
  });

  const edges = brickStackEdges(foundations, directions, orderedDirections);
  const foundationsWithChildren = foundations.map((foundation) => ({
    ...foundation,
    childIds: [...new Set(edges.filter((edge) => edge.source === foundation.id).map((edge) => edge.target))],
  }));

  return { nodes: [...foundationsWithChildren, ...directions], edges };
}

export async function discoverLearningPath(input: {
  intent?: BrickIntent;
  knownConcepts: string[];
  rawKnowledgeInput?: string;
  goal?: string;
  learnerProfile?: LearnerProfile;
  documents?: ExtractedDocument[];
}): Promise<WorkflowEnvelope<{
  root: ConceptNode;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  level: GraphLevelDescriptor;
  learningPath: LearningPathProposal;
  validation: PedagogyValidation;
}>> {
  const intent = input.intent ?? (input.goal ? "destination" : "explore");
  const trace = new TraceCollector();
  const warnings: string[] = [];
  const retrievedEvidence = await sourceEvidence({
    agentName: "learning_path",
    query: `${input.rawKnowledgeInput?.slice(0, 2400) || input.knownConcepts.join(" ")} ${input.goal ?? ""} next learnable concepts prerequisites`,
    trace,
    profile: input.learnerProfile,
    documents: input.documents,
  });
  if (sourceMode(input.learnerProfile) === "uploaded-only" && !retrievedEvidence.length) {
    throw new Error("No relevant uploaded-source evidence was found for this Brick path.");
  }
  let revisionFeedback: string[] = [];
  let finalProposal: LearningPathProposal | undefined;
  let finalValidation: PedagogyValidation | undefined;
  let finalLevel: GraphLevelDescriptor | undefined;

  for (let revision = 0; revision <= getEnv().AGENT_MAX_REVISIONS; revision += 1) {
    const path = await runtime.run<any, LearningPathProposal>(
      "learning_path",
      {
        knownConcepts: input.knownConcepts,
        rawKnowledgeInput: input.rawKnowledgeInput,
        currentLayerTitles: input.rawKnowledgeInput?.trim() ? undefined : input.knownConcepts,
        intent,
        goal: input.goal,
        learnerProfile: input.learnerProfile,
        allowFoundationSuggestions: true,
        retrievedEvidence,
        revisionFeedback,
      },
      trace,
    );
    finalProposal = path.data;
    const scores = finalProposal.directions.map((direction) => direction.difficulty);
    const foundationTitles = brickFoundationTitles(input.knownConcepts, finalProposal, Boolean(input.rawKnowledgeInput?.trim()));
    const baseLevel = levelFromDifficulties("height", 1, scores);
    finalLevel = narrateLevel(
      baseLevel,
      finalProposal.levelNarrative.previousLevelComparison,
      finalProposal.levelNarrative.sameLevelReason,
    );

    let validationBase = deterministicValidationBaseline("Brick layer");
    if (getEnv().PEDAGOGY_VALIDATION_MODE === "llm") {
      runtime.handoff(
        "learning_path",
        "pedagogy_validator",
        trace,
        {
          summary: `Learning Path Agent handed a ${intent} next-brick layer to Pedagogy Validator.`,
          context: {
            intent,
            candidateTitles: finalProposal.directions.map((direction) => direction.title),
            expectedLevel: finalLevel,
            learnerProfile: input.learnerProfile ?? null,
          },
        },
      );
      const validator = await runtime.run<any, PedagogyValidation>(
        "pedagogy_validator",
        {
          kind: "learning-path",
          expectedLevel: finalLevel,
          candidate: finalProposal,
          learnerContext: { knownConcepts: input.knownConcepts, goal: input.goal, profile: input.learnerProfile },
          sourceMode: sourceMode(input.learnerProfile),
          retrievedEvidence,
        },
        trace,
      );
      validationBase = validator.data;
    }
    finalValidation = addDestinationHeightChecks(
      addBrickStackShapeChecks(
        addBrickNoveltyChecks(
          addLearnerFitChecks(
            addAdjacentStepChecks(
              addDeterministicTitleChecks(
                addDeterministicSourceChecks(
                  addDeterministicDifficultyChecks(validationBase, scores, finalLevel),
                  finalProposal.directions.map((direction) => ({ title: direction.title, evidence: direction.evidence ?? [] })),
                  retrievedEvidence,
                  sourceMode(input.learnerProfile),
                ),
                finalProposal.directions.map((direction) => direction.title),
              ),
              finalProposal.foundationAssessment.difficulty,
              scores,
              "brick",
            ),
            finalProposal,
            input.learnerProfile,
            intent,
          ),
          finalProposal.directions.map((direction) => direction.title),
          foundationTitles,
        ),
        foundationTitles.length,
        finalProposal.directions.length,
      ),
      finalProposal,
      intent,
      1,
    );
    trace.add("validation", finalValidation.difficultyAssessment, {
      agent: "pedagogy_validator",
      metadata: {
        valid: finalValidation.valid,
        difficultyConsistency: finalValidation.difficultyConsistency,
        sourceFidelity: finalValidation.sourceFidelity,
      },
    });

    if (finalValidation.valid && finalValidation.difficultyConsistency && finalValidation.sourceFidelity) break;
    if (revision >= getEnv().AGENT_MAX_REVISIONS || !finalValidation.recommendedRevision) break;
    revisionFeedback = finalValidation.issues.map((issue) => issue.message);
    runtime.handoff(
      "pedagogy_validator",
      "learning_path",
      trace,
      {
        summary: "Pedagogy Validator requested a revised same-height next-brick layer.",
        context: {
          issues: finalValidation.issues,
          expectedLevel: finalLevel,
          revision: revision + 1,
        },
      },
    );
    trace.add("revision", `Learning-path revision ${revision + 1}: ${revisionFeedback.join(" | ")}`, {
      agent: "learning_path",
    });
  }

  if (!finalProposal || !finalValidation || !finalLevel) throw new Error("Learning path workflow did not complete.");

  const finalFoundationTitles = brickFoundationTitles(input.knownConcepts, finalProposal, Boolean(input.rawKnowledgeInput?.trim()));
  const root = rootNode(
    "Your Foundations",
    "height",
    `Starting knowledge: ${finalFoundationTitles.join(", ")}.`,
    finalProposal.foundationAssessment,
    "known",
    {
      description: finalProposal.foundationLevelNarrative.previousLevelComparison,
      peerRule: finalProposal.foundationLevelNarrative.sameLevelReason,
    },
  );
  const validated = finalValidation.valid && finalValidation.difficultyConsistency && finalValidation.sourceFidelity;
  if (!validated) warnings.push("The recommendation set is marked needs review because validation did not fully pass.");
  const foundations = foundationNodesFromLearningPath(root, input.knownConcepts, finalProposal, Boolean(input.rawKnowledgeInput?.trim()));
  const mapped = candidateNodesFromLearningPath(root, foundations, finalProposal, finalLevel, validated, retrievedEvidence);

  return {
    data: {
      root: { ...root, childIds: foundations.map((node) => node.id) },
      nodes: mapped.nodes,
      edges: mapped.edges,
      level: finalLevel,
      learningPath: finalProposal,
      validation: finalValidation,
    },
    trace: trace.list(),
    warnings,
  };
}

export async function branchFromConcept(input: {
  intent?: BrickIntent;
  node: ConceptNode;
  graphContext: GraphContext;
  goal?: string;
  learnerProfile?: LearnerProfile;
  documents?: ExtractedDocument[];
}): Promise<WorkflowEnvelope<{
  parent: ConceptNode;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  level: GraphLevelDescriptor;
  learningPath: LearningPathProposal;
  validation: PedagogyValidation;
}>> {
  const intent = input.intent ?? (input.goal ? "destination" : "explore");
  const trace = new TraceCollector();
  const warnings: string[] = [];

  const currentHeight = input.graphContext.nodes.reduce(
    (value, node) => Math.max(value, node.depth),
    input.node.depth,
  );
  const currentLayer = input.graphContext.nodes
    .filter((node) => node.depth === currentHeight)
    .sort((a, b) => input.graphContext.nodes.indexOf(a) - input.graphContext.nodes.indexOf(b));
  const lowerLayer: BrickLayerNode[] = currentLayer.length
    ? currentLayer
    : [input.node];
  const nextHeight = currentHeight + 1;
  const representativeDifficulty = Math.max(
    1,
    Math.min(
      5,
      Math.round(
        lowerLayer.reduce((sum, node) => sum + node.difficulty, 0) /
          Math.max(1, lowerLayer.length),
      ),
    ),
  ) as ConceptNode["difficulty"];
  const baseTargetLevel =
    existingLevel(input.graphContext, "height", nextHeight) ??
    suggestedNextLevel("height", nextHeight, representativeDifficulty);
  const knownConcepts = lowerLayer.map((node) => node.title);
  const targetDirectionCount = desiredBrickRowSize(lowerLayer.length);

  const retrievedEvidence = await sourceEvidence({
    agentName: "learning_path",
    query: `${knownConcepts.join(" ")} ${input.goal ?? ""} next stacked concepts builds on unlocks`,
    trace,
    profile: input.learnerProfile,
    documents: input.documents,
  });
  if (sourceMode(input.learnerProfile) === "uploaded-only" && !retrievedEvidence.length) {
    throw new Error(`No relevant uploaded-source evidence was found for constructing above Height +${currentHeight}.`);
  }

  let revisionFeedback: string[] = [];
  let finalProposal: LearningPathProposal | undefined;
  let finalValidation: PedagogyValidation | undefined;
  let finalLevel: GraphLevelDescriptor | undefined;

  for (let revision = 0; revision <= getEnv().AGENT_MAX_REVISIONS; revision += 1) {
    const path = await runtime.run<any, LearningPathProposal>(
      "learning_path",
      {
        knownConcepts,
        currentLayerTitles: knownConcepts,
        targetDirectionCount,
        allowFoundationSuggestions: false,
        focusTitle: input.node.title,
        intent,
        goal: input.goal,
        learnerProfile: input.learnerProfile,
        targetLevel: baseTargetLevel,
        retrievedEvidence,
        revisionFeedback,
      },
      trace,
    );
    finalProposal = {
      ...path.data,
      foundationSuggestions: [],
    };
    const scores = finalProposal.directions.map((direction) => direction.difficulty);
    finalLevel = narrateLevel(
      baseTargetLevel,
      finalProposal.levelNarrative.previousLevelComparison,
      finalProposal.levelNarrative.sameLevelReason,
    );

    let validationBase = deterministicValidationBaseline("Brick stack layer");
    if (getEnv().PEDAGOGY_VALIDATION_MODE === "llm") {
      runtime.handoff(
        "learning_path",
        "pedagogy_validator",
        trace,
        {
          summary: `Learning Path Agent handed Height +${nextHeight} to Pedagogy Validator.`,
          context: {
            height: nextHeight,
            candidateTitles: finalProposal.directions.map((direction) => direction.title),
            expectedLevel: finalLevel,
            learnerProfile: input.learnerProfile ?? null,
          },
        },
      );
      const validator = await runtime.run<any, PedagogyValidation>(
        "pedagogy_validator",
        {
          kind: "learning-path",
          expectedLevel: finalLevel,
          candidate: finalProposal,
          learnerContext: { knownConcepts, goal: input.goal, profile: input.learnerProfile },
          sourceMode: sourceMode(input.learnerProfile),
          retrievedEvidence,
        },
        trace,
      );
      validationBase = validator.data;
    }

    finalValidation = addDestinationHeightChecks(
      addBrickStackShapeChecks(
        addBrickNoveltyChecks(
          addLearnerFitChecks(
            addAdjacentStepChecks(
              addDeterministicTitleChecks(
                addDeterministicSourceChecks(
                  addDeterministicDifficultyChecks(validationBase, scores, finalLevel),
                  finalProposal.directions.map((direction) => ({ title: direction.title, evidence: direction.evidence ?? [] })),
                  retrievedEvidence,
                  sourceMode(input.learnerProfile),
                ),
                finalProposal.directions.map((direction) => direction.title),
              ),
              representativeDifficulty,
              scores,
              "brick",
            ),
            finalProposal,
            input.learnerProfile,
            intent,
          ),
          finalProposal.directions.map((direction) => direction.title),
          input.graphContext.nodes.map((node) => node.title),
        ),
        lowerLayer.length,
        finalProposal.directions.length,
      ),
      finalProposal,
      intent,
      nextHeight,
    );

    if (finalValidation.valid && finalValidation.difficultyConsistency && finalValidation.sourceFidelity) break;
    if (revision >= getEnv().AGENT_MAX_REVISIONS || !finalValidation.recommendedRevision) break;
    revisionFeedback = finalValidation.issues.map((issue) => issue.message);
    runtime.handoff("pedagogy_validator", "learning_path", trace, {
      summary: "Pedagogy Validator requested a revised stacked Brick row.",
      context: {
        issues: finalValidation.issues,
        expectedLevel: finalLevel,
        revision: revision + 1,
      },
    });
    trace.add("revision", `Stack revision ${revision + 1}: ${revisionFeedback.join(" | ")}`, { agent: "learning_path" });
  }

  if (!finalProposal || !finalValidation || !finalLevel) {
    throw new Error("Brick stack workflow did not complete.");
  }

  const validated = finalValidation.valid && finalValidation.difficultyConsistency && finalValidation.sourceFidelity;
  if (!validated) warnings.push("This Brick row is marked needs review because validation did not fully pass.");

  const orderedDirections = orderDirectionsForBrickStack(finalProposal.directions, lowerLayer);
  const nodes: ConceptNode[] = orderedDirections.map((direction, index) => {
    const id = conceptId(`height:${nextHeight}`, direction.title);
    const supports = brickSupportNodes(
      lowerLayer,
      index,
      orderedDirections.length,
      direction.connectsFrom ?? [],
    );
    const knowledgeStatus: ConceptNode["knowledgeStatus"] = direction.title === finalProposal!.recommendedTitle
      ? "recommended"
      : direction.missingPrerequisites.length === 0 || direction.readinessScore >= 70
        ? "available"
        : "future";
    return {
      id,
      title: direction.title,
      normalizedTitle: normalizeConceptTitle(direction.title),
      shortDescription: direction.description,
      parentId: supports[0]?.id,
      childIds: [],
      depth: nextHeight,
      level: finalLevel!,
      difficulty: direction.difficulty,
      difficultyLabel: difficultyLabel(direction.difficulty),
      difficultyExplanation: direction.difficultyExplanation,
      difficultyFactors: direction.difficultyFactors,
      prerequisites: [...direction.satisfiedPrerequisites, ...direction.missingPrerequisites],
      learningOutcomes: direction.unlocks,
      applications: direction.applications,
      examples: [],
      whyItMatters: direction.whyReachable,
      whatItUnlocks: direction.unlocks,
      estimatedLearningTime: direction.estimatedLearningTime,
      confidence: direction.confidence,
      status: validated ? "validated" : "needs-review",
      knowledgeStatus,
      resources: [],
      origins: evidenceOrigins(verifiedEvidenceReferences(direction.evidence ?? [], retrievedEvidence)),
    };
  });
  const edges = brickStackEdges(lowerLayer, nodes, orderedDirections);
  const parentChildren = edges
    .filter((edge) => edge.source === input.node.id)
    .map((edge) => edge.target);

  return {
    data: {
      parent: {
        ...input.node,
        childIds: [...new Set([...input.node.childIds, ...parentChildren])],
        knowledgeStatus: "known",
      },
      nodes,
      edges,
      level: finalLevel,
      learningPath: finalProposal,
      validation: finalValidation,
    },
    trace: trace.list(),
    warnings,
  };
}

function safeCandidateUrl(candidate: RawSearchResult): boolean {
  try {
    const parsed = new URL(candidate.url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "::1" || host.endsWith(".local")) return false;
    if (host.endsWith("wikipedia.org") || host.endsWith("wikimedia.org")) return false;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return true;
    const [a, b] = ipv4.slice(1).map(Number);
    return !(a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  } catch {
    return false;
  }
}

function compactSearchQuery(...parts: string[]): string {
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 280).trim();
}

function typeSearchTerms(strategy: ResourceStrategy): string {
  const terms: Record<string, string> = {
    article: "clear explanation guide",
    video: "video lecture walkthrough",
    course: "tutorial lesson course",
    documentation: "official documentation implementation guide",
    reference: "reference handbook textbook guide",
    paper: "research paper study",
  };
  return strategy.targetTypes.map((type) => terms[type]).join(" ");
}

function deterministicResourcePlan(
  node: ResourceNodeContext,
  webSearchAvailable: boolean,
  profile: LearnerProfile | undefined,
  strategy: ResourceStrategy,
): ResourceQueryPlan {
  const level = profile?.knowledgeLevel ?? "beginner";
  const education = profile?.educationLevel ?? "high-school";
  const purpose = profile?.purpose ?? "general-learning";
  const audience = `${education} ${level}`;
  const preferred = (profile?.preferredResourceTypes ?? []).slice(0, 3).join(" ").trim();
  const intentTerms: Record<ResourceStrategy["intent"], string> = {
    conceptual: "clear explanation examples",
    procedural: "worked examples practice step by step",
    implementation: "official documentation implementation examples",
    reference: "deep reference handbook guide",
    research: "technical overview evidence review",
  };
  const learningGoal = purpose === "exam" || purpose === "class"
    ? "practice lesson worked examples"
    : preferred || intentTerms[strategy.intent];
  const queries: ResourceQueryPlan["queries"] = [];

  // One high-signal web query per node is the normal path. The search tool itself
  // rotates between configured providers and only falls back when needed, avoiding
  // the old multiplication of several near-duplicate queries across both providers.
  if (webSearchAvailable) {
    queries.push({
      query: compactSearchQuery(node.title, audience, learningGoal, typeSearchTerms(strategy)),
      source: "web",
      reason: `Single adaptive web query for ${strategy.targetTypes.join(", ")} at ${node.difficulty}/5 difficulty.`,
    });
  }

  // Academic retrieval is additive only when the resource strategy explicitly
  // warrants papers/evidence; difficulty by itself never creates this call.
  if (strategy.academicSearch) {
    queries.push({
      query: compactSearchQuery(node.title, purpose === "research" ? "research evidence literature" : "scholarly evidence review"),
      source: "academic",
      reason: `Academic evidence is relevant here; selected papers remain capped at ${strategy.maxPapers}.`,
    });
  }

  return { queries: queries.slice(0, 2) };
}

function resourceTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#. -]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function resourceHost(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return "unknown"; }
}

function relevanceScore(candidate: RawSearchResult, node: ResourceNodeContext): number {
  const targetTokens = new Set(resourceTokens(`${node.title} ${node.shortDescription} ${node.difficultyFactors.join(" ")} ${node.learningOutcomes.join(" ")} ${node.applications.join(" ")}`));
  if (!targetTokens.size) return 0.5;
  const titleTokens = resourceTokens(candidate.title);
  const bodyTokens = new Set(resourceTokens(`${candidate.title} ${candidate.snippet ?? ""}`));
  const titleMatches = titleTokens.filter((token) => targetTokens.has(token)).length;
  const allMatches = [...targetTokens].filter((token) => bodyTokens.has(token)).length;
  const lexical = Math.min(1, (titleMatches * 1.8 + allMatches) / Math.max(3, targetTokens.size));
  return Math.max(lexical, candidate.searchScore ?? 0);
}

function credibilityScore(candidate: RawSearchResult): number {
  let score = 0.5;
  const signals = new Set(candidate.credibilitySignals ?? []);
  if (signals.has("HTTPS")) score += 0.06;
  if (signals.has("institutional-domain") || signals.has("government-domain")) score += 0.12;
  if (signals.has("scholarly-index")) score += 0.1;
  if (signals.has("DOI")) score += 0.04;
  if (candidate.citationCount) score += Math.min(0.06, Math.log10(candidate.citationCount + 1) * 0.02);
  if ((candidate.snippet ?? "").length >= 80) score += 0.04;
  return Math.min(1, score);
}

function audienceFitScore(candidate: RawSearchResult, node: ResourceNodeContext, profile?: LearnerProfile): number {
  const education = (profile?.educationLevel ?? "high-school").toLowerCase();
  const knowledge = profile?.knowledgeLevel ?? "beginner";
  const introductory = ["elementary", "middle-school", "high-school"].includes(education)
    || ["novice", "beginner"].includes(knowledge);

  let score = 0.68;
  if (introductory) {
    if (["course", "video", "article"].includes(candidate.type)) score += 0.16;
    if (candidate.type === "documentation") score -= 0.08;
    if (candidate.type === "paper") score -= 0.22;
  } else if (["advanced", "expert"].includes(knowledge)) {
    if (["documentation", "reference"].includes(candidate.type)) score += 0.1;
  }

  const preferences = (profile?.preferredResourceTypes ?? []).join(" ").toLowerCase();
  if (preferences && preferences.includes(candidate.type)) score += 0.14;
  if (node.difficulty <= 2 && candidate.type === "paper") score -= 0.18;
  return Math.max(0, Math.min(1, score));
}

function deterministicResourceSelection(
  candidates: ResourceCandidate[],
  node: ResourceNodeContext,
  profile: LearnerProfile | undefined,
  strategy: ResourceStrategy,
): ResourceCandidate[] {
  const ranked = candidates
    .filter((candidate) => candidate.type !== "paper" || strategy.maxPapers > 0)
    .map((candidate) => ({
      candidate,
      base:
        relevanceScore(candidate, node) * 0.42
        + resourceTypeFit(candidate.type, strategy) * 0.28
        + credibilityScore(candidate) * 0.18
        + audienceFitScore(candidate, node, profile) * 0.12,
    }))
    .sort((a, b) => b.base - a.base);

  const selected: ResourceCandidate[] = [];
  const hostCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const providerCounts = new Map<string, number>();
  let paperCount = 0;

  while (selected.length < 5 && ranked.length) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < ranked.length; index += 1) {
      const item = ranked[index];
      if (item.candidate.type === "paper" && paperCount >= strategy.maxPapers) continue;
      const host = resourceHost(item.candidate.url);
      const hostPenalty = (hostCounts.get(host) ?? 0) * 0.18;
      const typePenalty = (typeCounts.get(item.candidate.type) ?? 0) * 0.08;
      const provider = item.candidate.provider ?? item.candidate.source;
      const providerPenalty = (providerCounts.get(provider) ?? 0) * 0.04;
      const diversityBonus = (hostCounts.has(host) ? 0 : 0.08) + (typeCounts.has(item.candidate.type) ? 0 : 0.05);
      const score = item.base + diversityBonus - hostPenalty - typePenalty - providerPenalty;
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex < 0) break;
    const [{ candidate }] = ranked.splice(bestIndex, 1);
    if (selected.length && bestScore < 0.32) break;
    selected.push(candidate);
    if (candidate.type === "paper") paperCount += 1;
    const host = resourceHost(candidate.url);
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
    typeCounts.set(candidate.type, (typeCounts.get(candidate.type) ?? 0) + 1);
    const provider = candidate.provider ?? candidate.source;
    providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1);
  }

  return selected;
}

function enforceResourceMix(
  preferred: ResourceCandidate[],
  fallback: ResourceCandidate[],
  strategy: ResourceStrategy,
): ResourceCandidate[] {
  const result: ResourceCandidate[] = [];
  const seen = new Set<string>();
  let papers = 0;
  for (const candidate of [...preferred, ...fallback]) {
    if (seen.has(candidate.candidateId)) continue;
    if (candidate.type === "paper" && papers >= strategy.maxPapers) continue;
    if (candidate.type === "paper" && strategy.maxPapers === 0) continue;
    result.push(candidate);
    seen.add(candidate.candidateId);
    if (candidate.type === "paper") papers += 1;
    if (result.length >= 5) break;
  }
  return result;
}

export async function findResources(input: {
  node: ResourceNodeContext;
  learnerProfile?: LearnerProfile;
}): Promise<WorkflowEnvelope<{ resources: ResourceLink[] }>> {
  const trace = new TraceCollector();
  const warnings: string[] = [];
  const env = getEnv();
  const webSearchAvailable = Boolean(env.TAVILY_API_KEY || env.BRAVE_SEARCH_API_KEY);
  const originAgent = input.node.axis === "depth" ? "concept_architect" : "learning_path";
  const strategy = buildResourceStrategy(input.node, input.learnerProfile);
  const cacheKey = resourceCacheKey(input.node, input.learnerProfile, strategy, env.RESOURCE_PLANNING_MODE);
  const cached = resourceCache.get(cacheKey);
  if (cached?.expiresAt && cached.expiresAt > Date.now()) {
    trace.add("agent_finish", `Resource Agent reused ${cached.resources.length} cached adaptive resources for ${input.node.title}.`, {
      agent: "resource_agent",
      metadata: { cache: "hit", resourceIntent: strategy.intent, targetTypes: strategy.targetTypes },
    });
    return { data: { resources: cached.resources }, trace: trace.list(), warnings };
  }
  if (cached) resourceCache.delete(cacheKey);

  runtime.handoff(originAgent, "resource_agent", trace, {
    summary: `${originAgent === "concept_architect" ? "Concept Architect" : "Learning Path Agent"} handed ${input.node.title} to Resource Agent for learner-specific source discovery.`,
    context: {
      nodeId: input.node.id,
      nodeTitle: input.node.title,
      difficulty: input.node.difficulty,
      difficultyLabel: input.node.difficultyLabel,
      axis: input.node.axis,
      learnerProfile: input.learnerProfile ? {
        educationLevel: input.learnerProfile.educationLevel,
        knowledgeLevel: input.learnerProfile.knowledgeLevel,
        purpose: input.learnerProfile.purpose,
        depthPreference: input.learnerProfile.depthPreference,
        exploreBias: input.learnerProfile.exploreBias,
        preferredResourceTypes: input.learnerProfile.preferredResourceTypes?.slice(0, 6),
      } : null,
    },
  });

  const plan = deterministicResourcePlan(input.node, webSearchAvailable, input.learnerProfile, strategy);
  trace.add("agent_start", "Resource Agent created a source-neutral, format-adaptive retrieval plan from the node and learner context.", {
    agent: "resource_agent",
    metadata: {
      strategy: { intent: strategy.intent, targetTypes: strategy.targetTypes, maxPapers: strategy.maxPapers, rationale: strategy.rationale },
      queries: plan.queries.map((query) => ({ source: query.source, reason: query.reason })),
    },
  });
  if (!plan.queries.length) {
    warnings.push("No configured retrieval provider matched this node's resource strategy; academic papers were not used as a generic fallback.");
  }

  const rawCandidates: RawSearchResult[] = [];
  for (const query of plan.queries.slice(0, 2)) {
    const tool = query.source === "academic" ? "search_academic_resources" : "search_web";
    try {
      const results = (await runtime.executeTool(
        "resource_agent",
        tool,
        { query: query.query, limit: 5 },
        trace,
      )) as RawSearchResult[];
      rawCandidates.push(...results);
    } catch (error) {
      warnings.push(`${tool} was unavailable for one query.`);
      trace.add("error", `${tool} failed: ${error instanceof Error ? error.message : String(error)}`, {
        agent: "resource_agent",
      });
    }
  }

  const seenUrls = new Set<string>();
  let paperCandidates = 0;
  const paperCandidateLimit = Math.max(strategy.maxPapers * 3, strategy.maxPapers ? 3 : 0);
  const candidates: ResourceCandidate[] = rawCandidates
    .filter(safeCandidateUrl)
    .filter((candidate) => {
      if (candidate.type !== "paper") return true;
      if (strategy.maxPapers === 0 || paperCandidates >= paperCandidateLimit) return false;
      paperCandidates += 1;
      return true;
    })
    .filter((candidate) => {
      const key = candidate.url.replace(/\/$/, "").toLowerCase();
      if (seenUrls.has(key)) return false;
      seenUrls.add(key);
      return true;
    })
    .slice(0, 30)
    .map((candidate, index) => ({ ...candidate, candidateId: `candidate-${index + 1}` }));

  const deterministicSelected = deterministicResourceSelection(candidates, input.node, input.learnerProfile, strategy);
  let selected = deterministicSelected;


  if (env.RESOURCE_PLANNING_MODE === "llm" && candidates.length) {
    try {
      const selection = (
        await runtime.run<any, ResourceSelection>(
          "resource_agent",
          { node: input.node, learnerProfile: input.learnerProfile, candidates, strategy },
          trace,
        )
      ).data;
      const byId = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
      const validIds = [...new Set(selection.selected.map((item) => item.candidateId))];
      const llmSelected = validIds
        .map((id) => byId.get(id))
        .filter((candidate): candidate is ResourceCandidate => Boolean(candidate))
        .slice(0, 5);
      if (llmSelected.length) {
        selected = enforceResourceMix(llmSelected, deterministicSelected, strategy);
        trace.add("validation", selection.summary, { agent: "resource_agent" });
      } else {
        warnings.push("Resource Agent returned no valid candidate IDs, so deterministic selection was used.");
      }
    } catch (error) {
      warnings.push("Resource Agent selection fell back to deterministic scoring after the configured model was unavailable.");
      trace.add("error", `Resource Agent model selection failed: ${error instanceof Error ? error.message : String(error)}`, {
        agent: "resource_agent",
      });
    }
  }

  const resources: ResourceLink[] = selected.map((candidate) => ({
    title: candidate.title,
    url: candidate.url,
    source: candidate.source,
    type: candidate.type,
    description: candidate.snippet,
    verified: true,
  }));

  trace.add("agent_finish", `Resource Agent selected ${resources.length} node-specific resource links from ${candidates.length} retrieved candidates.`, {
    agent: "resource_agent",
    metadata: {
      candidateCount: candidates.length,
      selectedCandidateIds: selected.map((candidate) => candidate.candidateId),
      distinctHosts: new Set(selected.map((candidate) => resourceHost(candidate.url))).size,
      selectionMode: env.RESOURCE_PLANNING_MODE === "llm" ? "llm-with-deterministic-fallback" : "deterministic",
      resourceIntent: strategy.intent,
      targetTypes: strategy.targetTypes,
      maxPapers: strategy.maxPapers,
      selectedTypes: selected.map((candidate) => candidate.type),
    },
  });

  cacheResources(cacheKey, resources);
  return {
    data: { resources },
    trace: trace.list(),
    warnings,
  };
}

/**
 * Hydrate a generated layer in one HTTP request while keeping each node's actual
 * retrieval independent. Search calls run with a small concurrency cap so a row
 * does not burst every provider at once.
 */
export async function findResourcesBatch(input: {
  nodes: ResourceNodeContext[];
  learnerProfile?: LearnerProfile;
}): Promise<WorkflowEnvelope<{ items: Array<{ nodeId: string; resources: ResourceLink[] }> }>> {
  const unique = [...new Map(input.nodes.map((node) => [node.id, node])).values()].slice(0, 20);
  const items: Array<{ nodeId: string; resources: ResourceLink[] }> = [];
  const traceEvents: ReturnType<TraceCollector["list"]> = [];
  const warnings: string[] = [];
  const concurrency = 2;
  let cursor = 0;

  async function worker() {
    while (cursor < unique.length) {
      const index = cursor;
      cursor += 1;
      const node = unique[index];
      try {
        const result = await findResources({ node, learnerProfile: input.learnerProfile });
        items[index] = { nodeId: node.id, resources: result.data.resources };
        traceEvents.push(...result.trace);
        warnings.push(...result.warnings);
      } catch (error) {
        items[index] = { nodeId: node.id, resources: [] };
        warnings.push(`Resources could not be loaded for ${node.title}.`);
        const trace = new TraceCollector();
        trace.add("error", `Resource hydration failed for ${node.title}: ${error instanceof Error ? error.message : String(error)}`, {
          agent: "resource_agent",
        });
        traceEvents.push(...trace.list());
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, () => worker()));
  return {
    data: { items: items.filter(Boolean) },
    trace: traceEvents.slice(-100),
    warnings: [...new Set(warnings)].slice(0, 10),
  };
}

export async function explainConcept(input: {
  node: ExplanationNodeContext;
  level: ExplanationLevel;
  learnerProfile?: LearnerProfile;
  documents?: ExtractedDocument[];
}): Promise<WorkflowEnvelope<AdaptiveExplanation>> {
  ExplanationLevelSchema.parse(input.level);
  const trace = new TraceCollector();
  const evidence = await sourceEvidence({
    agentName: "concept_architect",
    query: `${input.node.title} explanation definition examples`,
    trace,
    profile: input.learnerProfile,
    documents: input.documents,
  });
  if (sourceMode(input.learnerProfile) === "uploaded-only" && !evidence.length) {
    throw new Error("No uploaded-source evidence was found for this explanation.");
  }

  const provider = createLLMProvider();
  trace.add("model_call", `Generating a ${input.level} explanation for ${input.node.title}.`, {
    agent: "concept_architect",
    metadata: { provider: provider.name, model: provider.model },
  });
  const result = await provider.generateStructured<AdaptiveExplanation>({
    system: `You adapt an existing concept explanation to a requested learner level and language style. Preserve the concept's meaning, stay concise, and do not introduce unsupported URLs.

Return only information that helps understand the selected node now: the explanation, one useful example, and one key takeaway. Do not generate prerequisite lists, unlock lists, learning-time estimates, or generic filler.

If source evidence is provided, distinguish "what the source says" from your general educational explanation. In uploaded-only mode, do not make factual claims that cannot be supported by the evidence. Return evidence identifiers only when they appear in the supplied evidence metadata.`,
    user: `Concept: ${input.node.title}
Base description: ${input.node.shortDescription}
Why it matters: ${input.node.whyItMatters ?? ""}
Why it is difficult: ${input.node.difficultyExplanation}
Difficulty factors: ${input.node.difficultyFactors.join(", ")}
Requested explanation level: ${input.level}
Learner/session profile: ${JSON.stringify(input.learnerProfile ? {
  educationLevel: input.learnerProfile.educationLevel,
  knowledgeLevel: input.learnerProfile.knowledgeLevel,
  languageStyle: input.learnerProfile.languageStyle,
  depthPreference: input.learnerProfile.depthPreference,
  purpose: input.learnerProfile.purpose,
  preferredExamples: input.learnerProfile.preferredExamples?.slice(0, 4),
  courseContext: input.learnerProfile.courseContext?.slice(0, 1200),
  goal: input.learnerProfile.learningGoal ?? input.learnerProfile.goal,
} : {})}
Source mode: ${sourceMode(input.learnerProfile)}
Retrieved source evidence: ${JSON.stringify(evidence)}`,
    schema: AdaptiveExplanationSchema,
    schemaName: "AdaptiveExplanation",
    schemaHint: "JSON fields: explanation:string, sourceSummary?:string, example:string, keyTakeaway:string, evidence:[{documentId,sectionId,page?,heading?}]. Keep every field node-specific and omit sourceSummary when no source evidence applies.",
    temperature: 0.25,
  });
  const verifiedExplanationEvidence = verifiedEvidenceReferences(result.data.evidence ?? [], evidence);
  if (sourceMode(input.learnerProfile) === "uploaded-only" && !verifiedExplanationEvidence.length) {
    throw new Error("The generated explanation did not preserve verifiable uploaded-source provenance.");
  }
  let explanationData: AdaptiveExplanation = {
    ...result.data,
    evidence: verifiedExplanationEvidence,
    sourceSummary: verifiedExplanationEvidence.length ? result.data.sourceSummary : undefined,
  };
  const warnings: string[] = [];
  trace.add("validation", `Verified ${verifiedExplanationEvidence.length} source reference${verifiedExplanationEvidence.length === 1 ? "" : "s"} for the explanation.`, {
    agent: "pedagogy_validator",
    metadata: { sourceMode: sourceMode(input.learnerProfile) },
  });

  if (sourceMode(input.learnerProfile) !== "general" && verifiedExplanationEvidence.length) {
    let sourceValidation = deterministicValidationBaseline("Source explanation");
    if (getEnv().PEDAGOGY_VALIDATION_MODE === "llm") {
      runtime.handoff(
        "concept_architect",
        "pedagogy_validator",
        trace,
        {
          summary: "Concept Architect handed the source-grounded explanation to Pedagogy Validator for attribution review.",
          context: {
            nodeId: input.node.id,
            nodeTitle: input.node.title,
            evidenceCount: verifiedExplanationEvidence.length,
            sourceMode: sourceMode(input.learnerProfile),
          },
        },
      );
      sourceValidation = (await runtime.run<any, PedagogyValidation>(
        "pedagogy_validator",
        {
          kind: "source-explanation",
          candidate: {
            concept: input.node.title,
            explanation: explanationData.explanation,
            sourceSummary: explanationData.sourceSummary,
            evidence: explanationData.evidence,
          },
          learnerContext: input.learnerProfile,
          sourceMode: sourceMode(input.learnerProfile),
          retrievedEvidence: evidence,
        },
        trace,
      )).data;
    }
    const validatedSource = addDeterministicSourceChecks(
      sourceValidation,
      [{ title: input.node.title, evidence: verifiedExplanationEvidence }],
      evidence,
      sourceMode(input.learnerProfile),
    );
    trace.add("validation", validatedSource.sourceAssessment, {
      agent: "pedagogy_validator",
      metadata: { sourceFidelity: validatedSource.sourceFidelity, valid: validatedSource.valid },
    });
    if (!validatedSource.valid || !validatedSource.sourceFidelity) {
      if (sourceMode(input.learnerProfile) === "uploaded-only") {
        throw new Error("The source-grounded explanation did not pass source-fidelity validation.");
      }
      explanationData = { ...explanationData, sourceSummary: undefined, evidence: [] };
      warnings.push("A source-specific summary was withheld because it did not fully pass attribution validation. The general Brick Tree explanation is still available.");
    }
  }

  trace.add("agent_finish", `Adapted explanation is ready at ${input.level} level.`, {
    agent: "concept_architect",
    durationMs: result.latencyMs,
  });
  return { data: explanationData, trace: trace.list(), warnings };
}

export function publicAgentList() {
  return agents.list().filter((agent) => !agent.name.endsWith("_internal"));
}
