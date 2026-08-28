import { TraceCollector } from "@/lib/observability/trace";
import { getEnv } from "@/lib/config/env";
import type { ResourceLink } from "@/lib/schemas/concept";
import type { LearnerProfile } from "@/lib/schemas/learning-path";
import type { RawSearchResult, ResourceCandidate, ResourceNodeContext, ResourceQueryPlan, ResourceSelection } from "@/lib/schemas/resources";
import { buildResourceStrategy, resourceTypeFit, type ResourceStrategy } from "@/lib/agents/resource-strategy";
import {
  type WorkflowEnvelope,
  cacheResources,
  resourceCache,
  resourceCacheKey,
  runtime,
} from "@/lib/agents/workflow-core";


function safeCandidateUrl(candidate: RawSearchResult): boolean {
  try {
    const parsed = new URL(candidate.url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "::1" || host.endsWith(".local")) return false;
    if (host.endsWith("wikipedia.org") || host.endsWith("wikimedia.org")) return false;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return true;
    const [a, b] = ipv4.slice(1).map(Number);
    return !(a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  } catch {
    return false;
  }
}

function compactSearchQuery(...parts: string[]): string {
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 280).trim();
}

function typeSearchTerms(strategy: ResourceStrategy): string {
  const terms: Record<string, string> = {
    article: "clear explanation guide",
    video: "video lecture walkthrough",
    course: "tutorial lesson course",
    documentation: "official documentation implementation guide",
    reference: "reference handbook textbook guide",
    paper: "research paper study",
  };
  return strategy.targetTypes.map((type) => terms[type]).join(" ");
}

function deterministicResourcePlan(
  node: ResourceNodeContext,
  webSearchAvailable: boolean,
  profile: LearnerProfile | undefined,
  strategy: ResourceStrategy,
): ResourceQueryPlan {
  const level = profile?.knowledgeLevel ?? "beginner";
  const education = profile?.educationLevel ?? "high-school";
  const purpose = profile?.purpose ?? "general-learning";
  const audience = `${education} ${level}`;
  const preferred = (profile?.preferredResourceTypes ?? []).slice(0, 3).join(" ").trim();
  const intentTerms: Record<ResourceStrategy["intent"], string> = {
    conceptual: "clear explanation examples",
    procedural: "worked examples practice step by step",
    implementation: "official documentation implementation examples",
    reference: "deep reference handbook guide",
    research: "technical overview evidence review",
  };
  const learningGoal = purpose === "exam" || purpose === "class"
    ? "practice lesson worked examples"
    : preferred || intentTerms[strategy.intent];
  const queries: ResourceQueryPlan["queries"] = [];

  // One high-signal web query per node is the normal path. The search tool itself
  // rotates between configured providers and only falls back when needed, avoiding
  // the old multiplication of several near-duplicate queries across both providers.
  if (webSearchAvailable) {
    queries.push({
      query: compactSearchQuery(node.title, audience, learningGoal, typeSearchTerms(strategy)),
      source: "web",
      reason: `Single adaptive web query for ${strategy.targetTypes.join(", ")} at ${node.difficulty}/5 difficulty.`,
    });
  }

  // Academic retrieval is additive only when the resource strategy explicitly
  // warrants papers/evidence; difficulty by itself never creates this call.
  if (strategy.academicSearch) {
    queries.push({
      query: compactSearchQuery(node.title, purpose === "research" ? "research evidence literature" : "scholarly evidence review"),
      source: "academic",
      reason: `Academic evidence is relevant here; selected papers remain capped at ${strategy.maxPapers}.`,
    });
  }

  return { queries: queries.slice(0, 2) };
}

function resourceTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#. -]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function resourceHost(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return "unknown"; }
}

function relevanceScore(candidate: RawSearchResult, node: ResourceNodeContext): number {
  const targetTokens = new Set(resourceTokens(`${node.title} ${node.shortDescription} ${node.difficultyFactors.join(" ")} ${node.learningOutcomes.join(" ")} ${node.applications.join(" ")}`));
  if (!targetTokens.size) return 0.5;
  const titleTokens = resourceTokens(candidate.title);
  const bodyTokens = new Set(resourceTokens(`${candidate.title} ${candidate.snippet ?? ""}`));
  const titleMatches = titleTokens.filter((token) => targetTokens.has(token)).length;
  const allMatches = [...targetTokens].filter((token) => bodyTokens.has(token)).length;
  const lexical = Math.min(1, (titleMatches * 1.8 + allMatches) / Math.max(3, targetTokens.size));
  return Math.max(lexical, candidate.searchScore ?? 0);
}

