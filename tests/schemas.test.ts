import { describe, expect, it } from "vitest";
import { ConceptDecompositionSchema } from "@/lib/schemas/concept";
import { AgentRequestSchema } from "@/lib/schemas/api";
import { LearnerProfileSchema, LearningPathProposalSchema } from "@/lib/schemas/learning-path";

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
      levelNarrative: {
        sameLevelReason: "Limits, derivatives, integrals, and series require comparable algebraic fluency and abstract function reasoning.",
        previousLevelComparison: "This layer cuts calculus into narrower ideas that each isolate one major kind of change or accumulation, making them one conceptual step more focused than calculus as a whole.",
      },
      children: [child("Limits"), child("Derivatives"), child("Integrals"), child("Series")],
      confidence: 0.9,
    });
    expect(result.success).toBe(true);
  });


  it("accepts compact ConceptDecomposition output and applies safe metadata defaults", () => {
    const result = ConceptDecompositionSchema.safeParse({
      parentConcept: "Calculus",
      summary: "Core branches of calculus.",
      parentAssessment: {
        difficulty: 3,
        difficultyLabel: "Intermediate",
        difficultyExplanation: "It combines algebraic fluency with abstract change.",
      },
      levelNarrative: {
        sameLevelReason: "The four branches use similar algebraic and function reasoning, so none requires a substantially larger prerequisite jump than the others.",
        previousLevelComparison: "Each branch is narrower than calculus as a whole and can be learned as one direct conceptual cut from the parent topic.",
      },
      children: [
        { title: "Limits", description: "How values approach a target.", difficulty: 3, difficultyLabel: "Intermediate", difficultyExplanation: "Requires function intuition." },
        { title: "Derivatives", description: "How quantities change locally.", difficulty: 3, difficultyLabel: "Intermediate", difficultyExplanation: "Builds on limits and algebra." },
        { title: "Integrals", description: "How small contributions accumulate.", difficulty: 3, difficultyLabel: "Intermediate", difficultyExplanation: "Connects area and accumulation." },
        { title: "Series", description: "How repeated terms form infinite sums.", difficulty: 3, difficultyLabel: "Intermediate", difficultyExplanation: "Requires sequence and limit reasoning." },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confidence).toBe(0.75);
      expect(result.data.children[0].confidence).toBe(0.75);
      expect(result.data.children[0].applications).toEqual([]);
      expect(result.data.parentAssessment.difficultyFactors).toEqual([]);
    }
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
      levelNarrative: {
        sameLevelReason: "These proposed branches are intended to require comparable effort.",
        previousLevelComparison: "They are intended to be one direct cut beneath the parent.",
      },
      children: [child("Limits"), child("Derivatives")],
      confidence: 0.9,
    });
    expect(result.success).toBe(false);
  });

  it("accepts compact Brick layer output and applies safe heuristic defaults", () => {
    const result = LearningPathProposalSchema.safeParse({
      learnerSummary: "The learner knows algebra and basic programming.",
      foundationAssessment: {
        difficulty: 2,
        difficultyLabel: "Beginner",
        difficultyExplanation: "The foundation supports one-step applied concepts.",
      },
      foundationLevelNarrative: {
        sameLevelReason: "The learner's algebra and basic programming are both treated as usable starting foundations rather than new material to learn first.",
        previousLevelComparison: "Height 0 is the learner's baseline, so there is no generated layer below it.",
      },
      levelNarrative: {
        sameLevelReason: "Functions, data structures, descriptive statistics, and Boolean logic all add a comparable beginner-level abstraction to the supplied foundation.",
        previousLevelComparison: "The new row is one step more complex because each brick introduces one new reusable idea while still depending only on the learner's existing algebra or programming foundation.",
      },
      directions: [
        { title: "Functions", description: "Reusable mappings from inputs to outputs.", whyReachable: "Builds directly on algebra.", difficulty: 2, difficultyLabel: "Beginner", difficultyExplanation: "Uses familiar algebraic relationships." },
        { title: "Data Structures", description: "Ways to organize values for programs.", whyReachable: "Builds directly on basic programming.", difficulty: 2, difficultyLabel: "Beginner", difficultyExplanation: "Adds organization without a large abstraction jump." },
        { title: "Descriptive Statistics", description: "Summaries such as averages and spread.", whyReachable: "Uses arithmetic and basic data handling.", difficulty: 2, difficultyLabel: "Beginner", difficultyExplanation: "Requires only a small step beyond arithmetic." },
        { title: "Boolean Logic", description: "Reasoning with true and false conditions.", whyReachable: "Builds directly on programming conditionals.", difficulty: 2, difficultyLabel: "Beginner", difficultyExplanation: "Adds formal names to familiar decisions." },
      ],
      recommendedTitle: "Functions",
      recommendationReason: "It connects the current algebra and programming foundation.",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confidence).toBe(0.75);
      expect(result.data.directions[0].readinessScore).toBe(60);
      expect(result.data.directions[0].missingPrerequisites).toEqual([]);
      expect(result.data.foundationAssessment.difficultyFactors).toEqual([]);
    }
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
