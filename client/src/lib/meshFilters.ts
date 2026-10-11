import type { MeshGraphEdge, MeshGraphNode } from "./meshLayout";

/**
 * Drop records before cascade layout.
 * The focused record always stays. Complete means `state === "complete"` only.
 */
export function filterMeshGraph(input: {
  nodes: readonly MeshGraphNode[];
  edges: readonly MeshGraphEdge[];
  focusKey: string;
  hideDone: boolean;
  hiddenTypes: ReadonlySet<string>;
}): { nodes: MeshGraphNode[]; edges: MeshGraphEdge[] } {
  const nodes = input.nodes.filter((node) => {
    if (node.key === input.focusKey) return true;
    if (input.hideDone && node.state === "complete") return false;
    if (input.hiddenTypes.has(node.type)) return false;
    return true;
  });
  const keys = new Set(nodes.map((node) => node.key));
  const edges = input.edges.filter((edge) => keys.has(edge.source) && keys.has(edge.target));
  return { nodes, edges };
}
