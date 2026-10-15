import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runPlanAssistantTool, type PlanToolServices } from "./planTools.js";

function board(revision = 1) {
  return {
    plan: {
      id: 4,
      number: 8,
      title: "Launch",
      status: "active",
      revision,
      projectId: 9,
      description: "hidden",
    },
    phases: [
      {
        id: 2,
        name: "Build",
        sortOrder: 0,
        items: [
          {
            id: 11,
            entityType: "task",
            entityId: 30,
            number: 108,
            title: "Ship",
            state: "ready",
            estimateHours: 3,
            sortOrder: 0,
          },
        ],
      },
    ],
    edges: [],
  };
}

describe("plan assistant tools", () => {
  it("adds items through the plans service and does not include children unless asked", async () => {
    const calls: unknown[] = [];
    const services: PlanToolServices = {
      getBoard: async () => board(),
      addItem: async (_actor, planId, input) => {
        calls.push({ planId, input });
        return board(2);
      },
      reorder: async () => board(),
      setState: async () => board(),
      projection: async () => ({ center: "2026-10-21" }),
    };
    const raw = await runPlanAssistantTool(
      "plan_add_items",
      { planId: 4, phaseId: 2, items: [{ entityType: "task", entityId: 30 }] },
      1,
      services,
    );
    const body = JSON.parse(raw) as { ok: boolean; board: { plan: { description?: string; revision: number } } };
    assert.equal(body.ok, true);
    assert.equal(body.board.plan.description, undefined);
    assert.equal(body.board.plan.revision, 2);
    assert.deepEqual(calls, [
      {
        planId: 4,
        input: { entityType: "task", entityId: 30, phaseId: 2, includeChildren: false },
      },
    ]);
  });

  it("reorders and checks an item off through the plans service", async () => {
    const seen: string[] = [];
    const services: PlanToolServices = {
      getBoard: async () => board(),
      addItem: async () => board(),
      reorder: async (_actor, planId, revision, phases) => {
        seen.push(`reorder:${planId}:${revision}:${phases[0]?.itemIds.join(",")}`);
        return board(3);
      },
      setState: async (_actor, planId, itemId, to, comment) => {
        seen.push(`state:${planId}:${itemId}:${to}:${comment ?? ""}`);
        return board();
      },
      projection: async () => ({ earliest: "2026-10-20" }),
    };
    await runPlanAssistantTool(
      "plan_reorder",
      { planId: 4, revision: 1, phases: [{ phaseId: 2, itemIds: [11] }] },
      1,
      services,
    );
    await runPlanAssistantTool(
      "plan_set_item_state",
      { planId: 4, itemId: 11, to: "in_progress" },
      1,
      services,
    );
    const projection = JSON.parse(
      await runPlanAssistantTool("plan_projection", { planId: 4 }, 1, services),
    ) as { earliest: string };
    assert.deepEqual(seen, ["reorder:4:1:11", "state:4:11:in_progress:"]);
    assert.equal(projection.earliest, "2026-10-20");
  });
});
