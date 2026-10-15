import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectPlanFinish, type PlanProjectionItem } from "./planProjection.js";

const NOW = new Date("2026-10-14T12:00:00.000Z");
const WINDOW_START = new Date(NOW.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString();

function task(
  entityId: number,
  overrides: Partial<PlanProjectionItem> = {},
): PlanProjectionItem {
  return {
    entityType: "task",
    entityId,
    parent: null,
    state: "ready",
    estimateHours: null,
    progress: 0,
    completedAt: null,
    ...overrides,
  };
}

describe("projectPlanFinish", () => {
  it("uses completed leaf hours from the last 28 days as velocity", () => {
    const projection = projectPlanFinish({
      now: NOW,
      workdayHours: 8,
      capacityHoursPerWeek: 1,
      items: [
        task(1, { state: "complete", estimateHours: 28, completedAt: "2026-10-01T00:00:00.000Z" }),
        task(2, { estimateHours: 70 }),
        task(3),
        task(4),
      ],
      dependencies: [],
    });
    assert.equal(projection.driver, "velocity");
    assert.equal(projection.inputs.completedHours28d, 28);
    assert.equal(projection.inputs.velocityHoursPerWeek, 7);
    assert.equal(projection.inputs.hoursPerWeek, 7);
    assert.equal(projection.inputs.remainingHours, 70);
    assert.equal(projection.inputs.uncertainty, 0.75);
    assert.equal(projection.center, "2026-12-23");
    assert.equal(projection.earliest, "2026-10-31");
    assert.equal(projection.latest, "2027-02-14");
  });

  it("falls back to weekly capacity when nothing was completed in the window", () => {
    const projection = projectPlanFinish({
      now: NOW,
      workdayHours: 8,
      capacityHoursPerWeek: 8,
      items: [task(1, { estimateHours: 8 }), task(2, { estimateHours: 8 })],
      dependencies: [
        {
          prerequisite: { entityType: "task", entityId: 1 },
          dependent: { entityType: "task", entityId: 2 },
        },
        {
          prerequisite: { entityType: "task", entityId: 2 },
          dependent: { entityType: "task", entityId: 1 },
        },
      ],
    });
    assert.equal(projection.driver, "capacity");
    assert.equal(projection.inputs.rateSource, "capacity");
    assert.equal(projection.inputs.criticalPathHours, null);
    assert.equal(projection.inputs.throughputFinish, "2026-10-28");
    assert.equal(projection.center, "2026-10-28");
    assert.equal(projection.earliest, "2026-10-24");
    assert.equal(projection.latest, "2026-11-01");
  });

  it("asks for capacity when there is remaining work and no rate", () => {
    const projection = projectPlanFinish({
      now: NOW,
      workdayHours: 8,
      capacityHoursPerWeek: null,
      items: [task(1, { state: "ready", estimateHours: 8, completedAt: WINDOW_START })],
      dependencies: [],
    });
    assert.equal(projection.driver, "needs_capacity");
    assert.equal(projection.inputs.completedHours28d, 0);
    assert.equal(projection.earliest, null);
    assert.equal(projection.center, null);
  });

  it("lets a long dependency chain finish later than weekly throughput", () => {
    const projection = projectPlanFinish({
      now: NOW,
      workdayHours: 8,
      capacityHoursPerWeek: null,
      items: [
        task(1, { state: "complete", estimateHours: 320, completedAt: WINDOW_START }),
        task(2, { estimateHours: 40 }),
        task(3, { estimateHours: 40 }),
      ],
      dependencies: [
        {
          prerequisite: { entityType: "task", entityId: 2 },
          dependent: { entityType: "task", entityId: 3 },
        },
      ],
    });
    assert.equal(projection.inputs.velocityHoursPerWeek, 80);
    assert.equal(projection.inputs.throughputFinish, "2026-10-21");
    assert.equal(projection.inputs.criticalPathFinish, "2026-10-27");
    assert.equal(projection.driver, "critical_path");
    assert.equal(projection.center, "2026-10-27");
    assert.equal(projection.earliest, "2026-10-24");
    assert.equal(projection.latest, "2026-10-30");
  });

  it("keeps the weekly rate when parallel work is longer than the chain", () => {
    const projection = projectPlanFinish({
      now: NOW,
      workdayHours: 8,
      capacityHoursPerWeek: null,
      items: [
        task(1, { state: "complete", estimateHours: 40, completedAt: "2026-10-10T00:00:00.000Z" }),
        task(2, { estimateHours: 40 }),
        task(3, { estimateHours: 40 }),
      ],
      dependencies: [],
    });
    assert.equal(projection.driver, "velocity");
    assert.equal(projection.inputs.criticalPathFinish, "2026-10-20");
    assert.equal(projection.center, "2026-12-09");
    assert.equal(projection.earliest, "2026-11-25");
    assert.equal(projection.latest, "2026-12-23");
  });

  it("does not add a parent's hours on top of an in-plan child", () => {
    const projection = projectPlanFinish({
      now: NOW,
      workdayHours: 8,
      capacityHoursPerWeek: null,
      items: [
        task(1, { state: "ready", estimateHours: 100 }),
        task(2, {
          state: "complete",
          estimateHours: 8,
          completedAt: "2026-10-13T00:00:00.000Z",
          parent: { entityType: "task", entityId: 1 },
        }),
      ],
      dependencies: [],
    });
    assert.equal(projection.driver, "complete");
    assert.equal(projection.inputs.completedHours28d, 8);
    assert.equal(projection.inputs.remainingHours, 0);
    assert.equal(projection.center, "2026-10-14");
  });

  it("drops a reopened item and a completion older than 28 days from velocity", () => {
    const justOutside = new Date(NOW.getTime() - 28 * 24 * 60 * 60 * 1000 - 1).toISOString();
    const reopened = projectPlanFinish({
      now: NOW,
      workdayHours: 8,
      capacityHoursPerWeek: null,
      items: [task(1, { state: "ready", estimateHours: 8, completedAt: WINDOW_START })],
      dependencies: [],
    });
    assert.equal(reopened.inputs.completedHours28d, 0);
    assert.equal(reopened.driver, "needs_capacity");
    const stale = projectPlanFinish({
      now: NOW,
      workdayHours: 8,
      capacityHoursPerWeek: 4,
      items: [task(1, { state: "complete", estimateHours: 8, completedAt: justOutside }), task(2, { estimateHours: 4 })],
      dependencies: [],
    });
    assert.equal(stale.inputs.completedHours28d, 0);
    assert.equal(stale.inputs.rateSource, "capacity");
    const onTheBoundary = projectPlanFinish({
      now: NOW,
      workdayHours: 8,
      capacityHoursPerWeek: null,
      items: [
        task(1, { state: "complete", estimateHours: 8, completedAt: WINDOW_START }),
        task(2, { estimateHours: 4 }),
      ],
      dependencies: [],
    });
    assert.equal(onTheBoundary.inputs.completedHours28d, 8);
    assert.equal(onTheBoundary.inputs.velocityHoursPerWeek, 2);
  });

  it("counts a partial to-do as unfinished hours and a complete to-do as velocity", () => {
    const projection = projectPlanFinish({
      now: NOW,
      workdayHours: 8,
      capacityHoursPerWeek: 8,
      items: [
        {
          entityType: "todo",
          entityId: 1,
          parent: null,
          state: "in_progress",
          estimateHours: 8,
          progress: 50,
          completedAt: null,
        },
        {
          entityType: "todo",
          entityId: 2,
          parent: null,
          state: "complete",
          estimateHours: 4,
          progress: 100,
          completedAt: "2026-10-12T00:00:00.000Z",
        },
      ],
      dependencies: [],
    });
    assert.equal(projection.inputs.completedHours28d, 4);
    assert.equal(projection.inputs.remainingHours, 4);
    assert.equal(projection.inputs.velocityHoursPerWeek, 1);
    assert.equal(projection.driver, "velocity");
    assert.equal(projection.center, "2026-11-11");
  });

  it("says finished when every counted leaf is done", () => {
    const projection = projectPlanFinish({
      now: NOW,
      workdayHours: 8,
      capacityHoursPerWeek: null,
      items: [task(1, { state: "canceled", estimateHours: 40 })],
      dependencies: [],
    });
    assert.equal(projection.driver, "complete");
    assert.equal(projection.earliest, "2026-10-14");
    assert.equal(projection.latest, "2026-10-14");
  });

  it("asks for estimates when the only open work has no hours", () => {
    const projection = projectPlanFinish({
      now: NOW,
      workdayHours: 8,
      capacityHoursPerWeek: 10,
      items: [task(1, { state: "ready", estimateHours: null })],
      dependencies: [],
    });
    assert.equal(projection.driver, "needs_estimates");
    assert.equal(projection.inputs.uncertainty, 1);
    assert.equal(projection.center, null);
  });

  it("starts a working-day chain on Monday when today is Saturday", () => {
    const projection = projectPlanFinish({
      now: new Date("2026-10-17T12:00:00.000Z"),
      workdayHours: 8,
      capacityHoursPerWeek: 400,
      items: [task(1, { estimateHours: 8 })],
      dependencies: [],
    });
    assert.equal(projection.inputs.criticalPathFinish, "2026-10-19");
    assert.equal(projection.inputs.throughputFinish, "2026-10-17");
    assert.equal(projection.driver, "critical_path");
  });
});
