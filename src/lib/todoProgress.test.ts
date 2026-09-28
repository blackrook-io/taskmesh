import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTodoCheckToggle, resolveTodoProgressUpdate } from "./todoProgress.js";

describe("resolveTodoProgressUpdate", () => {
  it("sets complete and checks memberships at 100%", () => {
    assert.deepEqual(
      resolveTodoProgressUpdate({ progress: 40, state: "ready" }, { progress: 100 }),
      { progress: 100, state: "complete", membershipChecked: true },
    );
  });

  it("sets progress to 100 when state becomes complete", () => {
    assert.deepEqual(
      resolveTodoProgressUpdate({ progress: 10, state: "new" }, { state: "complete" }),
      { progress: 100, state: "complete", membershipChecked: true },
    );
  });

  it("reopens a complete ToDo when progress drops below 100", () => {
    assert.deepEqual(
      resolveTodoProgressUpdate({ progress: 100, state: "complete" }, { progress: 75 }),
      { progress: 75, state: "in_progress", membershipChecked: false },
    );
  });

  it("clears progress when leaving Complete from 100%", () => {
    assert.deepEqual(
      resolveTodoProgressUpdate({ progress: 100, state: "complete" }, { state: "ready" }),
      { progress: 0, state: "ready", membershipChecked: false },
    );
  });

  it("leaves an open ToDo alone when progress stays below 100", () => {
    assert.deepEqual(
      resolveTodoProgressUpdate({ progress: 10, state: "ready" }, { progress: 40 }),
      { progress: 40, state: "ready", membershipChecked: null },
    );
  });
});

describe("resolveTodoCheckToggle", () => {
  it("completes at 100% when checked", () => {
    assert.deepEqual(resolveTodoCheckToggle(true, { progress: 20, state: "new" }), {
      progress: 100,
      state: "complete",
      membershipChecked: true,
    });
  });

  it("resets a completed ToDo when unchecked", () => {
    assert.deepEqual(resolveTodoCheckToggle(false, { progress: 100, state: "complete" }), {
      progress: 0,
      state: "in_progress",
      membershipChecked: false,
    });
  });

  it("does not change progress when unchecking a non-complete row", () => {
    assert.equal(resolveTodoCheckToggle(false, { progress: 30, state: "ready" }), null);
  });
});
