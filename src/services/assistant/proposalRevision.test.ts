import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { beforeSnapshot, revisionConflict } from "./proposalRevision.js";

const base = "2026-10-12T16:00:00.000Z";

describe("revisionConflict", () => {
  it("allows an update whose target has not moved", () => {
    assert.equal(revisionConflict(base, new Date(base)), "ok");
    assert.equal(revisionConflict(base, base), "ok");
  });

  it("rejects a newer updatedAt", () => {
    assert.equal(revisionConflict(base, new Date("2026-10-12T16:00:01.000Z")), "changed");
  });

  it("rejects a missing row when a stamp is present", () => {
    assert.equal(revisionConflict(base, null), "missing");
  });

  it("skips the check when the proposal has no stamp", () => {
    assert.equal(revisionConflict(undefined, null), "ok");
    assert.equal(revisionConflict("", new Date(base)), "ok");
  });

  it("rejects an unreadable stamp", () => {
    assert.equal(revisionConflict("not-a-date", new Date(base)), "changed");
  });
});

describe("beforeSnapshot", () => {
  it("copies only the proposed keys and serializes dates", () => {
    const when = new Date(base);
    const before = beforeSnapshot(
      { title: "Old", body: "Keep", updatedAt: when, secret: "no" },
      ["title", "missing", "updatedAt"],
    );
    assert.deepEqual(before, { title: "Old", missing: null, updatedAt: base });
  });
});
