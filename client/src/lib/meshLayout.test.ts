import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterMeshGraph } from "./meshFilters.ts";
import {
  containmentParent,
  collapseMeshBand,
  layoutMesh,
  MESH_BOX_HEIGHT,
  MESH_COLUMN_PITCH,
  MESH_FOCUS_BOX_HEIGHT,
  MESH_LANE_GAP,
  MESH_NODE_WIDTH,
  meshEdgeHandles,
  meshNodesOverlap,
  meshOrthogonalPath,
  meshPortOffsets,
  type MeshGraphEdge,
  type MeshGraphNode,
  type MeshLayoutNode,
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
      layout.edges.some((edge) => edge.kind === "depends"),
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

  it("draws a depends-on line toward a placed prerequisite", () => {
    const nodes = [
      { ...node("task:1", "First", "T0001"), state: "ready" },
      node("task:2", "Needs", "T0002"),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "task:2", target: "task:1", relation: "child_of" },
      { source: "task:2", target: "task:1", relation: "depends_on" },
    ];
    const layout = layoutMesh({ nodes, edges, focusKey: "task:1", meshProjectId: 4 });
    const edge = layout.edges.find((item) => item.kind === "depends");
    assert.equal(edge?.target, "task:1");
    assert.equal(edge?.blocking, true);
  });

  it("does not draw a satisfied prerequisite as blocking", () => {
    for (const state of ["complete", "canceled", "pending", "deleted"]) {
      const nodes = [
        { ...node("task:1", "First", "T0001"), state },
        node("task:2", "Needs", "T0002"),
      ];
      const edges: MeshGraphEdge[] = [
        { source: "task:2", target: "task:1", relation: "child_of" },
        { source: "task:2", target: "task:1", relation: "depends_on" },
      ];
      const layout = layoutMesh({ nodes, edges, focusKey: "task:1", meshProjectId: 4 });
      const edge = layout.edges.find((item) => item.kind === "depends");
      assert.equal(edge?.blocking, false, state);
    }
  });

  it("hides reference lines and records that exist only as links", () => {
    const nodes = [
      node("project:4", "TaskMesh", "P0003"),
      node("task:1", "Work", "T0001"),
      node("idea:7", "Own link", "I0007"),
      node("document:8", "Inside link", "D0008", 9),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:1", relation: "in_project" },
      { source: "project:4", target: "idea:7", relation: "supports" },
      { source: "task:1", target: "document:8", relation: "references" },
    ];
    const layout = layoutMesh({
      nodes,
      edges,
      focusKey: "project:4",
      meshProjectId: 4,
      references: false,
    });
    const keys = layout.nodes.map((item) => item.key);
    assert.deepEqual(keys.sort(), ["project:4", "task:1"]);
    assert.equal(layout.edges.some((edge) => edge.kind === "link"), false);
    assert.deepEqual(layout.headings, []);
  });

  it("hides a depends-on line without removing the cascade", () => {
    const nodes = [
      { ...node("task:1", "First", "T0001"), state: "ready" },
      node("task:2", "Needs", "T0002"),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "task:2", target: "task:1", relation: "child_of" },
      { source: "task:2", target: "task:1", relation: "depends_on" },
    ];
    const layout = layoutMesh({
      nodes,
      edges,
      focusKey: "task:1",
      meshProjectId: 4,
      dependsOn: false,
    });
    assert.equal(layout.nodes.some((item) => item.key === "task:2"), true);
    assert.equal(layout.edges.some((edge) => edge.kind === "depends"), false);
  });

  it("places a suggestion beside the focus and a dotted join", () => {
    const nodes = [
      node("project:4", "TaskMesh", "P0003"),
      node("task:1", "Work", "T0001"),
      node("idea:7", "Own link", "I0007"),
      node("document:9", "Maybe", "N0009"),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:1", relation: "in_project" },
      { source: "project:4", target: "idea:7", relation: "supports" },
    ];
    const layout = layoutMesh({
      nodes,
      edges,
      focusKey: "project:4",
      meshProjectId: 4,
      suggestions: [
        {
          sourceKey: "document:9",
          targetKey: "project:4",
          confidence: 72,
          reason: "shared tags",
        },
      ],
    });
    const byKey = new Map(layout.nodes.map((item) => [item.key, item]));
    const link = byKey.get("idea:7");
    const ghost = byKey.get("document:9");
    assert.equal(ghost?.role, "suggestion");
    assert.equal(ghost?.lane, "band");
    assert.ok((ghost?.centerX ?? 0) > (link?.centerX ?? 0));
    const edge = layout.edges.find((item) => item.kind === "suggested");
    assert.equal(edge?.source, "document:9");
    assert.equal(edge?.target, "project:4");
    assert.equal(meshNodesOverlap(layout.nodes), false);
  });

  it("places a cascade suggestion on the rail under Suggested by AI", () => {
    const nodes = [
      node("project:4", "TaskMesh", "P0003"),
      node("task:1", "Work", "T0001"),
      node("document:9", "Maybe", "N0009"),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:1", relation: "in_project" },
    ];
    const layout = layoutMesh({
      nodes,
      edges,
      focusKey: "project:4",
      meshProjectId: 4,
      suggestions: [
        {
          sourceKey: "document:9",
          targetKey: "task:1",
          confidence: 40,
          reason: "title mention",
        },
      ],
    });
    const ghost = layout.nodes.find((item) => item.key === "document:9");
    assert.equal(ghost?.role, "suggestion");
    assert.equal(ghost?.lane, "rail");
    assert.deepEqual(
      layout.headings.map((item) => item.text),
      ["Suggested by AI"],
    );
    assert.equal(layout.headings[0]?.tone, "ai");
    assert.equal(layout.edges.some((edge) => edge.kind === "suggested" && edge.target === "task:1"), true);
  });

  it("draws a suggestion line to a record that is already placed", () => {
    const nodes = [
      node("project:4", "TaskMesh", "P0003"),
      node("task:1", "Work", "T0001"),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:1", relation: "in_project" },
    ];
    const layout = layoutMesh({
      nodes,
      edges,
      focusKey: "project:4",
      meshProjectId: 4,
      suggestions: [
        { sourceKey: "task:1", targetKey: "project:4", confidence: 10, reason: "same list" },
      ],
    });
    assert.equal(layout.nodes.filter((item) => item.key === "task:1").length, 1);
    assert.equal(layout.nodes.find((item) => item.key === "task:1")?.role, "child");
    assert.equal(layout.edges.some((edge) => edge.kind === "suggested"), true);
  });
});

