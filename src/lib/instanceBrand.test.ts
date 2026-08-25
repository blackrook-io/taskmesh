import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { instanceBrand, resolveInstanceId } from "./instanceBrand.js";

describe("instanceBrand", () => {
  it("treats TASKMESH_INSTANCE as authoritative", () => {
    assert.equal(resolveInstanceId({ TASKMESH_INSTANCE: "dev", PORT: "3000" }), "dev");
    assert.equal(resolveInstanceId({ TASKMESH_INSTANCE: "prod", PORT: "3001" }), "prod");
    assert.equal(resolveInstanceId({ TASKMESH_INSTANCE: " DEV ", PORT: "3000" }), "dev");
  });

  it("ignores unknown TASKMESH_INSTANCE and uses PORT", () => {
    assert.equal(resolveInstanceId({ TASKMESH_INSTANCE: "staging", PORT: "3001" }), "dev");
  });

  it("treats PORT 3000 or unset as prod, any other port as dev", () => {
    assert.equal(resolveInstanceId({ PORT: "3000" }), "prod");
    assert.equal(resolveInstanceId({ PORT: "3001" }), "dev");
    assert.equal(resolveInstanceId({}), "prod");
  });

  it("sets yellow instanceTheme only for DEV", () => {
    assert.deepEqual(instanceBrand({ PORT: "3001" }), {
      instance: "dev",
      instanceTheme: "yellow",
    });
    assert.deepEqual(instanceBrand({ PORT: "3000" }), {
      instance: "prod",
      instanceTheme: null,
    });
  });
});
