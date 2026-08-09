import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  entityTypeFromPrefix,
  formatEntityRef,
  parseEntityRefToken,
} from "./entityRef.js";

describe("entityRef", () => {
  it("formats padded refs", () => {
    assert.equal(formatEntityRef("task", 58), "T0058");
    assert.equal(formatEntityRef("idea", 1), "I0001");
    assert.equal(formatEntityRef("image_board", 12), "M0012");
  });

  it("maps prefixes", () => {
    assert.equal(entityTypeFromPrefix("T"), "task");
    assert.equal(entityTypeFromPrefix("m"), "image_board");
    assert.equal(entityTypeFromPrefix("Z"), null);
  });

  it("parses tokens", () => {
    assert.deepEqual(parseEntityRefToken("T0031"), {
      entityType: "task",
      number: 31,
      query: "T0031",
    });
    assert.equal(parseEntityRefToken("42", "idea").number, 42);
    assert.equal(parseEntityRefToken("42", "idea").entityType, "idea");
  });
});
