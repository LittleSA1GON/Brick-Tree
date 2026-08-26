import { describe, expect, it } from "vitest";
import { ConceptDecompositionSchema } from "@/lib/schemas/concept";
import { AgentRequestSchema } from "@/lib/schemas/api";
import { LearnerProfileSchema } from "@/lib/schemas/learning-path";

const child = (title: string, difficulty = 3) => ({
  title,
  description: `${title} description`,
  whyItMatters: `${title} matters`,
  difficulty,
  difficultyLabel: difficulty === 3 ? "Intermediate" : "Beginner",
  difficultyExplanation: "It combines several prerequisite ideas.",
  difficultyFactors: ["Abstraction", "Multi-step reasoning"],
  prerequisites: ["Foundation"],
  learningOutcomes: ["Outcome"],
  applications: ["Application"],
  examples: ["Example"],
  whatItUnlocks: ["Next concept"],
  confidence: 0.9,
  evidence: [],
});

describe("structured schemas", () => {
  it("accepts a 3-6 child difficulty-explained decomposition", () => {
    const result = ConceptDecompositionSchema.safeParse({
      parentConcept: "Calculus",
      summary: "A structured view of calculus.",
      parentAssessment: {
        difficulty: 4,
        difficultyLabel: "Advanced",
        difficultyExplanation: "It combines abstraction, algebra, and multiple representations.",
        difficultyFactors: ["Abstraction", "Prerequisite load"],
      },
      children: [child("Limits"), child("Derivatives"), child("Integrals"), child("Series")],
      confidence: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it("rejects decompositions without enough children", () => {
    const result = ConceptDecompositionSchema.safeParse({
      parentConcept: "Calculus",
      summary: "Too small.",
      parentAssessment: {
        difficulty: 4,
        difficultyLabel: "Advanced",
        difficultyExplanation: "Hard.",
        difficultyFactors: [],
      },
      children: [child("Limits"), child("Derivatives")],
      confidence: 0.9,
    });
    expect(result.success).toBe(false);
  });

  it("requires a destination goal only in Brick Destination", () => {
    expect(AgentRequestSchema.safeParse({
      action: "navigate",
      traversal: { mode: "brick", intent: "explore" },
      knownConcepts: ["Algebra"],
    }).success).toBe(true);
    expect(AgentRequestSchema.safeParse({
      action: "navigate",
      traversal: { mode: "brick", intent: "destination" },
      knownConcepts: ["Algebra"],
    }).success).toBe(false);
  });


  it("accepts Tree question analysis without turning it into Brick Destination", () => {
    expect(AgentRequestSchema.safeParse({
      action: "navigate",
      traversal: { mode: "tree", intent: "analyze-question" },
      topic: "How do I stay valuable as a software engineer in an AI-heavy future?",
    }).success).toBe(true);
  });

  it("keeps knowledge level, vernacular, depth, and source mode independent", () => {
    const result = LearnerProfileSchema.parse({
      existingKnowledge: ["Calculus"],
      knowledgeLevel: "advanced",
      languageStyle: "conversational",
      depthPreference: "deep",
      sourceMode: "uploaded-only",
      sourceDocumentIds: ["paper-1"],
    });
    expect(result.knowledgeLevel).toBe("advanced");
    expect(result.languageStyle).toBe("conversational");
    expect(result.sourceMode).toBe("uploaded-only");
  });
});
