"use client";

import type { ConceptNode } from "@/lib/schemas/concept";

export function GraphBreadcrumbs({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: ConceptNode[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  if (!selectedId) return null;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: ConceptNode[] = [];
  let current = byId.get(selectedId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return (
    <nav className="breadcrumbs" aria-label="Knowledge path">
      {path.map((node, index) => (
        <span key={node.id} className="breadcrumb-item">
          {index > 0 ? <span className="breadcrumb-separator">›</span> : null}
          <button type="button" onClick={() => onSelect(node.id)}>
            {node.title}
          </button>
        </span>
      ))}
    </nav>
  );
}
