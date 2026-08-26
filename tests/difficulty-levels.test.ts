import { describe, expect, it } from "vitest";
import {
  difficultyConsistencyIssues,
  difficultyDescription,
  difficultyLabel,
  difficultySpread,
  levelFromDifficulties,
  suggestedNextLevel,
} from "@/lib/graph/levels";

describe("difficulty layers", () => {
  it("uses the universal five-level difficulty scale", () => {
    expect(difficultyLabel(1)).toBe("Foundational");
    expect(difficultyLabel(3)).toBe("Intermediate");
    expect(difficultyLabel(5)).toBe("Expert");
    expect(difficultyDescription(4)).toContain("prerequisite");
  });

  it("keeps peer layers within a one-point spread", () => {
    expect(difficultySpread([2, 3, 3, 2])).toBe(1);
    expect(difficultyConsistencyIssues([2, 3, 3])).toEqual([]);
    expect(difficultyConsistencyIssues([1, 4])).toHaveLength(1);
  });

  it("builds a shared layer descriptor from peer difficulty", () => {
    const level = levelFromDifficulties("depth", 2, [3, 3, 4, 3]);
    expect(level.index).toBe(2);
    expect(level.minDifficulty).toBe(3);
    expect(level.maxDifficulty).toBe(4);
    expect(level.label).toContain("3–4/5");
  });

  it("suggests easier roots and harder branches", () => {
    const down = suggestedNextLevel("depth", 2, 4);
    const up = suggestedNextLevel("height", 2, 3);
    expect([down.minDifficulty, down.maxDifficulty]).toEqual([3, 4]);
    expect([up.minDifficulty, up.maxDifficulty]).toEqual([3, 4]);
  });
});
