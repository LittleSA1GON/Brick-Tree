import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appSource = fs.readFileSync(path.join(root, "components/BrickTreeApp.tsx"), "utf8");
const appStyles = fs.readFileSync(path.join(root, "components/BrickTreeApp.module.css"), "utf8");
const layoutSource = fs.readFileSync(path.join(root, "app/layout.tsx"), "utf8");

describe("Brick Tree 0.7 interaction shell", () => {
  it("keeps the landing page concise and clearly separates Tree from Brick", () => {
    expect(appSource).toContain("Cut down complex ideas");
    expect(appSource).toContain("build up new ones");
    expect(appSource).toContain("beginTree");
    expect(appSource).toContain("beginBrick");
    expect(appStyles).toContain("linear-gradient");
    expect(appStyles).toContain("clip-path");
  });

  it("uses fixed scroll navigation instead of a draggable graph canvas", () => {
    expect(appStyles).toContain("scroll-snap-type: y mandatory");
    expect(appStyles).toContain("scroll-snap-align: start");
    expect(appStyles).toContain("scroll-snap-stop: always");
    expect(appSource).toContain("scrollIntoView");
    expect(appSource).not.toContain("ReactFlow");
    expect(appSource).not.toContain("onNodesChange");
  });

  it("uses zero-based Depth and Height and keeps detail/resources inside nodes", () => {
    expect(appSource).toContain('modeAxis(mode)');
    expect(appSource).toContain("0 is the starting point you supplied");
    expect(appSource).toContain("This node is more complex than level 0");
    expect(appSource).toContain("This node is less complex than level 0");
    expect(appSource).toContain("More detail + resources");
    expect(appSource).toContain("Continue from here");
  });

  it("provides a live navigator that can teleport to a node", () => {
    expect(appSource).toContain("Map & connections");
    expect(appSource).toContain("teleportNode");
    expect(appSource).toContain("Connects");
  });

  it("does not load the old React Flow stylesheet into the main application", () => {
    expect(layoutSource).not.toContain("@xyflow/react/dist/style.css");
  });
});
