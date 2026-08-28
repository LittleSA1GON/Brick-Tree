import { TraceCollector } from "@/lib/observability/trace";
import { getEnv } from "@/lib/config/env";
import type { LearnerProfile } from "@/lib/schemas/learning-path";
import type { PedagogyValidation } from "@/lib/schemas/validation";
import type { ExtractedDocument } from "@/lib/schemas/documents";
import { createLLMProvider } from "@/lib/llm/factory";
import { AdaptiveExplanationSchema, ExplanationLevelSchema, type AdaptiveExplanation, type ExplanationLevel, type ExplanationNodeContext } from "@/lib/schemas/api";
import { verifiedEvidenceReferences } from "@/lib/documents/provenance";
import {
  type WorkflowEnvelope,
  addDeterministicSourceChecks,
  agents,
  deterministicValidationBaseline,
  runtime,
  sourceEvidence,
  sourceMode,
} from "@/lib/agents/workflow-core";


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
