import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addAndMoveOffer,
  assertPlanRevision,
  computePlanRollup,
  conflictsForNewDependency,
  conflictsForParentChange,
  insertPlanBlock,
  layoutBelowPrerequisite,
  planItemActions,
  PlanRuleError,
  previewFixOrder,
  validatePlanOrder,
  type PlanDependencyEdge,
  type PlanLayoutItem,
  type PlanSnapshot,
} from "./plans.js";

function item(overrides: Partial<PlanLayoutItem> & Pick<PlanLayoutItem, "entityId">): PlanLayoutItem {
  return {
    entityType: "task",
    phaseSort: 0,
    itemSort: overrides.entityId,
    parent: null,
    state: "ready",
    estimateHours: null,
    progress: 0,
    ...overrides,
  };
}

function edge(prerequisiteId: number, dependentId: number): PlanDependencyEdge {
  return {
    prerequisite: { entityType: "task", entityId: prerequisiteId },
    dependent: { entityType: "task", entityId: dependentId },
  };
}

function plan(
  id: number,
  items: PlanLayoutItem[],
  dependencies: PlanDependencyEdge[] = [],
): PlanSnapshot {
  return { id, number: id, title: `Plan ${id}`, items, dependencies };
}

describe("validatePlanOrder", () => {
  it("accepts a prerequisite above its dependent and a nested block", () => {
    const items = [
      item({ entityId: 1, itemSort: 0, number: 1 }),
      item({ entityId: 2, itemSort: 1, number: 2, parent: { entityType: "task", entityId: 1 } }),
      item({ entityId: 3, itemSort: 2, number: 3, parent: { entityType: "task", entityId: 2 } }),
      item({ entityId: 4, itemSort: 3, number: 4, parent: { entityType: "task", entityId: 1 } }),
    ];
    assert.deepEqual(validatePlanOrder(items, [edge(1, 4)]), []);
  });

  it("rejects a dependent sitting above its prerequisite", () => {
    const items = [
      item({ entityId: 8, itemSort: 0, number: 108 }),
      item({ entityId: 2, itemSort: 1, number: 102 }),
    ];
    const violations = validatePlanOrder(items, [edge(2, 8)]);
    assert.equal(violations.some((row) => row.kind === "dependency"), true);
    assert.match(violations[0]?.message ?? "", /T0108 depends on T0102/);
  });

  it("rejects a cycle", () => {
    const items = [item({ entityId: 1, itemSort: 0 }), item({ entityId: 2, itemSort: 1 })];
    const violations = validatePlanOrder(items, [edge(1, 2), edge(2, 1)]);
    assert.equal(violations.some((row) => row.kind === "cycle"), true);
  });

  it("rejects a prerequisite in a later phase", () => {
    const items = [
      item({ entityId: 2, phaseSort: 0, itemSort: 0 }),
      item({ entityId: 1, phaseSort: 1, itemSort: 0 }),
    ];
    const violations = validatePlanOrder(items, [edge(1, 2)]);
    assert.equal(violations.some((row) => row.kind === "dependency"), true);
  });

  it("rejects a child outside its parent's phase", () => {
    const items = [
      item({ entityId: 1, phaseSort: 0, itemSort: 0 }),
      item({
        entityId: 2,
        phaseSort: 1,
        itemSort: 0,
        parent: { entityType: "task", entityId: 1 },
      }),
    ];
    const violations = validatePlanOrder(items, []);
    assert.equal(violations.some((row) => row.kind === "enclosure"), true);
  });

  it("rejects a broken parent block", () => {
    const items = [
      item({ entityId: 1, itemSort: 0 }),
      item({ entityId: 9, itemSort: 1 }),
      item({ entityId: 2, itemSort: 2, parent: { entityType: "task", entityId: 1 } }),
    ];
    const violations = validatePlanOrder(items, []);
    assert.equal(violations.some((row) => row.kind === "enclosure"), true);
  });

  it("ignores a dependency that leaves the plan", () => {
    const items = [item({ entityId: 2, itemSort: 0 }), item({ entityId: 1, itemSort: 1 })];
    assert.deepEqual(validatePlanOrder(items, [edge(9, 1)]), []);
  });
});