function credibilityScore(candidate: RawSearchResult): number {
  let score = 0.5;
  const signals = new Set(candidate.credibilitySignals ?? []);
  if (signals.has("HTTPS")) score += 0.06;
  if (signals.has("institutional-domain") || signals.has("government-domain")) score += 0.12;
  if (signals.has("scholarly-index")) score += 0.1;
  if (signals.has("DOI")) score += 0.04;
  if (candidate.citationCount) score += Math.min(0.06, Math.log10(candidate.citationCount + 1) * 0.02);
  if ((candidate.snippet ?? "").length >= 80) score += 0.04;
  return Math.min(1, score);
}

function audienceFitScore(candidate: RawSearchResult, node: ResourceNodeContext, profile?: LearnerProfile): number {
  const education = (profile?.educationLevel ?? "high-school").toLowerCase();
  const knowledge = profile?.knowledgeLevel ?? "beginner";
  const introductory = ["elementary", "middle-school", "high-school"].includes(education)
    || ["novice", "beginner"].includes(knowledge);

  let score = 0.68;
  if (introductory) {
    if (["course", "video", "article"].includes(candidate.type)) score += 0.16;
    if (candidate.type === "documentation") score -= 0.08;
    if (candidate.type === "paper") score -= 0.22;
  } else if (["advanced", "expert"].includes(knowledge)) {
    if (["documentation", "reference"].includes(candidate.type)) score += 0.1;
  }

  const preferences = (profile?.preferredResourceTypes ?? []).join(" ").toLowerCase();
  if (preferences && preferences.includes(candidate.type)) score += 0.14;
  if (node.difficulty <= 2 && candidate.type === "paper") score -= 0.18;
  return Math.max(0, Math.min(1, score));
}

function deterministicResourceSelection(
  candidates: ResourceCandidate[],
  node: ResourceNodeContext,
  profile: LearnerProfile | undefined,
  strategy: ResourceStrategy,
): ResourceCandidate[] {
  const ranked = candidates
    .filter((candidate) => candidate.type !== "paper" || strategy.maxPapers > 0)
    .map((candidate) => ({
      candidate,
      base:
        relevanceScore(candidate, node) * 0.42
        + resourceTypeFit(candidate.type, strategy) * 0.28
        + credibilityScore(candidate) * 0.18
        + audienceFitScore(candidate, node, profile) * 0.12,
    }))
    .sort((a, b) => b.base - a.base);

  const selected: ResourceCandidate[] = [];
  const hostCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const providerCounts = new Map<string, number>();
  let paperCount = 0;

  while (selected.length < 5 && ranked.length) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < ranked.length; index += 1) {
      const item = ranked[index];
      if (item.candidate.type === "paper" && paperCount >= strategy.maxPapers) continue;
      const host = resourceHost(item.candidate.url);
      const hostPenalty = (hostCounts.get(host) ?? 0) * 0.18;
      const typePenalty = (typeCounts.get(item.candidate.type) ?? 0) * 0.08;
      const provider = item.candidate.provider ?? item.candidate.source;
      const providerPenalty = (providerCounts.get(provider) ?? 0) * 0.04;
      const diversityBonus = (hostCounts.has(host) ? 0 : 0.08) + (typeCounts.has(item.candidate.type) ? 0 : 0.05);
      const score = item.base + diversityBonus - hostPenalty - typePenalty - providerPenalty;
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex < 0) break;
    const [{ candidate }] = ranked.splice(bestIndex, 1);
    if (selected.length && bestScore < 0.32) break;
    selected.push(candidate);
    if (candidate.type === "paper") paperCount += 1;
    const host = resourceHost(candidate.url);
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
    typeCounts.set(candidate.type, (typeCounts.get(candidate.type) ?? 0) + 1);
    const provider = candidate.provider ?? candidate.source;
    providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1);
  }

  return selected;
}

function enforceResourceMix(
  preferred: ResourceCandidate[],
  fallback: ResourceCandidate[],
  strategy: ResourceStrategy,
): ResourceCandidate[] {
  const result: ResourceCandidate[] = [];
  const seen = new Set<string>();
  let papers = 0;
  for (const candidate of [...preferred, ...fallback]) {
    if (seen.has(candidate.candidateId)) continue;
    if (candidate.type === "paper" && papers >= strategy.maxPapers) continue;
    if (candidate.type === "paper" && strategy.maxPapers === 0) continue;
    result.push(candidate);
    seen.add(candidate.candidateId);
    if (candidate.type === "paper") papers += 1;
    if (result.length >= 5) break;
  }
  return result;
}

