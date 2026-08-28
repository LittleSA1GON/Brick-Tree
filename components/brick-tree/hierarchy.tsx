"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConceptEdge, ConceptNode } from "@/lib/schemas/concept";
import type { LearningPathProposal } from "@/lib/schemas/learning-path";
import type { AdaptiveExplanation } from "@/lib/schemas/api";
import { buildHierarchyLayout } from "@/lib/graph/hierarchy-layout";
import type { PrimaryMode } from "@/components/brick-tree/model";
import { levelLabel, statusText } from "@/components/brick-tree/model";
import { KnowledgeNode } from "@/components/brick-tree/node-detail";
import styles from "../BrickTreeApp.module.css";

export function HierarchyStage({
  mode,
  zoom,
  nodes,
  edges,
  focusNode,
  learningPath,
  goal,
  selectedNodeId,
  generatedNodeIds,
  explanations,
  loadingNodeId,
  resourceLoadingNodeIds,
  explanationLoadingNodeId,
  busyLabel,
  error,
  warnings,
  onFocus,
  onClearFocus,
  onContinue,
  onExplain,
  onRetryResources,
  onMarkKnown,
  onTreeFromHere,
  onBrickFromHere,
  onDismissMessages,
}: {
  mode: PrimaryMode;
  zoom: number;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  focusNode?: ConceptNode;
  learningPath?: LearningPathProposal;
  goal: string;
  selectedNodeId?: string;
  generatedNodeIds: Set<string>;
  explanations: Record<string, AdaptiveExplanation>;
  loadingNodeId?: string;
  resourceLoadingNodeIds: Set<string>;
  explanationLoadingNodeId?: string;
  busyLabel?: string;
  error?: string;
  warnings: string[];
  onFocus: (id: string) => void;
  onClearFocus: () => void;
  onContinue: (id: string) => void;
  onExplain: (id: string) => void;
  onRetryResources: (id: string) => void;
  onMarkKnown: (id: string) => void;
  onTreeFromHere: (id: string) => void;
  onBrickFromHere: (id: string) => void;
  onDismissMessages: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 760 });
  const destination = mode === "brick" && learningPath?.estimatedDestinationHeight && goal.trim()
    ? {
        title: goal.trim(),
        height: learningPath.estimatedDestinationHeight,
        reason: learningPath.destinationHeightReason || "Estimated from the gap between your current foundation and the destination.",
      }
    : undefined;

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () => setViewportSize({ width: scroller.clientWidth || 1200, height: scroller.clientHeight || 760 });
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : undefined;
    observer?.observe(scroller);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const layout = useMemo(() => {
    const aspect = viewportSize.width / Math.max(1, viewportSize.height);
    const nodeGap = Math.round(Math.max(250, Math.min(aspect > 1.8 ? 380 : 340, viewportSize.width * (aspect > 1.8 ? 0.2 : 0.28))));
    const rowGap = Math.round(Math.max(158, Math.min(220, viewportSize.height * 0.24)));
    const paddingX = Math.round(Math.max(220, Math.min(420, viewportSize.width * 0.3)));
    const paddingY = Math.round(Math.max(240, Math.min(420, viewportSize.height * 0.42)));
    return buildHierarchyLayout(mode, nodes, edges, {
      nodeGap: mode === "tree" ? nodeGap : Math.max(nodeGap, 280),
      rowGap,
      paddingX,
      paddingY: mode === "tree" ? paddingY : Math.max(paddingY, 300),
      destinationOffset: destination ? 126 : 0,
    });
  }, [mode, nodes, edges, destination, viewportSize]);

  const scaledWidth = Math.max(viewportSize.width, Math.ceil(layout.width * zoom));
  const scaledHeight = Math.max(viewportSize.height, Math.ceil(layout.height * zoom));

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const timer = window.setTimeout(() => {
      const target = scroller.querySelector<HTMLElement>('[data-focus-target="true"]');
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        return;
      }
      const left = Math.max(0, (scroller.scrollWidth - scroller.clientWidth) / 2);
      const top = mode === "brick"
        ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        : 0;
      scroller.scrollTo({ left, top, behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [focusNode?.id, mode, scaledHeight, scaledWidth, nodes.length, edges.length, zoom]);

  const topBrickDepth = nodes.reduce((value, node) => Math.max(value, node.depth), 0);

  return (
    <section className={`${styles.hierarchyStage} ${mode === "tree" ? styles.treeStage : styles.brickStage}`}>
      <div ref={scrollerRef} className={styles.graphScroller} aria-label={`${mode === "tree" ? "Tree" : "Brick"} graph. Scroll vertically and horizontally; swipe on touch devices.`}>
        <div
          className={styles.graphCanvas}
          style={{ width: scaledWidth, height: scaledHeight }}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClearFocus();
          }}
        >
          <div
            className={`${styles.graphPlane} ${mode === "brick" ? styles.graphPlaneBrick : styles.graphPlaneTree}`}
            style={{
              width: layout.width,
              height: layout.height,
              left: scaledWidth / 2,
              transform: `translateX(-50%) scale(${zoom})`,
              transformOrigin: mode === "brick" ? "center bottom" : "center top",
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) onClearFocus();
            }}
          >
          <svg className={styles.graphEdges} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
            {edges.map((edge) => {
              const source = layout.positions.get(edge.source);
              const target = layout.positions.get(edge.target);
              if (!source || !target) return null;
              const middleY = (source.y + target.y) / 2;
              return (
                <path
                  key={edge.id}
                  d={`M ${source.x} ${source.y} C ${source.x} ${middleY}, ${target.x} ${middleY}, ${target.x} ${target.y}`}
                  className={styles.graphEdge}
                />
              );
            })}
            {destination ? (
              <path
                d={`M ${layout.width / 2} 54 L ${layout.width / 2} ${126 + 56}`}
                className={`${styles.graphEdge} ${styles.graphEdgeDashed}`}
              />
            ) : null}
          </svg>

          {destination ? (
            <div className={styles.graphDestination} style={{ left: layout.width / 2, top: 48 }}>
              <DestinationNode destination={destination} />
            </div>
          ) : null}

          {nodes.map((node, index) => {
            const point = layout.positions.get(node.id);
            if (!point) return null;
            const focused = focusNode?.id === node.id;
            const level = mode === "tree" ? -node.depth : node.depth;
            const treeScale = Math.max(0.58, 1 - node.depth * 0.065);
            const brickDistance = Math.abs(topBrickDepth - node.depth);
            const compactScale = mode === "tree" ? treeScale : Math.max(0.72, 0.94 - brickDistance * 0.025);

            return (
              <div
                key={node.id}
                className={`${styles.graphNodeWrapper} ${focused ? styles.graphNodeFocused : ""}`}
                style={{
                  left: point.x,
                  top: point.y,
                  transform: `translate(-50%, -50%) scale(${focused ? 1 : compactScale})`,
                }}
                data-focus-target={focused ? "true" : undefined}
              >
                {focused ? (
                  <KnowledgeNode
                    node={node}
                    mode={mode}
                    level={level}
                    selected={selectedNodeId === node.id}
                    recommended={Boolean(learningPath?.recommendedTitle === node.title)}
                    recommendationReason={learningPath?.recommendedTitle === node.title ? learningPath.recommendationReason : undefined}
                    explanation={explanations[node.id]}
                    generated={generatedNodeIds.has(node.id)}
                    busy={loadingNodeId === node.id}
                    busyLabel={loadingNodeId === node.id ? busyLabel : undefined}
                    explanationLoading={explanationLoadingNodeId === node.id}
                    resourceLoading={resourceLoadingNodeIds.has(node.id)}
                    error={selectedNodeId === node.id ? error : undefined}
                    warnings={selectedNodeId === node.id ? warnings : []}
                    onExplain={() => onExplain(node.id)}
                    onRetryResources={() => onRetryResources(node.id)}
                    onContinue={() => onContinue(node.id)}
                    onMarkKnown={() => onMarkKnown(node.id)}
                    onTreeFromHere={() => onTreeFromHere(node.id)}
                    onBrickFromHere={() => onBrickFromHere(node.id)}
                    onDismissMessages={onDismissMessages}
                  />
                ) : (
                  <CompactNode
                    node={node}
                    mode={mode}
                    level={level}
                    selected={selectedNodeId === node.id}
                    recommended={Boolean(learningPath?.recommendedTitle === node.title)}
                    delay={Math.min(index * 45, 360)}
                    onClick={() => onFocus(node.id)}
                  />
                )}
              </div>
            );
          })}
          </div>
        </div>
      </div>
      <div className={styles.navigationHint}>
        <span>↕ Scroll levels</span>
        <span>↔ Scroll or swipe siblings</span>
      </div>
    </section>
  );
}

export function DestinationNode({ destination }: { destination: { title: string; height: number; reason: string } }) {
  return (
    <article className={styles.destinationNode}>
      <span>Destination · Height +{destination.height}</span>
      <strong>{destination.title}</strong>
      <p>{destination.reason}</p>
    </article>
  );
}

export function CompactNode({ node, mode, level, selected, recommended, delay, onClick }: {
  node: ConceptNode;
  mode: PrimaryMode;
  level: number;
  selected: boolean;
  recommended: boolean;
  delay: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.compactNode} ${selected ? styles.compactSelected : ""}`}
      style={{ animationDelay: `${delay}ms` }}
      onClick={onClick}
    >
      <span>{levelLabel(mode, level)}</span>
      <strong>{node.title}</strong>
      <p>{node.shortDescription}</p>
      <small>{statusText(node.knowledgeStatus)}{recommended ? " · Recommended" : ""}</small>
    </button>
  );
}