describe("computePlanRollup", () => {
  it("drops a parent's hours when a child is in the plan", () => {
    const rollup = computePlanRollup([
      item({ entityId: 1, estimateHours: 8, state: "in_progress" }),
      item({
        entityId: 2,
        estimateHours: 2,
        state: "complete",
        parent: { entityType: "task", entityId: 1 },
      }),
    ]);
    assert.equal(rollup.plan.hoursTotal, 2);
    assert.equal(rollup.plan.hoursDone, 2);
    assert.equal(rollup.plan.progressMode, "hours");
    assert.equal(rollup.plan.itemCount, 1);
  });

  it("counts a parent's hours when no child is in the plan", () => {
    const rollup = computePlanRollup([
      item({ entityId: 1, estimateHours: 8, state: "pending" }),
    ]);
    assert.equal(rollup.plan.hoursTotal, 8);
    assert.equal(rollup.plan.hoursDone, 8);
  });

  it("warns on unestimated leaves and falls back to a count", () => {
    const rollup = computePlanRollup([
      item({ entityId: 1, state: "complete" }),
      item({ entityId: 2, state: "ready" }),
    ]);
    assert.equal(rollup.plan.hoursTotal, 0);
    assert.equal(rollup.plan.unestimatedCount, 2);
    assert.equal(rollup.plan.progressMode, "count");
    assert.equal(rollup.plan.progress, 0.5);
    assert.equal(rollup.plan.itemsDone, 1);
  });

  it("uses ToDo progress and omits canceled rows", () => {
    const rollup = computePlanRollup([
      item({
        entityId: 1,
        entityType: "todo",
        estimateHours: 4,
        state: "in_progress",
        progress: 25,
      }),
      item({ entityId: 2, estimateHours: 100, state: "canceled" }),
    ]);
    assert.equal(rollup.plan.hoursTotal, 4);
    assert.equal(rollup.plan.hoursDone, 1);
    assert.equal(rollup.plan.itemCount, 1);
    assert.equal(rollup.phases[0]?.progress, 0.25);
  });

  it("lets a parent count again when its only in-plan child is canceled", () => {
    const rollup = computePlanRollup([
      item({ entityId: 1, estimateHours: 3, state: "ready" }),
      item({
        entityId: 2,
        estimateHours: 9,
        state: "deleted",
        parent: { entityType: "task", entityId: 1 },
      }),
    ]);
    assert.equal(rollup.plan.hoursTotal, 3);
    assert.equal(rollup.plan.itemCount, 1);
  });
});

