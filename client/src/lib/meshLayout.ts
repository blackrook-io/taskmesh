/** Deterministic cascade positions for the Mesh tab. No force simulation. */

/** Matches the cascade in docs/design/mesh-view.html (centers, then a bus). */
export const MESH_COLUMN_PITCH = 240;
export const MESH_ROW_PITCH = 58;
export const MESH_STUB = 30;
export const MESH_ORIGIN_X = 60;
export const MESH_GLYPH = 22;
export const MESH_FOCUS_GLYPH = 28;
export const MESH_BOX_HEIGHT = 46;
export const MESH_FOCUS_BOX_HEIGHT = 54;
/** Glyph plus the two-line label, used to prove placed nodes do not overlap. */
export const MESH_NODE_WIDTH = 200;
export const MESH_NODE_HEIGHT = MESH_BOX_HEIGHT;

const LINK_RELATIONS = new Set(["relates_to", "references", "supports", "part_of"]);

export type MeshGraphNode = {
  key: string;
  type: string;
  id: number;
  referenceId: string | null;
  title: string;
  projectId: number | null;
  state?: string | null;
  progress?: number | null;
  priority?: string | null;
  dueDate?: string | null;
  createdAt?: string | null;
  signalAt?: string | null;
  lastUpdate?: {
    at: string;
    field: string;
    oldValue: string | null;
    newValue: string | null;
  } | null;
  lastComment?: {
    at: string;
    excerpt: string;
    withUpdate: boolean;
  } | null;
};

export type MeshGraphEdge = {
  source: string;
  target: string;
  relation: string;
};

export type MeshRole = "focus" | "parent" | "link" | "child" | "grandchild" | "rail" | "suggestion";

export type MeshLayoutNode = {
  key: string;
  /** Top-left of the node box. The glyph center is `centerX` / `centerY`. */
  x: number;
  y: number;
  centerX: number;
  centerY: number;
  role: MeshRole;
  /** Band or rail for a suggestion glyph. Null for every other role. */
  lane: "band" | "rail" | null;
  title: string;
  referenceId: string | null;
  type: string;
  /** Other project's display number, such as `P0009`, when this app already has it. */
  projectLabel: string | null;
};

export type MeshHeading = {
  x: number;
  y: number;
  text: string;
  tone: "ai" | null;
};

export type MeshSourceHandle = "b" | "r" | "l-out";
export type MeshTargetHandle = "t" | "l" | "r-in";

export type MeshLayoutEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: MeshSourceHandle;
  targetHandle: MeshTargetHandle;
  kind: "link" | "depends" | "suggested";
  blocking: boolean;
  /** Pixels along the source side, centered on the handle. */
  sourceOffset: number;
  /** Pixels along the target side, centered on the handle. */
  targetOffset: number;
  /** Flow x of the vertical run. Direct lines only. */
  laneX: number;
  /** Drop, floor, and rise for a line that runs under the columns. */
  corridor: MeshCorridor | null;
  /** Hidden until the channel record is hovered. */
  bundled: boolean;
  /** Set on the one visible line that stands in for a bundle. */
  trunkCount: number | null;
  /** Absolute points for a trunk. Members use `corridor` instead. */
  trunkPath: { x: number; y: number }[] | null;
};

export type MeshCorridor = {
  dropX: number;
  corridorY: number;
  arrivalX: number;
  approachY: number;
};

export const MESH_CORRIDOR_PAD = 16;
export const MESH_TRUNK_AT = 4;

/** Right, left, or a same-column bracket on the right. Half a column is the same column. */
export function meshEdgeHandles(
  sourceCenterX: number,
  targetCenterX: number,
): { sourceHandle: MeshSourceHandle; targetHandle: MeshTargetHandle } {
  const dx = targetCenterX - sourceCenterX;
  if (Math.abs(dx) < MESH_COLUMN_PITCH / 2) return { sourceHandle: "r", targetHandle: "r-in" };
  if (dx > 0) return { sourceHandle: "r", targetHandle: "l" };
  return { sourceHandle: "l-out", targetHandle: "r-in" };
}

export const MESH_PORT_GAP = 8;
export const MESH_LANE_GAP = 10;
export const MESH_LANE_INSET = 4;
export const MESH_LINE_STEP = 20;

/** Centered on the side, one slot per line, ordered by the other end's y. */
export function meshPortOffsets(otherYs: readonly number[]): number[] {
  const order = otherYs.map((y, index) => ({ y, index }));
  order.sort((a, b) => a.y - b.y || a.index - b.index);
  const offsets = new Array<number>(otherYs.length);
  order.forEach((item, rank) => {
    offsets[item.index] = (rank - (order.length - 1) / 2) * MESH_PORT_GAP;
  });
  return offsets;
}

/** Extra pixels a gutter needs so its lines are not forced onto one x. */
export function meshGutterExtra(count: number, gap: number): number {
  if (count <= 0) return 0;
  const fit = Math.max(1, Math.floor(Math.max(0, gap - MESH_LANE_INSET * 2) / MESH_LANE_GAP));
  let extra = Math.max(0, count - fit) * MESH_LANE_GAP;
  const room =
    MESH_LANE_INSET +
    (count === 1 ? MESH_LINE_STEP : MESH_LANE_INSET + (count - 1) * MESH_LANE_GAP);
  if (gap + extra < room) extra = room - gap;
  return extra;
}

