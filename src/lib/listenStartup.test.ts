import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { beginAfterListen } from "./listenStartup.js";

describe("beginAfterListen", () => {
  it("starts once when listen succeeds", () => {
    const exit = mock.method(process, "exit", () => undefined as never);
    const start = mock.fn();
    try {
      beginAfterListen(undefined, start);
      assert.equal(start.mock.calls.length, 1);
      assert.equal(exit.mock.calls.length, 0);
    } finally {
      exit.mock.restore();
    }
  });

  it("exits before start when the port is already taken", () => {
    const exit = mock.method(process, "exit", () => undefined as never);
    const errorLog = mock.method(console, "error", () => undefined);
    const start = mock.fn();
    const err = Object.assign(new Error("listen EADDRINUSE: address already in use"), {
      code: "EADDRINUSE",
    });
    try {
      beginAfterListen(err, start);
      assert.equal(start.mock.calls.length, 0);
      assert.equal(exit.mock.calls.length, 1);
      assert.equal(exit.mock.calls[0]?.arguments[0], 1);
      assert.equal(errorLog.mock.calls.length, 1);
      assert.equal(errorLog.mock.calls[0]?.arguments[0], "TaskMesh API failed to listen");
      assert.equal(errorLog.mock.calls[0]?.arguments[1], err);
    } finally {
      exit.mock.restore();
      errorLog.mock.restore();
    }
  });

  it("exits before start for any listen error", () => {
    const exit = mock.method(process, "exit", () => undefined as never);
    const errorLog = mock.method(console, "error", () => undefined);
    const start = mock.fn();
    const err = new Error("listen EACCES: permission denied");
    try {
      beginAfterListen(err, start);
      assert.equal(start.mock.calls.length, 0);
      assert.equal(exit.mock.calls[0]?.arguments[0], 1);
      assert.equal(errorLog.mock.calls[0]?.arguments[1], err);
    } finally {
      exit.mock.restore();
      errorLog.mock.restore();
    }
  });
});