describe("previewFixOrder", () => {
  it("keeps the current order when nothing is constrained", () => {
    const items = [
      item({ entityId: 3, itemSort: 0 }),
      item({ entityId: 1, itemSort: 1 }),
      item({ entityId: 2, itemSort: 2 }),
    ];
    const preview = previewFixOrder(items, []);
    assert.deepEqual(
      preview.phases[0]?.items.map((row) => row.entityId),
      [3, 1, 2],
    );
    assert.equal(preview.phases[0]?.changed, false);
    assert.deepEqual(preview.conflicts, []);
  });

  it("pulls a prerequisite above its dependent inside the phase", () => {
    const items = [item({ entityId: 1, itemSort: 0 }), item({ entityId: 2, itemSort: 1 })];
    const preview = previewFixOrder(items, [edge(2, 1)]);
    assert.deepEqual(
      preview.phases[0]?.items.map((row) => row.entityId),
      [2, 1],
    );
    assert.equal(preview.phases[0]?.changed, true);
  });

  it("packs a child into its parent block", () => {
    const items = [
      item({ entityId: 1, itemSort: 0 }),
      item({ entityId: 9, itemSort: 1 }),
      item({ entityId: 2, itemSort: 2, parent: { entityType: "task", entityId: 1 } }),
    ];
    const preview = previewFixOrder(items, []);
    assert.deepEqual(
      preview.phases[0]?.items.map((row) => row.entityId),
      [1, 2, 9],
    );
  });

  it("lists a cross-phase conflict and leaves both phases unchanged", () => {
    const items = [
      item({ entityId: 2, phaseSort: 0, itemSort: 0 }),
      item({ entityId: 1, phaseSort: 1, itemSort: 0 }),
    ];
    const preview = previewFixOrder(items, [edge(1, 2)]);
    assert.equal(preview.conflicts.some((row) => row.kind === "dependency"), true);
    assert.equal(preview.phases[0]?.changed, false);
    assert.equal(preview.phases[1]?.changed, false);
    assert.deepEqual(
      preview.phases.map((phase) => phase.items.map((row) => row.entityId)),
      [[2], [1]],
    );
  });

  it("leaves a cyclic phase unchanged", () => {
    const items = [item({ entityId: 1, itemSort: 0 }), item({ entityId: 2, itemSort: 1 })];
    const preview = previewFixOrder(items, [edge(1, 2), edge(2, 1)]);
    assert.equal(preview.conflicts.some((row) => row.kind === "cycle"), true);
    assert.deepEqual(
      preview.phases[0]?.items.map((row) => row.entityId),
      [1, 2],
    );
    assert.equal(preview.phases[0]?.changed, false);
  });
});

describe("plan conflicts", () => {
  it("names the two plans a new dependency would contradict and skips the legal one", () => {
    const bad = [
      item({ entityId: 8, itemSort: 0, number: 108 }),
      item({ entityId: 2, itemSort: 1, number: 102 }),
    ];
    const good = [
      item({ entityId: 2, itemSort: 0, number: 102 }),
      item({ entityId: 8, itemSort: 1, number: 108 }),
    ];
    const onlyOne = [item({ entityId: 8, itemSort: 0, number: 108 })];
    const conflicts = conflictsForNewDependency(
      [plan(1, bad), plan(2, bad), plan(3, good), plan(4, onlyOne)],
      edge(2, 8),
    );
    assert.deepEqual(
      conflicts.map((row) => row.id),
      [1, 2],
    );
  });

  it("rejects a parent move that would put a child above its prerequisite", () => {
    const items = [
      item({ entityId: 1, itemSort: 0, number: 1 }),
      item({ entityId: 9, itemSort: 1, number: 9 }),
      item({ entityId: 2, itemSort: 2, number: 2 }),
    ];
    const conflicts = conflictsForParentChange(
      [plan(7, items, [edge(9, 2)])],
      { entityType: "task", entityId: 2 },
      { entityType: "task", entityId: 1 },
    );
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.id, 7);
  });

  it("allows a parent move that keeps prerequisites above the block", () => {
    const items = [
      item({ entityId: 9, itemSort: 0 }),
      item({ entityId: 1, itemSort: 1 }),
      item({ entityId: 2, itemSort: 2 }),
    ];
    const conflicts = conflictsForParentChange(
      [plan(7, items, [edge(9, 2)])],
      { entityType: "task", entityId: 2 },
      { entityType: "task", entityId: 1 },
    );
    assert.deepEqual(conflicts, []);
  });

  it("ignores clearing a parent", () => {
    const conflicts = conflictsForParentChange(
      [plan(1, [item({ entityId: 1 }), item({ entityId: 2, parent: { entityType: "task", entityId: 1 } })])],
      { entityType: "task", entityId: 2 },
      null,
    );
    assert.deepEqual(conflicts, []);
  });
});

describe("assertPlanRevision", () => {
  it("accepts the current revision", () => {
    assert.doesNotThrow(() => assertPlanRevision(4, 4));
  });

  it("rejects a stale revision", () => {
    assert.throws(
      () => assertPlanRevision(4, 3),
      (err: unknown) => {
        assert.ok(err instanceof PlanRuleError);
        assert.equal(err.code, "plan_revision_stale");
        assert.equal(err.status, 409);
        return true;
      },
    );
  });
});

