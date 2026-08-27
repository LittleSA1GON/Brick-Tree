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
        childIds: [...new Set([...existingParent.childIds, ...parent.childIds])],
        resources: parent.resources.length ? parent.resources : existingParent.resources,
        origins: [
          ...new Map(
            [...existingParent.origins, ...parent.origins].map((origin) => [JSON.stringify(origin), origin]),
          ).values(),
        ],
      }
    : parent;

  let mergedNodes = currentNodes.map((node) =>
    node.id === parent.id ? mergedParent : node,
  );
  if (!mergedNodes.some((node) => node.id === parent.id)) {
    mergedNodes.push(mergedParent);
  }

  mergedNodes = deduplicateNodes(mergedNodes, incomingNodes);
  const mergedEdges = deduplicateEdges([...currentEdges, ...incomingEdges]);

  // Brick rows can be supported by more than one node in the previous layer.
  // Keep every source node's childIds synchronized with the semantic edge set,
  // rather than updating only the node that happened to be clicked.
  const childrenBySource = new Map<string, string[]>();
  for (const edge of mergedEdges) {
    const list = childrenBySource.get(edge.source) ?? [];
    if (!list.includes(edge.target)) list.push(edge.target);
    childrenBySource.set(edge.source, list);
  }

  mergedNodes = mergedNodes.map((node) => {
    const edgeChildren = childrenBySource.get(node.id);
    if (!edgeChildren) return node;
    return {
      ...node,
      childIds: [...new Set([...node.childIds, ...edgeChildren])],
    };
  });

  return {
    nodes: mergedNodes,
    edges: mergedEdges,
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
  const requestedRoots = (options?.rootNodeIds ?? []).filter((id) =>
    nodes.some((node) => node.id === id),
  );
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
    return relationships.has(edge.relationshipType) || edge.relationshipType === "related";
  });

  return {
    nodes: nodes.filter((node) => visible.has(node.id)),
    edges: visibleEdges,
  };
}
