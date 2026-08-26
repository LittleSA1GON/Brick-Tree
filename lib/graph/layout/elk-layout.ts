import ELK from "elkjs/lib/elk.bundled.js";
import type { ConceptEdge, ConceptNode } from "@/lib/schemas/concept";

const elk = new ELK();

export type PositionedConcept = ConceptNode & {
  position: { x: number; y: number };
};

const NODE_WIDTH = 250;
const NODE_HEIGHT = 132;

export async function layoutConceptGraph(
  nodes: ConceptNode[],
  edges: ConceptEdge[],
  direction: "DOWN" | "UP",
): Promise<PositionedConcept[]> {
  if (!nodes.length) return [];
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.spacing.nodeNode": "72",
      "elk.layered.spacing.nodeNodeBetweenLayers": "150",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.edgeRouting": "SPLINES",
      "elk.padding": "[top=60,left=60,bottom=60,right=60]",
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const result = await elk.layout(graph);
  const positions = new Map(
    (result.children ?? []).map((child) => [
      child.id,
      { x: child.x ?? 0, y: child.y ?? 0 },
    ]),
  );

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
  }));
}
