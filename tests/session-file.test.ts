import { describe, expect, it } from "vitest";
import { createPortableSessionFile, parsePortableSessionFile, safeSessionFileName } from "@/lib/schemas/session-file";
import { makeNode } from "./helpers";

function state() {
  const root = makeNode("root", "Machine Learning", 4);
  return {
    mode: "tree" as const,
    treeIntent: "decompose" as const,
    brickIntent: "explore" as const,
    nodes: [root],
    edges: [],
    levels: [root.level],
    expandedNodeIds: [root.id],
    selectedNodeId: root.id,
    focusedNodeId: root.id,
    viewRootId: root.id,
    goal: "",
    knownInput: "Algebra",
    topic: "Machine Learning",
    profile: {
      existingKnowledge: ["Algebra"],
      sourceMode: "general" as const,
      sourceDocumentIds: [],
      knowledgeLevel: "beginner" as const,
      languageStyle: "standard" as const,
      depthPreference: "balanced" as const,
      purpose: "general-learning" as const,
    },
    documents: [],
    trace: [],
    explanations: {},
  };
}

describe("portable session files", () => {
  it("round-trips the graph and learner state through a versioned file format", () => {
    const file = createPortableSessionFile(state());
    const restored = parsePortableSessionFile(JSON.parse(JSON.stringify(file)));
    expect(restored.format).toBe("brick-tree-session");
    expect(restored.version).toBe(1);
    expect(restored.state.nodes[0]?.title).toBe("Machine Learning");
    expect(restored.state.knownInput).toBe("Algebra");
  });

  it("rejects arbitrary JSON that is not a Brick Tree session", () => {
    expect(() => parsePortableSessionFile({ hello: "world" })).toThrow();
  });

  it("creates filesystem-safe session filenames", () => {
    expect(safeSessionFileName("Machine Learning / Foundations")).toBe("machine-learning-foundations.bricktree.json");
  });
});
