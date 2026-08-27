import { describe, expect, it } from "vitest";
import { buildHierarchyLayout } from "@/lib/graph/hierarchy-layout";
import { makeNode } from "./helpers";
import type { ConceptEdge, ConceptNode } from "@/lib/schemas/concept";

function edge(source: string, target: string): ConceptEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    relationshipType: "contains",
    confidence: 1,
  };
}

function atDepth(id: string, title: string, depth: number, parentId?: string): ConceptNode {
  return { ...makeNode(id, title, 2), depth, parentId };
}

describe("hierarchy layout", () => {
  it("centers a Tree parent over the children that actually belong to it", () => {
    const root = atDepth("root", "Root", 0);
    const left = atDepth("left", "Left", 1, root.id);
    const right = atDepth("right", "Right", 1, root.id);
    const leafA = atDepth("leaf-a", "Leaf A", 2, left.id);
    const leafB = atDepth("leaf-b", "Leaf B", 2, left.id);
    const leafC = atDepth("leaf-c", "Leaf C", 2, right.id);
    const nodes = [root, left, right, leafA, leafB, leafC];
    const layout = buildHierarchyLayout("tree", nodes, [
      edge(root.id, left.id),
      edge(root.id, right.id),
      edge(left.id, leafA.id),
      edge(left.id, leafB.id),
      edge(right.id, leafC.id),
    ]);

    const leftX = layout.positions.get(left.id)?.x ?? 0;
    const leftChildren = [layout.positions.get(leafA.id)?.x ?? 0, layout.positions.get(leafB.id)?.x ?? 0];
    expect(leftX).toBeCloseTo((leftChildren[0] + leftChildren[1]) / 2, 5);
    expect((layout.positions.get(root.id)?.y ?? 0) < (layout.positions.get(left.id)?.y ?? 0)).toBe(true);
  });

  it("places higher Brick layers above the foundation", () => {
    const foundationA = atDepth("fa", "Foundation A", 0);
    const foundationB = atDepth("fb", "Foundation B", 0);
    const next = atDepth("next", "Next", 1, foundationA.id);
    const higher = atDepth("higher", "Higher", 2, next.id);
    const layout = buildHierarchyLayout("brick", [foundationA, foundationB, next, higher], [
      edge(foundationA.id, next.id),
      edge(foundationB.id, next.id),
      edge(next.id, higher.id),
    ]);

    expect((layout.positions.get(higher.id)?.y ?? 0) < (layout.positions.get(next.id)?.y ?? 0)).toBe(true);
    expect((layout.positions.get(next.id)?.y ?? 0) < (layout.positions.get(foundationA.id)?.y ?? 0)).toBe(true);
  });

  it("widens a Tree as more leaf branches are added instead of alphabetically stacking them", () => {
    const root = atDepth("root", "Root", 0);
    const smallNodes = [root, atDepth("a", "Zeta", 1, root.id), atDepth("b", "Alpha", 1, root.id)];
    const wideNodes = [
      root,
      ...Array.from({ length: 7 }, (_, index) => atDepth(`c${index}`, `Node ${7 - index}`, 1, root.id)),
    ];
    const small = buildHierarchyLayout("tree", smallNodes, smallNodes.slice(1).map((node) => edge(root.id, node.id)));
    const wide = buildHierarchyLayout("tree", wideNodes, wideNodes.slice(1).map((node) => edge(root.id, node.id)));
    expect(wide.width).toBeGreaterThan(small.width);
  });
});
