import { describe, expect, it } from "vitest";
import { parseBrickKnowledgeInput } from "@/lib/learning/brick-input";

describe("Brick free-form foundation parsing", () => {
  it("parses a natural-language list into concise foundation strings", () => {
    expect(parseBrickKnowledgeInput("I know Python and basic algebra")).toEqual(["Python", "basic algebra"]);
  });

  it("does not turn an explicitly unknown concept into known knowledge", () => {
    expect(parseBrickKnowledgeInput("I know Python, but I don't understand classes")).toEqual(["Python"]);
  });

  it("keeps arbitrary long prose schema-safe instead of failing input validation", () => {
    const result = parseBrickKnowledgeInput(
      "I have experience with introductory programming and have spent time making small scripts for school projects, but I have not studied data structures formally.",
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => item.length <= 160)).toBe(true);
  });

  it("can represent a raw starting-from-scratch statement without inventing known concepts", () => {
    expect(parseBrickKnowledgeInput("I don't understand programming yet")).toEqual([]);
  });

  it("handles negation before positive knowledge instead of discarding the later known concept", () => {
    expect(parseBrickKnowledgeInput("I don't understand classes, but I know Python")).toEqual(["Python"]);
  });

  it("treats explicit starting-from-scratch prose as an empty known foundation", () => {
    expect(parseBrickKnowledgeInput("I am starting from scratch with programming")).toEqual([]);
    expect(parseBrickKnowledgeInput("I have no prior knowledge of calculus")).toEqual([]);
  });

  it("accepts a plain arbitrary string without requiring comma-separated syntax", () => {
    expect(parseBrickKnowledgeInput("counting alphabet speech")).toEqual(["counting alphabet speech"]);
  });
});
