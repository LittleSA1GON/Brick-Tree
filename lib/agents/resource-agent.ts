import type { AgentSpec } from "@/lib/agents/spec";
import { ResourceQueryPlanSchema, type ResourceQueryPlan } from "@/lib/schemas/resources";
import type { ConceptNode } from "@/lib/schemas/concept";
import type { LearnerProfile } from "@/lib/schemas/learning-path";

export type ResourcePlanInput = {
  node: ConceptNode;
  learnerProfile?: LearnerProfile;
  webSearchAvailable: boolean;
};

export const resourcePlannerAgent: AgentSpec<ResourcePlanInput, ResourceQueryPlan> = {
  name: "resource_agent",
  description: "Resource Agent is choosing trustworthy resources that fit this learner and concept.",
  instructions: `You are Brick Tree's Resource Agent. Plan a small number of high-value educational searches using reputable institutions, official documentation, and scholarly sources. Never use Wikipedia.

Match the source difficulty to the learner. Elementary, middle-school, high-school, novice, or beginner learners should usually receive approachable instruction from sources such as Khan Academy, OpenStax, university introductory courses, or official learning materials before research papers. College learners can receive textbooks, university courses, and selected scholarly sources. Graduate, professional, advanced, expert, or research learners can receive primary papers and advanced institutional material.

For machine learning or another advanced technical subject, scholarly papers and university/official technical material can be appropriate when the learner is ready. For high-school algebra or similar foundational material, prefer approachable instruction such as Khan Academy or OpenStax rather than research papers.

Use learner educationLevel, knowledgeLevel, purpose, preferredResourceTypes, preferredExamples, and exploreBias as semantic steering signals. Do not invent URLs; you only plan queries and source types.`,
  allowedTools: [
    "search_institution_resources",
    "search_academic_resources",
    "search_web",
  ],
  allowedHandoffs: [],
  maxSteps: 5,
  outputSchema: ResourceQueryPlanSchema,
  schemaName: "ResourceQueryPlan",
  schemaHint: `JSON field queries: 1-5 items, each {query:string, source:'institution'|'academic'|'web', reason:string, domains?:string[]}. Do not use Wikipedia.`,
  buildUserPrompt(input) {
    return `Concept: ${input.node.title}
Description: ${input.node.shortDescription}
Difficulty: ${input.node.difficulty}/5 · ${input.node.difficultyLabel}
Difficulty explanation: ${input.node.difficultyExplanation}
Learner profile: ${JSON.stringify(input.learnerProfile ?? {})}
General web search available: ${input.webSearchAvailable}

Preferred resource types: ${(input.learnerProfile?.preferredResourceTypes ?? []).join(", ") || "not specified"}
Preferred examples: ${(input.learnerProfile?.preferredExamples ?? []).join(", ") || "not specified"}

Plan sources that are credible and appropriate for this learner. Prefer institutions and official educational material for introductory learners; add scholarly papers only when the topic and learner level justify them.`;
  },
};
