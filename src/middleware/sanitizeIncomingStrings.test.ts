import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import { sanitizeIncomingStrings } from "./sanitizeIncomingStrings.js";

function run(req: Request): void {
  let nextCalled = false;
  sanitizeIncomingStrings(req, {} as Response, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
}

describe("sanitizeIncomingStrings", () => {
  it("strips HTML from a writable query and body", () => {
    const req = {
      body: { name: "<b>hi</b>" },
      query: { q: "<script>alert(1)</script>ok" },
    } as unknown as Request;

    run(req);

    assert.equal((req.body as { name: string }).name, "hi");
    assert.equal(req.query.q, "alert(1)ok");
  });

  it("replaces a getter-backed query without throwing", () => {
    const req = { body: null } as unknown as Request;
    let reads = 0;
    Object.defineProperty(req, "query", {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        return { q: "<script>alert(1)</script>ok" };
      },
    });

    assert.doesNotThrow(() => run(req));
    const readsAfterSanitize = reads;
    assert.equal(req.query.q, "alert(1)ok");
    assert.equal(reads, readsAfterSanitize);
  });
});