export async function findResources(input: {
  node: ResourceNodeContext;
  learnerProfile?: LearnerProfile;
}): Promise<WorkflowEnvelope<{ resources: ResourceLink[] }>> {
  const trace = new TraceCollector();
  const warnings: string[] = [];
  const env = getEnv();
  const webSearchAvailable = Boolean(env.TAVILY_API_KEY || env.BRAVE_SEARCH_API_KEY);
  const originAgent = input.node.axis === "depth" ? "concept_architect" : "learning_path";
  const strategy = buildResourceStrategy(input.node, input.learnerProfile);
  const cacheKey = resourceCacheKey(input.node, input.learnerProfile, strategy, env.RESOURCE_PLANNING_MODE);
  const cached = resourceCache.get(cacheKey);
  if (cached?.expiresAt && cached.expiresAt > Date.now()) {
    trace.add("agent_finish", `Resource Agent reused ${cached.resources.length} cached adaptive resources for ${input.node.title}.`, {
      agent: "resource_agent",
      metadata: { cache: "hit", resourceIntent: strategy.intent, targetTypes: strategy.targetTypes },
    });
    return { data: { resources: cached.resources }, trace: trace.list(), warnings };
  }
  if (cached) resourceCache.delete(cacheKey);

  runtime.handoff(originAgent, "resource_agent", trace, {
    summary: `${originAgent === "concept_architect" ? "Concept Architect" : "Learning Path Agent"} handed ${input.node.title} to Resource Agent for learner-specific source discovery.`,
    context: {
      nodeId: input.node.id,
      nodeTitle: input.node.title,
      difficulty: input.node.difficulty,
      difficultyLabel: input.node.difficultyLabel,
      axis: input.node.axis,
      learnerProfile: input.learnerProfile ? {
        educationLevel: input.learnerProfile.educationLevel,
        knowledgeLevel: input.learnerProfile.knowledgeLevel,
        purpose: input.learnerProfile.purpose,
        depthPreference: input.learnerProfile.depthPreference,
        exploreBias: input.learnerProfile.exploreBias,
        preferredResourceTypes: input.learnerProfile.preferredResourceTypes?.slice(0, 6),
      } : null,
    },
  });

  const plan = deterministicResourcePlan(input.node, webSearchAvailable, input.learnerProfile, strategy);
  trace.add("agent_start", "Resource Agent created a source-neutral, format-adaptive retrieval plan from the node and learner context.", {
    agent: "resource_agent",
    metadata: {
      strategy: { intent: strategy.intent, targetTypes: strategy.targetTypes, maxPapers: strategy.maxPapers, rationale: strategy.rationale },
      queries: plan.queries.map((query) => ({ source: query.source, reason: query.reason })),
    },
  });
  if (!plan.queries.length) {
    warnings.push("No configured retrieval provider matched this node's resource strategy; academic papers were not used as a generic fallback.");
  }

  const rawCandidates: RawSearchResult[] = [];
  for (const query of plan.queries.slice(0, 2)) {
    const tool = query.source === "academic" ? "search_academic_resources" : "search_web";
    try {
      const results = (await runtime.executeTool(
        "resource_agent",
        tool,
        { query: query.query, limit: 5 },
        trace,
      )) as RawSearchResult[];
      rawCandidates.push(...results);
    } catch (error) {
      warnings.push(`${tool} was unavailable for one query.`);
      trace.add("error", `${tool} failed: ${error instanceof Error ? error.message : String(error)}`, {
        agent: "resource_agent",
      });
    }
  }

  const seenUrls = new Set<string>();
  let paperCandidates = 0;
  const paperCandidateLimit = Math.max(strategy.maxPapers * 3, strategy.maxPapers ? 3 : 0);
  const candidates: ResourceCandidate[] = rawCandidates
    .filter(safeCandidateUrl)
    .filter((candidate) => {
      if (candidate.type !== "paper") return true;
      if (strategy.maxPapers === 0 || paperCandidates >= paperCandidateLimit) return false;
      paperCandidates += 1;
      return true;
    })
    .filter((candidate) => {
      const key = candidate.url.replace(/\/$/, "").toLowerCase();
      if (seenUrls.has(key)) return false;
      seenUrls.add(key);
      return true;
    })
    .slice(0, 30)
    .map((candidate, index) => ({ ...candidate, candidateId: `candidate-${index + 1}` }));

  const deterministicSelected = deterministicResourceSelection(candidates, input.node, input.learnerProfile, strategy);
  let selected = deterministicSelected;


  if (env.RESOURCE_PLANNING_MODE === "llm" && candidates.length) {
    try {
      const selection = (
        await runtime.run<any, ResourceSelection>(
          "resource_agent",
          { node: input.node, learnerProfile: input.learnerProfile, candidates, strategy },
          trace,
        )
      ).data;
      const byId = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
      const validIds = [...new Set(selection.selected.map((item) => item.candidateId))];
      const llmSelected = validIds
        .map((id) => byId.get(id))
        .filter((candidate): candidate is ResourceCandidate => Boolean(candidate))
        .slice(0, 5);
      if (llmSelected.length) {
        selected = enforceResourceMix(llmSelected, deterministicSelected, strategy);
        trace.add("validation", selection.summary, { agent: "resource_agent" });
      } else {
        warnings.push("Resource Agent returned no valid candidate IDs, so deterministic selection was used.");
      }
    } catch (error) {
      warnings.push("Resource Agent selection fell back to deterministic scoring after the configured model was unavailable.");
      trace.add("error", `Resource Agent model selection failed: ${error instanceof Error ? error.message : String(error)}`, {
        agent: "resource_agent",
      });
    }
  }

  const resources: ResourceLink[] = selected.map((candidate) => ({
    title: candidate.title,
    url: candidate.url,
    source: candidate.source,
    type: candidate.type,
    description: candidate.snippet,
    verified: true,
  }));

  trace.add("agent_finish", `Resource Agent selected ${resources.length} node-specific resource links from ${candidates.length} retrieved candidates.`, {
    agent: "resource_agent",
    metadata: {
      candidateCount: candidates.length,
      selectedCandidateIds: selected.map((candidate) => candidate.candidateId),
      distinctHosts: new Set(selected.map((candidate) => resourceHost(candidate.url))).size,
      selectionMode: env.RESOURCE_PLANNING_MODE === "llm" ? "llm-with-deterministic-fallback" : "deterministic",
      resourceIntent: strategy.intent,
      targetTypes: strategy.targetTypes,
      maxPapers: strategy.maxPapers,
      selectedTypes: selected.map((candidate) => candidate.type),
    },
  });

  cacheResources(cacheKey, resources);
  return {
    data: { resources },
    trace: trace.list(),
    warnings,
  };
}

