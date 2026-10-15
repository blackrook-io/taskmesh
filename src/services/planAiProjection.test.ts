import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPlanAiPacket,
  hashPlanAiPacket,
  parsePlanAiResult,
  planAiWithinWindow,
  resolvePlanAi,
  type PlanAiItem,
  type PlanAiResult,
} from "./planAiProjection.js";

const NOW = new Date("2026-10-14T12:00:00.000Z");

function item(over: Partial<PlanAiItem> & Pick<PlanAiItem, "entityId" | "title">): PlanAiItem {
  return {
    entityType: "task",
    phaseName: "Build",
    state: "in_progress",
    estimateHours: 8,
    parent: null,
    completedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

describe("plan AI projection packet", () => {
  it("omits item titles unless access is full", () => {
    const items = [item({ entityId: 1, title: "Secret work" })];
    const hidden = buildPlanAiPacket({
      now: NOW,
      includeTitles: false,
      capacityHoursPerWeek: 10,
      targetDate: null,
      baselineCenter: "2026-10-21",
      items,
      dependencies: [],
      externalBlockerCount: 2,
    });
    assert.equal(hidden.items, undefined);
    assert.equal(hidden.criticalPath?.[0]?.label, "Item 1");
    assert.equal(hidden.phases[0]?.remainingHours, 8);
    assert.equal(hidden.externalBlockerCount, 2);
    const shown = buildPlanAiPacket({
      now: NOW,
      includeTitles: true,
      capacityHoursPerWeek: 10,
      targetDate: null,
      baselineCenter: "2026-10-21",
      items,
      dependencies: [],
      externalBlockerCount: 0,
    });
    assert.equal(shown.items?.[0]?.title, "Secret work");
    assert.equal(shown.criticalPath?.[0]?.label, "Secret work");
    assert.notEqual(hashPlanAiPacket(hidden), hashPlanAiPacket(shown));
  });

  it("keeps a parent's hours out of the phase total when a child is in the plan", () => {
    const packet = buildPlanAiPacket({
      now: NOW,
      includeTitles: false,
      capacityHoursPerWeek: null,
      targetDate: null,
      baselineCenter: "2026-10-21",
      items: [
        item({ entityId: 1, title: "Parent", estimateHours: 40 }),
        item({
          entityId: 2,
          title: "Child",
          estimateHours: 4,
          parent: { entityType: "task", entityId: 1 },
        }),
      ],
      dependencies: [],
      externalBlockerCount: 0,
    });
    assert.equal(packet.phases[0]?.remainingHours, 4);
  });
});

describe("plan AI result contract", () => {
  const valid: PlanAiResult = {
    p50: "2026-12-04",
    p80: "2026-12-18",
    confidence: "medium",
    drivers: ["Phase 3 holds most of the remaining hours"],
  };

  it("accepts a fenced JSON object", () => {
    const parsed = parsePlanAiResult("```json\n" + JSON.stringify(valid) + "\n```");
    assert.equal(parsed.p50, "2026-12-04");
    assert.equal(parsed.confidence, "medium");
  });

  it("rejects a date before today or past three times the baseline span", () => {
    assert.equal(
      planAiWithinWindow("2026-10-14", "2026-10-21", { ...valid, p50: "2026-10-13", p80: "2026-10-20" }),
      false,
    );
    assert.equal(
      planAiWithinWindow("2026-10-14", "2026-10-21", { ...valid, p50: "2026-11-11", p80: "2026-11-12" }),
      false,
    );
    assert.equal(
      planAiWithinWindow("2026-10-14", "2026-10-21", { ...valid, p50: "2026-10-20", p80: "2026-11-04" }),
      true,
    );
  });

  it("does not call the provider for an excluded project or a fresh cache", async () => {
    let calls = 0;
    const packet = buildPlanAiPacket({
      now: NOW,
      includeTitles: false,
      capacityHoursPerWeek: 10,
      targetDate: null,
      baselineCenter: "2026-10-21",
      items: [item({ entityId: 1, title: "Work" })],
      dependencies: [],
      externalBlockerCount: 0,
    });
    const complete = async () => {
      calls += 1;
      return JSON.stringify(valid);
    };
    const hidden = await resolvePlanAi({
      access: "excluded",
      hasCenter: true,
      packet,
      cachedHash: null,
      force: true,
      complete,
    });
    assert.equal(hidden.kind, "hidden");
    const cached = await resolvePlanAi({
      access: "full",
      hasCenter: true,
      packet,
      cachedHash: hashPlanAiPacket(packet),
      force: false,
      complete,
    });
    assert.equal(cached.kind, "cache");
    assert.equal(calls, 0);
  });

  it("rejects a malformed reply and does not treat it as a range", async () => {
    const packet = buildPlanAiPacket({
      now: NOW,
      includeTitles: false,
      capacityHoursPerWeek: 10,
      targetDate: null,
      baselineCenter: "2026-10-21",
      items: [item({ entityId: 1, title: "Work" })],
      dependencies: [],
      externalBlockerCount: 0,
    });
    const resolved = await resolvePlanAi({
      access: "read_only",
      hasCenter: true,
      packet,
      cachedHash: null,
      force: false,
      complete: async () => "not json",
    });
    assert.deepEqual(resolved, { kind: "rejected", reason: "malformed_projection" });
  });

  it("rejects a date outside the sanity window", async () => {
    const packet = buildPlanAiPacket({
      now: NOW,
      includeTitles: true,
      capacityHoursPerWeek: 10,
      targetDate: "2026-11-01",
      baselineCenter: "2026-10-21",
      items: [item({ entityId: 1, title: "Work" })],
      dependencies: [],
      externalBlockerCount: 0,
    });
    const resolved = await resolvePlanAi({
      access: "standalone",
      hasCenter: true,
      packet,
      cachedHash: "old",
      force: false,
      complete: async () => JSON.stringify({ ...valid, p50: "2027-06-01", p80: "2027-07-01" }),
    });
    assert.deepEqual(resolved, { kind: "rejected", reason: "projection_out_of_range" });
  });
});
