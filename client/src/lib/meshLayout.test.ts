import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  containmentParent,
  layoutMesh,
  meshNodesOverlap,
  type MeshGraphEdge,
  type MeshGraphNode,
} from "./meshLayout.ts";

function node(
  key: string,
  title: string,
  referenceId: string | null,
  projectId: number | null = 4,
): MeshGraphNode {
  const [type, idRaw] = key.split(":");
  return {
    key,
    type: type ?? "task",
    id: Number(idRaw),
    referenceId,
    title,
    projectId,
  };
}

describe("mesh cascade layout", () => {
  it("prefers a parent task over the project", () => {
    const edges: MeshGraphEdge[] = [
      { source: "task:2", target: "task:1", relation: "child_of" },
      { source: "project:4", target: "task:2", relation: "in_project" },
    ];
    assert.equal(containmentParent("task:2", edges), "task:1");
  });

  it("prefers a list over the project", () => {
    const edges: MeshGraphEdge[] = [
      { source: "todo_list:3", target: "todo:9", relation: "in_list" },
      { source: "project:4", target: "todo:9", relation: "in_project" },
    ];
    assert.equal(containmentParent("todo:9", edges), "todo_list:3");
  });

  it("puts nested records in a column and loose children in one stack", () => {
    const nodes = [
      node("project:4", "TaskMesh", "P0003"),
      node("task:1", "Parent", "T0001"),
      node("task:2", "Child", "T0002"),
      node("task:3", "Leaf", "T0003"),
      node("task:9", "Too deep", "T0009"),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:1", relation: "in_project" },
      { source: "project:4", target: "task:2", relation: "in_project" },
      { source: "project:4", target: "task:3", relation: "in_project" },
      { source: "project:4", target: "task:9", relation: "in_project" },
      { source: "task:2", target: "task:1", relation: "child_of" },
      { source: "task:9", target: "task:2", relation: "child_of" },
    ];
    const layout = layoutMesh({ nodes, edges, focusKey: "project:4", meshProjectId: 4 });
    const byKey = new Map(layout.nodes.map((item) => [item.key, item]));
    const head = byKey.get("task:1");
    const nested = byKey.get("task:2");
    const leaf = byKey.get("task:3");
    const focus = byKey.get("project:4");
    assert.equal(byKey.has("task:9"), false);
    assert.equal(nested?.role, "grandchild");
    assert.equal(head?.role, "child");
    assert.equal(leaf?.role, "child");
    assert.ok((leaf?.centerX ?? 0) > (head?.centerX ?? 0));
    assert.equal(nested?.centerX, (head?.centerX ?? 0) + 30);
    assert.equal(focus?.centerX, ((head?.centerX ?? 0) + ((leaf?.centerX ?? 0) - 30)) / 2);
    assert.equal(layout.tree.some((path) => path.includes("H")), true);
    assert.equal(meshNodesOverlap(layout.nodes), false);
    assert.deepEqual(
      layout.ancestors.map((item) => item.key),
      ["project:4"],
    );
  });

  it("keeps the focus record's own links above and cascade links on the rail", () => {
    const nodes = [
      node("project:4", "TaskMesh", "P0003"),
      node("task:1", "Work", "T0001"),
      node("idea:7", "Own link", "I0007", null),
      node("document:8", "Inside link", "D0008", 9),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:1", relation: "in_project" },
      { source: "project:4", target: "idea:7", relation: "supports" },
      { source: "task:1", target: "document:8", relation: "references" },
      { source: "task:1", target: "task:2", relation: "depends_on" },
    ];
    const layout = layoutMesh({
      nodes,
      edges,
      focusKey: "project:4",
      meshProjectId: 4,
      projectRefs: new Map([[9, "P0009"]]),
    });
    const byKey = new Map(layout.nodes.map((item) => [item.key, item]));
    const own = byKey.get("idea:7");
    const focus = byKey.get("project:4");
    assert.equal(own?.role, "link");
    assert.ok((own?.centerY ?? 0) < (focus?.centerY ?? 0));
    assert.ok((own?.centerX ?? 0) > (focus?.centerX ?? 0));
    assert.equal(byKey.get("document:8")?.role, "rail");
    assert.equal(byKey.get("document:8")?.projectLabel, "P0009");
    assert.deepEqual(
      layout.headings.map((item) => item.text),
      ["Linked to this", "Linked from inside"],
    );
    assert.equal(byKey.has("task:2"), false);
    assert.equal(
      layout.edges.some((edge) => edge.id.includes("depends_on")),
      false,
    );
    assert.equal(meshNodesOverlap(layout.nodes), false);
  });

  it("shows the containment parent above a focused task", () => {
    const nodes = [
      node("project:4", "TaskMesh", "P0003"),
      node("task:1", "Parent", "T0001"),
      node("task:2", "Focus", "T0002"),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:1", relation: "in_project" },
      { source: "project:4", target: "task:2", relation: "in_project" },
      { source: "task:2", target: "task:1", relation: "child_of" },
    ];
    const layout = layoutMesh({ nodes, edges, focusKey: "task:2", meshProjectId: 4 });
    const parent = layout.nodes.find((item) => item.role === "parent");
    const focus = layout.nodes.find((item) => item.role === "focus");
    assert.equal(parent?.key, "task:1");
    assert.ok((parent?.centerY ?? 0) < (focus?.centerY ?? 0));
    assert.equal(parent?.centerX, focus?.centerX);
    assert.deepEqual(
      layout.ancestors.map((item) => item.key),
      ["project:4", "task:1", "task:2"],
    );
  });
});