describe("mesh edge handles", () => {
  it("keeps a rightward line on the right-to-left ports", () => {
    assert.deepEqual(meshEdgeHandles(0, MESH_COLUMN_PITCH), { sourceHandle: "r", targetHandle: "l" });
  });

  it("leaves a leftward line on the left and enters on the right", () => {
    assert.deepEqual(meshEdgeHandles(MESH_COLUMN_PITCH, 0), {
      sourceHandle: "l-out",
      targetHandle: "r-in",
    });
  });

  it("brackets a same-column line on the right", () => {
    assert.deepEqual(meshEdgeHandles(100, 100), { sourceHandle: "r", targetHandle: "r-in" });
    assert.deepEqual(meshEdgeHandles(0, MESH_COLUMN_PITCH / 2 - 1), {
      sourceHandle: "r",
      targetHandle: "r-in",
    });
  });

  it("uses those handles for depends lines in a cascade", () => {
    const nodes = [
      node("project:4", "TaskMesh", "P0003"),
      node("task:1", "Parent", "T0001"),
      node("task:2", "Child", "T0002"),
      node("task:3", "Leaf", "T0003"),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:1", relation: "in_project" },
      { source: "project:4", target: "task:3", relation: "in_project" },
      { source: "task:2", target: "task:1", relation: "child_of" },
      { source: "task:2", target: "task:1", relation: "depends_on" },
      { source: "task:1", target: "task:3", relation: "depends_on" },
      { source: "task:3", target: "task:1", relation: "depends_on" },
    ];
    const layout = layoutMesh({ nodes, edges, focusKey: "project:4", meshProjectId: 4 });
    const byId = new Map(layout.edges.filter((edge) => edge.kind === "depends").map((edge) => [edge.id, edge]));
    const sameColumn = byId.get("d:task:2:task:1");
    const rightward = byId.get("d:task:1:task:3");
    const leftward = byId.get("d:task:3:task:1");
    assert.equal(sameColumn?.sourceHandle, "r");
    assert.equal(sameColumn?.targetHandle, "r-in");
    assert.equal(rightward?.sourceHandle, "r");
    assert.equal(rightward?.targetHandle, "l");
    assert.equal(leftward?.sourceHandle, "l-out");
    assert.equal(leftward?.targetHandle, "r-in");
  });
});

