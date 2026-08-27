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
    const leftChildren = [
      layout.positions.get(leafA.id)?.x ?? 0,
      layout.positions.get(leafB.id)?.x ?? 0,
    ];
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

  it("lays Brick out as centered stacked rows instead of branching subtrees", () => {
    const row0 = [
      atDepth("f0", "Algebra", 0),
      atDepth("f1", "Python", 0),
      atDepth("f2", "Statistics", 0),
    ];
    const row1 = Array.from({ length: 4 }, (_, index) =>
      atDepth(`n1-${index}`, `Height 1 ${index}`, 1),
    );
    const row2 = Array.from({ length: 5 }, (_, index) =>
      atDepth(`n2-${index}`, `Height 2 ${index}`, 2),
    );
    const nodes = [...row0, ...row1, ...row2];
    const layout = buildHierarchyLayout("brick", nodes, [], {
      nodeGap: 220,
      rowGap: 150,
      paddingX: 100,
      paddingY: 80,
    });

    const x0 = row0.map((node) => layout.positions.get(node.id)?.x ?? 0);
    const x1 = row1.map((node) => layout.positions.get(node.id)?.x ?? 0);
    const x2 = row2.map((node) => layout.positions.get(node.id)?.x ?? 0);

    expect(x1.length).toBe(x0.length + 1);
    expect(x2.length).toBe(x1.length + 1);
    expect(Math.min(...x1)).toBeLessThan(Math.min(...x0));
    expect(Math.max(...x1)).toBeGreaterThan(Math.max(...x0));
    expect(Math.min(...x2)).toBeLessThan(Math.min(...x1));
    expect(Math.max(...x2)).toBeGreaterThan(Math.max(...x1));

    for (const row of [x0, x1, x2]) {
      for (let index = 1; index < row.length; index += 1) {
        expect(row[index] - row[index - 1]).toBeGreaterThanOrEqual(220);
      }
    }
  });

  it("widens a Tree as more leaf branches are added instead of alphabetically stacking them", () => {
    const root = atDepth("root", "Root", 0);
    const smallNodes = [
      root,
      atDepth("a", "Zeta", 1, root.id),
      atDepth("b", "Alpha", 1, root.id),
    ];
    const wideNodes = [
      root,
      ...Array.from({ length: 7 }, (_, index) =>
        atDepth(`c${index}`, `Node ${7 - index}`, 1, root.id),
      ),
    ];
    const small = buildHierarchyLayout(
      "tree",
      smallNodes,
      smallNodes.slice(1).map((node) => edge(root.id, node.id)),
    );
    const wide = buildHierarchyLayout(
      "tree",
      wideNodes,
      wideNodes.slice(1).map((node) => edge(root.id, node.id)),
    );
    expect(wide.width).toBeGreaterThan(small.width);
  });
});
