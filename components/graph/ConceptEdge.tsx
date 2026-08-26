"use client";

import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { ConceptEdge as DomainConceptEdge } from "@/lib/schemas/concept";

export function ConceptEdge(props: EdgeProps) {
  const relationshipType = (props.data as { relationshipType?: DomainConceptEdge["relationshipType"] } | undefined)?.relationshipType ?? "related";
  const [path] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    curvature: 0.28,
  });

  return (
    <BaseEdge
      id={props.id}
      path={path}
      markerEnd={props.markerEnd}
      className={`brick-edge relation-${relationshipType} ${props.selected ? "brick-edge-selected" : ""}`}
      style={props.style}
    />
  );
}
