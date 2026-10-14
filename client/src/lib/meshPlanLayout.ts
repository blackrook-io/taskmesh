/** Left-to-right plan of a Mesh neighbourhood. Phase rows, dependency rank. */

import {
  containmentParent,
  MESH_BOX_HEIGHT,
  MESH_COLUMN_PITCH,
  MESH_FOCUS_BOX_HEIGHT,
  MESH_FOCUS_GLYPH,
  MESH_GLYPH,
  MESH_ORIGIN_X,
  meshEdgeHandles,
  meshOrthogonalPath,
  type MeshGraphEdge,
  type MeshGraphNode,
  type MeshHeading,
  type MeshLayout,
  type MeshLayoutEdge,
  type MeshLayoutNode,
  type MeshPlanMark,
  type MeshSuggestion,
} from "./meshLayout.ts";
import { isDependencySatisfied } from "./dependencySatisfied.ts";

const LINK_RELATIONS = new Set(["relates_to", "references", "supports", "part_of", "duplicate_of"]);

/** Vertical step inside a phase row. Clears the focused record. */
export const MESH_PLAN_ROW = MESH_FOCUS_BOX_HEIGHT + 22;
const LANE_LABEL = 22;
const LANE_GAP = 28;
const NONE_LANE = "none";

type Flow = { from: string; to: string };

function compareNodes(a: MeshGraphNode, b: MeshGraphNode): number {
  const ref = (a.referenceId ?? "").localeCompare(b.referenceId ?? "");
  if (ref !== 0) return ref;
  const title = a.title.localeCompare(b.title);
  if (title !== 0) return title;
  return a.key.localeCompare(b.key);
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

function place(
  node: MeshGraphNode,
  centerX: number,
  centerY: number,
  role: MeshLayoutNode["role"],
  planMark: MeshPlanMark | null,
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
    planMark,
    group: null,
  };
}

/** Prerequisite and parent sit to the left. Other relations do not rank. */
function sequenceFlows(keys: ReadonlySet<string>, edges: readonly MeshGraphEdge[]): Flow[] {
  const flows: Flow[] = [];
  for (const edge of edges) {
    if (!keys.has(edge.source) || !keys.has(edge.target)) continue;
    if (edge.relation === "depends_on" || edge.relation === "child_of") {
      flows.push({ from: edge.target, to: edge.source });
    }
  }
  return flows;
}

/** Drop edges until Kahn's algorithm can order every node that appears. */
function acyclicFlows(keys: readonly string[], flows: readonly Flow[]): Flow[] {
  const current = [...flows];
  const keySet = new Set(keys);
  for (let guard = 0; guard < current.length + 1; guard += 1) {
    const indegree = new Map<string, number>();
    for (const key of keys) indegree.set(key, 0);
    for (const flow of current) {
      if (!keySet.has(flow.from) || !keySet.has(flow.to)) continue;
      indegree.set(flow.to, (indegree.get(flow.to) ?? 0) + 1);
    }
    const queue = keys.filter((key) => (indegree.get(key) ?? 0) === 0);
    let seen = 0;
    for (let index = 0; index < queue.length; index += 1) {
      const key = queue[index]!;
      seen += 1;
      for (const flow of current) {
        if (flow.from !== key) continue;
        const next = (indegree.get(flow.to) ?? 0) - 1;
        indegree.set(flow.to, next);
        if (next === 0) queue.push(flow.to);
      }
    }
    if (seen >= keys.length) return current;
    const stuck = new Set(keys.filter((key) => (indegree.get(key) ?? 0) > 0));
    const victim = current.findIndex((flow) => stuck.has(flow.from) && stuck.has(flow.to));
    if (victim < 0) return current;
    current.splice(victim, 1);
  }
  return current;
}

function ranksOf(keys: readonly string[], flows: readonly Flow[]): Map<string, number> {
  const rank = new Map<string, number>();
  for (const key of keys) rank.set(key, 0);
  const indegree = new Map<string, number>();
  for (const key of keys) indegree.set(key, 0);
  const outgoing = new Map<string, string[]>();
  for (const flow of flows) {
    indegree.set(flow.to, (indegree.get(flow.to) ?? 0) + 1);
    const list = outgoing.get(flow.from) ?? [];
    list.push(flow.to);
    outgoing.set(flow.from, list);
  }
  const queue = keys.filter((key) => (indegree.get(key) ?? 0) === 0);
  for (let index = 0; index < queue.length; index += 1) {
    const key = queue[index]!;
    for (const next of outgoing.get(key) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(key) ?? 0) + 1));
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  return rank;
}

function openState(state: string | null | undefined): boolean {
  return !isDependencySatisfied(state ?? "");
}

