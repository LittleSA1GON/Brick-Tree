import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appSource = fs.readFileSync(path.join(root, "components/BrickTreeApp.tsx"), "utf8");
const appStyles = fs.readFileSync(path.join(root, "components/BrickTreeApp.module.css"), "utf8");
const layoutSource = fs.readFileSync(path.join(root, "app/layout.tsx"), "utf8");
const pathAgent = fs.readFileSync(path.join(root, "lib/agents/learning-path.ts"), "utf8");

describe("Brick Tree 0.8 interaction shell", () => {
  it("keeps the landing page concise and clearly separates Tree from Brick", () => {
    expect(appSource).toContain("Cut down complex ideas");
    expect(appSource).toContain("build up new ones");
    expect(appSource).toContain("beginTree");
    expect(appSource).toContain("beginBrick");
    expect(appStyles).toContain("linear-gradient");
    expect(appStyles).toContain("clip-path");
  });

  it("uses click-to-focus plus two-dimensional scroll/swipe navigation instead of dragging", () => {
    expect(appSource).toContain("HierarchyStage");
    expect(appSource).toContain("CompactNode");
    expect(appSource).toContain("scrollIntoView");
    expect(appSource).toContain("Scroll or swipe siblings");
    expect(appSource).not.toContain("ReactFlow");
    expect(appSource).not.toContain("onNodesChange");
    expect(appStyles).toContain("touch-action: pan-x pan-y");
    expect(appStyles).toContain("overflow: auto");
    expect(appStyles).not.toContain("scroll-snap-type");
  });

  it("renders Tree downward with negative depth and Brick upward with positive height", () => {
    expect(appSource).toContain('mode === "tree" ? -offset : offset');
    expect(appSource).toContain('mode === "tree" ? -node.depth : node.depth');
    expect(appSource).toContain("Destination · Height +");
    expect(appSource).not.toContain("0 is your reference point");
  });

  it("keeps multiple independent Tree and Brick workspaces and maps them as connected hierarchies", () => {
    expect(appSource).toContain("WorkspaceSnapshot");
    expect(appSource).toContain("Tree maps");
    expect(appSource).toContain("Brick maps");
    expect(appSource).toContain("MiniGraphMap");
    expect(appSource).toContain("buildHierarchyLayout");
    expect(appSource).toContain("Tree - Workspace map");
    expect(appSource).toContain("Brick - Workspace map");
  });

  it("keeps a small map visible and supports importing a single Tree or Brick", () => {
    expect(appSource).toContain("PersistentMiniMap");
    expect(appSource).toContain("Upload Tree / Brick");
    expect(appSource).toContain("createPortableWorkspaceFile");
    expect(appSource).toContain("parsePortableWorkspaceFile");
  });

  it("makes learner level and Explore bias active Brick inputs", () => {
    expect(appSource).toContain("Learner / difficulty level");
    expect(appSource).toContain("Explore bias");
    expect(pathAgent).toContain("exploreBias");
    expect(pathAgent).toContain("Do not infer an AI, machine-learning");
  });

  it("shows agent-generated explanations for why nodes share a Depth/Height and how the layer changes", () => {
    expect(appSource).toContain("Why these nodes share this level");
    expect(appSource).toContain("Compared with the previous layer");
    expect(pathAgent).toContain("levelNarrative.sameLevelReason");
    expect(pathAgent).toContain("levelNarrative.previousLevelComparison");
  });

  it("loads resources automatically for the focused node", () => {
    expect(appSource).toContain("resourceAttemptedRef");
    expect(appSource).toContain("Loading resources for this node");
    expect(appSource).not.toContain("Resources are loaded only when you ask for them.");
  });

  it("does not load the old React Flow stylesheet into the main application", () => {
    expect(layoutSource).not.toContain("@xyflow/react/dist/style.css");
  });
});
