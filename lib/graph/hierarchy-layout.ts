import type { ConceptEdge, ConceptNode } from "@/lib/schemas/concept";

export type HierarchyPoint = {
  x: number;
  y: number;
};

export type HierarchyLayout = {
  width: number;
  height: number;
  positions: Map<string, HierarchyPoint>;
};

type LayoutMode = "tree" | "brick";

type LayoutOptions = {
  nodeGap?: number;
  rowGap?: number;
  paddingX?: number;
  paddingY?: number;
  destinationOffset?: number;
};

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function visibleEdges(nodes: ConceptNode[], edges: ConceptEdge[]): ConceptEdge[] {
  const ids = new Set(nodes.map((node) => node.id));
  return edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
}

function treeLayout(
  nodes: ConceptNode[],
  edges: ConceptEdge[],
  options: Required<LayoutOptions>,
): HierarchyLayout {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const graphEdges = visibleEdges(nodes, edges);
  const children = new Map<string, string[]>();
  const incoming = new Map<string, number>();

  for (const edge of graphEdges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target || target.depth <= source.depth) continue;
    const list = children.get(edge.source) ?? [];
    if (!list.includes(edge.target)) list.push(edge.target);
    children.set(edge.source, list);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const inputOrder = new Map(nodes.map((node, index) => [node.id, index]));
  for (const list of children.values()) {
    list.sort((a, b) => (inputOrder.get(a) ?? 0) - (inputOrder.get(b) ?? 0));
  }

  const roots = nodes
    .filter((node) => !incoming.has(node.id))
    .sort((a, b) => a.depth - b.depth || (inputOrder.get(a.id) ?? 0) - (inputOrder.get(b.id) ?? 0));

  const positions = new Map<string, HierarchyPoint>();
  const visited = new Set<string>();
  let leafCursor = 0;

  const place = (id: string): number => {
    const node = byId.get(id);
    if (!node) return options.paddingX;
    if (visited.has(id)) return positions.get(id)?.x ?? options.paddingX;
    visited.add(id);

    const childIds = (children.get(id) ?? []).filter((childId) => !visited.has(childId));
    let x: number;
    if (!childIds.length) {
      x = options.paddingX + leafCursor * options.nodeGap;
      leafCursor += 1;
    } else {
      const childXs = childIds.map(place);
      x = average(childXs);
    }

    positions.set(id, {
      x,
      y: options.paddingY + node.depth * options.rowGap,
    });
    return x;
  };

  for (const root of roots) place(root.id);
  for (const node of nodes) {
    if (!visited.has(node.id)) place(node.id);
  }

  const maxDepth = nodes.reduce((value, node) => Math.max(value, node.depth), 0);
  const width = Math.max(640, options.paddingX * 2 + Math.max(1, leafCursor - 1) * options.nodeGap);
  const height = Math.max(180, options.paddingY * 2 + maxDepth * options.rowGap + 56);

  return { width, height, positions };
}

