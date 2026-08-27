import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPublicV1Route } from "./requireAuth.js";

describe("isPublicV1Route", () => {
  it("allows auth login, logout, and session bootstrap", () => {
    assert.equal(isPublicV1Route("POST", "/auth/login"), true);
    assert.equal(isPublicV1Route("POST", "/auth/logout"), true);
    assert.equal(isPublicV1Route("GET", "/auth/session"), true);
  });

  it("allows public config", () => {
    assert.equal(isPublicV1Route("GET", "/config"), true);
    assert.equal(isPublicV1Route("GET", "/config/"), true);
  });

  it("rejects protected API routes", () => {
    assert.equal(isPublicV1Route("GET", "/projects"), false);
    assert.equal(isPublicV1Route("GET", "/users/me"), false);
    assert.equal(isPublicV1Route("POST", "/auth/login"), true);
    assert.equal(isPublicV1Route("GET", "/auth/login"), false);
    assert.equal(isPublicV1Route("GET", "/files/abc.png"), false);
  });
});

describe("requireAuth", () => {
  it("returns 401 for protected routes without a session", async () => {
    const { requireAuth } = await import("./requireAuth.js");
    let nextCalled = false;
    const req = { method: "GET", path: "/projects", sessionUserId: undefined } as import("express").Request;
    const res = {
      locals: {},
      status(code: number) {
        assert.equal(code, 401);
        return this;
      },
      json(body: unknown) {
        assert.deepEqual(body, {
          error: { code: "not_authenticated", message: "Authentication required." },
        });
      },
    } as import("express").Response;
    requireAuth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.locals.logMessage, "Unauthenticated API request");
  });

  it("passes through when a session user is present", async () => {
    const { requireAuth } = await import("./requireAuth.js");
    let nextCalled = false;
    const req = { method: "GET", path: "/projects", sessionUserId: 7 } as import("express").Request;
    const res = { locals: {} } as import("express").Response;
    requireAuth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  it("passes through for public routes without a session", async () => {
    const { requireAuth } = await import("./requireAuth.js");
    let nextCalled = false;
    const req = { method: "GET", path: "/config", sessionUserId: undefined } as import("express").Request;
    const res = { locals: {} } as import("express").Response;
    requireAuth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });
});
