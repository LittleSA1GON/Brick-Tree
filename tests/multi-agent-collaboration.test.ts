import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createAgentRegistry } from "@/lib/agents";

const root = process.cwd();
const orchestrator = [
  "lib/agents/workflow-core.ts",
  "lib/agents/tree-workflow.ts",
  "lib/agents/brick-workflow.ts",
  "lib/agents/branch-workflow.ts",
  "lib/agents/resource-workflow.ts",
  "lib/agents/explanation-workflow.ts",
].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");

describe("Brick Tree multi-agent collaboration graph", () => {
  it("registers the four collaborating roles with explicit authorized handoffs", () => {
    const registry = createAgentRegistry();
    const architect = registry.get("concept_architect");
    const pathAgent = registry.get("learning_path");
    const validator = registry.get("pedagogy_validator");
    const resource = registry.get("resource_agent");

    expect(architect.allowedHandoffs).toEqual(expect.arrayContaining(["pedagogy_validator", "resource_agent"]));
    expect(pathAgent.allowedHandoffs).toEqual(expect.arrayContaining(["pedagogy_validator", "resource_agent"]));
    expect(validator.allowedHandoffs).toEqual(expect.arrayContaining(["concept_architect", "learning_path"]));
    expect(resource.allowedHandoffs).toEqual([]);
  });

  it("passes concrete candidate context to validation and concrete node context to resources", () => {
    expect(orchestrator).toContain("candidateTitles: finalDecomposition.children.map");
    expect(orchestrator).toContain("candidateTitles: finalProposal.directions.map");
    expect(orchestrator).toContain('runtime.handoff(originAgent, "resource_agent"');
    expect(orchestrator).toContain("nodeId: input.node.id");
    expect(orchestrator).toContain("difficulty: input.node.difficulty");
    expect(orchestrator).toContain("learnerProfile: input.learnerProfile ?? null");
  });

  it("returns validation issues to the originating generation agent for bounded revision", () => {
    expect(orchestrator).toContain('"pedagogy_validator",\n      "concept_architect"');
    expect(orchestrator).toContain('"pedagogy_validator",\n      "learning_path"');
    expect(orchestrator).toContain("issues: finalValidation.issues");
  });
});