/** Tasks and to-dos with a prerequisite that is still open in the fetched graph. */
export function meshBlockedKeys(
  nodes: readonly MeshGraphNode[],
  edges: readonly MeshGraphEdge[],
): Set<string> {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const blocked = new Set<string>();
  for (const edge of edges) {
    if (edge.relation !== "depends_on") continue;
    const dependent = byKey.get(edge.source);
    const prerequisite = byKey.get(edge.target);
    if (!dependent || !prerequisite) continue;
    if (dependent.type !== "task" && dependent.type !== "todo") continue;
    if (openState(prerequisite.state)) blocked.add(dependent.key);
  }
  return blocked;
}

function planMarkFor(node: MeshGraphNode, blocked: ReadonlySet<string>): MeshPlanMark | null {
  if (node.type !== "task" && node.type !== "todo") return null;
  if (blocked.has(node.key)) return "blocked";
  if (node.state === "ready") return "next";
  return null;
}

type Lane = { id: string; label: string; sort: number; phaseId: number };

function laneOfTask(node: MeshGraphNode): Lane {
  if (node.phaseId == null) {
    return { id: NONE_LANE, label: "No phase", sort: Number.MAX_SAFE_INTEGER, phaseId: Number.MAX_SAFE_INTEGER };
  }
  return {
    id: `phase:${node.phaseId}`,
    label: node.phaseName?.trim() || `Phase ${node.phaseId}`,
    sort: node.phaseSort ?? Number.MAX_SAFE_INTEGER - 1,
    phaseId: node.phaseId,
  };
}

