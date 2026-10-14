import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  START_AFTER_DUE_MESSAGE,
  compareOptionalYmd,
  dateOrderViolation,
} from "./dateOrder.js";

describe("dateOrderViolation", () => {
  it("allows a missing side and an equal pair", () => {
    assert.equal(dateOrderViolation(null, "2026-10-01"), null);
    assert.equal(dateOrderViolation("2026-10-01", null), null);
    assert.equal(dateOrderViolation("", "2026-10-01"), null);
    assert.equal(dateOrderViolation("2026-10-01", "2026-10-01"), null);
    assert.equal(dateOrderViolation("2026-10-01", "2026-10-02"), null);
  });

  it("rejects a start after the due date from either direction", () => {
    assert.equal(dateOrderViolation("2026-10-03", "2026-10-02"), START_AFTER_DUE_MESSAGE);
  });
});

describe("compareOptionalYmd", () => {
  it("keeps empty dates last when sorting descending", () => {
    assert.equal(compareOptionalYmd(null, "2026-10-01", -1), 1);
    assert.equal(compareOptionalYmd("2026-10-02", "2026-10-01", -1) < 0, true);
  });
});
