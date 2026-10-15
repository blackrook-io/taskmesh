import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  planAdjacentGap,
  planApplyGap,
  planFixSummary,
  planGapBeforeItem,
  planJudgeGap,
  planMovingIds,
  planOrderViolation,
  planReorderBody,
  type PlanOrderEdge,
  type PlanOrderPhase,
} from "./planOrder.ts";

function row(
  id: number,
  partial: { parentId?: number | null; entityType?: "task" | "todo"; title?: string } = {},
): PlanOrderPhase["items"][number] {
  return {
    id,
    entityType: partial.entityType ?? "task",
    entityId: id,
    number: id,
    title: partial.title ?? `Item ${id}`,
    parentId: partial.parentId ?? null,
  };
}

function phase(id: number, items: PlanOrderPhase["items"], sortOrder = id): PlanOrderPhase {
  return { id, name: `Phase ${id}`, sortOrder, items };
}

function edge(prerequisite: number, dependent: number): PlanOrderEdge {
  return {
    prerequisite: { entityType: "task", entityId: prerequisite },
    dependent: { entityType: "task", entityId: dependent },
  };
}

describe("plan order", () => {
  it("moves a parent together with its children", () => {
    const phases = [phase(1, [row(1), row(2, { parentId: 1 }), row(3)])];
    assert.deepEqual(planMovingIds(phases, 1), [1, 2]);
    assert.deepEqual(planMovingIds(phases, 2), [2]);
  });

  it("refuses to place a dependent above its prerequisite", () => {
    const phases = [phase(1, [row(1), row(2)])];
    const edges = [edge(1, 2)];
    const gap = planGapBeforeItem(phases, [2], 1);
    assert.ok(gap);
    const verdict = planJudgeGap(phases, [2], gap, edges);
    assert.equal(verdict.legal, false);
    assert.equal(verdict.reason, "T0002 depends on T0001");
    assert.equal(planOrderViolation(phases, edges), null);
  });

  it("lets a child swap inside the parent block and not above the parent", () => {
    const phases = [phase(1, [row(1), row(2, { parentId: 1 }), row(3, { parentId: 1 })])];
    const swap = planGapBeforeItem(phases, [3], 2);
    assert.ok(swap);
    assert.equal(planJudgeGap(phases, [3], swap, []).legal, true);
    const above = planGapBeforeItem(phases, [3], 1);
    assert.ok(above);
    const blocked = planJudgeGap(phases, [3], above, []);
    assert.equal(blocked.legal, false);
    assert.match(blocked.reason ?? "", /must stay in T0001's block/);
  });

  it("moves a parent block into a later phase when nothing depends on it", () => {
    const phases = [phase(1, [row(1), row(2, { parentId: 1 })]), phase(2, [row(3)])];
    const gap = { phaseId: 2, index: 0 };
    const verdict = planJudgeGap(phases, planMovingIds(phases, 1), gap, []);
    assert.equal(verdict.legal, true);
    const next = planApplyGap(phases, planMovingIds(phases, 1), gap);
    assert.deepEqual(
      next.map((item) => item.items.map((row) => row.id)),
      [[], [1, 2, 3]],
    );
  });

  it("keeps a child out of another phase", () => {
    const phases = [phase(1, [row(1), row(2, { parentId: 1 })]), phase(2, [row(3)])];
    const verdict = planJudgeGap(phases, [2], { phaseId: 2, index: 0 }, []);
    assert.equal(verdict.legal, false);
    assert.match(verdict.reason ?? "", /must stay in T0001's block/);
  });

  it("steps the keyboard to the next gap and stops on an illegal one", () => {
    const phases = [phase(1, [row(1), row(2)])];
    const edges = [edge(1, 2)];
    const down = planAdjacentGap(phases, 1, "down", edges);
    assert.equal(down.verdict.legal, false);
    assert.equal(down.verdict.reason, "T0002 depends on T0001");
    const up = planAdjacentGap(phases, 2, "up", []);
    assert.equal(up.verdict.legal, true);
    assert.equal(up.gap?.index, 0);
    const top = planAdjacentGap(phases, 1, "up", []);
    assert.equal(top.gap, null);
    assert.equal(top.verdict.reason, "Already first on the plan");
  });

  it("builds a full reorder body and describes a fix-order preview", () => {
    const phases = [phase(1, [row(2, { title: "Later" }), row(1, { title: "First" })], 0)];
    const body = planReorderBody(4, phases);
    assert.deepEqual(body, { revision: 4, phases: [{ phaseId: 1, itemIds: [2, 1] }] });
    const summary = planFixSummary(phases, {
      phases: [
        {
          phaseSort: 0,
          changed: true,
          items: [
            { entityType: "task", entityId: 1 },
            { entityType: "task", entityId: 2 },
          ],
        },
      ],
      conflicts: [{ message: "T0003 depends on T0004" }],
    });
    assert.equal(summary.canApply, true);
    assert.equal(summary.alreadyLegal, false);
    assert.deepEqual(summary.conflicts, ["T0003 depends on T0004"]);
    assert.equal(summary.moves[0]?.rows[0]?.moved, true);
    assert.equal(summary.moves[0]?.rows[0]?.label, "T0001 First");
  });
});
