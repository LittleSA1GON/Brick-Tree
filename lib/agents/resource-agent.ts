import type { AgentSpec } from "@/lib/agents/spec";
import { ResourceSelectionSchema, type ResourceCandidate, type ResourceSelection } from "@/lib/schemas/resources";
import type { ConceptNode } from "@/lib/schemas/concept";
import type { LearnerProfile } from "@/lib/schemas/learning-path";
import type { ResourceStrategy } from "@/lib/agents/resource-strategy";

export type ResourceSelectionInput = {
  node: ConceptNode;
  learnerProfile?: LearnerProfile;
  candidates: ResourceCandidate[];
  strategy: ResourceStrategy;
};

export const resourceAgent: AgentSpec<ResourceSelectionInput, ResourceSelection> = {
  name: "resource_agent",
  description: "Resource Agent evaluates retrieved sources for relevance, credibility, learner fit, difficulty fit, and diversity.",
  instructions: `You are Brick Tree's Resource Agent. You receive a concept node, learner context, and a bounded list of already-retrieved resource candidates.

Your job is SELECTION, not URL generation. You may only return candidateId values that appear in the supplied candidate list. Never invent a resource, URL, title, provider, or candidate ID.

Evaluate every candidate on these principles:
1. Relevance: it should directly help with this exact node, not merely the broad subject.
2. Credibility evidence: favor primary sources, official documentation, established educational institutions, reputable publishers, scholarly indexes, and sources with clear authorship/editorial responsibility. Judge evidence, not brand familiarity. Credibility is not the same as pedagogical usefulness.
3. Learner fit: match education level, knowledge level, purpose, preferred resource types/examples, language style, and depth preference when provided.
4. Difficulty and task fit: introductory nodes should receive approachable explanations, lessons, visuals, or worked examples. Advanced difficulty should increase depth, not automatically imply research papers. Prefer documentation for implementation tasks, worked examples for procedural material, reference/textbook-style material for deep established concepts, and papers only when the node actually involves research evidence/frontier knowledge or the learner explicitly wants research literature.
5. Diversity: when quality is comparable, avoid returning several resources from the same host, publisher, provider, or identical format. Give the learner complementary ways to learn.

Source-neutrality rule: DO NOT prefer or boost a website simply because it is famous or appears on a memorized preferred list. There is no preferred-domain whitelist. A lesser-known source may outrank a famous one when it is more relevant, better evidenced, more appropriate for the learner, or more useful for this exact node.

Reject obvious SEO/content-farm pages, thin aggregators, unverifiable mirrors, unrelated results, and sources whose difficulty is a poor fit. Wikipedia/Wikimedia candidates should not be present; if one appears, do not select it.

Respect the supplied resource strategy, including its target resource types and maximum paper count. A scholarly paper must never outrank a more useful tutorial/reference merely because it is scholarly.

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

    return `Node: ${input.node.title}\nNode description: ${input.node.shortDescription}\nDifficulty: ${input.node.difficulty}/5 (${input.node.difficultyLabel})\nDifficulty explanation: ${input.node.difficultyExplanation}\nLearner profile: ${JSON.stringify(profile)}\nAdaptive resource strategy: ${JSON.stringify(input.strategy)}\nCandidates: ${JSON.stringify(candidates)}\n\nSelect only supplied candidate IDs. Follow the adaptive strategy first, then optimize exact relevance + credibility evidence + learner fit + source diversity. Do not equate higher difficulty with research papers, and do not exceed maxPapers.`;
  },
};