/** Records joined by depends-on or child-of stay in one band. Loose records do not push them apart. */
function sequenceBands(
  members: readonly MeshGraphNode[],
  edges: readonly MeshGraphEdge[],
): MeshGraphNode[][] {
  const keys = new Set(members.map((node) => node.key));
  const adj = new Map<string, string[]>();
  for (const key of keys) adj.set(key, []);
  for (const edge of edges) {
    if (edge.relation !== "depends_on" && edge.relation !== "child_of") continue;
    if (!keys.has(edge.source) || !keys.has(edge.target)) continue;
    adj.get(edge.source)?.push(edge.target);
    adj.get(edge.target)?.push(edge.source);
  }
  const seen = new Set<string>();
  const byKey = new Map(members.map((node) => [node.key, node]));
  const bands: MeshGraphNode[][] = [];
  for (const member of [...members].sort(compareNodes)) {
    if (seen.has(member.key)) continue;
    const band: MeshGraphNode[] = [];
    const queue = [member.key];
    seen.add(member.key);
    for (let index = 0; index < queue.length; index += 1) {
      const key = queue[index]!;
      const node = byKey.get(key);
      if (node) band.push(node);
      for (const next of adj.get(key) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    bands.push(band);
  }
  return bands;
}

function laneFor(
  key: string,
  byKey: ReadonlyMap<string, MeshGraphNode>,
  edges: readonly MeshGraphEdge[],
): Lane {
  const seen = new Set<string>();
  let cursor: string | null = key;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byKey.get(cursor);
    if (!node) break;
    if (node.type === "task") return laneOfTask(node);
    cursor = containmentParent(cursor, edges);
    if (cursor && !byKey.has(cursor)) break;
  }
  return { id: NONE_LANE, label: "No phase", sort: Number.MAX_SAFE_INTEGER, phaseId: Number.MAX_SAFE_INTEGER };
}

export function layoutMeshPlan(input: {
  nodes: readonly MeshGraphNode[];
  edges: readonly MeshGraphEdge[];
  focusKey: string;
  meshProjectId: number;
  projectRefs?: ReadonlyMap<number, string>;
  references?: boolean;
  dependsOn?: boolean;
  suggestions?: readonly MeshSuggestion[];
  /** Fetched graph before Hide done, so a hidden open prerequisite still blocks. */
  blockNodes?: readonly MeshGraphNode[];
  blockEdges?: readonly MeshGraphEdge[];
}): MeshLayout {
  const refs = input.projectRefs ?? new Map<number, string>();
  const referencesOn = input.references !== false;
  const dependsOn = input.dependsOn !== false;
  const suggestions = input.suggestions ?? [];
  const byKey = new Map(input.nodes.map((node) => [node.key, node]));
  const focus = byKey.get(input.focusKey);
  if (!focus) return { nodes: [], edges: [], ancestors: [], tree: [], treeTies: [], headings: [] };

  const keys = input.nodes.map((node) => node.key);
  const keySet = new Set(keys);
  const flows = acyclicFlows(keys, sequenceFlows(keySet, input.edges));
  const rank = ranksOf(keys, flows);
  const blocked = meshBlockedKeys(input.blockNodes ?? input.nodes, input.blockEdges ?? input.edges);

  const laneByKey = new Map<string, Lane>();
  for (const node of input.nodes) laneByKey.set(node.key, laneFor(node.key, byKey, input.edges));
  const lanes: Lane[] = [];
  const seenLane = new Set<string>();
  for (const lane of laneByKey.values()) {
    if (seenLane.has(lane.id)) continue;
    seenLane.add(lane.id);
    lanes.push(lane);
  }
  lanes.sort((a, b) => a.sort - b.sort || a.phaseId - b.phaseId || a.label.localeCompare(b.label));

  const headings: MeshHeading[] = [];
  const placed: MeshLayoutNode[] = [];
  let laneTop = 28;
  for (const lane of lanes) {
    headings.push({ x: MESH_ORIGIN_X, y: laneTop, text: lane.label, tone: null });
    const members = input.nodes.filter((node) => laneByKey.get(node.key)?.id === lane.id);
    const rowTop = laneTop + LANE_LABEL;
    let cursor = rowTop;
    for (const component of sequenceBands(members, input.edges)) {
      const byRank = new Map<number, MeshGraphNode[]>();
      for (const node of component) {
        const column = rank.get(node.key) ?? 0;
        const list = byRank.get(column) ?? [];
        list.push(node);
        byRank.set(column, list);
      }
      let stack = 1;
      for (const list of byRank.values()) {
        list.sort(compareNodes);
        stack = Math.max(stack, list.length);
      }
      for (const [column, list] of byRank) {
        list.forEach((node, index) => {
          const role = node.key === focus.key ? "focus" : "child";
          placed.push(
            place(
              node,
              MESH_ORIGIN_X + column * MESH_COLUMN_PITCH + MESH_GLYPH,
              cursor + index * MESH_PLAN_ROW + MESH_PLAN_ROW / 2,
              role,
              planMarkFor(node, blocked),
              input.meshProjectId,
              refs,
            ),
          );
        });
      }
      cursor += stack * MESH_PLAN_ROW;
    }
    laneTop = cursor + LANE_GAP;
  }

  const placedByKey = new Map(placed.map((node) => [node.key, node]));
  const tree: string[] = [];
  const treeTies: MeshLayout["treeTies"] = [];
  const edges: MeshLayoutEdge[] = [];
  for (const edge of input.edges) {
    const from = placedByKey.get(edge.source);
    const to = placedByKey.get(edge.target);
    if (!from || !to) continue;
    if (edge.relation === "child_of") {
      const mid = (from.centerX + to.centerX) / 2;
      treeTies.push({ pathIndex: tree.length, fromKey: edge.target, toKey: edge.source });
      tree.push(meshOrthogonalPath(to.centerX, to.centerY, from.centerX, from.centerY, mid));
      continue;
    }
    if (dependsOn && edge.relation === "depends_on") {
      const prerequisite = byKey.get(edge.target);
      edges.push({
        id: `d:${edge.source}:${edge.target}`,
        source: edge.target,
        target: edge.source,
        ...meshEdgeHandles(to.centerX, from.centerX),
        kind: "depends",
        blocking: openState(prerequisite?.state),
        sourceOffset: 0,
        targetOffset: 0,
        laneX: (from.centerX + to.centerX) / 2,
        corridor: null,
        bundled: false,
        trunkCount: null,
        trunkPath: null,
      });
      continue;
    }
    if (referencesOn && LINK_RELATIONS.has(edge.relation)) {
      edges.push({
        id: `l:${edge.source}:${edge.target}:${edge.relation}`,
        source: edge.source,
        target: edge.target,
        ...meshEdgeHandles(from.centerX, to.centerX),
        kind: "link",
        blocking: false,
        sourceOffset: 0,
        targetOffset: 0,
        laneX: (from.centerX + to.centerX) / 2,
        corridor: null,
        bundled: false,
        trunkCount: null,
        trunkPath: null,
      });
    }
  }

  const suggestedSeen = new Set<string>();
  for (const suggestion of suggestions) {
    if (!placedByKey.has(suggestion.sourceKey) || !placedByKey.has(suggestion.targetKey)) continue;
    const id = `s:${suggestion.sourceKey}:${suggestion.targetKey}`;
    if (suggestedSeen.has(id)) continue;
    suggestedSeen.add(id);
    const from = placedByKey.get(suggestion.sourceKey)!;
    const to = placedByKey.get(suggestion.targetKey)!;
    edges.push({
      id,
      source: suggestion.sourceKey,
      target: suggestion.targetKey,
      ...meshEdgeHandles(from.centerX, to.centerX),
      kind: "suggested",
      blocking: false,
      sourceOffset: 0,
      targetOffset: 0,
      laneX: (from.centerX + to.centerX) / 2,
      corridor: null,
      bundled: false,
      trunkCount: null,
      trunkPath: null,
    });
  }

  const ancestors: MeshLayout["ancestors"] = [];
  const seen = new Set<string>();
  let cursor: string | null = focus.key;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byKey.get(cursor);
    if (node) ancestors.push({ key: node.key, title: node.title, referenceId: node.referenceId });
    cursor = containmentParent(cursor, input.edges);
    if (cursor && !byKey.has(cursor)) break;
  }
  ancestors.reverse();

  const reading = [...placed].sort((a, b) => a.y - b.y || a.x - b.x);
  return { nodes: reading, edges, ancestors, tree, treeTies, headings };
}
