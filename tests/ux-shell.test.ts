import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appSource = fs.readFileSync(path.join(root, "components/BrickTreeApp.tsx"), "utf8");
const appStyles = fs.readFileSync(path.join(root, "components/BrickTreeApp.module.css"), "utf8");
const layoutSource = fs.readFileSync(path.join(root, "app/layout.tsx"), "utf8");

describe("Brick Tree 0.8 interaction shell", () => {
  it("keeps the landing page concise and clearly separates Tree from Brick", () => {
    expect(appSource).toContain("Cut down complex ideas");
    expect(appSource).toContain("build up new ones");
    expect(appSource).toContain("beginTree");
    expect(appSource).toContain("beginBrick");
    expect(appStyles).toContain("linear-gradient");
    expect(appStyles).toContain("clip-path");
  });

  it("uses click-to-focus hierarchy navigation instead of dragging or scroll snapping", () => {
    expect(appSource).toContain("HierarchyStage");
    expect(appSource).toContain("CompactNode");
    expect(appSource).toContain("teleportNode");
    expect(appSource).not.toContain("scrollIntoView");
    expect(appSource).not.toContain("ReactFlow");
    expect(appSource).not.toContain("onNodesChange");
    expect(appStyles).not.toContain("scroll-snap-type");
  });

  it("renders Tree downward with negative depth and Brick upward with positive height", () => {
    expect(appSource).toContain('mode === "tree" ? -offset : offset');
    expect(appSource).toContain('direction="down"');
    expect(appSource).toContain('direction="up"');
    expect(appSource).toContain("Destination · Height +");
    expect(appSource).toContain("Height 0 · Foundation");
    expect(appSource).not.toContain("0 is your reference point");
  });

  it("keeps multiple independent Tree and Brick workspaces and maps them as connected hierarchies", () => {
    expect(appSource).toContain("WorkspaceSnapshot");
    expect(appSource).toContain("Tree maps");
    expect(appSource).toContain("Brick maps");
    expect(appSource).toContain("MiniGraphMap");
    expect(appSource).toContain("miniEdge");
    expect(appSource).toContain("New {mode === \"tree\" ? \"Tree\" : \"Brick\"}");
  });

  it("keeps details and resources inside the focused node", () => {
    expect(appSource).toContain("Open detail + resources");
    expect(appSource).toContain("Find resources");
    expect(appSource).toContain("Branch this node");
    expect(appSource).toContain("Construct next layer");
  });

  it("does not load the old React Flow stylesheet into the main application", () => {
    expect(layoutSource).not.toContain("@xyflow/react/dist/style.css");
  });
});
