import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hiddenClosedCounts,
  isHiddenClosedSubtree,
  rollupMeterTitle,
} from "./hideCompletedTasks.ts";

type Node = { id: number; state: string };

function childrenOf(nodes: Node[], tree: Record<number, number[]>) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (id: number) => (tree[id] ?? []).map((childId) => byId.get(childId)!);
}

describe("isHiddenClosedSubtree", () => {
  const nodes: Node[] = [
    { id: 1, state: "ready" },
    { id: 2, state: "complete" },
    { id: 3, state: "ready" },
    { id: 4, state: "complete" },
    { id: 5, state: "in_progress" },
    { id: 6, state: "canceled" },
    { id: 7, state: "complete" },
    { id: 8, state: "ready" },
    { id: 9, state: "canceled" },
    { id: 10, state: "in_progress" },
  ];

  it("hides a complete leaf and keeps a mixed parent", () => {
    const kids = childrenOf(nodes, { 1: [2, 3], 2: [], 3: [] });
    assert.equal(isHiddenClosedSubtree(nodes[1]!, kids), true);
    assert.equal(isHiddenClosedSubtree(nodes[0]!, kids), false);
    assert.deepEqual(hiddenClosedCounts(1, kids), { completed: 1, canceled: 0 });
  });

  it("hides a parent whose descendants are all complete", () => {
    const kids = childrenOf(nodes, { 5: [2, 4], 2: [], 4: [] });
    assert.equal(isHiddenClosedSubtree(nodes[4]!, kids), true);
    assert.deepEqual(hiddenClosedCounts(5, kids), { completed: 2, canceled: 0 });
  });

  it("keeps a complete parent that still has an open grandchild", () => {
    const kids = childrenOf(nodes, { 7: [5], 5: [3], 3: [] });
    assert.equal(isHiddenClosedSubtree(nodes[6]!, kids), false);
    assert.equal(isHiddenClosedSubtree(nodes[4]!, kids), false);
    assert.deepEqual(hiddenClosedCounts(7, kids), { completed: 0, canceled: 0 });
  });

  it("hides a canceled leaf and a canceled parent only when its subtree is closed", () => {
    const kids = childrenOf(nodes, { 1: [6, 9], 6: [], 9: [8], 8: [] });
    assert.equal(isHiddenClosedSubtree(nodes[5]!, kids), true);
    assert.equal(isHiddenClosedSubtree(nodes[8]!, kids), false);
    assert.deepEqual(hiddenClosedCounts(1, kids), { completed: 0, canceled: 1 });
  });

  it("counts nested closed tasks omitted under a visible parent", () => {
    const kids = childrenOf(nodes, { 1: [7, 3], 7: [4], 4: [], 3: [] });
    assert.equal(isHiddenClosedSubtree(nodes[0]!, kids), false);
    assert.equal(isHiddenClosedSubtree(nodes[6]!, kids), true);
    assert.deepEqual(hiddenClosedCounts(1, kids), { completed: 2, canceled: 0 });
  });
});

describe("rollupMeterTitle", () => {
  it("keeps the fraction when nothing is hidden", () => {
    assert.equal(rollupMeterTitle(3, 4, { completed: 0, canceled: 0 }), "3 of 4 complete");
    assert.equal(rollupMeterTitle(3, 4, null), "3 of 4 complete");
  });

  it("appends non-zero hidden counts", () => {
    assert.equal(
      rollupMeterTitle(3, 4, { completed: 3, canceled: 1 }),
      "3 of 4 complete. Hidden: 3 Completed, 1 Canceled",
    );
    assert.equal(
      rollupMeterTitle(1, 2, { completed: 0, canceled: 1 }),
      "1 of 2 complete. Hidden: 1 Canceled",
    );
  });
});
