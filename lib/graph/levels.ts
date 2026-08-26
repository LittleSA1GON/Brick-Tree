import type {
  DifficultyLabel,
  DifficultyScore,
  GraphAxis,
  GraphLevelDescriptor,
} from "@/lib/schemas/concept";

const DIFFICULTY = {
  1: {
    label: "Foundational" as const,
    description:
      "Usually understandable with basic vocabulary, concrete examples, and little prerequisite knowledge.",
  },
  2: {
    label: "Beginner" as const,
    description:
      "Requires a small set of foundations and the ability to apply a straightforward idea in familiar situations.",
  },
  3: {
    label: "Intermediate" as const,
    description:
      "Requires combining multiple prior ideas, handling abstraction, or following multi-step reasoning with some fluency.",
  },
  4: {
    label: "Advanced" as const,
    description:
      "Requires strong prerequisite fluency and coordinating several interacting abstractions, methods, or representations.",
  },
  5: {
    label: "Expert" as const,
    description:
      "Requires deep specialized prior knowledge, high abstraction, formal reasoning, or open-ended judgment within the domain.",
  },
} satisfies Record<DifficultyScore, { label: DifficultyLabel; description: string }>;

export function difficultyLabel(score: number): DifficultyLabel {
  const bounded = Math.max(1, Math.min(5, Math.round(score))) as DifficultyScore;
  return DIFFICULTY[bounded].label;
}

export function difficultyDescription(score: number): string {
  const bounded = Math.max(1, Math.min(5, Math.round(score))) as DifficultyScore;
  return DIFFICULTY[bounded].description;
}

export function difficultySpread(scores: number[]): number {
  if (!scores.length) return 0;
  return Math.max(...scores) - Math.min(...scores);
}

export function levelFromDifficulties(
  axis: GraphAxis,
  index: number,
  scores: number[],
): GraphLevelDescriptor {
  const normalized = scores.length ? scores.map((score) => Math.max(1, Math.min(5, Math.round(score)))) : [1];
  const minDifficulty = Math.min(...normalized) as DifficultyScore;
  const maxDifficulty = Math.max(...normalized) as DifficultyScore;
  const average = normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
  const difficulty = Math.max(1, Math.min(5, Math.round(average))) as DifficultyScore;
  const label =
    minDifficulty === maxDifficulty
      ? `${difficulty}/5 · ${difficultyLabel(difficulty)}`
      : `${minDifficulty}–${maxDifficulty}/5 · ${difficultyLabel(difficulty)}`;

  return {
    axis,
    index,
    difficulty,
    minDifficulty,
    maxDifficulty,
    label,
    description: difficultyDescription(difficulty),
    peerRule:
      "Nodes on this visual layer should require roughly comparable effort to understand; Brick Tree normally allows at most a one-point difficulty spread.",
  };
}

export function suggestedNextLevel(
  axis: GraphAxis,
  index: number,
  parentDifficulty: DifficultyScore,
): GraphLevelDescriptor {
  const min = axis === "depth" ? Math.max(1, parentDifficulty - 1) : parentDifficulty;
  const max = axis === "depth" ? parentDifficulty : Math.min(5, parentDifficulty + 1);
  return levelFromDifficulties(axis, index, min === max ? [min] : [min, max]);
}

export function levelInvariantSummary(level: GraphLevelDescriptor): string {
  return `All nodes at ${level.axis} ${level.index} should stay within difficulty ${level.minDifficulty}-${level.maxDifficulty}/5. ${level.peerRule}`;
}

export function difficultyConsistencyIssues(
  scores: number[],
  expected?: GraphLevelDescriptor,
): string[] {
  if (!scores.length) return ["No difficulty scores were produced."];
  const issues: string[] = [];
  const spread = difficultySpread(scores);
  if (spread > 1) {
    issues.push(`Peer nodes span ${spread} difficulty points; same-height/depth peers should normally stay within one point.`);
  }
  if (expected) {
    const outside = scores.filter(
      (score) => score < expected.minDifficulty || score > expected.maxDifficulty,
    );
    if (outside.length) {
      issues.push(
        `One or more nodes fall outside this layer's expected ${expected.minDifficulty}-${expected.maxDifficulty}/5 difficulty band.`,
      );
    }
  }
  return issues;
}