describe("planItemActions", () => {
  const blocker = { id: 9, number: 102, title: "Blocker", state: "ready" };

  it("offers Start and Start and complete on a clear Ready task", () => {
    const flags = planItemActions({
      entityType: "task",
      state: "ready",
      canWrite: true,
      canReopen: false,
      stateDerived: false,
      openBlockers: [],
    });
    assert.equal(flags.canStart, true);
    assert.equal(flags.canStartAndComplete, true);
    assert.equal(flags.canCheck, false);
    assert.equal(flags.canUncheck, false);
  });

  it("keeps Start and drops Start and complete when Ready still has open blockers", () => {
    const flags = planItemActions({
      entityType: "task",
      state: "ready",
      canWrite: true,
      canReopen: true,
      stateDerived: false,
      openBlockers: [blocker],
    });
    assert.equal(flags.canStart, true);
    assert.equal(flags.canStartAndComplete, false);
    assert.deepEqual(flags.blockedBy, [blocker]);
  });

  it("hides every flag for a viewer and still names blockers", () => {
    const flags = planItemActions({
      entityType: "task",
      state: "in_progress",
      canWrite: false,
      canReopen: true,
      stateDerived: false,
      openBlockers: [blocker],
    });
    assert.equal(flags.canCheck, false);
    assert.equal(flags.canStart, false);
    assert.equal(flags.canUncheck, false);
    assert.deepEqual(flags.blockedBy, [blocker]);
  });

  it("lets a writer check an open ToDo and uncheck a complete one", () => {
    const open = planItemActions({
      entityType: "todo",
      state: "new",
      canWrite: true,
      canReopen: false,
      stateDerived: false,
      openBlockers: [],
    });
    assert.equal(open.canCheck, true);
    assert.equal(open.canStart, false);
    const done = planItemActions({
      entityType: "todo",
      state: "complete",
      canWrite: true,
      canReopen: false,
      stateDerived: false,
      openBlockers: [],
    });
    assert.equal(done.canCheck, false);
    assert.equal(done.canUncheck, true);
  });
});

describe("insertPlanBlock", () => {
  it("puts a dependent at the last legal index in the phase", () => {
    const items = [item({ entityId: 1, itemSort: 0 })];
    const block = [item({ entityId: 2, itemSort: 0 })];
    const next = insertPlanBlock(items, [edge(1, 2)], 0, block, null);
    assert.deepEqual(
      next?.map((row) => row.entityId),
      [1, 2],
    );
  });

  it("returns null when the prerequisite sits in a later phase", () => {
    const items = [item({ entityId: 1, phaseSort: 1, itemSort: 0 })];
    const block = [item({ entityId: 2, itemSort: 0 })];
    const next = insertPlanBlock(items, [edge(1, 2)], 0, block, null);
    assert.equal(next, null);
  });
});

describe("addAndMoveOffer", () => {
  it("offers the only plan that an in-phase move can fix", () => {
    const items = [item({ entityId: 2, itemSort: 0 }), item({ entityId: 1, itemSort: 1 })];
    const offer = addAndMoveOffer([plan(4, items)], edge(1, 2));
    assert.deepEqual(offer, { planId: 4 });
    assert.deepEqual(
      layoutBelowPrerequisite(items, [], edge(1, 2))?.map((row) => row.entityId),
      [1, 2],
    );
  });

  it("offers nothing when two plans conflict or the items are in different phases", () => {
    const items = [item({ entityId: 2, itemSort: 0 }), item({ entityId: 1, itemSort: 1 })];
    assert.equal(addAndMoveOffer([plan(4, items), plan(5, items)], edge(1, 2)), null);
    const split = [
      item({ entityId: 2, phaseSort: 0, itemSort: 0 }),
      item({ entityId: 1, phaseSort: 1, itemSort: 0 }),
    ];
    assert.equal(addAndMoveOffer([plan(4, split)], edge(1, 2)), null);
  });
});
