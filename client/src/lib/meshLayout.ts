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

export type MeshLayoutEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: "b" | "r";
  targetHandle: "t" | "l";
  kind: "link" | "depends" | "suggested";
  blocking: boolean;
};

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

  const colX = (index: number) => MESH_ORIGIN_X + index * MESH_COLUMN_PITCH;
  const cx = columns.length > 0 ? colX(0) + ((columns.length - 1) * MESH_COLUMN_PITCH) / 2 : MESH_ORIGIN_X;
  const fy = parent || linkNodes.length > 0 || bandSuggestions.length > 0 ? 170 : 60;
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
  const edges: MeshLayoutEdge[] = [];
  for (const edge of input.edges) {
    if (!placedKeys.has(edge.source) || !placedKeys.has(edge.target)) continue;
    if (referencesOn && LINK_RELATIONS.has(edge.relation)) {
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
    if (!dependsOn || edge.relation !== "depends_on") continue;
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
      sourceHandle: "r",
      targetHandle: "l",
      kind: "suggested",
      blocking: false,
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