function brickLayout(
  nodes: ConceptNode[],
  edges: ConceptEdge[],
  options: Required<LayoutOptions>,
): HierarchyLayout {
  const graphEdges = visibleEdges(nodes, edges);
  const inputOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const grouped = new Map<number, ConceptNode[]>();
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();

  for (const node of nodes) {
    const row = grouped.get(node.depth) ?? [];
    row.push(node);
    grouped.set(node.depth, row);
  }

  for (const edge of graphEdges) {
    const parentList = parents.get(edge.target) ?? [];
    if (!parentList.includes(edge.source)) parentList.push(edge.source);
    parents.set(edge.target, parentList);
    const childList = children.get(edge.source) ?? [];
    if (!childList.includes(edge.target)) childList.push(edge.target);
    children.set(edge.source, childList);
  }

  const depths = [...grouped.keys()].sort((a, b) => a - b);
  const maxDepth = depths.at(-1) ?? 0;
  const maxRow = Math.max(1, ...[...grouped.values()].map((row) => row.length));
  const width = Math.max(640, options.paddingX * 2 + (maxRow - 1) * options.nodeGap);
  const positions = new Map<string, HierarchyPoint>();

  const baseRow = grouped.get(depths[0] ?? 0) ?? [];
  baseRow
    .sort((a, b) => (inputOrder.get(a.id) ?? 0) - (inputOrder.get(b.id) ?? 0))
    .forEach((node, index) => {
      const x = baseRow.length === 1
        ? width / 2
        : options.paddingX + index * ((width - options.paddingX * 2) / Math.max(1, baseRow.length - 1));
      positions.set(node.id, { x, y: 0 });
    });

  for (const depth of depths.slice(1)) {
    const row = [...(grouped.get(depth) ?? [])];
    row.sort((a, b) => {
      const aParents = (parents.get(a.id) ?? []).map((id) => positions.get(id)?.x).filter((value): value is number => value !== undefined);
      const bParents = (parents.get(b.id) ?? []).map((id) => positions.get(id)?.x).filter((value): value is number => value !== undefined);
      const aAnchor = aParents.length ? average(aParents) : (inputOrder.get(a.id) ?? 0) * options.nodeGap;
      const bAnchor = bParents.length ? average(bParents) : (inputOrder.get(b.id) ?? 0) * options.nodeGap;
      return aAnchor - bAnchor;
    });

    const anchors = row.map((node) => {
      const parentXs = (parents.get(node.id) ?? [])
        .map((id) => positions.get(id)?.x)
        .filter((value): value is number => value !== undefined);
      return parentXs.length ? average(parentXs) : width / 2;
    });

    const placed: number[] = [];
    for (let index = 0; index < row.length; index += 1) {
      const minX = index === 0 ? options.paddingX : placed[index - 1] + options.nodeGap;
      placed.push(Math.max(minX, anchors[index]));
    }

    const overflow = placed.length ? placed[placed.length - 1] - (width - options.paddingX) : 0;
    if (overflow > 0) {
      for (let index = 0; index < placed.length; index += 1) placed[index] -= overflow;
    }

    row.forEach((node, index) => positions.set(node.id, { x: placed[index], y: 0 }));
  }

  // One reverse barycentric pass keeps foundations visually under the branches they actually support.
  for (const depth of [...depths].reverse().slice(1)) {
    const row = grouped.get(depth) ?? [];
    for (const node of row) {
      const childXs = (children.get(node.id) ?? [])
        .map((id) => positions.get(id)?.x)
        .filter((value): value is number => value !== undefined);
      const point = positions.get(node.id);
      if (point && childXs.length) point.x = (point.x + average(childXs)) / 2;
    }
  }

  for (const node of nodes) {
    const point = positions.get(node.id) ?? { x: width / 2, y: 0 };
    point.y = options.destinationOffset + options.paddingY + (maxDepth - node.depth) * options.rowGap;
    positions.set(node.id, point);
  }

  const height = Math.max(
    180,
    options.destinationOffset + options.paddingY * 2 + Math.max(0, maxDepth - (depths[0] ?? 0)) * options.rowGap + 56,
  );

  return { width, height, positions };
}

export function buildHierarchyLayout(
  mode: LayoutMode,
  nodes: ConceptNode[],
  edges: ConceptEdge[],
  options: LayoutOptions = {},
): HierarchyLayout {
  const resolved: Required<LayoutOptions> = {
    nodeGap: options.nodeGap ?? 138,
    rowGap: options.rowGap ?? 96,
    paddingX: options.paddingX ?? 78,
    paddingY: options.paddingY ?? 46,
    destinationOffset: options.destinationOffset ?? 0,
  };

  if (!nodes.length) return { width: 640, height: 180, positions: new Map() };
  return mode === "tree"
    ? treeLayout(nodes, edges, resolved)
    : brickLayout(nodes, edges, resolved);
}
