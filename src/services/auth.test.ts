import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldLockAfterFailedLogin } from "./auth.js";
import { readSessionCookie, SESSION_COOKIE_NAME } from "../lib/sessionCookie.js";

describe("shouldLockAfterFailedLogin", () => {
  it("locks when the next failure reaches the threshold", () => {
    assert.equal(shouldLockAfterFailedLogin(2, 3), true);
    assert.equal(shouldLockAfterFailedLogin(0, 1), true);
  });

  it("does not lock below the threshold", () => {
    assert.equal(shouldLockAfterFailedLogin(0, 3), false);
    assert.equal(shouldLockAfterFailedLogin(1, 3), false);
  });
});

describe("readSessionCookie", () => {
  it("reads the TaskMesh session cookie from the header", () => {
    const req = {
      headers: {
        cookie: `other=1; ${SESSION_COOKIE_NAME}=abc123; foo=bar`,
      },
    } as import("express").Request;
    assert.equal(readSessionCookie(req), "abc123");
  });

  it("returns undefined when the cookie is absent", () => {
    const req = { headers: {} } as import("express").Request;
    assert.equal(readSessionCookie(req), undefined);
  });
});
