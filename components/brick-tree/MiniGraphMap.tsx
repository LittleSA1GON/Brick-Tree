"use client";

import type { ConceptEdge, ConceptNode } from "@/lib/schemas/concept";
import { buildHierarchyLayout } from "@/lib/graph/hierarchy-layout";
import type { PrimaryMode } from "@/components/brick-tree/model";
import styles from "../BrickTreeApp.module.css";

export function MiniGraphMap({ mode, nodes, edges, activeNodeId, destination, onTeleport, compact = false }: {
  mode: PrimaryMode;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  activeNodeId?: string;
  destination?: { title: string; height: number };
  onTeleport: (id: string) => void;
  compact?: boolean;
}) {
  if (!nodes.length) return <div className={`${styles.miniGraph} ${compact ? styles.miniGraphCompact : ""}`}><p className={styles.emptyMap}>Map starts here.</p></div>;

  const layout = buildHierarchyLayout(mode, nodes, edges, {
    nodeGap: compact ? 118 : 150,
    rowGap: compact ? 74 : 98,
    paddingX: compact ? 58 : 88,
    paddingY: compact ? 36 : 54,
    destinationOffset: destination ? (compact ? 56 : 82) : 0,
  });
  const scale = compact ? Math.min(1, 218 / layout.width) : 1;
  const renderWidth = Math.max(compact ? 210 : 640, layout.width * scale);
  const renderHeight = Math.max(compact ? 118 : 190, layout.height * scale);

  return (
    <div className={`${styles.miniGraph} ${compact ? styles.miniGraphCompact : ""}`}>
      <div className={styles.miniGraphCanvas} style={{ width: renderWidth, height: renderHeight }}>
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" aria-hidden="true">
          {edges.map((edge) => {
            const source = layout.positions.get(edge.source);
            const target = layout.positions.get(edge.target);
            if (!source || !target) return null;
            const midY = (source.y + target.y) / 2;
            return (
              <path
                key={edge.id}
                d={`M ${source.x} ${source.y} C ${source.x} ${midY}, ${target.x} ${midY}, ${target.x} ${target.y}`}
                className={styles.miniEdge}
              />
            );
          })}
          {destination ? (
            <path
              d={`M ${layout.width / 2} 28 L ${layout.width / 2} ${compact ? 78 : 116}`}
              className={`${styles.miniEdge} ${styles.miniEdgeDashed}`}
            />
          ) : null}
        </svg>

        {destination ? (
          <div
            className={styles.miniDestination}
            style={{ left: "50%", top: compact ? 10 : 16, transform: `translateX(-50%) scale(${compact ? 0.72 : 1})` }}
          >
            <small>+{destination.height}</small>
            <strong>{destination.title}</strong>
          </div>
        ) : null}

        {nodes.map((node) => {
          const position = layout.positions.get(node.id);
          if (!position) return null;
          return (
            <button
              key={node.id}
              type="button"
              className={`${styles.miniNode} ${compact ? styles.miniNodeCompact : ""} ${node.id === activeNodeId ? styles.miniNodeActive : ""}`}
              style={{ left: position.x * scale, top: position.y * scale }}
              onClick={(event) => {
                event.stopPropagation();
                onTeleport(node.id);
              }}
              title={node.shortDescription}
            >
              <small>{mode === "tree" ? -node.depth : node.depth > 0 ? `+${node.depth}` : "0"}</small>
              {!compact ? <span>{node.title}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