/** Lane x values in a gutter. One line steps 20px out; several sit 10px apart. */
export function meshLaneXs(count: number, gutterLeft: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [gutterLeft + MESH_LINE_STEP];
  return Array.from({ length: count }, (_, index) => gutterLeft + MESH_LANE_INSET + index * MESH_LANE_GAP);
}

/** Rounded orthogonal step through `laneX`. */
export function meshOrthogonalPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  laneX: number,
  radius = 8,
): string {
  const fmt = (n: number) => n.toFixed(1);
  const vert = Math.abs(ty - sy);
  const h1 = Math.abs(laneX - sx);
  const h2 = Math.abs(tx - laneX);
  const r = Math.min(radius, h1 / 2, h2 / 2, vert / 2);
  if (r < 0.5 || vert < 1) {
    return `M${fmt(sx)},${fmt(sy)} L${fmt(laneX)},${fmt(sy)} L${fmt(laneX)},${fmt(ty)} L${fmt(tx)},${fmt(ty)}`;
  }
  const sxSign = Math.sign(laneX - sx) || 1;
  const exSign = Math.sign(tx - laneX) || 1;
  const ySign = Math.sign(ty - sy) || 1;
  const sweep1 = sxSign * ySign > 0 ? 1 : 0;
  const sweep2 = ySign * exSign > 0 ? 0 : 1;
  return [
    `M${fmt(sx)},${fmt(sy)}`,
    `L${fmt(laneX - sxSign * r)},${fmt(sy)}`,
    `A${fmt(r)},${fmt(r)} 0 0 ${sweep1} ${fmt(laneX)},${fmt(sy + ySign * r)}`,
    `L${fmt(laneX)},${fmt(ty - ySign * r)}`,
    `A${fmt(r)},${fmt(r)} 0 0 ${sweep2} ${fmt(laneX + exSign * r)},${fmt(ty)}`,
    `L${fmt(tx)},${fmt(ty)}`,
  ].join(" ");
}

/** Rounded orthogonal polyline. Zero-length segments are dropped. */
export function meshRoundedPolyline(points: readonly { x: number; y: number }[], radius = 8): string {
  const fmt = (n: number) => n.toFixed(1);
  const unique = points.filter((point, index) => {
    const prev = points[index - 1];
    return index === 0 || !prev || point.x !== prev.x || point.y !== prev.y;
  });
  if (unique.length === 0) return "";
  if (unique.length === 1) return `M${fmt(unique[0]!.x)},${fmt(unique[0]!.y)}`;
  const parts = [`M${fmt(unique[0]!.x)},${fmt(unique[0]!.y)}`];
  for (let index = 1; index < unique.length - 1; index += 1) {
    const prev = unique[index - 1]!;
    const curr = unique[index]!;
    const next = unique[index + 1]!;
    const inDx = curr.x - prev.x;
    const inDy = curr.y - prev.y;
    const outDx = next.x - curr.x;
    const outDy = next.y - curr.y;
    const inLen = Math.hypot(inDx, inDy);
    const outLen = Math.hypot(outDx, outDy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5 || inLen === 0 || outLen === 0) {
      parts.push(`L${fmt(curr.x)},${fmt(curr.y)}`);
      continue;
    }
    const inUx = inDx / inLen;
    const inUy = inDy / inLen;
    const outUx = outDx / outLen;
    const outUy = outDy / outLen;
    const sweep = inUx * outUy - inUy * outUx > 0 ? 1 : 0;
    parts.push(`L${fmt(curr.x - inUx * r)},${fmt(curr.y - inUy * r)}`);
    parts.push(
      `A${fmt(r)},${fmt(r)} 0 0 ${sweep} ${fmt(curr.x + outUx * r)},${fmt(curr.y + outUy * r)}`,
    );
  }
  const last = unique[unique.length - 1]!;
  parts.push(`L${fmt(last.x)},${fmt(last.y)}`);
  return parts.join(" ");
}

export function meshCorridorPoints(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  corridor: MeshCorridor,
): { x: number; y: number }[] {
  return [
    { x: sx, y: sy },
    { x: corridor.dropX, y: sy },
    { x: corridor.dropX, y: corridor.corridorY },
    { x: corridor.arrivalX, y: corridor.corridorY },
    { x: corridor.arrivalX, y: corridor.approachY },
    { x: tx, y: corridor.approachY },
    { x: tx, y: ty },
  ];
}

/** A proposed link. The source is the suggested record; the target is already on the canvas. */
export type MeshSuggestion = {
  sourceKey: string;
  targetKey: string;
  confidence: number;
  reason: string;
};

export type MeshAncestor = {
  key: string;
  title: string;
  referenceId: string | null;
};

export type MeshLayout = {
  nodes: MeshLayoutNode[];
  edges: MeshLayoutEdge[];
  ancestors: MeshAncestor[];
  /** Containment bus, in glyph-center coordinates. */
  tree: string[];
  headings: MeshHeading[];
};

function compareNodes(a: MeshGraphNode, b: MeshGraphNode): number {
  const ref = (a.referenceId ?? "").localeCompare(b.referenceId ?? "");
  if (ref !== 0) return ref;
  const title = a.title.localeCompare(b.title);
  if (title !== 0) return title;
  return a.key.localeCompare(b.key);
}