describe("mesh line lanes", () => {
  it("orders ports by the other end's y", () => {
    assert.deepEqual(meshPortOffsets([30, 10, 20]), [8, -8, 0]);
  });

  it("gives two lines in one gutter lane x values 10px apart", () => {
    const nodes = [
      node("project:4", "TaskMesh", "P0003"),
      node("task:1", "Head A", "T0001"),
      node("task:10", "Child A", "T0010"),
      node("task:2", "Head B", "T0002"),
      node("task:20", "Child B", "T0020"),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:1", relation: "in_project" },
      { source: "project:4", target: "task:2", relation: "in_project" },
      { source: "task:10", target: "task:1", relation: "child_of" },
      { source: "task:20", target: "task:2", relation: "child_of" },
      { source: "task:1", target: "task:2", relation: "depends_on" },
      { source: "task:10", target: "task:2", relation: "depends_on" },
    ];
    const layout = layoutMesh({ nodes, edges, focusKey: "project:4", meshProjectId: 4 });
    const lanes = layout.edges
      .filter((edge) => edge.kind === "depends")
      .map((edge) => edge.laneX)
      .sort((a, b) => a - b);
    assert.equal(lanes.length, 2);
    assert.equal((lanes[1] ?? 0) - (lanes[0] ?? 0), MESH_LANE_GAP);
    const centers = new Set(layout.nodes.map((item) => item.centerX));
    assert.equal(centers.has(lanes[0]!), false);
    assert.equal(centers.has(lanes[1]!), false);
    const headB = layout.nodes.find((item) => item.key === "task:2");
    const arrivals = layout.edges
      .filter((edge) => edge.kind === "depends" && edge.target === "task:2")
      .map((edge) => ({
        y: layout.nodes.find((item) => item.key === edge.source)?.centerY ?? 0,
        offset: edge.targetOffset,
      }))
      .sort((a, b) => a.y - b.y);
    assert.equal(arrivals.length, 2);
    assert.ok((arrivals[0]?.offset ?? 0) < (arrivals[1]?.offset ?? 0));
    assert.equal(meshNodesOverlap(layout.nodes), false);
    assert.equal(headB != null, true);
  });

  it("shifts the next column when a gutter cannot hold every line", () => {
    const nodes = [
      node("project:4", "TaskMesh", "P0003"),
      node("task:1", "Head A", "T0001"),
      node("task:10", "A1", "T0010"),
      node("task:11", "A2", "T0011"),
      node("task:12", "A3", "T0012"),
      node("task:13", "A4", "T0013"),
      node("task:2", "Head B", "T0002"),
      node("task:20", "B1", "T0020"),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:1", relation: "in_project" },
      { source: "project:4", target: "task:2", relation: "in_project" },
      { source: "task:10", target: "task:1", relation: "child_of" },
      { source: "task:11", target: "task:1", relation: "child_of" },
      { source: "task:12", target: "task:1", relation: "child_of" },
      { source: "task:13", target: "task:1", relation: "child_of" },
      { source: "task:20", target: "task:2", relation: "child_of" },
      { source: "task:1", target: "task:2", relation: "depends_on" },
      { source: "task:10", target: "task:2", relation: "depends_on" },
      { source: "task:11", target: "task:2", relation: "depends_on" },
      { source: "task:12", target: "task:2", relation: "depends_on" },
      { source: "task:13", target: "task:2", relation: "depends_on" },
    ];
    const layout = layoutMesh({ nodes, edges, focusKey: "project:4", meshProjectId: 4 });
    const headA = layout.nodes.find((item) => item.key === "task:1");
    const headB = layout.nodes.find((item) => item.key === "task:2");
    assert.equal((headB?.centerX ?? 0) - (headA?.centerX ?? 0), MESH_COLUMN_PITCH + 40);
    const lanes = layout.edges
      .filter((edge) => edge.kind === "depends")
      .map((edge) => edge.laneX)
      .sort((a, b) => a - b);
    assert.equal(new Set(lanes).size, 5);
    for (let index = 1; index < lanes.length; index += 1) {
      assert.equal((lanes[index] ?? 0) - (lanes[index - 1] ?? 0), MESH_LANE_GAP);
    }
    assert.equal(
      layout.tree.some((path) => path.startsWith(`M${headB?.centerX},`)),
      true,
    );
    assert.equal(meshNodesOverlap(layout.nodes), false);
  });

  it("rounds an orthogonal step", () => {
    assert.match(meshOrthogonalPath(0, 0, 80, 40, 40), /A/);
  });
});

