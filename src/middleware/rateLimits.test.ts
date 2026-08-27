import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import {
  clientRateLimitKey,
  createRateLimiter,
  loginRateLimitKey,
} from "./rateLimits.js";

function mockReq(overrides: Partial<Request> & { ip?: string } = {}): Request {
  return {
    ip: "203.0.113.10",
    sessionUserId: undefined,
    apiKeyId: undefined,
    ...overrides,
  } as Request;
}

function mockRes(): Response & {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
} {
  const res = {
    locals: {} as Record<string, string>,
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
  };
  return res as unknown as Response & {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
  };
}

async function hit(
  limiter: ReturnType<typeof createRateLimiter>,
  req: Request,
): Promise<{ next: boolean; res: ReturnType<typeof mockRes> }> {
  const res = mockRes();
  let nextCalled = false;
  await new Promise<void>((resolve, reject) => {
    try {
      const maybe = limiter(req, res, () => {
        nextCalled = true;
        resolve();
      }) as void | Promise<void>;
      if (maybe && typeof maybe.then === "function") {
        void maybe.then(() => {
          if (!nextCalled) resolve();
        }, reject);
      }
    } catch (err) {
      reject(err);
    }
  });
  return { next: nextCalled, res };
}

describe("rateLimits keying", () => {
  it("prefers api key, then session user, then IP", () => {
    assert.equal(clientRateLimitKey(mockReq({ apiKeyId: 9, sessionUserId: 1 })), "apikey:9");
    assert.equal(clientRateLimitKey(mockReq({ sessionUserId: 3 })), "user:3");
    assert.match(clientRateLimitKey(mockReq()), /^ip:/);
  });

  it("login key is always IP-based", () => {
    assert.match(loginRateLimitKey(mockReq({ sessionUserId: 1 })), /^login:/);
    assert.notEqual(
      loginRateLimitKey(mockReq({ sessionUserId: 1 })),
      clientRateLimitKey(mockReq({ sessionUserId: 1 })),
    );
  });
});

describe("createRateLimiter", () => {
  it("allows requests under the limit and 429s after", async () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      limit: 2,
      skipValidation: true,
      keyGenerator: (req) => `test:${req.sessionUserId ?? "anon"}`,
    });

    const req = mockReq({ sessionUserId: 42 });
    const a = await hit(limiter, req);
    assert.equal(a.next, true);

    const b = await hit(limiter, req);
    assert.equal(b.next, true);

    const c = await hit(limiter, req);
    assert.equal(c.next, false);
    assert.equal(c.res.statusCode, 429);
    assert.deepEqual(c.res.body, {
      error: {
        code: "rate_limited",
        message: "Too many requests. Please try again later.",
      },
    });
    assert.ok(c.res.headers["retry-after"]);
    assert.equal(c.res.locals.logMessage, "Rate limit exceeded");
  });

  it("isolates buckets by identity", async () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      limit: 1,
      skipValidation: true,
      keyGenerator: (req) => `iso:${req.sessionUserId ?? "anon"}`,
    });

    const first = await hit(limiter, mockReq({ sessionUserId: 1 }));
    assert.equal(first.next, true);
    const blocked = await hit(limiter, mockReq({ sessionUserId: 1 }));
    assert.equal(blocked.next, false);
    assert.equal(blocked.res.statusCode, 429);

    const other = await hit(limiter, mockReq({ sessionUserId: 2 }));
    assert.equal(other.next, true);
  });
});