function firstKey(keys: string[]): string | null {
  if (keys.length === 0) return null;
  return [...keys].sort()[0] ?? null;
}

/** Parent task or to-do, otherwise the list, otherwise the project. */
export function containmentParent(key: string, edges: readonly MeshGraphEdge[]): string | null {
  const childOf = edges
    .filter((edge) => edge.relation === "child_of" && edge.source === key)
    .map((edge) => edge.target);
  const fromChild = firstKey(childOf);
  if (fromChild) return fromChild;
  const inList = edges
    .filter((edge) => edge.relation === "in_list" && edge.target === key)
    .map((edge) => edge.source);
  const fromList = firstKey(inList);
  if (fromList) return fromList;
  const inProject = edges
    .filter((edge) => edge.relation === "in_project" && edge.target === key)
    .map((edge) => edge.source);
  return firstKey(inProject);
}

function projectLabel(
  node: MeshGraphNode,
  meshProjectId: number,
  projectRefs: ReadonlyMap<number, string>,
): string | null {
  if (node.type === "project") return null;
  if (node.projectId == null || node.projectId === meshProjectId) return null;
  return projectRefs.get(node.projectId) ?? null;
}

function placedNode(
  node: MeshGraphNode,
  centerX: number,
  centerY: number,
  role: MeshRole,
  meshProjectId: number,
  projectRefs: ReadonlyMap<number, string>,
): MeshLayoutNode {
  const glyph = role === "focus" ? MESH_FOCUS_GLYPH : MESH_GLYPH;
  const height = role === "focus" ? MESH_FOCUS_BOX_HEIGHT : MESH_BOX_HEIGHT;
  return {
    key: node.key,
    x: centerX - glyph / 2,
    y: centerY - height / 2,
    centerX,
    centerY,
    role,
    lane: null,
    title: node.title,
    referenceId: node.referenceId,
    type: node.type,
    projectLabel: projectLabel(node, meshProjectId, projectRefs),
  };
}

function columnCenters(
  column: { head: MeshGraphNode | null; members: MeshGraphNode[] },
  x: number,
): number[] {
  if (column.head) return [x, ...column.members.map(() => x + MESH_STUB)];
  return column.members.map(() => x + MESH_STUB);
}

function columnExtent(centers: readonly number[]): { left: number; right: number } {
  if (centers.length === 0) return { left: 0, right: 0 };
  const left = Math.min(...centers.map((center) => center - MESH_GLYPH / 2));
  const right = Math.max(...centers.map((center) => center - MESH_GLYPH / 2 + MESH_NODE_WIDTH));
  return { left, right };
}

function assignMeshPorts(
  edges: MeshLayoutEdge[],
  placedByKey: ReadonlyMap<string, MeshLayoutNode>,
): void {
  const groups = new Map<
    string,
    { edge: MeshLayoutEdge; end: "source" | "target"; otherY: number }[]
  >();
  for (const edge of edges) {
    const from = placedByKey.get(edge.source);
    const to = placedByKey.get(edge.target);
    if (!from || !to) continue;
    const sourceSide = edge.sourceHandle === "l-out" ? "left" : "right";
    const targetSide = edge.targetHandle === "l" ? "left" : "right";
    const sourceGroup = groups.get(`${edge.source}:${sourceSide}`) ?? [];
    sourceGroup.push({ edge, end: "source", otherY: to.centerY });
    groups.set(`${edge.source}:${sourceSide}`, sourceGroup);
    const targetGroup = groups.get(`${edge.target}:${targetSide}`) ?? [];
    targetGroup.push({ edge, end: "target", otherY: from.centerY });
    groups.set(`${edge.target}:${targetSide}`, targetGroup);
  }
  for (const group of groups.values()) {
    const offsets = meshPortOffsets(group.map((item) => item.otherY));
    group.forEach((item, index) => {
      const offset = offsets[index] ?? 0;
      if (item.end === "source") item.edge.sourceOffset = offset;
      else item.edge.targetOffset = offset;
    });
  }
}