/**
 * Hydrate a generated layer in one HTTP request while keeping each node's actual
 * retrieval independent. Search calls run with a small concurrency cap so a row
 * does not burst every provider at once.
 */
export async function findResourcesBatch(input: {
  nodes: ResourceNodeContext[];
  learnerProfile?: LearnerProfile;
}): Promise<WorkflowEnvelope<{ items: Array<{ nodeId: string; resources: ResourceLink[] }> }>> {
  const unique = [...new Map(input.nodes.map((node) => [node.id, node])).values()].slice(0, 20);
  const items: Array<{ nodeId: string; resources: ResourceLink[] }> = [];
  const traceEvents: ReturnType<TraceCollector["list"]> = [];
  const warnings: string[] = [];
  const concurrency = 2;
  let cursor = 0;

  async function worker() {
    while (cursor < unique.length) {
      const index = cursor;
      cursor += 1;
      const node = unique[index];
      try {
        const result = await findResources({ node, learnerProfile: input.learnerProfile });
        items[index] = { nodeId: node.id, resources: result.data.resources };
        traceEvents.push(...result.trace);
        warnings.push(...result.warnings);
      } catch (error) {
        items[index] = { nodeId: node.id, resources: [] };
        warnings.push(`Resources could not be loaded for ${node.title}.`);
        const trace = new TraceCollector();
        trace.add("error", `Resource hydration failed for ${node.title}: ${error instanceof Error ? error.message : String(error)}`, {
          agent: "resource_agent",
        });
        traceEvents.push(...trace.list());
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, () => worker()));
  return {
    data: { items: items.filter(Boolean) },
    trace: traceEvents.slice(-100),
    warnings: [...new Set(warnings)].slice(0, 10),
  };
}

