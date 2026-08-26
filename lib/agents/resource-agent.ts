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
  description: "Resource Agent is deciding which trustworthy sources to search for this concept.",
  instructions: `You are Brick Tree's Resource Agent. Plan a small number of high-value searches for educational resources. Prefer authoritative or educational sources. Use Wikipedia for broad reference, academic search for research-oriented or advanced concepts, and web search only when configured and useful.

Learner settings are semantic steering signals, not cosmetic formatting. Use knowledgeLevel, languageStyle, depthPreference, purpose, preferredResourceTypes, preferredExamples, and sourceMode to choose resources appropriate to the learner. A research learner may benefit from papers; a novice should usually receive clear introductory material before scholarly sources. If the learner requested documentation, courses, videos, or papers, reflect that in query wording when the source can support it.

Do not invent URLs; you only plan queries and source types.`,
  allowedTools: [
    "search_wikipedia",
    "search_academic_resources",
    "search_web",
  ],
  allowedHandoffs: [],
  maxSteps: 5,
  outputSchema: ResourceQueryPlanSchema,
  schemaName: "ResourceQueryPlan",
  schemaHint: `JSON field queries: 1-5 items, each {query:string, source:'wikipedia'|'academic'|'web', reason:string}.`,
  buildUserPrompt(input) {
    return `Concept: ${input.node.title}
Description: ${input.node.shortDescription}
Difficulty: ${input.node.difficulty}/5 · ${input.node.difficultyLabel}
Difficulty explanation: ${input.node.difficultyExplanation}
Learner profile: ${JSON.stringify(input.learnerProfile ?? {})}
General web search available: ${input.webSearchAvailable}

Preferred resource types: ${(input.learnerProfile?.preferredResourceTypes ?? []).join(", ") || "not specified"}
Preferred examples: ${(input.learnerProfile?.preferredExamples ?? []).join(", ") || "not specified"}

Plan only searches that add real learning value and fit the learner's requested level, vernacular, purpose, and resource preferences.`;
  },
};
