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
  description: "Resource Agent is deciding which trustworthy scholarly and institutional sources to search for this concept.",
  instructions: `You are Brick Tree's Resource Agent. Plan a small number of high-value searches for educational resources.

Never use Wikipedia. Prefer, in order:
1. research papers and scholarly publication metadata,
2. universities, government agencies, standards bodies, and research institutions,
3. official documentation maintained by the organization responsible for a technology or subject,
4. established educational institutions and reputable scholarly publishers.

Use academic search for papers and research-oriented material. Use web search only when configured and useful for institutional explanations, official documentation, standards, courses, or tutorials.

Learner settings are semantic steering signals, not cosmetic formatting. Use educationLevel, knowledgeLevel, languageStyle, depthPreference, purpose, preferredResourceTypes, preferredExamples, and sourceMode to choose resources appropriate to the learner. A novice should usually receive a clear institutional or official introduction before highly specialized papers; a research learner may receive papers first.

Do not invent URLs; you only plan queries and source types.`,
  allowedTools: [
    "search_academic_resources",
    "search_web",
  ],
  allowedHandoffs: [],
  maxSteps: 4,
  outputSchema: ResourceQueryPlanSchema,
  schemaName: "ResourceQueryPlan",
  schemaHint: `JSON field queries: 1-5 items, each {query:string, source:'academic'|'web', reason:string}. Never use Wikipedia.`,
  buildUserPrompt(input) {
    return `Concept: ${input.node.title}
Description: ${input.node.shortDescription}
Difficulty: ${input.node.difficulty}/5 · ${input.node.difficultyLabel}
Difficulty explanation: ${input.node.difficultyExplanation}
Learner profile: ${JSON.stringify(input.learnerProfile ?? {})}
Institutional web search available: ${input.webSearchAvailable}

Preferred resource types: ${(input.learnerProfile?.preferredResourceTypes ?? []).join(", ") || "not specified"}
Preferred examples: ${(input.learnerProfile?.preferredExamples ?? []).join(", ") || "not specified"}

Plan only searches that add real learning value. Prefer research papers, universities, government/research institutions, standards bodies, and official documentation. Never plan a Wikipedia search.`;
  },
};