function boxBottom(node: MeshLayoutNode): number {
  return node.y + (node.role === "focus" ? MESH_FOCUS_BOX_HEIGHT : MESH_BOX_HEIGHT);
}

describe("mesh trunk corridor", () => {
  it("keeps a rail line under the columns and out of the next column", () => {
    const nodes = [
      node("project:4", "TaskMesh", "P0003"),
      node("task:1", "Head A", "T0001"),
      node("task:10", "Child A", "T0010"),
      node("task:2", "Head B", "T0002"),
      node("task:20", "Child B", "T0020"),
      node("document:8", "Inside", "D0008", 9),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:1", relation: "in_project" },
      { source: "project:4", target: "task:2", relation: "in_project" },
      { source: "task:10", target: "task:1", relation: "child_of" },
      { source: "task:20", target: "task:2", relation: "child_of" },
      { source: "task:10", target: "document:8", relation: "references" },
    ];
    const layout = layoutMesh({ nodes, edges, focusKey: "project:4", meshProjectId: 4 });
    const columns = layout.nodes.filter((item) => item.role === "child" || item.role === "grandchild");
    const link = layout.edges.find((edge) => edge.id === "l:task:10:document:8:references");
    const headB = layout.nodes.find((item) => item.key === "task:2");
    const childA = layout.nodes.find((item) => item.key === "task:10");
    assert.ok(link?.corridor);
    const corridorY = link?.corridor?.corridorY ?? 0;
    assert.ok(columns.every((item) => corridorY > boxBottom(item)));
    assert.ok((link?.corridor?.dropX ?? 0) > (childA?.x ?? 0) + MESH_NODE_WIDTH);
    assert.ok((link?.corridor?.dropX ?? 0) < (headB?.x ?? 0));
    assert.equal(meshNodesOverlap(layout.nodes), false);
  });

  it("draws one trunk when four lines share a rail record", () => {
    const nodes = [
      node("project:4", "TaskMesh", "P0003"),
      node("task:1", "Head A", "T0001"),
      node("task:10", "A1", "T0010"),
      node("task:11", "A2", "T0011"),
      node("task:12", "A3", "T0012"),
      node("task:2", "Head B", "T0002"),
      node("task:20", "B1", "T0020"),
      node("document:8", "Inside", "D0008", 9),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:1", relation: "in_project" },
      { source: "project:4", target: "task:2", relation: "in_project" },
      { source: "task:10", target: "task:1", relation: "child_of" },
      { source: "task:11", target: "task:1", relation: "child_of" },
      { source: "task:12", target: "task:1", relation: "child_of" },
      { source: "task:20", target: "task:2", relation: "child_of" },
      { source: "task:1", target: "document:8", relation: "references" },
      { source: "task:10", target: "document:8", relation: "references" },
      { source: "task:11", target: "document:8", relation: "references" },
      { source: "task:12", target: "document:8", relation: "references" },
    ];
    const layout = layoutMesh({ nodes, edges, focusKey: "project:4", meshProjectId: 4 });
    const members = layout.edges.filter((edge) => edge.target === "document:8" && edge.trunkCount == null);
    const trunk = layout.edges.find((edge) => edge.id === "trunk:document:8");
    assert.equal(members.length, 4);
    assert.ok(members.every((edge) => edge.bundled && edge.corridor));
    assert.equal(new Set(members.map((edge) => Math.round(edge.corridor?.arrivalX ?? 0))).size, 4);
    assert.equal(trunk?.trunkCount, 4);
    assert.equal(trunk?.bundled, false);
    const columns = layout.nodes.filter((item) => item.role === "child" || item.role === "grandchild");
    assert.ok(
      members.every((edge) => columns.every((item) => (edge.corridor?.corridorY ?? 0) > boxBottom(item))),
    );
    assert.equal(meshNodesOverlap(layout.nodes), false);
  });

  it("runs a far band link under the columns", () => {
    const nodes = [
      node("project:4", "TaskMesh", "P0003"),
      node("task:1", "Head", "T0001"),
      node("task:10", "Child", "T0010"),
      node("idea:7", "Own link", "I0007", null),
    ];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:1", relation: "in_project" },
      { source: "task:10", target: "task:1", relation: "child_of" },
      { source: "project:4", target: "idea:7", relation: "supports" },
    ];
    const layout = layoutMesh({ nodes, edges, focusKey: "project:4", meshProjectId: 4 });
    const link = layout.edges.find((edge) => edge.target === "idea:7" || edge.source === "idea:7");
    const columns = layout.nodes.filter((item) => item.role === "child" || item.role === "grandchild");
    const band = layout.nodes.find((item) => item.key === "idea:7");
    assert.equal(band?.role, "link");
    assert.ok(link?.corridor);
    assert.ok(columns.every((item) => (link?.corridor?.corridorY ?? 0) > boxBottom(item)));
    assert.ok(Math.abs((band?.centerX ?? 0) - (layout.nodes.find((item) => item.role === "focus")?.centerX ?? 0)) > MESH_COLUMN_PITCH / 2);
    assert.equal(meshNodesOverlap(layout.nodes), false);
  });
});

