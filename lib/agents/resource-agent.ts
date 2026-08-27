import type { AgentSpec } from "@/lib/agents/spec";
import { ResourceSelectionSchema, type ResourceCandidate, type ResourceSelection } from "@/lib/schemas/resources";
import type { ConceptNode } from "@/lib/schemas/concept";
import type { LearnerProfile } from "@/lib/schemas/learning-path";

export type ResourceSelectionInput = {
  node: ConceptNode;
  learnerProfile?: LearnerProfile;
  candidates: ResourceCandidate[];
};

export const resourceAgent: AgentSpec<ResourceSelectionInput, ResourceSelection> = {
  name: "resource_agent",
  description: "Resource Agent evaluates retrieved sources for relevance, credibility, learner fit, difficulty fit, and diversity.",
  instructions: `You are Brick Tree's Resource Agent. You receive a concept node, learner context, and a bounded list of already-retrieved resource candidates.

Your job is SELECTION, not URL generation. You may only return candidateId values that appear in the supplied candidate list. Never invent a resource, URL, title, provider, or candidate ID.

Evaluate every candidate on these principles:
1. Relevance: it should directly help with this exact node, not merely the broad subject.
2. Credibility evidence: favor primary sources, official documentation, established educational or research institutions, reputable publishers, scholarly indexes, and sources with clear authorship/editorial responsibility. Judge evidence, not brand familiarity.
3. Learner fit: match education level, knowledge level, purpose, preferred resource types/examples, language style, and depth preference when provided.
4. Difficulty fit: introductory nodes should receive approachable explanations or guided material; advanced nodes may justify technical documentation, reference works, or primary research.
5. Diversity: when quality is comparable, avoid returning several resources from the same host, publisher, provider, or identical format. Give the learner complementary ways to learn.

Source-neutrality rule: DO NOT prefer or boost a website simply because it is famous or appears on a memorized preferred list. There is no preferred-domain whitelist. A lesser-known source may outrank a famous one when it is more relevant, better evidenced, more appropriate for the learner, or more useful for this exact node.

Reject obvious SEO/content-farm pages, thin aggregators, unverifiable mirrors, unrelated results, and sources whose difficulty is a poor fit. Wikipedia/Wikimedia candidates should not be present; if one appears, do not select it.

Return up to five candidate IDs in strongest learner-specific order, with concise reasons.`,
  allowedTools: ["search_academic_resources", "search_web"],
  allowedHandoffs: [],
  maxSteps: 4,
  outputSchema: ResourceSelectionSchema,
  schemaName: "ResourceSelection",
  schemaHint: `JSON fields: selected:[{candidateId:string,reason:string}] (1-5 items, candidateId MUST be copied from supplied candidates), summary:string. Do not return URLs.`,
  buildUserPrompt(input) {
    const profile = input.learnerProfile ?? {};
    const candidates = input.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      title: candidate.title,
      source: candidate.source,
      provider: candidate.provider,
      type: candidate.type,
      snippet: candidate.snippet,
      credibilitySignals: candidate.credibilitySignals,
      searchScore: candidate.searchScore,
      citationCount: candidate.citationCount,
      publishedAt: candidate.publishedAt,
      urlHost: (() => {
        try { return new URL(candidate.url).hostname.replace(/^www\./, ""); } catch { return "invalid"; }
      })(),
    }));

    return `Node: ${input.node.title}\nNode description: ${input.node.shortDescription}\nDifficulty: ${input.node.difficulty}/5 (${input.node.difficultyLabel})\nDifficulty explanation: ${input.node.difficultyExplanation}\nLearner profile: ${JSON.stringify(profile)}\nCandidates: ${JSON.stringify(candidates)}\n\nSelect only supplied candidate IDs. Optimize relevance + credibility evidence + learner fit + difficulty fit + source diversity without preferred-site bias.`;
  },
};
