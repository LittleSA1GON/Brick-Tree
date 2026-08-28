import { TraceCollector } from "@/lib/observability/trace";
import { getEnv } from "@/lib/config/env";
import type { ConceptEdge, ConceptNode, GraphLevelDescriptor } from "@/lib/schemas/concept";
import type { LearnerProfile, LearningPathProposal } from "@/lib/schemas/learning-path";
import type { PedagogyValidation } from "@/lib/schemas/validation";
import type { ExtractedDocument, RetrievedChunk } from "@/lib/schemas/documents";
import type { BrickIntent } from "@/lib/schemas/session";
import { difficultyLabel, levelFromDifficulties } from "@/lib/graph/levels";
import { conceptId } from "@/lib/graph/graph-utils";
import { normalizeConceptTitle } from "@/lib/utils/text";
import { verifiedEvidenceReferences } from "@/lib/documents/provenance";
import {
  type WorkflowEnvelope,
  addAdjacentStepChecks,
  addBrickNoveltyChecks,
  addBrickStackShapeChecks,
  addDestinationHeightChecks,
  addDeterministicDifficultyChecks,
  addDeterministicSourceChecks,
  addDeterministicTitleChecks,
  addLearnerFitChecks,
  brickFoundationTitles,
  brickKnownTitles,
  brickStackEdges,
  brickSupportNodes,
  deterministicValidationBaseline,
  evidenceOrigins,
  narrateLevel,
  orderDirectionsForBrickStack,
  rootNode,
  runtime,
  sourceEvidence,
  sourceMode,
} from "@/lib/agents/workflow-core";


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

