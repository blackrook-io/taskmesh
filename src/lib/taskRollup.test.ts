import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countedLeafStates,
  derivedParentState,
  derivedStatePatchRejected,
  rollupUpdates,
  type RollupNode,
} from "./taskRollup.js";

function node(
  id: number,
  parentId: number | null,
  state: string,
  extra: Partial<RollupNode> = {},
): RollupNode {
  return {
    id,
    parentId,
    state,
    stateManual: false,
    rollupDone: null,
    rollupTotal: null,
    ...extra,
  };
}

describe("derivedParentState", () => {
  it("follows the locked precedence", () => {
    assert.equal(derivedParentState(["complete", "complete"]), "complete");
    assert.equal(derivedParentState(["complete", "blocked"]), "blocked");
    assert.equal(derivedParentState(["complete", "ready"]), "in_progress");
    assert.equal(derivedParentState(["in_progress", "ready"]), "in_progress");
    assert.equal(derivedParentState(["pending"]), "in_progress");
    assert.equal(derivedParentState(["on_hold", "ready"]), "on_hold");
    assert.equal(derivedParentState(["new", "ready"]), "new");
    assert.equal(derivedParentState(["ready", "ready"]), "ready");
  });
});

describe("countedLeafStates", () => {
  it("counts descendant leaves and skips canceled, deleted, and groups", () => {
    const nodes = [
      node(1, null, "new"),
      node(2, 1, "new"),
      node(3, 2, "complete"),
      node(4, 2, "ready"),
      node(5, 1, "complete"),
      node(6, 1, "canceled"),
      node(7, 1, "deleted"),
    ];
    assert.deepEqual(countedLeafStates(1, nodes).sort(), ["complete", "complete", "ready"]);
    assert.deepEqual(countedLeafStates(2, nodes).sort(), ["complete", "ready"]);
    assert.deepEqual(countedLeafStates(5, nodes), []);
  });

  it("treats a parent of only canceled children as not derived", () => {
    const nodes = [node(1, null, "ready"), node(2, 1, "canceled")];
    assert.deepEqual(countedLeafStates(1, nodes), []);
  });
});

describe("rollupUpdates", () => {
  it("writes the same fraction and status on a group and its epic", () => {
    const nodes = [
      node(1, null, "new"),
      node(2, 1, "new"),
      node(3, 2, "complete"),
      node(4, 2, "complete"),
      node(5, 2, "complete"),
      node(6, 2, "new"),
    ];
    const updates = rollupUpdates(nodes, [6]);
    const byId = new Map(updates.map((row) => [row.id, row]));
    assert.equal(byId.get(6), undefined);
    assert.deepEqual(byId.get(2), {
      id: 2,
      state: "in_progress",
      rollupDone: 3,
      rollupTotal: 4,
    });
    assert.deepEqual(byId.get(1), {
      id: 1,
      state: "in_progress",
      rollupDone: 3,
      rollupTotal: 4,
    });
  });

  it("keeps a manual parent's stored state and still refreshes the count", () => {
    const nodes = [
      node(1, null, "ready", { stateManual: true }),
      node(2, 1, "complete"),
    ];
    assert.deepEqual(rollupUpdates(nodes, [2]), [
      { id: 1, state: "ready", rollupDone: 1, rollupTotal: 1 },
    ]);
  });

  it("clears the rollup when the last counted leaf is removed", () => {
    const nodes = [
      node(1, null, "in_progress", { rollupDone: 1, rollupTotal: 2 }),
      node(2, 1, "canceled"),
    ];
    assert.deepEqual(rollupUpdates(nodes, [2]), [
      { id: 1, state: "in_progress", rollupDone: null, rollupTotal: null },
    ]);
  });
});

describe("derivedStatePatchRejected", () => {
  const derived = { stateManual: false, rollupTotal: 2 };
  it("blocks a state write until manual status is turned on", () => {
    assert.equal(derivedStatePatchRejected(derived, { state: "ready" }), true);
    assert.equal(
      derivedStatePatchRejected(derived, { state: "ready", stateManual: true }),
      false,
    );
    assert.equal(derivedStatePatchRejected(derived, { stateManual: true }), false);
    assert.equal(
      derivedStatePatchRejected({ stateManual: false, rollupTotal: null }, { state: "ready" }),
      false,
    );
  });
});
