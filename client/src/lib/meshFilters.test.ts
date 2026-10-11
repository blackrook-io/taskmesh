import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterMeshGraph } from "./meshFilters.ts";
import type { MeshGraphEdge, MeshGraphNode } from "./meshLayout.ts";

function node(key: string, state: string | null = "ready"): MeshGraphNode {
  const [type, idRaw] = key.split(":");
  return {
    key,
    type: type ?? "task",
    id: Number(idRaw),
    referenceId: null,
    title: key,
    projectId: 4,
    state,
  };
}

describe("mesh graph filters", () => {
  const nodes = [
    node("project:4", null),
    node("task:1", "complete"),
    node("task:2", "ready"),
    node("task:3", "canceled"),
    node("document:8", "complete"),
  ];
  const edges: MeshGraphEdge[] = [
    { source: "project:4", target: "task:1", relation: "in_project" },
    { source: "project:4", target: "task:2", relation: "in_project" },
    { source: "project:4", target: "task:3", relation: "in_project" },
    { source: "project:4", target: "document:8", relation: "in_project" },
    { source: "task:2", target: "task:1", relation: "depends_on" },
  ];

  it("keeps a complete focus and drops other complete records", () => {
    const filtered = filterMeshGraph({
      nodes,
      edges,
      focusKey: "task:1",
      hideDone: true,
      hiddenTypes: new Set(),
    });
    const keys = filtered.nodes.map((item) => item.key);
    assert.deepEqual(keys, ["project:4", "task:1", "task:2", "task:3"]);
    assert.equal(
      filtered.edges.some((edge) => edge.source === "document:8" || edge.target === "document:8"),
      false,
    );
    assert.equal(
      filtered.edges.some((edge) => edge.source === "task:2" && edge.target === "task:1"),
      true,
    );
  });

  it("leaves canceled records when hide done is on", () => {
    const filtered = filterMeshGraph({
      nodes,
      edges,
      focusKey: "project:4",
      hideDone: true,
      hiddenTypes: new Set(),
    });
    assert.equal(
      filtered.nodes.some((item) => item.key === "task:3"),
      true,
    );
    assert.equal(
      filtered.nodes.some((item) => item.key === "task:1"),
      false,
    );
  });

  it("drops a hidden type except the focus", () => {
    const filtered = filterMeshGraph({
      nodes,
      edges,
      focusKey: "task:2",
      hideDone: false,
      hiddenTypes: new Set(["task"]),
    });
    assert.deepEqual(
      filtered.nodes.map((item) => item.key),
      ["project:4", "task:2", "document:8"],
    );
    assert.deepEqual(filtered.edges, [
      { source: "project:4", target: "task:2", relation: "in_project" },
      { source: "project:4", target: "document:8", relation: "in_project" },
    ]);
  });
});