function assignMeshLanes(
  edges: MeshLayoutEdge[],
  placedByKey: ReadonlyMap<string, MeshLayoutNode>,
  columnOf: ReadonlyMap<string, number>,
  gutterLeftOf: (index: number) => number,
  busX: ReadonlySet<number>,
): void {
  const cascade = new Map<number, MeshLayoutEdge[]>();
  const other = new Map<string, { left: number; edges: MeshLayoutEdge[] }>();
  for (const edge of edges) {
    const sourceColumn = columnOf.get(edge.source);
    const targetColumn = columnOf.get(edge.target);
    if (sourceColumn != null && targetColumn != null) {
      const gutter = Math.min(sourceColumn, targetColumn);
      const list = cascade.get(gutter) ?? [];
      list.push(edge);
      cascade.set(gutter, list);
      continue;
    }
    const from = placedByKey.get(edge.source);
    const to = placedByKey.get(edge.target);
    if (!from || !to) continue;
    const same = Math.abs(from.centerX - to.centerX) < MESH_COLUMN_PITCH / 2;
    const gutterLeft = same
      ? Math.max(from.x + MESH_NODE_WIDTH, to.x + MESH_NODE_WIDTH)
      : (from.centerX <= to.centerX ? from : to).x + MESH_NODE_WIDTH;
    const key = `${same ? "same" : "gap"}:${Math.round(gutterLeft)}`;
    const group = other.get(key) ?? { left: gutterLeft, edges: [] };
    group.edges.push(edge);
    other.set(key, group);
  }
  const used = new Set<number>();
  const place = (list: MeshLayoutEdge[], left: number) => {
    const sorted = [...list].sort((a, b) => {
      const span = (edge: MeshLayoutEdge) =>
        (placedByKey.get(edge.source)?.centerY ?? 0) + (placedByKey.get(edge.target)?.centerY ?? 0);
      return span(a) - span(b) || a.id.localeCompare(b.id);
    });
    const lanes = meshLaneXs(sorted.length, left);
    for (let index = 0; index < sorted.length; index += 1) {
      let lane = lanes[index] ?? left + MESH_LINE_STEP;
      while (busX.has(Math.round(lane)) || used.has(Math.round(lane))) lane += MESH_LANE_GAP;
      used.add(Math.round(lane));
      sorted[index]!.laneX = lane;
    }
  };
  for (const [gutter, list] of cascade) place(list, gutterLeftOf(gutter));
  for (const group of other.values()) place(group.edges, group.left);
}

type MeshBox = { key: string; left: number; right: number; top: number; bottom: number };

function meshNodeBox(node: MeshLayoutNode): MeshBox {
  const height = node.role === "focus" ? MESH_FOCUS_BOX_HEIGHT : MESH_BOX_HEIGHT;
  return {
    key: node.key,
    left: node.x,
    right: node.x + MESH_NODE_WIDTH,
    top: node.y,
    bottom: node.y + height,
  };
}

function clearRiseX(
  start: number,
  dir: number,
  y0: number,
  y1: number,
  boxes: readonly MeshBox[],
  ignore: ReadonlySet<string>,
  used: ReadonlySet<number>,
): number {
  for (let step = 0; step <= 80; step += 1) {
    const x = start + dir * step * MESH_LANE_GAP;
    if (used.has(Math.round(x))) continue;
    if (!verticalHits(x, y0, y1, boxes, ignore)) return x;
  }
  return start;
}

function verticalHits(x: number, y0: number, y1: number, boxes: readonly MeshBox[], ignore: ReadonlySet<string>): boolean {
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  return boxes.some(
    (box) =>
      !ignore.has(box.key) &&
      x > box.left + 0.5 &&
      x < box.right - 0.5 &&
      box.bottom > top &&
      box.top < bottom,
  );
}

function channelKind(node: MeshLayoutNode): "rail" | "band" | null {
  if (node.role === "rail" || node.lane === "rail") return "rail";
  if (node.role === "link" || node.lane === "band") return "band";
  return null;
}

