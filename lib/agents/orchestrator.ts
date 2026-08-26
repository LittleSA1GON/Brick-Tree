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
import { ExplanationLevelSchema, type ExplanationLevel } from "@/lib/schemas/api";
import type { RawSearchResult, ResourceQueryPlan } from "@/lib/schemas/resources";
import type { RetrievedChunk } from "@/lib/schemas/documents";
import { evidenceCoverageFindings, verifiedEvidenceReferences } from "@/lib/documents/provenance";

const agents = createAgentRegistry();
const tools = createToolRegistry();
const runtime = new AgentRuntime(agents, tools);

type ExplanationResponse = {
  explanation: string;
  sourceSummary?: string;
  example: string;
  keyTakeaway: string;
  evidence: Array<{ documentId: string; sectionId: string; page?: number; heading?: string }>;
};

const ExplanationResponseSchema = z.object({
  explanation: z.string().min(1).max(4000),
  sourceSummary: z.string().max(2400).optional(),
  example: z.string().min(1).max(1800),
  keyTakeaway: z.string().min(1).max(700),
  evidence: z.array(z.object({
    documentId: z.string(),
    sectionId: z.string(),
    page: z.number().int().positive().optional(),
    heading: z.string().optional(),
  })).max(8).default([]),
});

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
): ConceptNode {
  const normalized = normalizedAssessment(assessment);
  const level = levelFromDifficulties(axis, 0, [normalized.difficulty]);
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
      );
    }

    const candidateScores = finalDecomposition.children.map((child) => child.difficulty);
    finalLevel = targetLevel ?? levelFromDifficulties("depth", childIndex, candidateScores);

    runtime.handoff(
      "concept_architect",
      "pedagogy_validator",
      trace,
      `Concept Architect handed a ${input.intent === "decompose" ? "component" : input.intent === "analyze-question" ? "question-lens" : "prerequisite"} layer to Pedagogy Validator.`,
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
    finalValidation = addDeterministicTitleChecks(
      addDeterministicSourceChecks(
        addDeterministicDifficultyChecks(validator.data, candidateScores, finalLevel),
        finalDecomposition.children.map((child) => ({ title: child.title, evidence: child.evidence ?? [] })),
        retrievedEvidence,
        sourceMode(input.learnerProfile),
      ),
      finalDecomposition.children.map((child) => child.title),
      parent.title,
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
      "Pedagogy Validator requested a bounded revision for conceptual, source, or difficulty consistency.",
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

function candidateNodesFromLearningPath(
  root: ConceptNode,
  proposal: LearningPathProposal,
  level: GraphLevelDescriptor,
  validated: boolean,
  retrievedEvidence: RetrievedChunk[] = [],
): { nodes: ConceptNode[]; edges: ConceptEdge[] } {
  const nodes = proposal.directions.map((direction) => {
    const id = conceptId(root.id, direction.title);
    const knowledgeStatus: ConceptNode["knowledgeStatus"] = direction.title === proposal.recommendedTitle
      ? "recommended"
      : direction.missingPrerequisites.length === 0 || direction.readinessScore >= 70
        ? "available"
        : "future";
    return {
      id,
      title: direction.title,
      normalizedTitle: normalizeConceptTitle(direction.title),
      shortDescription: direction.description,
      parentId: root.id,
      childIds: [],
      depth: root.depth + 1,
      level,
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
  const edges = nodes.map((node) => ({
    id: edgeId(root.id, node.id, "leads-to"),
    source: root.id,
    target: node.id,
    relationshipType: "leads-to" as const,
    confidence: node.confidence,
  }));
  return { nodes, edges };
}

export async function discoverLearningPath(input: {
  intent?: BrickIntent;
  knownConcepts: string[];
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
    query: `${input.knownConcepts.join(" ")} ${input.goal ?? ""} next learnable concepts prerequisites`,
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
        intent,
        goal: input.goal,
        learnerProfile: input.learnerProfile,
        retrievedEvidence,
        revisionFeedback,
      },
      trace,
    );
    finalProposal = path.data;
    const scores = finalProposal.directions.map((direction) => direction.difficulty);
    finalLevel = levelFromDifficulties("height", 1, scores);

    runtime.handoff(
      "learning_path",
      "pedagogy_validator",
      trace,
      `Learning Path Agent handed a ${intent} next-brick layer to Pedagogy Validator.`,
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
    finalValidation = addDeterministicTitleChecks(
      addDeterministicSourceChecks(
        addDeterministicDifficultyChecks(validator.data, scores, finalLevel),
        finalProposal.directions.map((direction) => ({ title: direction.title, evidence: direction.evidence ?? [] })),
        retrievedEvidence,
        sourceMode(input.learnerProfile),
      ),
      finalProposal.directions.map((direction) => direction.title),
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
      "Pedagogy Validator requested a revised same-height next-brick layer.",
    );
    trace.add("revision", `Learning-path revision ${revision + 1}: ${revisionFeedback.join(" | ")}`, {
      agent: "learning_path",
    });
  }

  if (!finalProposal || !finalValidation || !finalLevel) throw new Error("Learning path workflow did not complete.");

  const root = rootNode(
    "Your Foundations",
    "height",
    `Starting knowledge: ${input.knownConcepts.join(", ")}.`,
    finalProposal.foundationAssessment,
    "known",
  );
  const validated = finalValidation.valid && finalValidation.difficultyConsistency && finalValidation.sourceFidelity;
  if (!validated) warnings.push("The recommendation set is marked needs review because validation did not fully pass.");
  const mapped = candidateNodesFromLearningPath(root, finalProposal, finalLevel, validated, retrievedEvidence);

  return {
    data: {
      root: { ...root, childIds: mapped.nodes.map((node) => node.id) },
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
  const targetLevel =
    existingLevel(input.graphContext, "height", input.node.depth + 1) ??
    suggestedNextLevel("height", input.node.depth + 1, input.node.difficulty);
  const knownConcepts = [
    ...(input.learnerProfile?.existingKnowledge ?? []),
    input.node.title,
  ].filter((value, index, values) => values.indexOf(value) === index);
  const retrievedEvidence = await sourceEvidence({
    agentName: "learning_path",
    query: `${input.node.title} ${input.goal ?? ""} next concepts builds on unlocks`,
    trace,
    profile: input.learnerProfile,
    documents: input.documents,
  });
  if (sourceMode(input.learnerProfile) === "uploaded-only" && !retrievedEvidence.length) {
    throw new Error(`No relevant uploaded-source evidence was found for building from ${input.node.title}.`);
  }

  let revisionFeedback: string[] = [];
  let finalProposal: LearningPathProposal | undefined;
  let finalValidation: PedagogyValidation | undefined;

  for (let revision = 0; revision <= getEnv().AGENT_MAX_REVISIONS; revision += 1) {
    const path = await runtime.run<any, LearningPathProposal>(
      "learning_path",
      {
        knownConcepts,
        intent,
        goal: input.goal,
        learnerProfile: input.learnerProfile,
        targetLevel,
        retrievedEvidence,
        revisionFeedback,
      },
      trace,
    );
    finalProposal = path.data;
    const scores = finalProposal.directions.map((direction) => direction.difficulty);

    runtime.handoff(
      "learning_path",
      "pedagogy_validator",
      trace,
      `Learning Path Agent handed a ${intent} branch layer to Pedagogy Validator.`,
    );
    const validator = await runtime.run<any, PedagogyValidation>(
      "pedagogy_validator",
      {
        kind: "learning-path",
        expectedLevel: targetLevel,
        candidate: finalProposal,
        learnerContext: { knownConcepts, goal: input.goal, profile: input.learnerProfile },
        sourceMode: sourceMode(input.learnerProfile),
        retrievedEvidence,
      },
      trace,
    );
    finalValidation = addDeterministicTitleChecks(
      addDeterministicSourceChecks(
        addDeterministicDifficultyChecks(validator.data, scores, targetLevel),
        finalProposal.directions.map((direction) => ({ title: direction.title, evidence: direction.evidence ?? [] })),
        retrievedEvidence,
        sourceMode(input.learnerProfile),
      ),
      finalProposal.directions.map((direction) => direction.title),
      input.node.title,
    );

    if (finalValidation.valid && finalValidation.difficultyConsistency && finalValidation.sourceFidelity) break;
    if (revision >= getEnv().AGENT_MAX_REVISIONS || !finalValidation.recommendedRevision) break;
    revisionFeedback = finalValidation.issues.map((issue) => issue.message);
    runtime.handoff("pedagogy_validator", "learning_path", trace, "Pedagogy Validator requested a revised branch layer.");
    trace.add("revision", `Branch revision ${revision + 1}: ${revisionFeedback.join(" | ")}`, { agent: "learning_path" });
  }

  if (!finalProposal || !finalValidation) throw new Error("Branch workflow did not complete.");
  const validated = finalValidation.valid && finalValidation.difficultyConsistency && finalValidation.sourceFidelity;
  if (!validated) warnings.push("This branch layer is marked needs review because validation did not fully pass.");

  const existingByTitle = new Map<string, { id: string }>(
    input.graphContext.nodes.map((item) => [item.normalizedTitle, { id: item.id }]),
  );
  const nodes: ConceptNode[] = [];
  const edges: ConceptEdge[] = [];
  for (const direction of finalProposal.directions) {
    const normalizedTitle = normalizeConceptTitle(direction.title);
    const existing = existingByTitle.get(normalizedTitle);
    const id = existing?.id ?? conceptId(input.node.id, direction.title);
    if (id === input.node.id) continue;
    const knowledgeStatus: ConceptNode["knowledgeStatus"] = direction.title === finalProposal.recommendedTitle
      ? "recommended"
      : direction.missingPrerequisites.length === 0 || direction.readinessScore >= 70
        ? "available"
        : "future";
    if (!existing) nodes.push({
      id,
      title: direction.title,
      normalizedTitle,
      shortDescription: direction.description,
      parentId: input.node.id,
      childIds: [],
      depth: input.node.depth + 1,
      level: targetLevel,
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
    });
    edges.push({
      id: edgeId(input.node.id, id, "leads-to"),
      source: input.node.id,
      target: id,
      relationshipType: "leads-to",
      confidence: direction.confidence,
    });
  }

  return {
    data: {
      parent: { ...input.node, childIds: [...new Set(edges.map((edge) => edge.target))], knowledgeStatus: "known" },
      nodes,
      edges,
      level: targetLevel,
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
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "::1" || host.endsWith(".local")) return false;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return true;
    const [a, b] = ipv4.slice(1).map(Number);
    return !(a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  } catch {
    return false;
  }
}

function deterministicResourcePlan(
  node: ConceptNode,
  webSearchAvailable: boolean,
  profile?: LearnerProfile,
): ResourceQueryPlan {
  const preferred = (profile?.preferredResourceTypes ?? []).join(" ");
  const level = profile?.knowledgeLevel ?? "beginner";
  const purpose = profile?.purpose ?? "general-learning";
  const queries: ResourceQueryPlan["queries"] = [
    { query: `${node.title} ${level} overview`, source: "wikipedia", reason: "Broad reference and terminology." },
  ];
  if (node.difficulty >= 4 || purpose === "research" || preferred.includes("paper")) {
    queries.push({ query: `${node.title} research education overview`, source: "academic", reason: "Research-oriented or advanced learning can benefit from scholarly references." });
  }
  if (webSearchAvailable) {
    const preferenceTerms = preferred || (purpose === "project" ? "documentation tutorial" : "tutorial course official documentation");
    queries.push({ query: `${node.title} ${level} ${preferenceTerms}`, source: "web", reason: "Find practical material aligned with the learner's requested format and level." });
  }
  return { queries };
}

export async function findResources(input: {
  node: ConceptNode;
  learnerProfile?: LearnerProfile;
}): Promise<WorkflowEnvelope<{ resources: ResourceLink[]; summary: string }>> {
  const trace = new TraceCollector();
  const warnings: string[] = [];
  const webSearchAvailable = Boolean(getEnv().TAVILY_API_KEY);
  let plan: ResourceQueryPlan;

  try {
    plan = (
      await runtime.run<any, ResourceQueryPlan>(
        "resource_agent",
        { node: input.node, learnerProfile: input.learnerProfile, webSearchAvailable },
        trace,
      )
    ).data;
  } catch (error) {
    warnings.push(
      error instanceof LLMConfigurationError
        ? "No LLM key is configured for resource planning; using no-key resource discovery directly."
        : "Resource planning used a deterministic fallback after the model planner failed.",
    );
    plan = deterministicResourcePlan(input.node, webSearchAvailable, input.learnerProfile);
    trace.add("agent_start", "Resource Agent is using a deterministic search plan because model planning is unavailable.", { agent: "resource_agent" });
  }

  const candidates: RawSearchResult[] = [];
  for (const query of plan.queries.slice(0, 5)) {
    const tool = query.source === "wikipedia" ? "search_wikipedia" : query.source === "academic" ? "search_academic_resources" : "search_web";
    try {
      const results = (await runtime.executeTool("resource_agent", tool, { query: query.query, limit: 4 }, trace)) as RawSearchResult[];
      candidates.push(...results);
    } catch (error) {
      warnings.push(`${tool} was unavailable for one query.`);
      trace.add("error", `${tool} failed: ${error instanceof Error ? error.message : String(error)}`, { agent: "resource_agent" });
    }
  }

  const seen = new Set<string>();
  const sourcePriority: Record<string, number> = { Crossref: 4, Wikipedia: 3, Tavily: 2 };
  const selected = candidates
    .filter(safeCandidateUrl)
    .filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    })
    .sort((a, b) => (sourcePriority[b.source] ?? 0) - (sourcePriority[a.source] ?? 0))
    .slice(0, 5);

  const resources: ResourceLink[] = selected.map((candidate) => ({
    title: candidate.title,
    url: candidate.url,
    source: candidate.source,
    type: candidate.type,
    description: candidate.snippet,
    verified: true,
  }));

  trace.add("agent_finish", `Resource Agent selected ${resources.length} controlled resource links.`, { agent: "resource_agent" });
  return {
    data: {
      resources,
      summary: resources.length
        ? `Found ${resources.length} resource${resources.length === 1 ? "" : "s"} from controlled public/search tools.`
        : "No verified external resources were available. The knowledge graph remains usable without them.",
    },
    trace: trace.list(),
    warnings,
  };
}

export async function explainConcept(input: {
  node: ConceptNode;
  level: ExplanationLevel;
  learnerProfile?: LearnerProfile;
  documents?: ExtractedDocument[];
}): Promise<WorkflowEnvelope<ExplanationResponse>> {
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
  const result = await provider.generateStructured<ExplanationResponse>({
    system: `You adapt an existing concept explanation to a requested learner level and language style. Preserve the concept's meaning. Do not introduce unsupported URLs.

If source evidence is provided, distinguish "what the source says" from your general educational explanation. In uploaded-only mode, do not make factual claims that cannot be supported by the evidence. Return evidence identifiers only when they appear in the supplied evidence metadata.`,
    user: `Concept: ${input.node.title}
Base description: ${input.node.shortDescription}
Why it matters: ${input.node.whyItMatters ?? ""}
Why it is difficult: ${input.node.difficultyExplanation}
Difficulty factors: ${input.node.difficultyFactors.join(", ")}
Prerequisites: ${input.node.prerequisites.join(", ")}
Requested explanation level: ${input.level}
Learner/session profile: ${JSON.stringify(input.learnerProfile ?? {})}
Source mode: ${sourceMode(input.learnerProfile)}
Retrieved source evidence: ${JSON.stringify(evidence)}`,
    schema: ExplanationResponseSchema,
    schemaName: "AdaptiveExplanation",
    schemaHint: "JSON fields: explanation:string, sourceSummary?:string, example:string, keyTakeaway:string, evidence:[{documentId,sectionId,page?,heading?}].",
    temperature: 0.25,
  });
  const verifiedExplanationEvidence = verifiedEvidenceReferences(result.data.evidence ?? [], evidence);
  if (sourceMode(input.learnerProfile) === "uploaded-only" && !verifiedExplanationEvidence.length) {
    throw new Error("The generated explanation did not preserve verifiable uploaded-source provenance.");
  }
  let explanationData: ExplanationResponse = {
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
    runtime.handoff(
      "concept_architect",
      "pedagogy_validator",
      trace,
      "Concept Architect handed the source-grounded explanation to Pedagogy Validator for attribution review.",
    );
    const sourceValidation = await runtime.run<any, PedagogyValidation>(
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
    );
    const validatedSource = addDeterministicSourceChecks(
      sourceValidation.data,
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
