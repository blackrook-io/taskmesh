import { LINK_RELATIONS } from "./entityLinkRules.js";

/** Structural edges unioned with `entity_links` relations. `tagged` is opt-in. */
export const STRUCTURAL_GRAPH_RELATIONS = [
  "in_project",
  "child_of",
  "depends_on",
  "in_list",
  "on_board",
  "in_wiki",
  "tagged",
  "from_idea",
] as const;

export const GRAPH_RELATIONS = [...STRUCTURAL_GRAPH_RELATIONS, ...LINK_RELATIONS] as const;

export type GraphRelation = (typeof GRAPH_RELATIONS)[number];

const GRAPH_RELATION_SET = new Set<string>(GRAPH_RELATIONS);

/** Default neighbourhood omits tag nodes until `rel` includes `tagged`. */
export const DEFAULT_GRAPH_RELATIONS = GRAPH_RELATIONS.filter((relation) => relation !== "tagged");

export type GraphEdge = {
  source: string;
  target: string;
  relation: string;
  origin: string | null;
};

export type GraphNeighbour = {
  /** The endpoint that is not the node being expanded. */
  key: string;
  done: boolean;
  edge: GraphEdge;
};

export function graphNodeKey(type: string, id: number): string {
  return `${type}:${id}`;
}

export function parseGraphRelations(
  rel: string | undefined,
): { ok: true; relations: Set<string> } | { ok: false; unknown: string } {
  if (rel == null || rel.trim() === "") {
    return { ok: true, relations: new Set(DEFAULT_GRAPH_RELATIONS) };
  }
  const parts = rel
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return { ok: true, relations: new Set(DEFAULT_GRAPH_RELATIONS) };
  }
  for (const part of parts) {
    if (!GRAPH_RELATION_SET.has(part)) {
      return { ok: false, unknown: part };
    }
  }
  return { ok: true, relations: new Set(parts) };
}

function edgeIdentity(edge: GraphEdge): string {
  return `${edge.source}\0${edge.target}\0${edge.relation}\0${edge.origin ?? ""}`;
}

/**
 * Breadth-first neighbourhood. The root is depth 0 and always included.
 * `truncated` is set only when a visible, allowed neighbour does not fit the cap.
 */
export async function walkNeighbourhood(opts: {
  root: string;
  depth: number;
  cap: number;
  hideDone: boolean;
  rootDone?: boolean;
  relations: ReadonlySet<string>;
  isVisible: (key: string) => boolean;
  expand: (keys: string[]) => Promise<GraphNeighbour[]>;
}): Promise<{ keys: string[]; edges: GraphEdge[]; truncated: boolean }> {
  const seen = new Set<string>([opts.root]);
  const done = new Set<string>();
  if (opts.rootDone) done.add(opts.root);
  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();
  let truncated = false;
  let frontier = [opts.root];

  for (let level = 0; level < opts.depth; level += 1) {
    const expandable = frontier.filter((key) => !(opts.hideDone && done.has(key)));
    if (expandable.length === 0) break;
    const neighbours = await opts.expand(expandable);
    const next: string[] = [];
    for (const neighbour of neighbours) {
      if (!opts.relations.has(neighbour.edge.relation)) continue;
      if (!opts.isVisible(neighbour.key)) continue;
      if (opts.hideDone && neighbour.done) continue;
      if (!seen.has(neighbour.key)) {
        if (seen.size >= opts.cap) {
          truncated = true;
          continue;
        }
        seen.add(neighbour.key);
        if (neighbour.done) done.add(neighbour.key);
        next.push(neighbour.key);
      }
      if (seen.has(neighbour.edge.source) && seen.has(neighbour.edge.target)) {
        const id = edgeIdentity(neighbour.edge);
        if (!edgeIds.has(id)) {
          edgeIds.add(id);
          edges.push(neighbour.edge);
        }
      }
    }
    frontier = next;
  }

  return { keys: [...seen], edges, truncated };
}
