import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hiddenDescendantCount } from "./hiddenDescendantCount.ts";

function childrenOf(tree: Record<number, number[]>) {
  return (id: number) => (tree[id] ?? []).map((childId) => ({ id: childId }));
}

describe("hiddenDescendantCount", () => {
  it("counts every descendant, including grandchildren", () => {
    const kids = childrenOf({ 1: [2, 3], 2: [4], 3: [], 4: [] });
    assert.equal(hiddenDescendantCount(1, kids), 3);
    assert.equal(hiddenDescendantCount(2, kids), 1);
    assert.equal(hiddenDescendantCount(3, kids), 0);
  });

  it("reuses a shared cache across parents", () => {
    const kids = childrenOf({ 1: [2], 2: [3], 3: [] });
    const cache = new Map<number, number>();
    assert.equal(hiddenDescendantCount(1, kids, cache), 2);
    assert.equal(cache.get(2), 1);
    assert.equal(hiddenDescendantCount(2, kids, cache), 1);
  });

  it("stops on a cycle", () => {
    const kids = childrenOf({ 1: [2], 2: [1] });
    assert.equal(hiddenDescendantCount(1, kids), 2);
  });
});
