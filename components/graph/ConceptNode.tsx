"use client";

import type { CSSProperties } from "react";
import { Handle, Position, type Node, type NodeProps, useViewport } from "@xyflow/react";
import type { ConceptNode as DomainConceptNode } from "@/lib/schemas/concept";
import type { LearningTraversal } from "@/lib/schemas/session";

export type FlowNodeData = DomainConceptNode & {
  axis: "depth" | "height";
  selected: boolean;
  focused: boolean;
  expanded: boolean;
  loading: boolean;
  recommended: boolean;
  hasGeneratedChildren: boolean;
  traversal: LearningTraversal;
  onSelect: (id: string) => void;
  onExpand: (id: string) => void;
  onCollapse: (id: string) => void;
};

export type FlowConceptNode = Node<FlowNodeData, "concept">;

function expansionCopy(traversal: LearningTraversal, generated: boolean): string {
  if (traversal.mode === "tree") {
    if (traversal.intent === "trace-prerequisites") return generated ? "Reveal roots" : "Trace roots";
    if (traversal.intent === "analyze-question") return generated ? "Reveal lenses" : "Analyze lens";
    return generated ? "Reveal parts" : "Break down";
  }
  if (traversal.intent === "destination") return generated ? "Reveal path" : "Build onward";
  return generated ? "Reveal branches" : "Explore next";
}

function floatStyle(title: string): CSSProperties {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  return {
    "--float-duration": `${5 + (hash % 17) / 10}s`,
    "--float-delay": `-${(hash % 19) / 10}s`,
  } as CSSProperties;
}

export function ConceptNode({ data }: NodeProps<FlowConceptNode>) {
  const { zoom } = useViewport();
  const verticalSource = data.axis === "depth" ? Position.Bottom : Position.Top;
  const verticalTarget = data.axis === "depth" ? Position.Top : Position.Bottom;
  const showSummary = zoom >= 0.62;
  const showActions = zoom >= 0.79;

  return (
    <div className="flow-position-wrapper">
      <Handle type="target" position={verticalTarget} className="brick-handle" />
      <article
        className={`concept-card difficulty-${data.difficulty} knowledge-${data.knowledgeStatus} ${data.selected ? "is-selected" : ""} ${data.focused ? "is-focused" : ""} ${
          data.recommended || data.knowledgeStatus === "recommended" ? "is-recommended" : ""
        } ${data.status === "needs-review" ? "needs-review" : ""}`}
        style={floatStyle(data.title)}
        onClick={() => data.onSelect(data.id)}
      >
        <div className="concept-card-topline">
          <span className="level-pill">{data.level.label}</span>
          <span className={`difficulty-pill d${data.difficulty}`}>D{data.difficulty}</span>
        </div>
        <h3>{data.title}</h3>
        {showSummary ? <p>{data.shortDescription}</p> : null}
        {data.origins.some((origin) => origin.type === "uploaded-source") ? <div className="source-backed-badge">📄 Source-backed</div> : null}
        {data.knowledgeStatus === "known" ? <div className="knowledge-badge known">● Known brick</div> : null}
        {data.knowledgeStatus === "missing-prerequisite" ? <div className="knowledge-badge missing">△ Missing foundation</div> : null}
        {data.knowledgeStatus === "future" ? <div className="knowledge-badge future">○ Future brick</div> : null}
        {data.recommended || data.knowledgeStatus === "recommended" ? <div className="recommended-badge">★ Recommended next brick</div> : null}
        {showActions ? (
          <div className="concept-card-actions">
            <button
              type="button"
              className="node-action"
              onClick={(event) => {
                event.stopPropagation();
                data.expanded ? data.onCollapse(data.id) : data.onExpand(data.id);
              }}
              disabled={data.loading}
            >
              {data.loading ? "Building…" : data.expanded ? "Collapse" : expansionCopy(data.traversal, data.hasGeneratedChildren)}
            </button>
          </div>
        ) : null}
      </article>
      <Handle type="source" position={verticalSource} className="brick-handle" />
    </div>
  );
}
