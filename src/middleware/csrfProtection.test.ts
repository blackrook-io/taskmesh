import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readSessionCookie } from "../lib/sessionCookie.js";
import { SPA_CLIENT_HEADER, SPA_CLIENT_VALUE, csrfProtection } from "./csrfProtection.js";

describe("csrfProtection", () => {
  it("passes GET requests without headers", () => {
    let nextCalled = false;
    const req = {
      method: "GET",
      path: "/projects",
      get: () => undefined,
      headers: {},
    } as unknown as import("express").Request;
    csrfProtection(req, { locals: {} } as import("express").Response, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  it("passes POST /auth/login without session", () => {
    let nextCalled = false;
    const req = {
      method: "POST",
      path: "/auth/login",
      get: () => undefined,
      headers: {},
    } as unknown as import("express").Request;
    csrfProtection(req, { locals: {} } as import("express").Response, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  it("rejects mutating requests with session cookie but no SPA header", () => {
    let nextCalled = false;
    let statusCode = 0;
    let body: unknown;
    const req = {
      method: "POST",
      path: "/projects",
      sessionUserId: undefined,
      get(name: string) {
        if (name === "host") return "127.0.0.1";
        return undefined;
      },
      headers: { cookie: "taskmesh_session_dev=abc123" },
    } as import("express").Request;
    assert.equal(readSessionCookie(req), "abc123");
    const res = {
      locals: {} as Record<string, string>,
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
      },
    } as import("express").Response;
    csrfProtection(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
    assert.deepEqual(body, {
      error: { code: "csrf_rejected", message: "Request rejected." },
    });
    assert.equal(res.locals.logMessage, "CSRF rejected: missing SPA client header");
  });

  it("passes mutating requests with session and SPA header", () => {
    let nextCalled = false;
    const req = {
      method: "PATCH",
      path: "/tasks/1",
      sessionUserId: 1,
      get(name: string) {
        if (name === SPA_CLIENT_HEADER) return SPA_CLIENT_VALUE;
        if (name === "host") return "127.0.0.1";
        if (name === "origin") return "https://127.0.0.1";
        return undefined;
      },
      headers: {},
    } as import("express").Request;
    csrfProtection(req, { locals: {} } as import("express").Response, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  it("rejects cross-origin mutating requests with session", () => {
    let nextCalled = false;
    let statusCode = 0;
    const req = {
      method: "DELETE",
      path: "/tasks/1",
      sessionUserId: 1,
      get(name: string) {
        if (name === SPA_CLIENT_HEADER) return SPA_CLIENT_VALUE;
        if (name === "host") return "127.0.0.1";
        if (name === "origin") return "https://evil.example";
        return undefined;
      },
      headers: {},
    } as import("express").Request;
    const res = {
      locals: {} as Record<string, string>,
      status(code: number) {
        statusCode = code;
        return this;
      },
      json() {},
    } as import("express").Response;
    csrfProtection(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
    assert.equal(res.locals.logMessage, "CSRF rejected: cross-origin request");
  });

  it("passes mutating requests without session (requireAuth handles auth)", () => {
    let nextCalled = false;
    const req = {
      method: "POST",
      path: "/projects",
      sessionUserId: undefined,
      get: () => undefined,
      headers: {},
    } as unknown as import("express").Request;
    csrfProtection(req, { locals: {} } as import("express").Response, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });
});
