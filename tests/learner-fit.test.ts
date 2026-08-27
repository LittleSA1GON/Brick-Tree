import { describe, expect, it } from "vitest";
import { learnerDifficultyCeiling, learnerFitIssues } from "@/lib/learning/learner-fit";
import type { LearnerProfile, LearningDirectionProposal } from "@/lib/schemas/learning-path";

function profile(educationLevel: string, knowledgeLevel: LearnerProfile["knowledgeLevel"] = "beginner"): LearnerProfile {
  return {
    educationLevel,
    exploreBias: "balanced",
    existingKnowledge: ["Algebra", "Basic statistics", "Python"],
    knowledgeLevel,
    sourceMode: "general",
    sourceDocumentIds: [],
  };
}

function direction(title: string, difficulty: number, missingPrerequisites: string[] = []) {
  return {
    title,
    difficulty,
    missingPrerequisites,
  } as Pick<LearningDirectionProposal, "title" | "difficulty" | "missingPrerequisites">;
}

describe("learner-fit constraints", () => {
  it("keeps high-school Explore suggestions below advanced difficulty by default", () => {
    const learner = profile("high-school");
    expect(learnerDifficultyCeiling(learner)).toBe(3);
    expect(learnerFitIssues(learner, [direction("Accessible next step", 3)], "explore")).toEqual([]);
    expect(learnerFitIssues(learner, [direction("Advanced specialist topic", 4)], "explore")).toHaveLength(1);
  });

  it("allows college learners a broader difficulty ceiling", () => {
    const learner = profile("college", "intermediate");
    expect(learnerDifficultyCeiling(learner)).toBe(4);
    expect(learnerFitIssues(learner, [direction("College-level next step", 4)], "explore")).toEqual([]);
  });

  it("rejects an Explore direction with several missing prerequisites even when its difficulty number looks adjacent", () => {
    const learner = profile("high-school");
    const issues = learnerFitIssues(
      learner,
      [direction("Premature topic", 3, ["Calculus", "Linear algebra", "Probability theory"])],
      "explore",
    );
    expect(issues.some((issue) => issue.message.includes("missing prerequisites"))).toBe(true);
  });

  it("does not impose the Explore ceiling on an explicit destination path", () => {
    const learner = profile("high-school");
    expect(learnerFitIssues(learner, [direction("Long-term destination layer", 4)], "destination")).toEqual([]);
  });
});
