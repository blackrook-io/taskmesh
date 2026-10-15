import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectPlanFinish } from "./planProjection.js";
import { schedulePlan, type ScheduleItemInput } from "./planSchedule.js";
import type { PlanDependencyEdge } from "./plans.js";

const NOW = new Date("2026-10-14T15:00:00.000Z");

function task(entityId: number, overrides: Partial<ScheduleItemInput> = {}): ScheduleItemInput {
  return {
    entityType: "task",
    entityId,
    phaseSort: 0,
    itemSort: entityId,
    parent: null,
    state: "ready",
    estimateHours: 8,
    progress: 0,
    startDate: null,
    dueDate: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function edge(prerequisite: number, dependent: number): PlanDependencyEdge {
  return {
    prerequisite: { entityType: "task", entityId: prerequisite },
    dependent: { entityType: "task", entityId: dependent },
  };
}

function row(plan: ReturnType<typeof schedulePlan>, entityId: number) {
  const found = plan.rows.find((item) => item.entityId === entityId);
  assert.ok(found);
  return found;
}

describe("schedulePlan", () => {
  it("ends an undelayed critical chain on the baseline finish", () => {
    const items = [task(1), task(2, { estimateHours: 8 })];
    const dependencies = [edge(1, 2)];
    const plan = schedulePlan({ now: NOW, workdayHours: 8, planStart: null, items, dependencies });
    const projection = projectPlanFinish({
      now: NOW,
      workdayHours: 8,
      capacityHoursPerWeek: 40,
      items: items.map((item) => ({ ...item, completedAt: item.completedAt })),
      dependencies,
    });
    assert.equal(plan.cycle, false);
    assert.equal(plan.criticalPathFinish, projection.inputs.criticalPathFinish);
    assert.equal(row(plan, 1).start, "2026-10-14");
    assert.equal(row(plan, 1).end, "2026-10-14");
    assert.equal(row(plan, 2).start, "2026-10-15");
    assert.equal(row(plan, 2).end, plan.criticalPathFinish);
    assert.equal(row(plan, 2).critical, true);
    assert.equal(row(plan, 1).slackDays, 0);
    assert.equal(row(plan, 2).slackDays, 0);
  });

  it("packs fractional hours onto the rounded baseline finish", () => {
    const items = [task(1, { estimateHours: 3 }), task(2, { estimateHours: 3 }), task(3, { estimateHours: 3 })];
    const dependencies = [edge(1, 2), edge(2, 3)];
    const plan = schedulePlan({ now: NOW, workdayHours: 8, planStart: null, items, dependencies });
    const projection = projectPlanFinish({
      now: NOW,
      workdayHours: 8,
      capacityHoursPerWeek: 40,
      items,
      dependencies,
    });
    assert.equal(row(plan, 3).end, projection.inputs.criticalPathFinish);
    assert.equal(plan.criticalPathFinish, "2026-10-14");
  });

  it("does not let a dependent start before its prerequisite ends", () => {
    const plan = schedulePlan({
      now: NOW,
      workdayHours: 8,
      planStart: null,
      items: [task(1, { estimateHours: 16 }), task(2)],
      dependencies: [edge(1, 2)],
    });
    assert.equal(row(plan, 1).end, "2026-10-15");
    assert.ok(row(plan, 2).start > row(plan, 1).end);
  });

  it("skips the weekend", () => {
    const friday = new Date("2026-10-16T15:00:00.000Z");
    const plan = schedulePlan({
      now: friday,
      workdayHours: 8,
      planStart: null,
      items: [task(1, { estimateHours: 16 })],
      dependencies: [],
    });
    assert.equal(row(plan, 1).start, "2026-10-16");
    assert.equal(row(plan, 1).end, "2026-10-19");
    assert.equal(plan.criticalPathFinish, "2026-10-19");
  });

  it("honors a future item start date", () => {
    const plan = schedulePlan({
      now: NOW,
      workdayHours: 8,
      planStart: null,
      items: [task(1, { startDate: "2026-10-19" })],
      dependencies: [],
    });
    assert.equal(row(plan, 1).start, "2026-10-19");
    assert.equal(row(plan, 1).end, "2026-10-19");
  });

  it("draws an unestimated item as a one-day marker that does not push successors", () => {
    const plan = schedulePlan({
      now: NOW,
      workdayHours: 8,
      planStart: null,
      items: [task(1, { estimateHours: null }), task(2)],
      dependencies: [edge(1, 2)],
    });
    assert.equal(row(plan, 1).marker, "unestimated");
    assert.equal(row(plan, 1).start, row(plan, 1).end);
    assert.equal(row(plan, 2).end, plan.criticalPathFinish);
    assert.equal(row(plan, 2).start, "2026-10-14");
  });

  it("draws a parent as a bracket over its children", () => {
    const plan = schedulePlan({
      now: NOW,
      workdayHours: 8,
      planStart: null,
      items: [
        task(1, { estimateHours: 40, itemSort: 0 }),
        task(2, { parent: { entityType: "task", entityId: 1 }, estimateHours: 8, itemSort: 1 }),
        task(3, { parent: { entityType: "task", entityId: 1 }, estimateHours: 16, itemSort: 2 }),
      ],
      dependencies: [],
    });
    const parent = row(plan, 1);
    assert.equal(parent.marker, "bracket");
    assert.equal(parent.start, "2026-10-14");
    assert.equal(parent.end, "2026-10-15");
    assert.equal(parent.remainingHours, 0);
  });

  it("keeps a completed predecessor from pushing unfinished work", () => {
    const plan = schedulePlan({
      now: NOW,
      workdayHours: 8,
      planStart: null,
      items: [
        task(1, {
          state: "complete",
          startedAt: "2026-10-13T15:00:00.000Z",
          completedAt: "2026-10-13T18:00:00.000Z",
        }),
        task(2),
      ],
      dependencies: [edge(1, 2)],
    });
    assert.equal(row(plan, 1).actual, true);
    assert.equal(row(plan, 1).start, "2026-10-13");
    assert.equal(row(plan, 1).end, "2026-10-13");
    assert.equal(row(plan, 2).start, "2026-10-14");
    assert.equal(row(plan, 2).end, "2026-10-14");
  });

  it("stretches an in-progress bar from its activity date through the remaining work", () => {
    const plan = schedulePlan({
      now: NOW,
      workdayHours: 8,
      planStart: null,
      items: [
        task(1, {
          state: "in_progress",
          startedAt: "2026-10-13T15:00:00.000Z",
        }),
      ],
      dependencies: [],
    });
    assert.equal(row(plan, 1).actual, true);
    assert.equal(row(plan, 1).start, "2026-10-13");
    assert.equal(row(plan, 1).end, "2026-10-14");
  });

  it("schedules a partial to-do from the hours still left", () => {
    const plan = schedulePlan({
      now: NOW,
      workdayHours: 8,
      planStart: null,
      items: [
        task(1, {
          entityType: "todo",
          estimateHours: 16,
          progress: 50,
          state: "in_progress",
          startedAt: null,
        }),
      ],
      dependencies: [],
    });
    assert.equal(row(plan, 1).remainingHours, 8);
    assert.equal(row(plan, 1).end, "2026-10-14");
  });

  it("still places bars when dependencies cycle, without a critical path", () => {
    const plan = schedulePlan({
      now: NOW,
      workdayHours: 8,
      planStart: null,
      items: [task(1), task(2)],
      dependencies: [edge(1, 2), edge(2, 1)],
    });
    assert.equal(plan.cycle, true);
    assert.equal(plan.criticalPathFinish, null);
    assert.equal(plan.rows.length, 2);
    assert.equal(row(plan, 1).critical, false);
    assert.equal(row(plan, 2).critical, false);
  });

  it("gives a parallel item slack and lists who an item is waiting on", () => {
    const plan = schedulePlan({
      now: NOW,
      workdayHours: 8,
      planStart: null,
      items: [task(1), task(2), task(3, { state: "ready" })],
      dependencies: [edge(1, 2)],
    });
    assert.equal(row(plan, 3).critical, false);
    assert.equal(row(plan, 3).slackDays, 1);
    assert.deepEqual(row(plan, 2).waitingOn, ["task:1"]);
    assert.deepEqual(row(plan, 2).prerequisiteKeys, ["task:1"]);
  });

  it("keeps a short chain visible on the baseline finish day", () => {
    const plan = schedulePlan({
      now: NOW,
      workdayHours: 8,
      planStart: null,
      items: [task(1, { estimateHours: 1.5 }), task(2, { estimateHours: 1 })],
      dependencies: [edge(1, 2)],
    });
    const first = row(plan, 1);
    const second = row(plan, 2);
    assert.equal(first.end, plan.criticalPathFinish);
    assert.equal(second.end, plan.criticalPathFinish);
    assert.ok(second.startFraction > first.startFraction);
    assert.ok(first.endFraction > 0);
  });

  it("drops canceled items", () => {
    const plan = schedulePlan({
      now: NOW,
      workdayHours: 8,
      planStart: null,
      items: [task(1, { state: "canceled" }), task(2)],
      dependencies: [],
    });
    assert.equal(plan.rows.length, 1);
    assert.equal(plan.rows[0]?.entityId, 2);
  });
});
