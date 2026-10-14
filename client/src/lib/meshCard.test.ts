import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMeshCard, buildMeshSuggestionCard, type MeshCardNode } from "./meshCard.ts";

const today = new Date("2026-10-11T12:00:00.000Z");

function node(partial: Partial<MeshCardNode> & Pick<MeshCardNode, "key" | "title">): MeshCardNode {
  return { type: "task", state: "ready", ...partial };
}

describe("mesh hover card", () => {
  it("shows overdue, at risk, and days left on the due line", () => {
    const overdue = buildMeshCard({
      node: node({ key: "task:1", title: "Late", dueDate: "2026-10-01", referenceId: "T0001" }),
      nodes: [],
      edges: [],
      today,
      staleDays: 30,
      isFocus: false,
    });
    assert.equal(overdue.rows.find((row) => row.label === "Due")?.value, "Oct 1 · 10 days overdue");
    assert.equal(overdue.rows.find((row) => row.label === "Due")?.tone, "danger");

    const risk = buildMeshCard({
      node: node({
        key: "todo:1",
        type: "todo",
        title: "Slow",
        state: "in_progress",
        dueDate: "2026-10-20",
        createdAt: "2026-09-01T12:00:00.000Z",
        progress: 10,
      }),
      nodes: [],
      edges: [],
      today,
      staleDays: 30,
      isFocus: false,
    });
    const due = risk.rows.find((row) => row.label === "Due");
    assert.match(due?.value ?? "", /at risk, \d+% of time used/);
    assert.equal(due?.tone, "warning");

    const ok = buildMeshCard({
      node: node({
        key: "todo:2",
        title: "Fine",
        state: "in_progress",
        dueDate: "2026-12-01",
        createdAt: "2026-10-01T12:00:00.000Z",
        progress: 80,
      }),
      nodes: [],
      edges: [],
      today,
      staleDays: 30,
      isFocus: false,
    });
    assert.match(ok.rows.find((row) => row.label === "Due")?.value ?? "", /days left$/);
  });

  it("pairs a comment with its update and keeps a later comment separate", () => {
    const together = buildMeshCard({
      node: node({
        key: "task:1",
        title: "Labs",
        signalAt: "2026-10-09T12:00:00.000Z",
        lastUpdate: {
          at: "2026-10-05T12:00:00.000Z",
          field: "progress",
          oldValue: "60",
          newValue: "70",
        },
        lastComment: { at: "2026-10-05T12:00:30.000Z", excerpt: "Slowing down to lab it.", withUpdate: true },
      }),
      nodes: [],
      edges: [],
      today,
      staleDays: 30,
      isFocus: false,
    });
    const update = together.rows.find((row) => row.label === "Last update");
    assert.equal(update?.value, "6 days ago · Progress 60 → 70");
    assert.equal(update?.quote, "Slowing down to lab it.");
    assert.equal(together.rows.some((row) => row.label === "Last comment"), false);

    const apart = buildMeshCard({
      node: node({
        key: "task:2",
        title: "Notes",
        lastUpdate: { at: "2026-10-03T12:00:00.000Z", field: "body", oldValue: null, newValue: null },
        lastComment: { at: "2026-10-10T12:00:00.000Z", excerpt: "Add the matrix.", withUpdate: false },
      }),
      nodes: [],
      edges: [],
      today,
      staleDays: 30,
      isFocus: false,
    });
    assert.equal(apart.rows.find((row) => row.label === "Last update")?.value, "8 days ago · Content edited");
    assert.equal(
      apart.rows.find((row) => row.label === "Last comment")?.value,
      "yesterday · Add the matrix.",
    );
  });

  it("marks a quiet update stale and omits an update when none was recorded", () => {
    const stale = buildMeshCard({
      node: node({
        key: "task:1",
        title: "Old",
        state: "ready",
        signalAt: "2026-08-01T12:00:00.000Z",
        lastUpdate: { at: "2026-08-01T12:00:00.000Z", field: "state", oldValue: "Draft", newValue: "Ready" },
      }),
      nodes: [],
      edges: [],
      today,
      staleDays: 30,
      isFocus: false,
    });
    const row = stale.rows.find((item) => item.label === "Last update");
    assert.match(row?.value ?? "", /· stale$/);
    assert.equal(row?.tone, "warning");

    const fresh = buildMeshCard({
      node: node({ key: "task:3", title: "New", signalAt: "2026-01-01T12:00:00.000Z" }),
      nodes: [],
      edges: [],
      today,
      staleDays: 30,
      isFocus: true,
    });
    assert.equal(fresh.rows.some((item) => item.label === "Last update"), false);
    assert.equal(fresh.hint, "This is the focused record.");
  });

  it("rolls up direct children and loaded descendants", () => {
    const nodes = [
      node({ key: "list:1", type: "todo_list", title: "List" }),
      node({ key: "task:1", title: "Done", state: "complete" }),
      node({
        key: "task:2",
        title: "Late",
        state: "ready",
        dueDate: "2026-10-01",
        signalAt: "2026-08-01T12:00:00.000Z",
      }),
      node({ key: "task:3", title: "Grandchild", state: "ready", dueDate: "2026-10-01" }),
    ];
    const edges = [
      { source: "list:1", target: "task:1", relation: "in_list" },
      { source: "list:1", target: "task:2", relation: "in_list" },
      { source: "task:3", target: "task:2", relation: "child_of" },
    ];
    const card = buildMeshCard({
      node: nodes[0]!,
      nodes,
      edges,
      today,
      staleDays: 30,
      isFocus: false,
    });
    const inside = card.rows.find((row) => row.label === "Inside");
    assert.equal(inside?.value, "1 of 2 done · 2 overdue · 1 stale");
    assert.equal(inside?.tone, "danger");
    assert.equal(card.hint, "Click to cascade its contents underneath.");
  });

  it("lists open blockers and counts references and dependencies", () => {
    const nodes = [
      node({ key: "task:1", title: "Blocked", referenceId: "T0001" }),
      node({ key: "task:9", title: "Setup", referenceId: "T0009", state: "in_progress" }),
      node({ key: "task:8", title: "Done dep", referenceId: "T0008", state: "complete" }),
      node({ key: "document:1", type: "document", title: "Notes", referenceId: "N0001" }),
    ];
    const edges = [
      { source: "task:1", target: "task:9", relation: "depends_on" },
      { source: "task:1", target: "task:8", relation: "depends_on" },
      { source: "document:1", target: "task:1", relation: "references" },
      { source: "task:1", target: "document:1", relation: "relates_to" },
    ];
    const card = buildMeshCard({
      node: nodes[0]!,
      nodes,
      edges,
      today,
      staleDays: 30,
      isFocus: false,
    });
    assert.equal(card.rows.find((row) => row.label === "Blocked by")?.value, "T0009 Setup");
    assert.equal(card.rows.find((row) => row.label === "Links")?.value, "2 references · 2 dependencies");
    assert.equal(card.hint, "Click to focus and see its links.");
    assert.match(card.description, /T0001 Task/);
    assert.match(card.description, /Blocked by/);
  });

  it("omits canceled, pending, and deleted prerequisites from Blocked by", () => {
    const nodes = [
      node({ key: "task:1", title: "Blocked", referenceId: "T0001" }),
      node({ key: "task:9", title: "Setup", referenceId: "T0009", state: "in_progress" }),
      node({ key: "task:8", title: "Done dep", referenceId: "T0008", state: "complete" }),
      node({ key: "task:7", title: "Dropped", referenceId: "T0007", state: "canceled" }),
      node({ key: "task:6", title: "Waiting", referenceId: "T0006", state: "pending" }),
      node({ key: "task:5", title: "Gone", referenceId: "T0005", state: "deleted" }),
    ];
    const edges = [
      { source: "task:1", target: "task:9", relation: "depends_on" },
      { source: "task:1", target: "task:8", relation: "depends_on" },
      { source: "task:1", target: "task:7", relation: "depends_on" },
      { source: "task:1", target: "task:6", relation: "depends_on" },
      { source: "task:1", target: "task:5", relation: "depends_on" },
    ];
    const card = buildMeshCard({
      node: nodes[0]!,
      nodes,
      edges,
      today,
      staleDays: 30,
      isFocus: false,
    });
    assert.equal(card.rows.find((row) => row.label === "Blocked by")?.value, "T0009 Setup");
  });

  it("adds a suggested count when a proposal touches the record", () => {
    const card = buildMeshCard({
      node: node({ key: "task:1", title: "Focus", referenceId: "T0001" }),
      nodes: [node({ key: "task:1", title: "Focus", referenceId: "T0001" })],
      edges: [],
      today,
      staleDays: 30,
      isFocus: true,
      suggestions: [{ sourceKey: "document:2", targetKey: "task:1" }],
    });
    assert.equal(card.rows.find((row) => row.label === "Links")?.value, "1 suggested");
  });

  it("builds an accept and dismiss card for a suggestion", () => {
    const nodes = [
      node({ key: "document:2", type: "document", title: "Notes", referenceId: "N0002" }),
      node({ key: "task:1", title: "Focus", referenceId: "T0001" }),
    ];
    const card = buildMeshSuggestionCard({
      node: { ...nodes[0]!, projectLabel: "P0009" },
      nodes,
      suggestions: [
        {
          sourceKey: "document:2",
          targetKey: "task:1",
          confidence: 64,
          reason: "shared tags",
        },
      ],
    });
    assert.equal(card?.projectNote, "From P0009");
    assert.equal(card?.items[0]?.targetLabel, "T0001 Focus");
    assert.equal(card?.items[0]?.confidence, 64);
    assert.equal(card?.items[0]?.reason, "shared tags");
    assert.match(card?.description ?? "", /Apply/);
    assert.match(card?.description ?? "", /Dismiss/);
    assert.match(card?.description ?? "", /64% match/);
  });
});
