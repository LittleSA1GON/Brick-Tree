import { describe, expect, it } from "vitest";
import { deduplicateNodes, edgeId, graphContextFromState } from "@/lib/graph/graph-utils";
import { mergeGraphPatch, visibleGraph } from "@/lib/graph/client-state";
import { makeNode } from "./helpers";

describe("graph state", () => {
  it("reveals only expanded branches", () => {
    const root = { ...makeNode("root", "Calculus", 4), childIds: ["a", "b"] };
    const a = { ...makeNode("a", "Derivatives", 3, "root", 1), childIds: ["c"] };
    const b = makeNode("b", "Integrals", 3, "root", 1);
    const c = makeNode("c", "Chain Rule", 3, "a", 2);
    const edges = [
      { id: edgeId("root", "a", "contains"), source: "root", target: "a", relationshipType: "contains" as const },
      { id: edgeId("root", "b", "contains"), source: "root", target: "b", relationshipType: "contains" as const },
      { id: edgeId("a", "c", "contains"), source: "a", target: "c", relationshipType: "contains" as const },
    ];

    expect(visibleGraph([root, a, b, c], edges, new Set()).nodes.map((node) => node.id)).toEqual(["root"]);
    expect(visibleGraph([root, a, b, c], edges, new Set(["root"])).nodes.map((node) => node.id)).toEqual(["root", "a", "b"]);
    expect(visibleGraph([root, a, b, c], edges, new Set(["root", "a"])).nodes.map((node) => node.id)).toEqual(["root", "a", "b", "c"]);
  });

  it("updates an existing parent without duplicating it", () => {
    const root = makeNode("root", "Calculus", 4);
    const child = makeNode("child", "Derivatives", 3, "root", 1);
    const updated = { ...root, childIds: [child.id] };
    const patch = mergeGraphPatch([root], [], updated, [child], [
      { id: "edge", source: root.id, target: child.id, relationshipType: "contains" },
    ]);
    expect(patch.nodes).toHaveLength(2);
    expect(patch.nodes.find((node) => node.id === "root")?.childIds).toEqual(["child"]);
  });

  it("deduplicates equivalent concept names", () => {
    const a = makeNode("a", "Linear Algebra", 3);
    const b = { ...makeNode("b", " linear algebra ", 3), normalizedTitle: "linear algebra" };
    expect(deduplicateNodes([a], [b])).toHaveLength(1);
  });

  it("includes difficulty in the bounded graph context", () => {
    const root = makeNode("root", "Probability", 3);
    const context = graphContextFromState([root], [root.level], root.id);
    expect(context.nodes[0].difficulty).toBe(3);
    expect(context.focusedNodeId).toBe("root");
  });
});

it("keeps Tree decomposition and prerequisite traversal semantically isolated while sharing graph state", () => {
  const root = { ...makeNode("root", "Neural Networks", 4), childIds: ["layers", "algebra"] };
  const layers = makeNode("layers", "Layers", 3, "root", 1);
  const algebra = makeNode("algebra", "Linear Algebra", 3, "root", 1);
  const semanticEdges = [
    { id: edgeId("root", "layers", "contains"), source: "root", target: "layers", relationshipType: "contains" as const },
    { id: edgeId("root", "algebra", "prerequisite"), source: "root", target: "algebra", relationshipType: "prerequisite" as const },
  ];

  const decomposition = visibleGraph([root, layers, algebra], semanticEdges, new Set(["root"]), {
    traversal: { mode: "tree", intent: "decompose" },
    rootNodeIds: ["root"],
  });
  expect(decomposition.nodes.map((node) => node.id)).toEqual(["root", "layers"]);

  const roots = visibleGraph([root, layers, algebra], semanticEdges, new Set(["root"]), {
    traversal: { mode: "tree", intent: "trace-prerequisites" },
    rootNodeIds: ["root"],
  });
  expect(roots.nodes.map((node) => node.id)).toEqual(["root", "algebra"]);
});

it("can re-anchor a shared graph on a selected brick when changing traversal direction", () => {
  const root = makeNode("root", "Backpropagation", 4);
  const derivative = makeNode("derivative", "Derivatives", 2, "root", 1);
  const optimization = makeNode("optimization", "Optimization", 3, "derivative", 2);
  const semanticEdges = [
    { id: edgeId("root", "derivative", "prerequisite"), source: "root", target: "derivative", relationshipType: "prerequisite" as const },
    { id: edgeId("derivative", "optimization", "leads-to"), source: "derivative", target: "optimization", relationshipType: "leads-to" as const },
  ];
  const branch = visibleGraph([root, derivative, optimization], semanticEdges, new Set(["derivative"]), {
    traversal: { mode: "brick", intent: "explore" },
    rootNodeIds: ["derivative"],
  });
  expect(branch.nodes.map((node) => node.id)).toEqual(["derivative", "optimization"]);
});


it("keeps Tree question analysis isolated through examines edges", () => {
  const root = makeNode("root", "How should software engineers adapt to AI?", 4);
  const who = makeNode("who", "Who gains leverage from AI-assisted engineering?", 4, "root", 1);
  const how = makeNode("how", "How should skills and workflows change?", 4, "root", 1);
  const parts = makeNode("parts", "Software engineering capabilities", 4, "root", 1);
  const edges = [
    { id: edgeId("root", "who", "examines"), source: "root", target: "who", relationshipType: "examines" as const },
    { id: edgeId("root", "how", "examines"), source: "root", target: "how", relationshipType: "examines" as const },
    { id: edgeId("root", "parts", "contains"), source: "root", target: "parts", relationshipType: "contains" as const },
  ];

  const view = visibleGraph([root, who, how, parts], edges, new Set(["root"]), {
    traversal: { mode: "tree", intent: "analyze-question" },
    rootNodeIds: ["root"],
  });
  expect(view.nodes.map((node) => node.id)).toEqual(["root", "who", "how"]);
  expect(view.edges.every((edge) => edge.relationshipType === "examines")).toBe(true);
});
