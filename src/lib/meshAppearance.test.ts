import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MESH_APPEARANCE_DEFAULTS,
  meshAppearanceSchema,
  normalizeMeshAppearance,
} from "./meshAppearance.js";
import { systemPropertiesPatchSchema } from "../services/systemProperties.js";

describe("mesh appearance", () => {
  it("returns defaults when the stored value is missing", () => {
    assert.deepEqual(normalizeMeshAppearance(undefined), MESH_APPEARANCE_DEFAULTS);
    assert.deepEqual(normalizeMeshAppearance(null), MESH_APPEARANCE_DEFAULTS);
  });

  it("keeps valid fields and replaces invalid ones", () => {
    const next = normalizeMeshAppearance({
      types: { task: "#FFFFFF", project: "nope" },
      glyphScale: 9,
      staleDays: 14,
    });
    assert.equal(next.types.task, "#ffffff");
    assert.equal(next.types.project, MESH_APPEARANCE_DEFAULTS.types.project);
    assert.equal(next.glyphScale, MESH_APPEARANCE_DEFAULTS.glyphScale);
    assert.equal(next.staleDays, 14);
    assert.equal(next.suggestion, MESH_APPEARANCE_DEFAULTS.suggestion);
  });

  it("rejects a bad color and an out-of-range glyph scale", () => {
    const badColor = structuredClone(MESH_APPEARANCE_DEFAULTS);
    badColor.types.task = "#fff";
    assert.equal(meshAppearanceSchema.safeParse(badColor).success, false);

    const badScale = structuredClone(MESH_APPEARANCE_DEFAULTS);
    badScale.glyphScale = 2;
    assert.equal(meshAppearanceSchema.safeParse(badScale).success, false);
  });

  it("round-trips a valid patch through the system-properties schema", () => {
    const parsed = systemPropertiesPatchSchema.parse({
      meshAppearance: MESH_APPEARANCE_DEFAULTS,
    });
    assert.deepEqual(parsed.meshAppearance, MESH_APPEARANCE_DEFAULTS);
  });
});
