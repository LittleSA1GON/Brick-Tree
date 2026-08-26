import type { ConceptEdge, ConceptNode, GraphContext, GraphLevelDescriptor } from "@/lib/schemas/concept";
import { normalizeConceptTitle, slugify } from "@/lib/utils/text";

export function conceptId(parentId: string | undefined, title: string): string {
  const parent = parentId ? parentId.slice(0, 80) : "root";
  return `${parent}::${slugify(title)}`;
}

export function edgeId(source: string, target: string, type: ConceptEdge["relationshipType"]): string {
  return `${source}=>${type}=>${target}`;
}

export function deduplicateNodes(existing: ConceptNode[], incoming: ConceptNode[]): ConceptNode[] {
  const byId = new Map(existing.map((node) => [node.id, node]));
  const normalizedToId = new Map(existing.map((node) => [node.normalizedTitle, node.id]));
  for (const node of incoming) {
    const normalizedTitle = normalizeConceptTitle(node.title);
    const sameTitleId = normalizedToId.get(normalizedTitle);
    if (sameTitleId && sameTitleId !== node.id) continue;
    byId.set(node.id, { ...node, normalizedTitle });
    normalizedToId.set(normalizedTitle, node.id);
  }
  return [...byId.values()];
}

export function deduplicateEdges(edges: ConceptEdge[]): ConceptEdge[] {
  const map = new Map<string, ConceptEdge>();
  for (const edge of edges) map.set(edge.id, edge);
  return [...map.values()];
}

export function graphContextFromState(
  nodes: ConceptNode[],
  levels: GraphLevelDescriptor[],
  focusedNodeId?: string,
): GraphContext {
  return {
    nodes: nodes.slice(0, 250).map((node) => ({
      id: node.id,
      title: node.title,
      normalizedTitle: node.normalizedTitle,
      parentId: node.parentId,
      depth: node.depth,
      difficulty: node.difficulty,
      knowledgeStatus: node.knowledgeStatus,
      level: node.level,
    })),
    levels,
    focusedNodeId,
  };
}
