import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatGroupNumber, toGroupRef } from "../lib/groupFields.js";

describe("formatGroupNumber", () => {
  it("pads to at least 4 digits with G prefix", () => {
    assert.equal(formatGroupNumber(1), "G0001");
    assert.equal(formatGroupNumber(130), "G0130");
    assert.equal(formatGroupNumber(12345), "G12345");
  });
});

describe("toGroupRef", () => {
  it("maps id, G####, and name", () => {
    assert.deepEqual(toGroupRef({ id: 9, number: 3, name: "Editors" }), {
      id: 9,
      referenceId: "G0003",
      name: "Editors",
    });
  });
});
