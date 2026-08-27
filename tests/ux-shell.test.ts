import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appSource = fs.readFileSync(path.join(root, "components/BrickTreeApp.tsx"), "utf8");
const appStyles = fs.readFileSync(path.join(root, "components/BrickTreeApp.module.css"), "utf8");
const globalsSource = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
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

  it("keeps a movable small map visible without turning the main graph into a drag canvas", () => {
    expect(appSource).toContain("PersistentMiniMap");
    expect(appSource).toContain("Move mini map");
    expect(appSource).toContain("setPointerCapture");
    expect(appSource).toContain("persistentMapDragHandle");
    expect(appSource).toContain("Upload Tree / Brick");
    expect(appSource).toContain("createPortableWorkspaceFile");
    expect(appSource).toContain("parsePortableWorkspaceFile");
  });

  it("makes learner level and Explore bias active Brick inputs", () => {
    expect(appSource).toContain("Learner / difficulty level");
    expect(appSource).toContain("Explore bias");
    expect(pathAgent).toContain("exploreBias");
    expect(pathAgent).toContain("Do not infer an AI or machine-learning");
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

  it("keeps generated graphs centered and provides explicit whole-graph zoom controls only after visible nodes exist", () => {
    expect(appSource).toContain("ZoomControls");
    expect(appSource).toContain("mapNodes.length > 0");
    expect(appSource).toContain("graphZoom");
    expect(appSource).toContain("scaledWidth");
    expect(appSource).toContain("scaledHeight");
    expect(appSource).toContain("(scroller.scrollWidth - scroller.clientWidth) / 2");
    expect(appSource).toContain('transform: `translateX(-50%) scale(${zoom})`');
    expect(appStyles).toContain(".zoomControls");
  });


  it("scales the complete starting prompt node with viewport width and height and keeps the redundant Direction tab absent", () => {
    expect(appStyles).toContain("width: min(clamp(320px, 58vw, 980px), calc(100% - 8px))");
    expect(appStyles).toContain("height: min(82%, 780px)");
    expect(appSource).not.toContain(">Direction<");
  });
  it("keeps every dropdown readable with one explicit dark native palette", () => {
    expect(globalsSource).toContain("select option");
    expect(globalsSource).toContain("background-color: #151817");
    expect(appStyles).toContain("Unified dropdown treatment");
    expect(appStyles).toContain(".setupAdvanced :global(.profile-grid select)");
  });

  it("replaces static node-detail placeholders with adaptive prerequisites and unlocks", () => {
    expect(appSource).toContain("detailPrerequisites");
    expect(appSource).toContain("detailUnlocks");
    expect(appSource).not.toContain("None listed yet.");
    expect(appSource).not.toContain("Branch this node to cut it one level deeper.");
  });

  it("rechecks adaptive detail when the learner level changes without refetching the same level", () => {
    expect(appSource).toContain("explanations[nodeId]?.level === level");
    expect(appSource).toContain("if (event.currentTarget.open) onExplain();");
  });

  it("does not load the old React Flow stylesheet into the main application", () => {
    expect(layoutSource).not.toContain("@xyflow/react/dist/style.css");
  });
});
