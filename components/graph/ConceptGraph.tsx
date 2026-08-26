"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import type { ConceptEdge as DomainEdge, ConceptNode as DomainNode } from "@/lib/schemas/concept";
import type { LearningTraversal } from "@/lib/schemas/session";
import { layoutConceptGraph } from "@/lib/graph/layout/elk-layout";
import { ConceptNode, type FlowConceptNode, type FlowNodeData } from "@/components/graph/ConceptNode";
import { ConceptEdge } from "@/components/graph/ConceptEdge";
import { GraphViewportController, type ViewportIntent } from "@/components/graph/GraphViewportController";

const nodeTypes = { concept: ConceptNode };
const edgeTypes = { concept: ConceptEdge };

function InnerGraph({
  nodes,
  edges,
  axis,
  traversal,
  generatedNodeIds,
  selectedNodeId,
  focusedNodeId,
  expandedNodeIds,
  loadingNodeId,
  recommendedTitle,
  viewportIntent,
  onSelect,
  onExpand,
  onCollapse,
  onRoot,
}: {
  nodes: DomainNode[];
  edges: DomainEdge[];
  axis: "depth" | "height";
  traversal: LearningTraversal;
  generatedNodeIds: Set<string>;
  selectedNodeId?: string;
  focusedNodeId?: string;
  expandedNodeIds: Set<string>;
  loadingNodeId?: string;
  recommendedTitle?: string;
  viewportIntent: ViewportIntent;
  onSelect: (id: string) => void;
  onExpand: (id: string) => void;
  onCollapse: (id: string) => void;
  onRoot: () => void;
}) {
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void layoutConceptGraph(nodes, edges, axis === "depth" ? "DOWN" : "UP").then((positioned) => {
      if (cancelled) return;
      setPositions(new Map(positioned.map((node) => [node.id, node.position])));
    });
    return () => {
      cancelled = true;
    };
  }, [nodes, edges, axis]);

  const flowNodes = useMemo<FlowConceptNode[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: "concept",
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        draggable: false,
        selectable: true,
        data: {
          ...node,
          axis,
          selected: node.id === selectedNodeId,
          focused: node.id === focusedNodeId,
          expanded: expandedNodeIds.has(node.id),
          loading: node.id === loadingNodeId,
          recommended: Boolean(recommendedTitle && node.title === recommendedTitle),
          hasGeneratedChildren: generatedNodeIds.has(node.id),
          traversal,
          onSelect,
          onExpand,
          onCollapse,
        } satisfies FlowNodeData,
      })),
    [
      nodes,
      positions,
      axis,
      traversal,
      generatedNodeIds,
      selectedNodeId,
      focusedNodeId,
      expandedNodeIds,
      loadingNodeId,
      recommendedTitle,
      onSelect,
      onExpand,
      onCollapse,
    ],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "concept",
        className: "concept-edge-enter",
        data: { relationshipType: edge.relationshipType },
      })),
    [edges],
  );

  return (
    <ReactFlow
      nodes={flowNodes as Node[]}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      minZoom={0.32}
      maxZoom={1.8}
      defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      fitView
      fitViewOptions={{ padding: 0.22 }}
      onNodeClick={(_, node) => onSelect(node.id)}
    >
      <Background variant={BackgroundVariant.Dots} gap={28} size={1.2} className="graph-background" />
      <GraphViewportController intent={viewportIntent} />
      <Controls showInteractive={false} />
      <Panel position="top-left">
        <button type="button" className="graph-root-button" onClick={onRoot}>Root</button>
      </Panel>
    </ReactFlow>
  );
}

export function ConceptGraph(props: Parameters<typeof InnerGraph>[0]) {
  return (
    <ReactFlowProvider>
      <InnerGraph {...props} />
    </ReactFlowProvider>
  );
}
