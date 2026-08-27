import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const orchestrator = read("lib/agents/orchestrator.ts");
const planner = read("lib/agents/resource-agent.ts");
const resources = read("lib/schemas/resources.ts");
const toolIndex = read("lib/tools/index.ts");
const institutionTool = read("lib/tools/implementations/institution-search.ts");
const webTool = read("lib/tools/implementations/web-search.ts");

const wikipediaToolPath = path.join(root, "lib/tools/implementations/wikipedia-search.ts");

describe("audience-aware resource quality", () => {
  it("removes Wikipedia from the resource pipeline", () => {
    expect(resources).not.toContain('"wikipedia"');
    expect(planner).not.toContain("search_wikipedia");
    expect(toolIndex).not.toContain("wikipediaSearchTool");
    expect(fs.existsSync(wikipediaToolPath)).toBe(false);
    expect(webTool).toContain("wikipedia\\.org");
  });

  it("prioritizes approachable institutional sources for school-level learners", () => {
    expect(institutionTool).toContain("Khan Academy");
    expect(institutionTool).toContain("OpenStax");
    expect(orchestrator).toContain("schoolLearner");
    expect(orchestrator).toContain("introductoryLearner && !explicitlyWantsResearch");
    expect(orchestrator).toContain("khanacademy.org");
    expect(orchestrator).toContain("openstax.org");
  });

  it("allows advanced and research learners to receive scholarly and university material", () => {
    expect(institutionTool).toContain("Stanford University");
    expect(institutionTool).toContain("MIT OpenCourseWare");
    expect(orchestrator).toContain("isResearchAudience");
    expect(orchestrator).toContain('source: "academic"');
    expect(orchestrator).toContain("crossref");
  });

  it("restricts optional web search toward trusted subject-appropriate domains", () => {
    expect(resources).toContain("domains:");
    expect(webTool).toContain("include_domains");
    expect(orchestrator).toContain("resourceSubjectDomains");
  });
});
