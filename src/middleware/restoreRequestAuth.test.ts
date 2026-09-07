import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { getRequestSessionUserId, requestAuthContext } from "../lib/requestAuthContext.js";
import { withRestoredRequestAuth } from "./restoreRequestAuth.js";

describe("withRestoredRequestAuth", () => {
  it("rebinds ALS after an async multer-like middleware", async () => {
    const req = { sessionUserId: 42, apiKeyUserId: undefined } as Request;
    const res = {} as Response;

    const fakeMulter = (_req: Request, _res: Response, next: NextFunction) => {
      // Simulate multer finishing on a later turn outside sessionLoader's run().
      setImmediate(() => next());
    };

    await new Promise<void>((resolve, reject) => {
      requestAuthContext.run({ sessionUserId: 42 }, () => {
        withRestoredRequestAuth(fakeMulter)(req, res, (err?: unknown) => {
          try {
            if (err) throw err;
            // Intentionally leave the outer run so only the restored store remains
            // for the handler — mirror Express calling the route after next().
            setImmediate(() => {
              try {
                assert.equal(getRequestSessionUserId(), 42);
                resolve();
              } catch (e) {
                reject(e);
              }
            });
          } catch (e) {
            reject(e);
          }
        });
      });
    });
  });
});
