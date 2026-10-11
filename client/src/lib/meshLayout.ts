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
};

export type MeshGraphEdge = {
  source: string;
  target: string;
  relation: string;
};

export type MeshRole = "focus" | "parent" | "link" | "child" | "grandchild" | "rail";

export type MeshLayoutNode = {
  key: string;
  /** Top-left of the node box. The glyph center is `centerX` / `centerY`. */
  x: number;
  y: number;
  centerX: number;
  centerY: number;
  role: MeshRole;
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
};

export type MeshLayoutEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: "b" | "r";
  targetHandle: "t" | "l";
  kind: "link" | "depends";
  blocking: boolean;
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
    title: node.title,
    referenceId: node.referenceId,
    type: node.type,
    projectLabel: projectLabel(node, meshProjectId, projectRefs),
  };
}

export function layoutMesh(input: {
  nodes: readonly MeshGraphNode[];
  edges: readonly MeshGraphEdge[];
  focusKey: string;
  meshProjectId: number;
  projectRefs?: ReadonlyMap<number, string>;
}): MeshLayout {
  const refs = input.projectRefs ?? new Map<number, string>();
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
    if (!LINK_RELATIONS.has(edge.relation)) continue;
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

  const branching = level1.filter((child) => (level2.get(child.key) ?? []).length > 0);
  const leaves = level1.filter((child) => (level2.get(child.key) ?? []).length === 0);
  const columns: { head: MeshGraphNode | null; members: MeshGraphNode[] }[] = branching.map((head) => ({
    head,
    members: level2.get(head.key) ?? [],
  }));
  if (leaves.length > 0) columns.push({ head: null, members: leaves });

  const colX = (index: number) => MESH_ORIGIN_X + index * MESH_COLUMN_PITCH;
  const cx = columns.length > 0 ? colX(0) + ((columns.length - 1) * MESH_COLUMN_PITCH) / 2 : MESH_ORIGIN_X;
  const fy = parent || linkNodes.length > 0 ? 170 : 60;
  const focusR = MESH_FOCUS_GLYPH / 2;
  const glyphR = MESH_GLYPH / 2;
  const tree: string[] = [];
  const headings: MeshHeading[] = [];
  const placed: MeshLayoutNode[] = [];
  let maxX = columns.length > 0 ? colX(columns.length - 1) + MESH_STUB + 190 : cx + 260;

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
  if (linkNodes.length > 0) {
    const bandX = cx + 280;
    headings.push({ x: bandX - 14, y: 16, text: "Linked to this" });
    linkNodes.forEach((node, index) => {
      placed.push(placedNode(node, bandX + index * MESH_COLUMN_PITCH, 56, "link", input.meshProjectId, refs));
    });
    maxX = Math.max(maxX, bandX + (linkNodes.length - 1) * MESH_COLUMN_PITCH + 200);
  }

  const railX = Math.max(maxX + 40, cx + 280);
  if (railNodes.length > 0) {
    let railY = fy + 40;
    headings.push({ x: railX - 14, y: railY, text: "Linked from inside" });
    railY += 34;
    railNodes.forEach((node) => {
      placed.push(placedNode(node, railX, railY, "rail", input.meshProjectId, refs));
      railY += MESH_ROW_PITCH;
    });
  }

  const placedKeys = new Set(placed.map((node) => node.key));
  const edges: MeshLayoutEdge[] = [];
  for (const edge of input.edges) {
    if (!placedKeys.has(edge.source) || !placedKeys.has(edge.target)) continue;
    if (LINK_RELATIONS.has(edge.relation)) {
      edges.push({
        id: `l:${edge.source}:${edge.target}:${edge.relation}`,
        source: edge.source,
        target: edge.target,
        sourceHandle: "r",
        targetHandle: "l",
        kind: "link",
        blocking: false,
      });
      continue;
    }
    if (edge.relation !== "depends_on") continue;
    const prerequisite = byKey.get(edge.target);
    edges.push({
      id: `d:${edge.source}:${edge.target}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: "r",
      targetHandle: "l",
      kind: "depends",
      blocking: prerequisite?.state !== "complete",
    });
  }

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

  const order: Record<MeshRole, number> = {
    parent: 0,
    link: 1,
    focus: 2,
    child: 3,
    grandchild: 4,
    rail: 5,
  };
  const reading = [...placed].sort((a, b) => {
    const role = order[a.role] - order[b.role];
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
