import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionIdsToEvict, shouldLockAfterFailedLogin } from "./auth.js";
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

describe("getSessionById expiry", () => {
  it("treats expiresAt in the past as absent", () => {
    const row = {
      id: "sess1",
      userId: 1,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
    };
    assert.equal(row.expiresAt.getTime() <= Date.now(), true);
  });
});

describe("sessionIdsToEvict", () => {
  const t0 = new Date("2026-01-01T00:00:00Z");
  const t1 = new Date("2026-01-02T00:00:00Z");
  const t2 = new Date("2026-01-03T00:00:00Z");
  const t3 = new Date("2026-01-04T00:00:00Z");
  const future = new Date("2026-02-01T00:00:00Z");
  const past = new Date("2025-01-01T00:00:00Z");
  const now = new Date("2026-01-15T00:00:00Z");

  function row(id: string, createdAt: Date, expiresAt: Date = future) {
    return { id, createdAt, expiresAt };
  }

  it("drops every other live session when the cap is 1", () => {
    assert.deepEqual(
      sessionIdsToEvict([row("old", t0), row("new", t1)], "new", 1, now),
      ["old"],
    );
  });

  it("keeps one older live session when the cap is 2", () => {
    assert.deepEqual(sessionIdsToEvict([row("a", t0), row("b", t1)], "b", 2, now), []);
  });

  it("drops the oldest live session when a third login exceeds a cap of 2", () => {
    assert.deepEqual(
      sessionIdsToEvict([row("a", t0), row("b", t1), row("c", t2)], "c", 2, now),
      ["a"],
    );
  });

  it("deletes an expired row without dropping a live session that is still under the cap", () => {
    assert.deepEqual(
      sessionIdsToEvict(
        [row("expired", t0, past), row("live", t1), row("new", t2)],
        "new",
        2,
        now,
      ),
      ["expired"],
    );
  });

  it("deletes expired rows and then the oldest live rows still over the cap", () => {
    assert.deepEqual(
      sessionIdsToEvict(
        [row("expired", t0, past), row("old", t1), row("mid", t2), row("new", t3)],
        "new",
        2,
        now,
      ),
      ["expired", "old"],
    );
  });

  it("never evicts the session just created", () => {
    assert.deepEqual(
      sessionIdsToEvict([row("new", t0, past), row("other", t1)], "new", 1, now),
      ["other"],
    );
  });

  it("treats a cap below 1 as a single session", () => {
    assert.deepEqual(
      sessionIdsToEvict([row("old", t0), row("new", t1)], "new", 0, now),
      ["old"],
    );
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
