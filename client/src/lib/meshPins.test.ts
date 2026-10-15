import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { layoutMesh, meshNodesOverlap, type MeshGraphEdge, type MeshGraphNode } from "./meshLayout.ts";
import { applyMeshPins, meshPinsInGraph } from "./meshPins.ts";

function node(key: string, title: string, referenceId: string): MeshGraphNode {
  const [type, idRaw] = key.split(":");
  return {
    key,
    type: type ?? "task",
    id: Number(idRaw),
    referenceId,
    title,
    projectId: 4,
  };
}

const nodes = [
  node("project:4", "TaskMesh", "P0003"),
  node("task:1", "Parent", "T0001"),
  node("task:3", "Leaf", "T0003"),
];
const edges: MeshGraphEdge[] = [
  { source: "project:4", target: "task:1", relation: "in_project" },
  { source: "project:4", target: "task:3", relation: "in_project" },
];

describe("mesh pins", () => {
  it("keeps a pin and moves an overlapping node aside", () => {
    const layout = layoutMesh({ nodes, edges, focusKey: "project:4", meshProjectId: 4 });
    const leaf = layout.nodes.find((item) => item.key === "task:3");
    assert.ok(leaf);
    const pinned = applyMeshPins(layout, { "task:1": { x: leaf.x, y: leaf.y } });
    const head = pinned.nodes.find((item) => item.key === "task:1");
    const shifted = pinned.nodes.find((item) => item.key === "task:3");
    assert.equal(head?.x, leaf.x);
    assert.equal(head?.y, leaf.y);
    assert.ok(shifted && (shifted.x !== leaf.x || shifted.y !== leaf.y));
    assert.equal(meshNodesOverlap(pinned.nodes), false);
    assert.ok(
      pinned.tree.some((path) => path.includes(String(head?.centerX)) && path.includes(String(head?.centerY))),
    );
  });

  it("places a node that was not pinned off of a pin", () => {
    const layout = layoutMesh({ nodes, edges, focusKey: "project:4", meshProjectId: 4 });
    const leaf = layout.nodes.find((item) => item.key === "task:3");
    assert.ok(leaf);
    const pinned = applyMeshPins(layout, { "project:4": { x: leaf.x, y: leaf.y } });
    const focus = pinned.nodes.find((item) => item.key === "project:4");
    const shifted = pinned.nodes.find((item) => item.key === "task:3");
    assert.equal(focus?.x, leaf.x);
    assert.equal(focus?.y, leaf.y);
    assert.equal(meshNodesOverlap(pinned.nodes), false);
    assert.ok(shifted && (shifted.x !== leaf.x || shifted.y !== leaf.y));
  });

  it("ignores a pin whose record left the graph", () => {
    const layout = layoutMesh({ nodes, edges, focusKey: "project:4", meshProjectId: 4 });
    const pinned = applyMeshPins(layout, { "task:99": { x: 0, y: 0 } });
    assert.equal(pinned, layout);
    assert.deepEqual(
      meshPinsInGraph({ "task:1": { x: 1, y: 2 }, "task:99": { x: 0, y: 0 } }, new Set(["task:1"])),
      { "task:1": { x: 1, y: 2 } },
    );
  });

  it("redraws a parent line to a pinned child", () => {
    const planNodes = [node("task:1", "Parent", "T0001"), node("task:2", "Child", "T0002")];
    const planEdges: MeshGraphEdge[] = [{ source: "task:2", target: "task:1", relation: "child_of" }];
    const layout = layoutMesh({
      nodes: planNodes,
      edges: planEdges,
      focusKey: "task:1",
      meshProjectId: 4,
    });
    const pinned = applyMeshPins(layout, { "task:2": { x: 900, y: 40 } });
    const child = pinned.nodes.find((item) => item.key === "task:2");
    assert.equal(child?.x, 900);
    assert.equal(meshNodesOverlap(pinned.nodes), false);
    assert.ok(pinned.tree.some((path) => path.includes(String(child?.centerX))));
  });
});
