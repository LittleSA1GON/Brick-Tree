import { AgentRuntime } from "@/lib/agents/runtime";
import { createAgentRegistry } from "@/lib/agents";
import { createToolRegistry } from "@/lib/tools";
import { TraceCollector } from "@/lib/observability/trace";
import { getEnv } from "@/lib/config/env";
import type {
  ConceptDecomposition,
  ConceptEdge,
  ConceptNode,
  DifficultyAssessment,
  EvidenceReference,
  GraphContext,
  GraphLevelDescriptor,
  KnowledgeOrigin,
  ResourceLink,
} from "@/lib/schemas/concept";
import type { LearnerProfile, LearningPathProposal } from "@/lib/schemas/learning-path";
import type { PedagogyValidation } from "@/lib/schemas/validation";
import type { ExtractedDocument, RetrievedChunk } from "@/lib/schemas/documents";
import type { BrickIntent, SourceMode, TreeIntent } from "@/lib/schemas/session";
import { difficultyConsistencyIssues, difficultyLabel, levelFromDifficulties } from "@/lib/graph/levels";
import { conceptId, edgeId } from "@/lib/graph/graph-utils";
import { normalizeConceptTitle } from "@/lib/utils/text";
import type { ResourceNodeContext } from "@/lib/schemas/resources";
import { evidenceCoverageFindings, verifiedEvidenceReferences } from "@/lib/documents/provenance";
import { learnerFitIssues } from "@/lib/learning/learner-fit";
import type { ResourceStrategy } from "@/lib/agents/resource-strategy";


export const agents = createAgentRegistry();
export const tools = createToolRegistry();
export const runtime = new AgentRuntime(agents, tools);

const RESOURCE_CACHE_TTL_MS = 20 * 60 * 1000;
const RESOURCE_CACHE_LIMIT = 200;
export const resourceCache = new Map<string, { expiresAt: number; resources: ResourceLink[] }>();

export function resourceCacheKey(node: ResourceNodeContext, profile: LearnerProfile | undefined, strategy: ResourceStrategy, mode: string): string {
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

export function cacheResources(key: string, resources: ResourceLink[]): void {
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

export function existingLevel(
  context: GraphContext | undefined,
  axis: "depth" | "height",
  index: number,
): GraphLevelDescriptor | undefined {
  return context?.levels.find((item) => item.axis === axis && item.index === index);
}

export function normalizedAssessment(assessment: DifficultyAssessment): DifficultyAssessment {
  return { ...assessment, difficultyLabel: difficultyLabel(assessment.difficulty) };
}

export function normalizedKnown(profile?: LearnerProfile, additional: string[] = []): Set<string> {
  return new Set(
    [...(profile?.existingKnowledge ?? []), ...additional]
      .map(normalizeConceptTitle)
      .filter(Boolean),
  );
}

export function sourceMode(profile?: LearnerProfile): SourceMode {
  return profile?.sourceMode ?? "general";
}

export function treeRelationship(intent: TreeIntent): ConceptEdge["relationshipType"] {
  if (intent === "decompose") return "contains";
  if (intent === "analyze-question") return "examines";
  return "prerequisite";
}

export function treeValidationKind(intent: TreeIntent): "decomposition" | "prerequisite-trace" | "question-analysis" {
  if (intent === "decompose") return "decomposition";
  if (intent === "analyze-question") return "question-analysis";
  return "prerequisite-trace";
}

export function treeQuery(intent: TreeIntent, topic: string): string {
  if (intent === "decompose") return `${topic} major concepts components structure`;
  if (intent === "analyze-question") return `${topic} stakeholders changes causes contexts actions risks tradeoffs evidence`;
  return `${topic} prerequisites foundations concepts to understand first`;
}

export function evidenceOrigins(evidence: EvidenceReference[]): KnowledgeOrigin[] {
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

export function rootNode(
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

export function truncateLevelText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 420);
}

export function narrateLevel(
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

export function brickKnownTitles(
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

export function brickFoundationTitles(
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

export function desiredBrickRowSize(lowerRowCount: number): number {
  return Math.max(
    2,
    Math.min(BRICK_MAX_ROW_SIZE, lowerRowCount + 1),
  );
}

export function addBrickStackShapeChecks(
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

export type BrickLayerNode = Pick<ConceptNode, "id" | "title" | "normalizedTitle" | "difficulty">;

export function addBrickNoveltyChecks(
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

export function orderDirectionsForBrickStack(
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

export function brickSupportNodes(
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

export function brickStackEdges(
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

export function childrenFromDecomposition(
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

export function addDeterministicDifficultyChecks(
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

export function addDeterministicTitleChecks(
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


export function deterministicValidationBaseline(label: string): PedagogyValidation {
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

export function addAdjacentStepChecks(
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


export function addLearnerFitChecks(
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


export function addDestinationHeightChecks(
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

export function addDeterministicSourceChecks(
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

export async function sourceEvidence(input: {
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

