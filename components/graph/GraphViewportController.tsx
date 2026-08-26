"use client";

import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";

export type ViewportIntent =
  | { type: "fit-all"; nonce: number }
  | { type: "fit-branch"; rootNodeId: string; nonce: number }
  | { type: "focus-node"; nodeId: string; nonce: number }
  | { type: "show-overview"; nonce: number }
  | null;

function branchNodesFromVisibleGraph(
  nodes: ReturnType<ReturnType<typeof useReactFlow>["getNodes"]>,
  edges: ReturnType<ReturnType<typeof useReactFlow>["getEdges"]>,
  rootNodeId: string,
) {
  const bySource = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = bySource.get(edge.source) ?? [];
    targets.push(edge.target);
    bySource.set(edge.source, targets);
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const root = byId.get(rootNodeId);
  if (!root) return [];

  const result = [root];
  const queue = [rootNodeId];
  const seen = new Set(queue);
  while (queue.length) {
    const sourceId = queue.shift()!;
    for (const targetId of bySource.get(sourceId) ?? []) {
      if (seen.has(targetId)) continue;
      const child = byId.get(targetId);
      if (!child) continue;
      seen.add(targetId);
      result.push(child);
      queue.push(targetId);
    }
  }
  return result;
}

export function GraphViewportController({ intent }: { intent: ViewportIntent }) {
  const flow = useReactFlow();

  useEffect(() => {
    if (!intent) return;
    const timer = window.setTimeout(() => {
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      const duration = reduceMotion ? 0 : 720;

      if (intent.type === "fit-all" || intent.type === "show-overview") {
        void flow.fitView({
          padding: intent.type === "show-overview" ? 0.3 : 0.22,
          duration,
          minZoom: 0.42,
          maxZoom: 1.15,
        });
        return;
      }

      if (intent.type === "fit-branch") {
        const branchNodes = branchNodesFromVisibleGraph(flow.getNodes(), flow.getEdges(), intent.rootNodeId);
        if (!branchNodes.length) return;
        void flow.fitView({
          nodes: branchNodes,
          padding: branchNodes.length >= 6 ? 0.38 : 0.3,
          duration: reduceMotion ? 0 : 760,
          minZoom: branchNodes.length >= 6 ? 0.48 : 0.58,
          maxZoom: branchNodes.length <= 4 ? 1.28 : 1.08,
        });
        return;
      }

      const node = flow.getNode(intent.nodeId);
      if (!node) return;
      const width = node.measured?.width ?? 250;
      const height = node.measured?.height ?? 132;
      void flow.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
        zoom: 1.08,
        duration: reduceMotion ? 0 : 620,
      });
    }, 90);
    return () => window.clearTimeout(timer);
  }, [flow, intent]);

  return null;
}
