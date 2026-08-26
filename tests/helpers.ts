import type { ConceptNode } from "@/lib/schemas/concept";
import { difficultyLabel, levelFromDifficulties } from "@/lib/graph/levels";

export function makeNode(
  id: string,
  title: string,
  difficulty = 2,
  parentId?: string,
  depth = parentId ? 1 : 0,
): ConceptNode {
  const score = Math.max(1, Math.min(5, Math.round(difficulty))) as 1 | 2 | 3 | 4 | 5;
  const axis = "depth" as const;
  return {
    id,
    title,
    normalizedTitle: title.toLowerCase(),
    shortDescription: `${title} description`,
    parentId,
    childIds: [],
    depth,
    level: levelFromDifficulties(axis, depth, [score]),
    difficulty: score,
    difficultyLabel: difficultyLabel(score),
    difficultyExplanation: `${title} requires an appropriate amount of prerequisite knowledge.`,
    difficultyFactors: ["Prerequisite load"],
    prerequisites: [],
    learningOutcomes: [],
    applications: [],
    examples: [],
    whyItMatters: `${title} matters.`,
    whatItUnlocks: [],
    confidence: 0.9,
    status: "validated",
    knowledgeStatus: "available",
    resources: [],
    origins: [{ type: "model-knowledge" }],
  };
}
