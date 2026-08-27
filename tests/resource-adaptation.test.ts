import { describe, expect, it } from "vitest";
import { buildResourceStrategy } from "@/lib/agents/resource-strategy";
import { makeNode } from "./helpers";

function node(title: string, difficulty: number, description: string) {
  return { ...makeNode(`node-${difficulty}`, title, difficulty), shortDescription: description };
}

describe("adaptive resource strategy", () => {
  it("uses approachable learning material for beginner concepts", () => {
    const strategy = buildResourceStrategy(
      node("Fractions", 1, "Understand parts of a whole with simple examples."),
      { educationLevel: "middle-school", knowledgeLevel: "beginner" } as any,
    );
    expect(strategy.academicSearch).toBe(false);
    expect(strategy.maxPapers).toBe(0);
    expect(strategy.targetTypes).toEqual(expect.arrayContaining(["article", "course"]));
    expect(strategy.targetTypes).not.toContain("paper");
  });

  it("does not turn high difficulty into paper bias for implementation topics", () => {
    const strategy = buildResourceStrategy(
      node("Distributed database replication", 5, "Configure replication, consistency settings, failover, and deployment."),
      { educationLevel: "professional", knowledgeLevel: "advanced", purpose: "project", exploreBias: "technical" } as any,
    );
    expect(strategy.intent).toBe("implementation");
    expect(strategy.academicSearch).toBe(false);
    expect(strategy.maxPapers).toBe(0);
    expect(strategy.targetTypes[0]).toBe("documentation");
  });

  it("prefers deep reference material for difficult established concepts without assuming research", () => {
    const strategy = buildResourceStrategy(
      node("Fourier transforms", 5, "Understand frequency-domain representation and transform properties."),
      { educationLevel: "undergraduate", knowledgeLevel: "advanced", depthPreference: "deep" } as any,
    );
    expect(strategy.academicSearch).toBe(false);
    expect(strategy.maxPapers).toBe(0);
    expect(strategy.targetTypes[0]).toBe("reference");
  });

  it("uses worked learning formats for difficult exam material", () => {
    const strategy = buildResourceStrategy(
      node("Integration by parts", 4, "Solve integrals by selecting u and dv and applying the formula."),
      { educationLevel: "undergraduate", knowledgeLevel: "intermediate", purpose: "exam" } as any,
    );
    expect(strategy.intent).toBe("procedural");
    expect(strategy.maxPapers).toBe(0);
    expect(strategy.targetTypes[0]).toBe("course");
  });

  it("allows research papers when the learner actually asks for research", () => {
    const strategy = buildResourceStrategy(
      node("Mechanistic interpretability", 4, "Compare current empirical research and experimental evidence."),
      { educationLevel: "graduate", knowledgeLevel: "advanced", purpose: "research", depthPreference: "deep" } as any,
    );
    expect(strategy.intent).toBe("research");
    expect(strategy.academicSearch).toBe(true);
    expect(strategy.maxPapers).toBeGreaterThan(0);
    expect(strategy.targetTypes).toContain("paper");
  });
});
