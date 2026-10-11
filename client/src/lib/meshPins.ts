import {
  MESH_BOX_HEIGHT,
  MESH_FOCUS_BOX_HEIGHT,
  MESH_FOCUS_GLYPH,
  MESH_GLYPH,
  MESH_NODE_WIDTH,
  meshEdgeHandles,
  meshOrthogonalPath,
  type MeshLayout,
  type MeshLayoutEdge,
  type MeshLayoutNode,
} from "./meshLayout.ts";

export type MeshPin = { x: number; y: number };

const SEPARATE_GAP = 8;
const MAX_NUDGE = 48;

function boxHeight(node: MeshLayoutNode): number {
  return node.role === "focus" ? MESH_FOCUS_BOX_HEIGHT : MESH_BOX_HEIGHT;
}

function withTopLeft(node: MeshLayoutNode, x: number, y: number): MeshLayoutNode {
  const glyph = node.role === "focus" ? MESH_FOCUS_GLYPH : MESH_GLYPH;
  const height = boxHeight(node);
  return { ...node, x, y, centerX: x + glyph / 2, centerY: y + height / 2 };
}

function intersects(a: MeshLayoutNode, b: MeshLayoutNode): boolean {
  return !(
    a.x + MESH_NODE_WIDTH + SEPARATE_GAP <= b.x ||
    b.x + MESH_NODE_WIDTH + SEPARATE_GAP <= a.x ||
    a.y + boxHeight(a) + SEPARATE_GAP <= b.y ||
    b.y + boxHeight(b) + SEPARATE_GAP <= a.y
  );
}

/** Push down or right, whichever clears `hit` in the shorter move. */
function shove(node: MeshLayoutNode, hit: MeshLayoutNode): { dx: number; dy: number } {
  const down = hit.y + boxHeight(hit) + SEPARATE_GAP - node.y;
  const right = hit.x + MESH_NODE_WIDTH + SEPARATE_GAP - node.x;
  if (down > 0 && (right <= 0 || down <= right)) return { dx: 0, dy: down };
  if (right > 0) return { dx: right, dy: 0 };
  return { dx: 0, dy: SEPARATE_GAP };
}

function nudgeUnpinned(nodes: MeshLayoutNode[], pinned: ReadonlySet<string>): void {
  const settled = nodes.filter((node) => pinned.has(node.key));
  const free = nodes
    .filter((node) => !pinned.has(node.key))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const node of free) {
    for (let step = 0; step < MAX_NUDGE; step += 1) {
      const hit = settled.find((other) => intersects(node, other));
      if (!hit) break;
      const move = shove(node, hit);
      const next = withTopLeft(node, node.x + move.dx, node.y + move.dy);
      node.x = next.x;
      node.y = next.y;
      node.centerX = next.centerX;
      node.centerY = next.centerY;
    }
    settled.push(node);
  }
}

function simpleEnds(d: string): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  const match = d.match(
    /^M\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:V\s*(-?\d+(?:\.\d+)?)|H\s*(-?\d+(?:\.\d+)?))\s*$/,
  );
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (match[3] != null) return { start: { x, y }, end: { x, y: Number(match[3]) } };
  return { start: { x, y }, end: { x: Number(match[4]), y } };
}

function retargetPath(d: string, from: MeshLayoutNode | null, to: MeshLayoutNode | null): string {
  const ends = simpleEnds(d);
  const start = from ? { x: from.centerX, y: from.centerY } : ends?.start;
  const end = to ? { x: to.centerX, y: to.centerY } : ends?.end;
  if (!start || !end) return d;
  if (from && to) {
    return meshOrthogonalPath(start.x, start.y, end.x, end.y, (start.x + end.x) / 2);
  }
  if (Math.abs(start.x - end.x) < 0.5) return `M${start.x},${start.y} V${end.y}`;
  if (Math.abs(start.y - end.y) < 0.5) return `M${start.x},${start.y} H${end.x}`;
  return meshOrthogonalPath(start.x, start.y, end.x, end.y, (start.x + end.x) / 2);
}

function retargetEdges(
  edges: readonly MeshLayoutEdge[],
  byKey: ReadonlyMap<string, MeshLayoutNode>,
  moved: ReadonlySet<string>,
): MeshLayoutEdge[] {
  return edges.map((edge) => {
    if (!moved.has(edge.source) && !moved.has(edge.target)) return edge;
    const from = byKey.get(edge.source);
    const to = byKey.get(edge.target);
    if (!from || !to) return edge;
    return {
      ...edge,
      ...meshEdgeHandles(from.centerX, to.centerX),
      laneX: (from.centerX + to.centerX) / 2,
      corridor: null,
      trunkPath: null,
      trunkCount: null,
      bundled: false,
      sourceOffset: 0,
      targetOffset: 0,
    };
  });
}

/** Keep saved pins, then shift unpinned nodes so they do not cover a pin. */
export function applyMeshPins(
  layout: MeshLayout,
  pins: Readonly<Record<string, MeshPin>>,
): MeshLayout {
  const pinned = new Set<string>();
  for (const [key, pin] of Object.entries(pins)) {
    if (!layout.nodes.some((node) => node.key === key)) continue;
    if (!Number.isFinite(pin.x) || !Number.isFinite(pin.y)) continue;
    pinned.add(key);
  }
  if (pinned.size === 0) return layout;

  const before = new Map(layout.nodes.map((node) => [node.key, { x: node.centerX, y: node.centerY }]));
  const nodes = layout.nodes.map((node) => {
    const pin = pinned.has(node.key) ? pins[node.key] : undefined;
    return pin ? withTopLeft(node, pin.x, pin.y) : { ...node };
  });
  nudgeUnpinned(nodes, pinned);

  const moved = new Set<string>();
  for (const node of nodes) {
    const was = before.get(node.key);
    if (!was) continue;
    if (Math.abs(was.x - node.centerX) > 0.5 || Math.abs(was.y - node.centerY) > 0.5) moved.add(node.key);
  }

  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const ties = new Map(layout.treeTies.map((tie) => [tie.pathIndex, tie]));
  const tree = layout.tree.map((d, index) => {
    const tie = ties.get(index);
    if (!tie) return d;
    const fromMoved = tie.fromKey != null && moved.has(tie.fromKey);
    const toMoved = tie.toKey != null && moved.has(tie.toKey);
    if (!fromMoved && !toMoved) return d;
    const fromNode = tie.fromKey ? (byKey.get(tie.fromKey) ?? null) : null;
    const toNode = tie.toKey ? (byKey.get(tie.toKey) ?? null) : null;
    if (fromNode && toNode) {
      return meshOrthogonalPath(
        fromNode.centerX,
        fromNode.centerY,
        toNode.centerX,
        toNode.centerY,
        (fromNode.centerX + toNode.centerX) / 2,
      );
    }
    return retargetPath(d, fromMoved ? fromNode : null, toMoved ? toNode : null);
  });

  return { ...layout, nodes, edges: retargetEdges(layout.edges, byKey, moved), tree };
}

/** Drop pins for records that are no longer in this graph. */
export function meshPinsInGraph(
  pins: Readonly<Record<string, MeshPin>>,
  graphKeys: ReadonlySet<string>,
): Record<string, MeshPin> {
  const next: Record<string, MeshPin> = {};
  for (const [key, pin] of Object.entries(pins)) {
    if (graphKeys.has(key)) next[key] = pin;
  }
  return next;
}
