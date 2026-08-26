import type { ConceptEdge, ConceptNode } from "@/lib/schemas/concept";
import type { LearningTraversal } from "@/lib/schemas/session";
import { deduplicateEdges, deduplicateNodes } from "@/lib/graph/graph-utils";

export function mergeGraphPatch(
  currentNodes: ConceptNode[],
  currentEdges: ConceptEdge[],
  parent: ConceptNode,
  incomingNodes: ConceptNode[],
  incomingEdges: ConceptEdge[],
): { nodes: ConceptNode[]; edges: ConceptEdge[] } {
  const existingParent = currentNodes.find((node) => node.id === parent.id);
  const mergedParent = existingParent
    ? {
        ...existingParent,
        ...parent,
        // A node can have neighbors produced by more than one traversal intent.
        // Never throw away previously generated semantic branches.
        childIds: [...new Set([...existingParent.childIds, ...parent.childIds])],
        resources: parent.resources.length ? parent.resources : existingParent.resources,
        origins: [
          ...new Map(
            [...existingParent.origins, ...parent.origins].map((origin) => [JSON.stringify(origin), origin]),
          ).values(),
        ],
      }
    : parent;
  const replaced = currentNodes.map((node) => (node.id === parent.id ? mergedParent : node));
  if (!replaced.some((node) => node.id === parent.id)) replaced.push(mergedParent);
  return {
    nodes: deduplicateNodes(replaced, incomingNodes),
    edges: deduplicateEdges([...currentEdges, ...incomingEdges]),
  };
}

export function traversalRelationships(traversal?: LearningTraversal): Set<ConceptEdge["relationshipType"]> {
  if (!traversal) {
    return new Set(["contains", "prerequisite", "builds-on", "leads-to", "related", "examines"]);
  }
  if (traversal.mode === "tree") {
    if (traversal.intent === "decompose") return new Set(["contains"]);
    if (traversal.intent === "analyze-question") return new Set(["examines"]);
    return new Set(["prerequisite", "builds-on"]);
  }
  return new Set(["leads-to", "builds-on"]);
}

export function hasGeneratedTraversalNeighbors(
  nodeId: string,
  edges: ConceptEdge[],
  traversal: LearningTraversal,
): boolean {
  const relationships = traversalRelationships(traversal);
  return edges.some((edge) => edge.source === nodeId && relationships.has(edge.relationshipType));
}

/**
 * Visibility is intent-aware. The graph retains every semantic relationship
 * that has already been generated, while the current Tree/Brick intent decides
 * which relationships drive the visible traversal.
 *
 * This is the key to "Separate the intent. Share the system": a prerequisite, decomposition, and question-analysis branch can coexist without being mixed on screen.
 */
export function visibleGraph(
  nodes: ConceptNode[],
  edges: ConceptEdge[],
  expandedIds: Set<string>,
  options?: {
    traversal?: LearningTraversal;
    rootNodeIds?: string[];
  },
): { nodes: ConceptNode[]; edges: ConceptEdge[] } {
  if (!nodes.length) return { nodes: [], edges: [] };

  const relationships = traversalRelationships(options?.traversal);
  const requestedRoots = (options?.rootNodeIds ?? []).filter((id) => nodes.some((node) => node.id === id));
  const roots = requestedRoots.length
    ? requestedRoots
    : nodes.filter((node) => !node.parentId).map((node) => node.id);
  const visible = new Set(roots);

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (!relationships.has(edge.relationshipType)) continue;
      if (!visible.has(edge.source) || !expandedIds.has(edge.source) || visible.has(edge.target)) continue;
      visible.add(edge.target);
      changed = true;
    }
  }

  const visibleEdges = edges.filter((edge) => {
    if (!visible.has(edge.source) || !visible.has(edge.target)) return false;
    // Related links never expand the graph, but can be shown when both concepts
    // are already visible through the active traversal.
    return relationships.has(edge.relationshipType) || edge.relationshipType === "related";
  });

  return {
    nodes: nodes.filter((node) => visible.has(node.id)),
    edges: visibleEdges,
  };
}