/** Rail and far band lines share a floor under the columns. Busy targets become one trunk. */
function assignMeshCorridors(
  edges: MeshLayoutEdge[],
  placed: readonly MeshLayoutNode[],
  placedByKey: ReadonlyMap<string, MeshLayoutNode>,
  columnOf: ReadonlyMap<string, number>,
  gutterLeftOf: (index: number) => number,
): void {
  const columnNodes = placed.filter((node) => node.role === "child" || node.role === "grandchild");
  if (columnNodes.length === 0) return;
  const boxes = placed.map(meshNodeBox);
  const floor = Math.max(...boxes.map((box) => box.bottom)) + MESH_CORRIDOR_PAD;
  const columnRight = Math.max(...columnNodes.map((node) => node.x + MESH_NODE_WIDTH));

  type Run = { edge: MeshLayoutEdge; anchor: MeshLayoutNode; channel: MeshLayoutNode };
  const runs: Run[] = [];
  for (const edge of edges) {
    const source = placedByKey.get(edge.source);
    const target = placedByKey.get(edge.target);
    if (!source || !target || edge.kind === "depends") continue;
    const sourceChannel = channelKind(source);
    const targetChannel = channelKind(target);
    const anchor = sourceChannel && !targetChannel ? target : targetChannel && !sourceChannel ? source : null;
    const channel = anchor === source ? target : anchor === target ? source : null;
    if (!anchor || !channel) continue;
    if (Math.abs(anchor.centerX - channel.centerX) < MESH_COLUMN_PITCH / 2) continue;
    runs.push({ edge, anchor, channel });
  }
  if (runs.length === 0) return;

  const byDrop = new Map<string, Run[]>();
  for (const run of runs) {
    const column = columnOf.get(run.anchor.key);
    const key = column == null ? "open" : String(column);
    const list = byDrop.get(key) ?? [];
    list.push(run);
    byDrop.set(key, list);
  }
  const corridorIds = new Set(runs.map((run) => run.edge.id));
  const usedX = new Set<number>(
    edges.filter((edge) => !corridorIds.has(edge.id)).map((edge) => Math.round(edge.laneX)),
  );
  for (const [key, list] of byDrop) {
    const sorted = [...list].sort(
      (a, b) => a.anchor.centerY - b.anchor.centerY || a.edge.id.localeCompare(b.edge.id),
    );
    const left = key === "open" ? columnRight : gutterLeftOf(Number(key));
    const lanes = meshLaneXs(sorted.length, left);
    sorted.forEach((run, index) => {
      let dropX = lanes[index] ?? left + MESH_LINE_STEP;
      const ignore = new Set([run.anchor.key]);
      for (let step = 0; step < 40; step += 1) {
        const blocked =
          usedX.has(Math.round(dropX)) ||
          verticalHits(dropX, run.anchor.centerY, floor, boxes, ignore);
        if (!blocked) break;
        dropX += MESH_LANE_GAP;
      }
      usedX.add(Math.round(dropX));
      run.edge.laneX = dropX;
    });
  }

  const ordered = [...runs].sort(
    (a, b) => a.anchor.centerX - b.anchor.centerX || a.anchor.centerY - b.anchor.centerY || a.edge.id.localeCompare(b.edge.id),
  );
  ordered.forEach((run, index) => {
    const corridorY = floor + index * MESH_LANE_GAP;
    const approachY =
      channelKind(run.channel) === "band"
        ? run.channel.y + MESH_BOX_HEIGHT + 8
        : run.channel.centerY;
    let arrivalX = run.channel.x - MESH_LINE_STEP;
    const ignore = new Set([run.channel.key]);
    if (verticalHits(arrivalX, corridorY, approachY, boxes, ignore)) {
      let found = arrivalX;
      for (let step = 1; step <= 80; step += 1) {
        const right = run.channel.x - MESH_LINE_STEP + step * MESH_LANE_GAP;
        const left = run.channel.x - MESH_LINE_STEP - step * MESH_LANE_GAP;
        if (!verticalHits(right, corridorY, approachY, boxes, ignore)) {
          found = right;
          break;
        }
        if (!verticalHits(left, corridorY, approachY, boxes, ignore)) {
          found = left;
          break;
        }
      }
      arrivalX = found;
    }
    run.edge.corridor = { dropX: run.edge.laneX, corridorY, arrivalX, approachY };
  });

  const byChannel = new Map<string, Run[]>();
  for (const run of runs) {
    const list = byChannel.get(run.channel.key) ?? [];
    list.push(run);
    byChannel.set(run.channel.key, list);
  }
  for (const list of byChannel.values()) {
    if (list.length < 2) continue;
    const channel = list[0]!.channel;
    const fromLeft =
      list.filter((run) => run.anchor.centerX < channel.centerX).length >= list.length / 2;
    const dir = fromLeft ? -1 : 1;
    const start = fromLeft
      ? channel.x - MESH_LINE_STEP
      : channel.x + MESH_NODE_WIDTH + MESH_LINE_STEP;
    const ignore = new Set([channel.key]);
    const used = new Set<number>();
    const sorted = [...list].sort((a, b) => a.anchor.centerX - b.anchor.centerX);
    for (const run of sorted) {
      const corridor = run.edge.corridor;
      if (!corridor) continue;
      const x = clearRiseX(start, dir, corridor.corridorY, corridor.approachY, boxes, ignore, used);
      used.add(Math.round(x));
      corridor.arrivalX = x;
    }
  }
  for (const [key, list] of byChannel) {
    if (list.length < MESH_TRUNK_AT) continue;
    for (const run of list) run.edge.bundled = true;
    const channel = list[0]!.channel;
    const lead = [...list].sort((a, b) => a.anchor.centerX - b.anchor.centerX)[0]!;
    const approachY = lead.edge.corridor?.approachY ?? channel.centerY;
    const corridorY = Math.min(...list.map((run) => run.edge.corridor?.corridorY ?? floor));
    const arrivalX = lead.edge.corridor?.arrivalX ?? channel.x - MESH_LINE_STEP;
    const dropX = Math.min(...list.map((run) => run.edge.laneX));
    const handles = meshEdgeHandles(dropX, channel.centerX);
    edges.push({
      id: `trunk:${key}`,
      source: lead.anchor.key,
      target: channel.key,
      ...handles,
      kind: lead.edge.kind,
      blocking: false,
      sourceOffset: 0,
      targetOffset: 0,
      laneX: dropX,
      corridor: null,
      bundled: false,
      trunkCount: list.length,
      trunkPath: [
        { x: dropX, y: corridorY },
        { x: arrivalX, y: corridorY },
        { x: arrivalX, y: approachY },
        { x: channel.x, y: approachY },
        { x: channel.x, y: channel.centerY },
      ],
    });
  }
}

function readingRank(node: MeshLayoutNode): number {
  if (node.role === "suggestion") return node.lane === "rail" ? 6 : 1;
  switch (node.role) {
    case "parent":
      return 0;
    case "link":
      return 1;
    case "focus":
      return 2;
    case "child":
      return 3;
    case "grandchild":
      return 4;
    case "rail":
      return 5;
  }
}

