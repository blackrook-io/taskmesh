import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { meshNodesOverlap, type MeshGraphEdge, type MeshGraphNode } from "./meshLayout.ts";
import { layoutMeshPlan, meshBlockedKeys } from "./meshPlanLayout.ts";

function node(
  key: string,
  title: string,
  extra: Partial<MeshGraphNode> = {},
): MeshGraphNode {
  const [type, idRaw] = key.split(":");
  return {
    key,
    type: type ?? "task",
    id: Number(idRaw),
    referenceId: extra.referenceId ?? key,
    title,
    projectId: extra.projectId ?? 4,
    state: extra.state ?? "ready",
    phaseId: extra.phaseId ?? null,
    phaseName: extra.phaseName ?? null,
    phaseSort: extra.phaseSort ?? null,
  };
}

describe("mesh plan layout", () => {
  it("puts a prerequisite left of the task that depends on it", () => {
    const nodes = [
      node("task:1", "Read", { phaseId: 1, phaseName: "Foundation", phaseSort: 0, state: "complete" }),
      node("task:2", "Practice", { phaseId: 1, phaseName: "Foundation", phaseSort: 0 }),
    ];
    const edges: MeshGraphEdge[] = [{ source: "task:2", target: "task:1", relation: "depends_on" }];
    const layout = layoutMeshPlan({ nodes, edges, focusKey: "task:1", meshProjectId: 4 });
    const byKey = new Map(layout.nodes.map((item) => [item.key, item]));
    assert.ok((byKey.get("task:1")?.centerX ?? 0) < (byKey.get("task:2")?.centerX ?? 0));
    assert.equal(byKey.get("task:2")?.planMark, "next");
    assert.equal(layout.edges[0]?.source, "task:1");
    assert.equal(layout.edges[0]?.target, "task:2");
    assert.equal(layout.edges[0]?.blocking, false);
  });

  it("puts a parent left of its child and stacks phases top to bottom", () => {
    const nodes = [
      node("task:1", "Parent", { phaseId: 1, phaseName: "Foundation", phaseSort: 0, state: "in_progress" }),
      node("task:2", "Child", { phaseId: 1, phaseName: "Foundation", phaseSort: 0 }),
      node("task:3", "Later", { phaseId: 2, phaseName: "Studio", phaseSort: 1, state: "in_progress" }),
    ];
    const edges: MeshGraphEdge[] = [{ source: "task:2", target: "task:1", relation: "child_of" }];
    const layout = layoutMeshPlan({ nodes, edges, focusKey: "task:1", meshProjectId: 4 });
    const byKey = new Map(layout.nodes.map((item) => [item.key, item]));
    assert.ok((byKey.get("task:1")?.centerX ?? 0) < (byKey.get("task:2")?.centerX ?? 0));
    assert.ok((byKey.get("task:3")?.centerY ?? 0) > (byKey.get("task:1")?.centerY ?? 0));
    assert.deepEqual(
      layout.headings.map((heading) => heading.text),
      ["Foundation", "Studio"],
    );
    assert.equal(meshNodesOverlap(layout.nodes), false);
    assert.ok(layout.tree.length > 0);
  });

  it("marks a ready task blocked while an open prerequisite is hidden", () => {
    const hidden = node("task:1", "Read", { state: "in_progress" });
    const ready = node("task:2", "Practice");
    const edges: MeshGraphEdge[] = [{ source: "task:2", target: "task:1", relation: "depends_on" }];
    assert.equal(meshBlockedKeys([hidden, ready], edges).has("task:2"), true);
    const layout = layoutMeshPlan({
      nodes: [ready],
      edges: [],
      focusKey: "task:2",
      meshProjectId: 4,
      blockNodes: [hidden, ready],
      blockEdges: edges,
    });
    assert.equal(layout.nodes[0]?.planMark, "blocked");
  });

  it("does not treat a canceled prerequisite as an open blocker", () => {
    const nodes = [
      node("task:1", "Dropped", { state: "canceled" }),
      node("task:2", "Practice"),
    ];
    const edges: MeshGraphEdge[] = [{ source: "task:2", target: "task:1", relation: "depends_on" }];
    const layout = layoutMeshPlan({ nodes, edges, focusKey: "task:2", meshProjectId: 4 });
    assert.equal(layout.nodes.find((item) => item.key === "task:2")?.planMark, "next");
  });

  it("keeps a reference cycle from throwing and ignores it for rank", () => {
    const nodes = [
      node("task:1", "A", { phaseId: 1, phaseName: "Foundation", phaseSort: 0, state: "in_progress" }),
      node("task:2", "B", { phaseId: 1, phaseName: "Foundation", phaseSort: 0, state: "in_progress" }),
      node("document:3", "Notes", { state: null, phaseId: null }),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "task:2", target: "task:1", relation: "depends_on" },
      { source: "task:1", target: "document:3", relation: "references" },
      { source: "document:3", target: "task:1", relation: "references" },
    ];
    const layout = layoutMeshPlan({ nodes, edges, focusKey: "task:1", meshProjectId: 4 });
    const byKey = new Map(layout.nodes.map((item) => [item.key, item]));
    assert.equal(layout.nodes.length, 3);
    assert.ok((byKey.get("task:1")?.centerX ?? 0) < (byKey.get("task:2")?.centerX ?? 0));
    assert.ok((byKey.get("document:3")?.centerY ?? 0) > (byKey.get("task:1")?.centerY ?? 0));
    assert.equal(layout.headings.some((heading) => heading.text === "No phase"), true);
    assert.equal(meshNodesOverlap(layout.nodes), false);
  });

  it("puts a child to-do in its parent task phase", () => {
    const nodes = [
      node("task:1", "Parent", { phaseId: 2, phaseName: "Studio", phaseSort: 1, state: "in_progress" }),
      node("todo:4", "Drill", { state: "ready" }),
      node("task:9", "Unphased", { state: "in_progress" }),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "todo:4", target: "task:1", relation: "child_of" },
      { source: "project:4", target: "todo:4", relation: "in_project" },
    ];
    const layout = layoutMeshPlan({ nodes, edges, focusKey: "task:1", meshProjectId: 4 });
    const byKey = new Map(layout.nodes.map((item) => [item.key, item]));
    assert.equal(byKey.get("todo:4")?.centerY, byKey.get("task:1")?.centerY);
    assert.ok((byKey.get("todo:4")?.centerX ?? 0) > (byKey.get("task:1")?.centerX ?? 0));
    assert.ok((byKey.get("task:9")?.centerY ?? 0) > (byKey.get("task:1")?.centerY ?? 0));
    assert.equal(byKey.get("todo:4")?.planMark, "next");
  });

  it("keeps a parent beside its child when unrelated tasks share the phase", () => {
    const nodes = [
      node("task:1", "Parent", { referenceId: "T0002", phaseId: 1, phaseName: "Foundation", phaseSort: 0, state: "in_progress" }),
      node("task:2", "Child", { referenceId: "T0003", phaseId: 1, phaseName: "Foundation", phaseSort: 0 }),
      node("task:9", "Loose", { referenceId: "T0001", phaseId: 1, phaseName: "Foundation", phaseSort: 0, state: "in_progress" }),
    ];
    const edges: MeshGraphEdge[] = [{ source: "task:2", target: "task:1", relation: "child_of" }];
    const layout = layoutMeshPlan({ nodes, edges, focusKey: "task:1", meshProjectId: 4 });
    const byKey = new Map(layout.nodes.map((item) => [item.key, item]));
    assert.equal(byKey.get("task:1")?.centerY, byKey.get("task:2")?.centerY);
    assert.ok((byKey.get("task:9")?.centerY ?? 0) < (byKey.get("task:1")?.centerY ?? 0));
    assert.equal(meshNodesOverlap(layout.nodes), false);
  });

  it("still returns a layout when child links cycle", () => {
    const nodes = [
      node("task:1", "A", { state: "in_progress" }),
      node("task:2", "B", { state: "in_progress" }),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "task:2", target: "task:1", relation: "child_of" },
      { source: "task:1", target: "task:2", relation: "child_of" },
    ];
    const layout = layoutMeshPlan({ nodes, edges, focusKey: "task:1", meshProjectId: 4 });
    assert.equal(layout.nodes.length, 2);
    assert.equal(meshNodesOverlap(layout.nodes), false);
  });
});
