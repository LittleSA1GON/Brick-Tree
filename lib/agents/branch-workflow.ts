import { TraceCollector } from "@/lib/observability/trace";
import { getEnv } from "@/lib/config/env";
import type { ConceptEdge, ConceptNode, GraphContext, GraphLevelDescriptor } from "@/lib/schemas/concept";
import type { LearnerProfile, LearningPathProposal } from "@/lib/schemas/learning-path";
import type { PedagogyValidation } from "@/lib/schemas/validation";
import type { ExtractedDocument } from "@/lib/schemas/documents";
import type { BrickIntent } from "@/lib/schemas/session";
import { difficultyLabel, suggestedNextLevel } from "@/lib/graph/levels";
import { conceptId } from "@/lib/graph/graph-utils";
import { normalizeConceptTitle } from "@/lib/utils/text";
import { verifiedEvidenceReferences } from "@/lib/documents/provenance";
import {
  type BrickLayerNode,
  type WorkflowEnvelope,
  addAdjacentStepChecks,
  addBrickNoveltyChecks,
  addBrickStackShapeChecks,
  addDestinationHeightChecks,
  addDeterministicDifficultyChecks,
  addDeterministicSourceChecks,
  addDeterministicTitleChecks,
  addLearnerFitChecks,
  brickStackEdges,
  brickSupportNodes,
  desiredBrickRowSize,
  deterministicValidationBaseline,
  evidenceOrigins,
  existingLevel,
  narrateLevel,
  orderDirectionsForBrickStack,
  runtime,
  sourceEvidence,
  sourceMode,
} from "@/lib/agents/workflow-core";


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

