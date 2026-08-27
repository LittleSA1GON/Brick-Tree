import type { ResourceLink } from "@/lib/schemas/concept";
import type { ResourceNodeContext } from "@/lib/schemas/resources";
import type { LearnerProfile } from "@/lib/schemas/learning-path";

export type ResourceType = ResourceLink["type"];
export type ResourceIntent = "conceptual" | "procedural" | "implementation" | "reference" | "research";

export type ResourceStrategy = {
  intent: ResourceIntent;
  typeWeights: Record<ResourceType, number>;
  targetTypes: ResourceType[];
  academicSearch: boolean;
  maxPapers: number;
  rationale: string;
};

const resourceTypes: ResourceType[] = ["article", "video", "course", "documentation", "reference", "paper"];

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function preferenceTypes(values: string[] = []): Set<ResourceType> {
  const result = new Set<ResourceType>();
  for (const value of values) {
    const text = value.toLowerCase();
    if (/video|lecture|watch/.test(text)) result.add("video");
    if (/course|lesson|tutorial|training/.test(text)) result.add("course");
    if (/documentation|docs|api/.test(text)) result.add("documentation");
    if (/reference|handbook|manual|textbook/.test(text)) result.add("reference");
    if (/paper|research|journal|study/.test(text)) result.add("paper");
    if (/article|guide|reading/.test(text)) result.add("article");
  }
  return result;
}

function nodeText(node: ResourceNodeContext): string {
  return [
    node.title,
    node.shortDescription,
    node.difficultyExplanation,
    ...node.difficultyFactors,
    ...node.learningOutcomes,
    ...node.applications,
    ...node.examples,
  ].join(" ").toLowerCase();
}

export function buildResourceStrategy(node: ResourceNodeContext, profile?: LearnerProfile): ResourceStrategy {
  const purpose = profile?.purpose ?? "general-learning";
  const knowledge = profile?.knowledgeLevel ?? "beginner";
  const depth = profile?.depthPreference ?? "balanced";
  const bias = profile?.exploreBias ?? "balanced";
  const preferred = preferenceTypes(profile?.preferredResourceTypes);
  const text = nodeText(node);

  const implementationSignal = /\b(api|sdk|library|framework|programming|code|coding|syntax|deploy|deployment|configuration|configure|install|implementation|software|database|sql|cli|command line)\b/.test(text);
  const proceduralSignal = /\b(solve|calculate|calculation|worked example|practice|exercise|derivative|integral|equation|proof|algorithm|procedure|step[- ]by[- ]step)\b/.test(text);
  const referenceSignal = /\b(specification|standard|reference|definition|taxonomy|protocol|grammar|formula sheet|cheat sheet)\b/.test(text);
  const researchSignal = /\b(research|empirical|evidence|study|studies|literature review|state of the art|state-of-the-art|benchmark|experiment|experimental|clinical trial|meta-analysis|systematic review|paper)\b/.test(text);
  const explicitPaperPreference = preferred.has("paper");
  const explicitResearch = purpose === "research" || explicitPaperPreference;
  const academicDeepDive = bias === "academic"
    && depth === "deep"
    && node.difficulty >= 4
    && ["advanced", "expert"].includes(knowledge);
  const evidenceResearch = researchSignal && node.difficulty >= 3;
  const academicSearch = explicitResearch || evidenceResearch || academicDeepDive;
  const maxPapers = explicitResearch ? (node.difficulty >= 4 ? 3 : 2) : evidenceResearch ? 2 : academicDeepDive ? 1 : 0;

  let intent: ResourceIntent = "conceptual";
  if (explicitResearch || evidenceResearch) intent = "research";
  else if (purpose === "project" || implementationSignal || bias === "technical") intent = "implementation";
  else if (purpose === "exam" || purpose === "class" || proceduralSignal) intent = "procedural";
  else if (referenceSignal) intent = "reference";

  const byDifficulty: Record<number, Record<ResourceType, number>> = {
    1: { article: 0.95, video: 0.9, course: 0.92, documentation: 0.28, reference: 0.42, paper: 0.02 },
    2: { article: 0.92, video: 0.84, course: 0.92, documentation: 0.4, reference: 0.55, paper: 0.04 },
    3: { article: 0.88, video: 0.7, course: 0.86, documentation: 0.62, reference: 0.76, paper: 0.08 },
    4: { article: 0.78, video: 0.56, course: 0.76, documentation: 0.82, reference: 0.92, paper: 0.14 },
    5: { article: 0.7, video: 0.46, course: 0.68, documentation: 0.9, reference: 0.96, paper: 0.2 },
  };
  const weights = { ...byDifficulty[node.difficulty] };

  if (intent === "implementation") {
    weights.documentation = 1;
    weights.reference = Math.max(weights.reference, 0.9);
    weights.course = Math.max(weights.course, 0.78);
    weights.article = Math.max(weights.article, 0.78);
    weights.paper = Math.min(weights.paper, 0.08);
  } else if (intent === "procedural") {
    weights.course = 1;
    weights.article = Math.max(weights.article, 0.92);
    weights.video = Math.max(weights.video, 0.84);
    weights.reference = Math.max(weights.reference, 0.7);
    weights.paper = Math.min(weights.paper, 0.06);
  } else if (intent === "reference") {
    weights.reference = 1;
    weights.article = Math.max(weights.article, 0.82);
    weights.documentation = Math.max(weights.documentation, 0.72);
  } else if (intent === "research") {
    weights.paper = 1;
    weights.reference = Math.max(weights.reference, 0.9);
    weights.article = Math.max(weights.article, 0.8);
    weights.course = Math.max(weights.course, 0.55);
  }

  if (purpose === "professional") {
    weights.documentation = Math.max(weights.documentation, 0.88);
    weights.reference = Math.max(weights.reference, 0.9);
    weights.article = Math.max(weights.article, 0.8);
  }
  if (bias === "practical") {
    weights.course = Math.max(weights.course, 0.88);
    weights.article = Math.max(weights.article, 0.86);
    weights.video = Math.max(weights.video, 0.72);
  }
  if (bias === "academic" && !explicitResearch) {
    weights.reference = Math.max(weights.reference, 0.9);
    weights.course = Math.max(weights.course, 0.76);
  }

  for (const type of preferred) weights[type] = 1;
  if (!academicSearch) weights.paper = 0;
  for (const type of resourceTypes) weights[type] = clamp(weights[type]);

  const targetTypes = [...resourceTypes]
    .filter((type) => type !== "paper" || maxPapers > 0)
    .sort((a, b) => weights[b] - weights[a])
    .slice(0, 3);

  const rationale = `Intent=${intent}; difficulty=${node.difficulty}/5; prioritize ${targetTypes.join(", ")}; papers=${maxPapers ? `up to ${maxPapers}` : "not appropriate unless explicitly requested"}.`;
  return { intent, typeWeights: weights, targetTypes, academicSearch, maxPapers, rationale };
}

export function resourceTypeFit(type: ResourceType, strategy: ResourceStrategy): number {
  return strategy.typeWeights[type] ?? 0;
}
