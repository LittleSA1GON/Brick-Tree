import { TraceCollector } from "@/lib/observability/trace";
import { getEnv } from "@/lib/config/env";
import type { ConceptDecomposition, ConceptEdge, ConceptNode, GraphContext, GraphLevelDescriptor } from "@/lib/schemas/concept";
import type { LearnerProfile } from "@/lib/schemas/learning-path";
import type { PedagogyValidation } from "@/lib/schemas/validation";
import type { ExtractedDocument } from "@/lib/schemas/documents";
import type { TreeIntent } from "@/lib/schemas/session";
import { difficultyConsistencyIssues, levelFromDifficulties, suggestedNextLevel } from "@/lib/graph/levels";
import { normalizeConceptTitle } from "@/lib/utils/text";
import {
  type WorkflowEnvelope,
  addAdjacentStepChecks,
  addDeterministicDifficultyChecks,
  addDeterministicSourceChecks,
  addDeterministicTitleChecks,
  childrenFromDecomposition,
  deterministicValidationBaseline,
  existingLevel,
  narrateLevel,
  normalizedKnown,
  rootNode,
  runtime,
  sourceEvidence,
  sourceMode,
  treeQuery,
  treeValidationKind,
} from "@/lib/agents/workflow-core";


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

