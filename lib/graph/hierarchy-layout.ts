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
    .sort(
      (a, b) =>
        a.depth - b.depth ||
        (inputOrder.get(a.id) ?? 0) - (inputOrder.get(b.id) ?? 0),
    );

  const positions = new Map<string, HierarchyPoint>();
  const visited = new Set<string>();
  let leafCursor = 0;

  const place = (id: string): number => {
    const node = byId.get(id);
    if (!node) return options.paddingX;
    if (visited.has(id)) return positions.get(id)?.x ?? options.paddingX;

    visited.add(id);

    const childIds = (children.get(id) ?? []).filter(
      (childId) => !visited.has(childId),
    );

    let x: number;

    if (!childIds.length) {
      x = options.paddingX + leafCursor * options.nodeGap;
      leafCursor += 1;
    } else {
      x = average(childIds.map(place));
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

  const maxDepth = nodes.reduce(
    (value, node) => Math.max(value, node.depth),
    0,
  );

  const width = Math.max(
    640,
    options.paddingX * 2 + Math.max(1, leafCursor - 1) * options.nodeGap,
  );

  const height = Math.max(
    180,
    options.paddingY * 2 + maxDepth * options.rowGap + 56,
  );

  return { width, height, positions };
}

/**
 * Brick is deliberately laid out as a wall, not as a branching tree.
 *
 * Higher rows are centered above lower rows and use stable input order. The
 * orchestrator creates only local one/two-brick support edges between adjacent
 * rows, so the visual result stays readable as a stack:
 *
 *        +2   [ ][ ][ ][ ][ ]
 *              |\/|\/|\/|
 *        +1     [ ][ ][ ][ ]
 *                |\/|\/|
 *         0       [ ][ ][ ]
 *
 * The canvas is bottom-origin: Height 0 is physically the lowest row and each
 * positive height moves upward. Row spacing and horizontal node spacing are
 * independent, which prevents nodes from overlapping even as the wall widens.
 */
function brickLayout(
  nodes: ConceptNode[],
  _edges: ConceptEdge[],
  options: Required<LayoutOptions>,
): HierarchyLayout {
  const grouped = new Map<number, ConceptNode[]>();
  const inputOrder = new Map(nodes.map((node, index) => [node.id, index]));

  for (const node of nodes) {
    const row = grouped.get(node.depth) ?? [];
    row.push(node);
    grouped.set(node.depth, row);
  }

  const depths = [...grouped.keys()].sort((a, b) => a - b);
  const minDepth = depths[0] ?? 0;
  const maxDepth = depths.at(-1) ?? minDepth;
  const layerCount = Math.max(0, maxDepth - minDepth);

  for (const row of grouped.values()) {
    row.sort(
      (a, b) =>
        (inputOrder.get(a.id) ?? 0) -
        (inputOrder.get(b.id) ?? 0),
    );
  }

  const widestRowCount = Math.max(
    1,
    ...[...grouped.values()].map((row) => row.length),
  );

  const width = Math.max(
    640,
    options.paddingX * 2 + Math.max(0, widestRowCount - 1) * options.nodeGap,
  );

  const topInset = options.destinationOffset + options.paddingY;
  const bottomInset = options.paddingY + 72;
  const height = Math.max(
    220,
    topInset + layerCount * options.rowGap + bottomInset,
  );
  const foundationY = height - bottomInset;

  const positions = new Map<string, HierarchyPoint>();

  for (const depth of depths) {
    const row = grouped.get(depth) ?? [];
    const rowWidth = Math.max(0, row.length - 1) * options.nodeGap;
    const startX = (width - rowWidth) / 2;
    const y = foundationY - (depth - minDepth) * options.rowGap;

    row.forEach((node, index) => {
      positions.set(node.id, {
        x: startX + index * options.nodeGap,
        y,
      });
    });
  }

  return { width, height, positions };
}

export function buildHierarchyLayout(
  mode: LayoutMode,
  nodes: ConceptNode[],
  edges: ConceptEdge[],
  options: LayoutOptions = {},
): HierarchyLayout {
  const resolved: Required<LayoutOptions> = {
    nodeGap: options.nodeGap ?? 160,
    rowGap: options.rowGap ?? 104,
    paddingX: options.paddingX ?? 82,
    paddingY: options.paddingY ?? 48,
    destinationOffset: options.destinationOffset ?? 0,
  };

  if (!nodes.length) {
    return {
      width: 640,
      height: 180,
      positions: new Map(),
    };
  }

  return mode === "tree"
    ? treeLayout(nodes, edges, resolved)
    : brickLayout(nodes, edges, resolved);
}