function many(
  type: string,
  count: number,
  start = 1,
  state: string | null = null,
): MeshGraphNode[] {
  return Array.from({ length: count }, (_, index) => {
    const id = start + index;
    return { ...node(`${type}:${id}`, `${type} ${id}`, null), state };
  });
}

describe("mesh group nodes", () => {
  it("leaves twelve records of one type in a column", () => {
    const tasks = many("task", 12);
    const nodes = [node("project:4", "TaskMesh", "P0003"), ...tasks];
    const edges: MeshGraphEdge[] = tasks.map((task) => ({
      source: "project:4",
      target: task.key,
      relation: "in_project",
    }));
    const layout = layoutMesh({ nodes, edges, focusKey: "project:4", meshProjectId: 4 });
    assert.equal(layout.nodes.some((item) => item.group), false);
    assert.equal(layout.nodes.filter((item) => item.type === "task").length, 12);
  });

  it("collapses a column past twelve and keeps the column head", () => {
    const grands = many("task", 13, 2);
    const nodes = [node("project:4", "TaskMesh", "P0003"), node("task:1", "Head", "T0001"), ...grands];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:1", relation: "in_project" },
      ...grands.map((task) => ({ source: task.key, target: "task:1", relation: "child_of" as const })),
    ];
    const layout = layoutMesh({ nodes, edges, focusKey: "project:4", meshProjectId: 4 });
    const head = layout.nodes.find((item) => item.key === "task:1");
    const group = layout.nodes.find((item) => item.group);
    assert.equal(head?.role, "child");
    assert.equal(head?.group, null);
    assert.equal(group?.key, "group:column:0:task");
    assert.equal(group?.title, "13 tasks");
    assert.equal(group?.role, "grandchild");
    assert.equal(group?.group?.expanded, false);
    assert.equal(
      layout.nodes.some((item) => item.key.startsWith("task:") && item.key !== "task:1"),
      false,
    );
    assert.equal(meshNodesOverlap(layout.nodes), false);
  });

  it("judges each type on its own and redraws lines onto the group", () => {
    const tasks = many("task", 13);
    const docs = many("document", 3, 1);
    const nodes = [node("project:4", "TaskMesh", "P0003"), node("task:100", "Anchor", "T0100"), ...tasks, ...docs];
    const edges: MeshGraphEdge[] = [
      { source: "project:4", target: "task:100", relation: "in_project" },
      ...docs.map((doc) => ({ source: "task:100", target: doc.key, relation: "references" as const })),
      ...tasks.map((task) => ({ source: "task:100", target: task.key, relation: "references" as const })),
    ];
    const layout = layoutMesh({ nodes, edges, focusKey: "project:4", meshProjectId: 4 });
    const groups = layout.nodes.filter((item) => item.group);
    assert.deepEqual(groups.map((item) => item.title), ["13 tasks"]);
    assert.equal(layout.nodes.filter((item) => item.type === "document" && item.role === "rail").length, 3);
    const ontoGroup = layout.edges.filter((edge) => edge.source === "group:rail:task" || edge.target === "group:rail:task");
    assert.equal(ontoGroup.length, 1);
    assert.equal(ontoGroup[0]?.source, "task:100");
    assert.equal(layout.edges.some((edge) => edge.source.startsWith("task:") && edge.target.startsWith("task:") && edge.target !== "group:rail:task"), false);
  });

  it("places members under an expanded group and restores their lines", () => {
    const ideas = many("idea", 13);
    const nodes = [node("project:4", "TaskMesh", "P0003"), ...ideas];
    const edges: MeshGraphEdge[] = ideas.map((idea) => ({
      source: "project:4",
      target: idea.key,
      relation: "supports",
    }));
    const collapsed = layoutMesh({ nodes, edges, focusKey: "project:4", meshProjectId: 4 });
    assert.equal(collapsed.nodes.filter((item) => item.role === "link").length, 1);
    assert.equal(collapsed.edges.filter((edge) => edge.kind === "link").length, 1);
    assert.equal(collapsed.edges[0]?.target, "group:link:idea");

    const layout = layoutMesh({
      nodes,
      edges,
      focusKey: "project:4",
      meshProjectId: 4,
      expandedGroups: new Set(["group:link:idea"]),
    });
    const group = layout.nodes.find((item) => item.key === "group:link:idea");
    assert.equal(group?.group?.expanded, true);
    assert.equal(layout.nodes.filter((item) => item.key.startsWith("idea:")).length, 13);
    assert.equal(layout.edges.filter((edge) => edge.kind === "link" && edge.target.startsWith("idea:")).length, 13);
    assert.equal(meshNodesOverlap(layout.nodes), false);
  });

  it("keeps the focused record out of the group", () => {
    const items = [node("task:1", "Focus", "T0001"), ...many("task", 13, 2)];
    const slots = collapseMeshBand("rail", items, "task:1");
    assert.equal(slots[0]?.kind, "record");
    assert.equal(slots[0]?.kind === "record" ? slots[0].node.key : "", "task:1");
    const group = slots.find((slot) => slot.kind === "group");
    assert.equal(group?.kind === "group" ? group.count : 0, 13);
    assert.equal(group?.kind === "group" ? group.memberKeys.includes("task:1") : true, false);
  });

  it("counts the graph after hide-done and type filters", () => {
    const tasks = [
      ...many("task", 11, 1, "ready"),
      ...many("task", 2, 12, "complete"),
    ];
    const nodes = [node("project:4", "TaskMesh", "P0003"), ...tasks];
    const edges: MeshGraphEdge[] = tasks.map((task) => ({
      source: "project:4",
      target: task.key,
      relation: "in_project",
    }));
    const hidden = filterMeshGraph({
      nodes,
      edges,
      focusKey: "project:4",
      hideDone: true,
      hiddenTypes: new Set(),
    });
    const filtered = layoutMesh({
      nodes: hidden.nodes,
      edges: hidden.edges,
      focusKey: "project:4",
      meshProjectId: 4,
    });
    assert.equal(filtered.nodes.some((item) => item.group), false);
    assert.equal(filtered.nodes.filter((item) => item.type === "task").length, 11);

    const typed = filterMeshGraph({
      nodes,
      edges,
      focusKey: "project:4",
      hideDone: false,
      hiddenTypes: new Set(["task"]),
    });
    const withoutTasks = layoutMesh({
      nodes: typed.nodes,
      edges: typed.edges,
      focusKey: "project:4",
      meshProjectId: 4,
    });
    assert.equal(withoutTasks.nodes.some((item) => item.type === "task" || item.group), false);
  });
});
