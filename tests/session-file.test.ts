import { describe, expect, it } from "vitest";
import {
  createPortableSessionFile,
  createPortableWorkspaceFile,
  parsePortableSessionFile,
  parsePortableWorkspaceFile,
  safeSessionFileName,
  safeWorkspaceFileName,
} from "@/lib/schemas/session-file";
import { makeNode } from "./helpers";

function state() {
  const root = makeNode("root", "Machine Learning", 4);
  const brickRoot = makeNode("brick-root", "Your Foundations", 2);
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
    workspaces: [
      {
        id: "tree-map",
        name: "Machine Learning",
        mode: "tree" as const,
        treeIntent: "decompose" as const,
        brickIntent: "explore" as const,
        topic: "Machine Learning",
        knownInput: "",
        goal: "",
        nodes: [root],
        edges: [],
        levels: [root.level],
        expandedNodeIds: [root.id],
        selectedNodeId: root.id,
        focusedNodeId: root.id,
        viewRootId: root.id,
        trace: [],
        explanations: {},
        createdAt: 1,
      },
      {
        id: "brick-map",
        name: "Algebra",
        mode: "brick" as const,
        treeIntent: "decompose" as const,
        brickIntent: "explore" as const,
        topic: "",
        knownInput: "Algebra",
        goal: "",
        nodes: [brickRoot],
        edges: [],
        levels: [brickRoot.level],
        expandedNodeIds: [brickRoot.id],
        selectedNodeId: brickRoot.id,
        focusedNodeId: brickRoot.id,
        viewRootId: brickRoot.id,
        trace: [],
        explanations: {},
        createdAt: 2,
      },
    ],
    activeWorkspaceId: "tree-map",
  };
}

describe("portable session files", () => {
  it("round-trips independent Tree and Brick workspaces through a versioned file format", () => {
    const file = createPortableSessionFile(state());
    const restored = parsePortableSessionFile(JSON.parse(JSON.stringify(file)));
    expect(restored.format).toBe("brick-tree-session");
    expect(restored.version).toBe(1);
    expect(restored.state.nodes[0]?.title).toBe("Machine Learning");
    expect(restored.state.knownInput).toBe("Algebra");
    expect(restored.state.workspaces).toHaveLength(2);
    expect(restored.state.workspaces[0]?.mode).toBe("tree");
    expect(restored.state.workspaces[1]?.mode).toBe("brick");
    expect(restored.state.activeWorkspaceId).toBe("tree-map");
  });

  it("still accepts older single-workspace session files", () => {
    const legacy = state();
    delete (legacy as Partial<typeof legacy>).workspaces;
    delete (legacy as Partial<typeof legacy>).activeWorkspaceId;
    const file = createPortableSessionFile(legacy);
    const restored = parsePortableSessionFile(JSON.parse(JSON.stringify(file)));
    expect(restored.state.workspaces).toEqual([]);
  });


  it("round-trips one independent Tree or Brick workspace without replacing a whole session", () => {
    const workspace = state().workspaces[1]!;
    const file = createPortableWorkspaceFile(workspace);
    const restored = parsePortableWorkspaceFile(JSON.parse(JSON.stringify(file)));
    expect(restored.format).toBe("brick-tree-workspace");
    expect(restored.workspace.mode).toBe("brick");
    expect(restored.workspace.name).toBe("Algebra");
  });

  it("rejects arbitrary JSON that is not a Brick Tree session", () => {
    expect(() => parsePortableSessionFile({ hello: "world" })).toThrow();
  });

  it("creates filesystem-safe session and workspace filenames", () => {
    expect(safeSessionFileName("Machine Learning / Foundations")).toBe("machine-learning-foundations.bricktree.json");
    expect(safeWorkspaceFileName("Algebra Foundations", "brick")).toBe("algebra-foundations.brick.bricktree.json");
  });
});