export function layoutMesh(input: {
  nodes: readonly MeshGraphNode[];
  edges: readonly MeshGraphEdge[];
  focusKey: string;
  meshProjectId: number;
  projectRefs?: ReadonlyMap<number, string>;
  /** Entity-link lines and records that exist only because of them. Default on. */
  references?: boolean;
  /** Depends-on lines. Default on. */
  dependsOn?: boolean;
  /** Proposed links. Empty until a caller such as T0168 supplies them. */
  suggestions?: readonly MeshSuggestion[];
}): MeshLayout {
  const refs = input.projectRefs ?? new Map<number, string>();
  const referencesOn = input.references !== false;
  const dependsOn = input.dependsOn !== false;
  const suggestions = input.suggestions ?? [];
  const byKey = new Map(input.nodes.map((node) => [node.key, node]));
  const focus = byKey.get(input.focusKey);
  if (!focus) return { nodes: [], edges: [], ancestors: [], tree: [], headings: [] };

  const childrenOf = new Map<string, MeshGraphNode[]>();
  for (const node of input.nodes) {
    const parent = containmentParent(node.key, input.edges);
    if (!parent || parent === node.key) continue;
    const list = childrenOf.get(parent) ?? [];
    list.push(node);
    childrenOf.set(parent, list);
  }
  for (const list of childrenOf.values()) list.sort(compareNodes);

  const parentKey = containmentParent(focus.key, input.edges);
  const parent = parentKey ? byKey.get(parentKey) : undefined;
  const level1 = childrenOf.get(focus.key) ?? [];
  const level2 = new Map<string, MeshGraphNode[]>();
  for (const child of level1) {
    level2.set(child.key, childrenOf.get(child.key) ?? []);
  }

  const cascadeKeys = new Set<string>([focus.key]);
  if (parent) cascadeKeys.add(parent.key);
  for (const child of level1) {
    cascadeKeys.add(child.key);
    for (const grand of level2.get(child.key) ?? []) cascadeKeys.add(grand.key);
  }

  const linkSeen = new Set<string>();
  const linkNodes: MeshGraphNode[] = [];
  const railSeen = new Set<string>();
  const railNodes: MeshGraphNode[] = [];
  const cascadeOnly = new Set<string>(cascadeKeys);
  if (parent) cascadeOnly.delete(parent.key);
  cascadeOnly.delete(focus.key);

  for (const edge of input.edges) {
    if (!referencesOn || !LINK_RELATIONS.has(edge.relation)) continue;
    const touchFocus = edge.source === focus.key || edge.target === focus.key;
    const otherKey = edge.source === focus.key ? edge.target : edge.target === focus.key ? edge.source : null;
    if (touchFocus && otherKey && !cascadeKeys.has(otherKey) && !linkSeen.has(otherKey)) {
      const other = byKey.get(otherKey);
      if (other) {
        linkSeen.add(otherKey);
        linkNodes.push(other);
      }
    }
    const cascadeEnd = cascadeOnly.has(edge.source)
      ? edge.target
      : cascadeOnly.has(edge.target)
        ? edge.source
        : null;
    if (cascadeEnd && !cascadeKeys.has(cascadeEnd) && !linkSeen.has(cascadeEnd) && !railSeen.has(cascadeEnd)) {
      const other = byKey.get(cascadeEnd);
      if (other) {
        railSeen.add(cascadeEnd);
        railNodes.push(other);
      }
    }
  }
  linkNodes.sort(compareNodes);
  railNodes.sort(compareNodes);

  const structural = new Set<string>(cascadeKeys);
  for (const node of linkNodes) structural.add(node.key);
  for (const node of railNodes) structural.add(node.key);
  const bySource = new Map<string, MeshSuggestion[]>();
  for (const suggestion of suggestions) {
    const group = bySource.get(suggestion.sourceKey) ?? [];
    group.push(suggestion);
    bySource.set(suggestion.sourceKey, group);
  }
  const bandSuggestions: MeshGraphNode[] = [];
  const railSuggestions: MeshGraphNode[] = [];
  for (const [sourceKey, group] of bySource) {
    if (structural.has(sourceKey)) continue;
    const source = byKey.get(sourceKey);
    if (!source) continue;
    const live = group.filter((item) => structural.has(item.targetKey));
    if (live.some((item) => item.targetKey === focus.key)) bandSuggestions.push(source);
    else if (live.some((item) => cascadeOnly.has(item.targetKey))) railSuggestions.push(source);
  }
  bandSuggestions.sort(compareNodes);
  railSuggestions.sort(compareNodes);

  const branching = level1.filter((child) => (level2.get(child.key) ?? []).length > 0);
  const leaves = level1.filter((child) => (level2.get(child.key) ?? []).length === 0);
  const columns: { head: MeshGraphNode | null; members: MeshGraphNode[] }[] = branching.map((head) => ({
    head,
    members: level2.get(head.key) ?? [],
  }));
  if (leaves.length > 0) columns.push({ head: null, members: leaves });

  const columnOf = new Map<string, number>();
  columns.forEach((column, index) => {
    if (column.head) columnOf.set(column.head.key, index);
    for (const member of column.members) columnOf.set(member.key, index);
  });
  const gutterCount = new Array<number>(columns.length).fill(0);
  const channelKeys = new Set<string>([
    ...linkNodes.map((node) => node.key),
    ...railNodes.map((node) => node.key),
    ...bandSuggestions.map((node) => node.key),
    ...railSuggestions.map((node) => node.key),
  ]);
  const addGutter = (source: string, target: string) => {
    const sourceColumn = columnOf.get(source);
    const targetColumn = columnOf.get(target);
    if (sourceColumn != null && targetColumn != null) {
      const gutter = Math.min(sourceColumn, targetColumn);
      gutterCount[gutter] = (gutterCount[gutter] ?? 0) + 1;
      return;
    }
    if (sourceColumn != null && channelKeys.has(target)) {
      gutterCount[sourceColumn] = (gutterCount[sourceColumn] ?? 0) + 1;
    }
    if (targetColumn != null && channelKeys.has(source)) {
      gutterCount[targetColumn] = (gutterCount[targetColumn] ?? 0) + 1;
    }
  };
  for (const edge of input.edges) {
    if (referencesOn && LINK_RELATIONS.has(edge.relation)) {
      addGutter(edge.source, edge.target);
      continue;
    }
    if (dependsOn && edge.relation === "depends_on") addGutter(edge.source, edge.target);
  }
  const countedSuggestions = new Set<string>();
  for (const suggestion of suggestions) {
    const id = `s:${suggestion.sourceKey}:${suggestion.targetKey}`;
    if (countedSuggestions.has(id)) continue;
    countedSuggestions.add(id);
    addGutter(suggestion.sourceKey, suggestion.targetKey);
  }
  const baseX = (index: number) => MESH_ORIGIN_X + index * MESH_COLUMN_PITCH;
  const baseExtent = columns.map((column, index) => columnExtent(columnCenters(column, baseX(index))));
  const baseMaxX = columns.length > 0 ? baseX(columns.length - 1) + MESH_STUB + 190 : MESH_ORIGIN_X + 260;
  const gutterExtra = gutterCount.map((count, index) => {
    const extent = baseExtent[index];
    if (!extent) return 0;
    const next = baseExtent[index + 1];
    const gap = next ? next.left - extent.right : baseMaxX + 40 - extent.right;
    return meshGutterExtra(count, gap);
  });
  const shiftBefore = (index: number) => gutterExtra.slice(0, index).reduce((sum, extra) => sum + extra, 0);
  const colX = (index: number) => baseX(index) + shiftBefore(index);
  const cx = columns.length > 0 ? (colX(0) + colX(columns.length - 1)) / 2 : MESH_ORIGIN_X;
  const fy = parent || linkNodes.length > 0 || bandSuggestions.length > 0 ? 170 : 60;
  const focusR = MESH_FOCUS_GLYPH / 2;
  const glyphR = MESH_GLYPH / 2;
  const tree: string[] = [];
  const headings: MeshHeading[] = [];
  const placed: MeshLayoutNode[] = [];
  let maxX =
    columns.length > 0
      ? colX(columns.length - 1) + MESH_STUB + 190 + (gutterExtra[columns.length - 1] ?? 0)
      : cx + 260;

  if (columns.length > 0) {
    const rowY = fy + 150;
    const busY = fy + 70;
    tree.push(`M${cx},${fy + focusR + 10} V${busY}`);
    if (columns.length > 1) tree.push(`M${colX(0)},${busY} H${colX(columns.length - 1)}`);
    columns.forEach((column, index) => {
      const x = colX(index);
      if (column.head) {
        placed.push(placedNode(column.head, x, rowY, "child", input.meshProjectId, refs));
        tree.push(`M${x},${busY} V${rowY - 30}`);
        const top = rowY + 40;
        column.members.forEach((member, memberIndex) => {
          const y = top + 30 + memberIndex * MESH_ROW_PITCH;
          placed.push(placedNode(member, x + MESH_STUB, y, "grandchild", input.meshProjectId, refs));
          tree.push(`M${x},${y} H${x + MESH_STUB - glyphR - 4}`);
        });
        const last = top + 30 + (column.members.length - 1) * MESH_ROW_PITCH;
        tree.push(`M${x},${rowY + 30} V${last}`);
      } else {
        const top = rowY - 30;
        column.members.forEach((member, memberIndex) => {
          const y = top + 30 + memberIndex * MESH_ROW_PITCH;
          placed.push(placedNode(member, x + MESH_STUB, y, "child", input.meshProjectId, refs));
          tree.push(`M${x},${y} H${x + MESH_STUB - glyphR - 4}`);
        });
        const last = top + 30 + (column.members.length - 1) * MESH_ROW_PITCH;
        tree.push(`M${x},${busY} V${last}`);
      }
    });
  }

  placed.push(placedNode(focus, cx, fy, "focus", input.meshProjectId, refs));
  if (parent) {
    const parentY = 50;
    placed.push(placedNode(parent, cx, parentY, "parent", input.meshProjectId, refs));
    tree.push(`M${cx},${parentY + glyphR + 4} V${fy - focusR - 6}`);
  }
  const bandCount = linkNodes.length + bandSuggestions.length;
  if (bandCount > 0) {
    const bandX = cx + 280;
    headings.push({ x: bandX - 14, y: 16, text: "Linked to this", tone: null });
    linkNodes.forEach((node, index) => {
      placed.push(placedNode(node, bandX + index * MESH_COLUMN_PITCH, 56, "link", input.meshProjectId, refs));
    });
    bandSuggestions.forEach((node, index) => {
      const placedSuggestion = placedNode(
        node,
        bandX + (linkNodes.length + index) * MESH_COLUMN_PITCH,
        56,
        "suggestion",
        input.meshProjectId,
        refs,
      );
      placed.push({ ...placedSuggestion, lane: "band" });
    });
    maxX = Math.max(maxX, bandX + (bandCount - 1) * MESH_COLUMN_PITCH + 200);
  }

  const railX = Math.max(maxX + 40, cx + 280);
  if (railNodes.length > 0 || railSuggestions.length > 0) {
    let railY = fy + 40;
    if (railNodes.length > 0) {
      headings.push({ x: railX - 14, y: railY, text: "Linked from inside", tone: null });
      railY += 34;
      railNodes.forEach((node) => {
        placed.push(placedNode(node, railX, railY, "rail", input.meshProjectId, refs));
        railY += MESH_ROW_PITCH;
      });
      if (railSuggestions.length > 0) railY += 14;
    }
    if (railSuggestions.length > 0) {
      headings.push({ x: railX - 14, y: railY, text: "Suggested by AI", tone: "ai" });
      railY += 34;
      railSuggestions.forEach((node) => {
        const placedSuggestion = placedNode(
          node,
          railX,
          railY,
          "suggestion",
          input.meshProjectId,
          refs,
        );
        placed.push({ ...placedSuggestion, lane: "rail" });
        railY += MESH_ROW_PITCH;
      });
    }
  }

  const placedKeys = new Set(placed.map((node) => node.key));
  const placedByKey = new Map(placed.map((node) => [node.key, node]));
  const edgeHandles = (source: string, target: string) => {
    const from = placedByKey.get(source);
    const to = placedByKey.get(target);
    return meshEdgeHandles(from?.centerX ?? 0, to?.centerX ?? 0);
  };
  const edges: MeshLayoutEdge[] = [];
  for (const edge of input.edges) {
    if (!placedKeys.has(edge.source) || !placedKeys.has(edge.target)) continue;
    if (referencesOn && LINK_RELATIONS.has(edge.relation)) {
      edges.push({
        id: `l:${edge.source}:${edge.target}:${edge.relation}`,
        source: edge.source,
        target: edge.target,
        ...edgeHandles(edge.source, edge.target),
        kind: "link",
        blocking: false,
        sourceOffset: 0,
        targetOffset: 0,
        laneX: 0,
        corridor: null,
        bundled: false,
        trunkCount: null,
        trunkPath: null,
      });
      continue;
    }
    if (!dependsOn || edge.relation !== "depends_on") continue;
    const prerequisite = byKey.get(edge.target);
    edges.push({
      id: `d:${edge.source}:${edge.target}`,
      source: edge.source,
      target: edge.target,
      ...edgeHandles(edge.source, edge.target),
      kind: "depends",
      blocking: prerequisite?.state !== "complete",
      sourceOffset: 0,
      targetOffset: 0,
      laneX: 0,
      corridor: null,
      bundled: false,
      trunkCount: null,
      trunkPath: null,
    });
  }
  const suggestedSeen = new Set<string>();
  for (const suggestion of suggestions) {
    if (!placedKeys.has(suggestion.sourceKey) || !placedKeys.has(suggestion.targetKey)) continue;
    const id = `s:${suggestion.sourceKey}:${suggestion.targetKey}`;
    if (suggestedSeen.has(id)) continue;
    suggestedSeen.add(id);
    edges.push({
      id,
      source: suggestion.sourceKey,
      target: suggestion.targetKey,
      ...edgeHandles(suggestion.sourceKey, suggestion.targetKey),
      kind: "suggested",
      blocking: false,
      sourceOffset: 0,
      targetOffset: 0,
      laneX: 0,
      corridor: null,
      bundled: false,
      trunkCount: null,
      trunkPath: null,
    });
  }
  assignMeshPorts(edges, placedByKey);
  assignMeshLanes(
    edges,
    placedByKey,
    columnOf,
    (index) => (baseExtent[index]?.right ?? 0) + shiftBefore(index),
    new Set<number>([Math.round(cx), ...columns.map((_, index) => Math.round(colX(index)))]),
  );
  assignMeshCorridors(
    edges,
    placed,
    placedByKey,
    columnOf,
    (index) => (baseExtent[index]?.right ?? 0) + shiftBefore(index),
  );

  const ancestors: MeshAncestor[] = [];
  const seen = new Set<string>();
  let cursor: string | null = focus.key;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byKey.get(cursor);
    if (node) {
      ancestors.push({ key: node.key, title: node.title, referenceId: node.referenceId });
    }
    cursor = containmentParent(cursor, input.edges);
    if (cursor && !byKey.has(cursor)) break;
  }
  ancestors.reverse();

  const reading = [...placed].sort((a, b) => {
    const role = readingRank(a) - readingRank(b);
    if (role !== 0) return role;
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  return { nodes: reading, edges, ancestors, tree, headings };
}

export function meshNodesOverlap(nodes: readonly MeshLayoutNode[]): boolean {
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i]!;
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j]!;
      const aHeight = a.role === "focus" ? MESH_FOCUS_BOX_HEIGHT : MESH_BOX_HEIGHT;
      const bHeight = b.role === "focus" ? MESH_FOCUS_BOX_HEIGHT : MESH_BOX_HEIGHT;
      const separated =
        a.x + MESH_NODE_WIDTH <= b.x ||
        b.x + MESH_NODE_WIDTH <= a.x ||
        a.y + aHeight <= b.y ||
        b.y + bHeight <= a.y;
      if (!separated) return true;
    }
  }
  return false;
}
