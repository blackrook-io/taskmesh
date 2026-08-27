import type { Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db } from "../db/client.js";
import { sendError } from "../lib/httpError.js";
import { getSystemProperties } from "../services/systemProperties.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Identity for authenticated buckets; IP for pre-auth / anonymous. */
export function clientRateLimitKey(req: Request): string {
  if (req.apiKeyId != null) return `apikey:${req.apiKeyId}`;
  if (req.sessionUserId != null) return `user:${req.sessionUserId}`;
  return `ip:${ipKeyGenerator(req.ip ?? "127.0.0.1")}`;
}

/** Login is public — always key by client IP. */
export function loginRateLimitKey(req: Request): string {
  return `login:${ipKeyGenerator(req.ip ?? "127.0.0.1")}`;
}

function sendRateLimited(req: Request, res: Response): void {
  const info = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit;
  const reset = info?.resetTime;
  if (reset instanceof Date) {
    const retryAfterSec = Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
  }
  res.locals.logMessage = "Rate limit exceeded";
  sendError(res, 429, "rate_limited", "Too many requests. Please try again later.");
}

export type CreateRateLimiterOptions = {
  windowMs: number;
  limit: number;
  keyGenerator?: (req: Request) => string;
  /** Disable library validations (unit tests with mock requests). */
  skipValidation?: boolean;
};

/** Shared factory so tests can use tiny windows/limits with the same handler shape. */
export function createRateLimiter(opts: CreateRateLimiterOptions) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: opts.keyGenerator ?? clientRateLimitKey,
    handler: (req, res) => {
      sendRateLimited(req, res);
    },
    skip: () => process.env.RATE_LIMIT_DISABLE === "1",
    validate: opts.skipValidation ? false : { keyGeneratorIpFallback: false },
  });
}

/** Loose ceiling so miscellaneous CRUD cannot unbounded-flood. */
export const globalApiRateLimit = createRateLimiter({
  windowMs: MINUTE,
  limit: 300,
});

/** Credential stuffing / lockout amplification. */
export const loginRateLimit = createRateLimiter({
  windowMs: 15 * MINUTE,
  limit: 20,
  keyGenerator: loginRateLimitKey,
});

/** Backup run + restore, import — expensive CPU/disk/Postgres. */
export const heavyWriteRateLimit = createRateLimiter({
  windowMs: HOUR,
  limit: 5,
});

/** Image uploads. */
export const uploadRateLimit = createRateLimiter({
  windowMs: 15 * MINUTE,
  limit: 60,
});

/** Assistant chat (OpenAI spend). */
export const assistantChatRateLimit = createRateLimiter({
  windowMs: MINUTE,
  limit: 10,
});

/** Global search (Postgres ILIKE fan-out). */
export const searchRateLimit = createRateLimiter({
  windowMs: MINUTE,
  limit: 60,
});

/**
 * Per-API-key budget from Admin `api_rate_limit_per_minute` (default 60).
 * Skips when the request is not authenticated via an API key.
 */
export const apiKeyRateLimit = rateLimit({
  windowMs: MINUTE,
  limit: async () => {
    const props = await getSystemProperties(db);
    return Math.max(1, props.apiRateLimitPerMinute);
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `apikey:${req.apiKeyId ?? "none"}`,
  handler: (req, res) => {
    sendRateLimited(req, res);
  },
  skip: (req) =>
    req.apiKeyId == null || process.env.RATE_LIMIT_DISABLE === "1",
  validate: { keyGeneratorIpFallback: false },
});
