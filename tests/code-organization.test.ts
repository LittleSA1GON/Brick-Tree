import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceRoots = ["app", "components", "lib"];

function sourceFiles(): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(relative);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(relative);
    }
  };
  for (const directory of sourceRoots) visit(directory);
  return files;
}

describe("code organization", () => {
  it("keeps application source modules below 1000 lines", () => {
    const oversized = sourceFiles().filter((file) => {
      const lines = fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/).length;
      return lines >= 1000;
    });
    expect(oversized).toEqual([]);
  });

  it("keeps the public orchestrator as a small workflow facade", () => {
    const orchestrator = fs.readFileSync(path.join(root, "lib/agents/orchestrator.ts"), "utf8");
    expect(orchestrator.split(/\r?\n/).length).toBeLessThan(30);
    expect(orchestrator).toContain("tree-workflow");
    expect(orchestrator).toContain("brick-workflow");
    expect(orchestrator).toContain("resource-workflow");
  });
});
