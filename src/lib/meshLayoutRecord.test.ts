import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { meshLayoutBodySchema, meshLayoutQuerySchema, readMeshPositions, readMeshViewport } from "./meshLayoutRecord.js";

describe("mesh layout records", () => {
  it("accepts pins and a viewport", () => {
    const parsed = meshLayoutBodySchema.parse({
      positions: { "task:12": { x: 10, y: -4 } },
      viewport: { x: 1, y: 2, zoom: 1 },
    });
    assert.equal(parsed.positions["task:12"]?.x, 10);
    assert.equal(parsed.viewport?.zoom, 1);
  });

  it("rejects an unknown node key and a huge pin map", () => {
    assert.equal(
      meshLayoutBodySchema.safeParse({ positions: { nope: { x: 0, y: 0 } }, viewport: null }).success,
      false,
    );
    const positions: Record<string, { x: number; y: number }> = {};
    for (let i = 1; i <= 501; i += 1) positions[`task:${i}`] = { x: 0, y: 0 };
    assert.equal(meshLayoutBodySchema.safeParse({ positions, viewport: null }).success, false);
  });

  it("accepts the focus view and rejects the retired plan view", () => {
    assert.equal(meshLayoutQuerySchema.safeParse({ root: "task:1", view: "focus" }).success, true);
    assert.equal(meshLayoutQuerySchema.safeParse({ root: "task:1", view: "plan" }).success, false);
  });

  it("drops junk stored pins and viewports", () => {
    assert.deepEqual(readMeshPositions({ "task:1": { x: 3, y: 4 }, bad: { x: 1, y: 2 } }), {
      "task:1": { x: 3, y: 4 },
    });
    assert.equal(readMeshViewport({ x: 1, y: 2 }), null);
  });
});
