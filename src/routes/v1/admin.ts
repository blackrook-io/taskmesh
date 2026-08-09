import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import {
  createAdminApiKey,
  expireApiKey,
  listAdminApiKeys,
  revokeApiKey,
  suspendApiKey,
  unsuspendApiKey,
} from "../../services/adminApiKeys.js";
import {
  deactivateUser,
  listAdminUsers,
  reactivateUser,
  resetUserPassword,
} from "../../services/adminUsers.js";
import {
  getApiUsageSummary,
  listApiRequestLogs,
  type ApiLogOutcome,
  type UsageRange,
} from "../../services/apiRequestLogs.js";
import {
  getSystemProperties,
  patchSystemProperties,
} from "../../services/systemProperties.js";
import { getCurrentUser } from "../../services/users.js";

export const adminRouter = Router();

function serviceError(res: Parameters<typeof sendError>[0], err: unknown): boolean {
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    "code" in err &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    const e = err as { status: number; code: string; message: string };
    sendError(res, e.status, e.code, e.message);
    return true;
  }
  return false;
}

// ── Users ──────────────────────────────────────────────────────────────────

adminRouter.get("/users", async (_req, res) => {
  try {
    res.json({ data: await listAdminUsers(db) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

const resetPasswordBody = z
  .object({
    password: z.string().min(1).max(200),
  })
  .strict();

adminRouter.post("/users/:id/reset-password", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      sendError(res, 400, "invalid_id", "Invalid user id");
      return;
    }
    const { password } = resetPasswordBody.parse(req.body);
    const data = await resetUserPassword(db, id, password);
    res.json({ data });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.post("/users/:id/deactivate", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      sendError(res, 400, "invalid_id", "Invalid user id");
      return;
    }
    const data = await deactivateUser(db, id);
    res.json({ data });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.post("/users/:id/reactivate", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      sendError(res, 400, "invalid_id", "Invalid user id");
      return;
    }
    const data = await reactivateUser(db, id);
    res.json({ data });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

// ── API keys ───────────────────────────────────────────────────────────────

adminRouter.get("/api-keys", async (_req, res) => {
  try {
    res.json({ data: await listAdminApiKeys(db) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

const createKeyBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    access: z.enum(["readonly", "readwrite"]).default("readwrite"),
    userId: z.number().int().positive().optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

adminRouter.post("/api-keys", async (req, res) => {
  try {
    const parsed = createKeyBody.parse(req.body);
    const ownerId =
      parsed.userId ?? (await getCurrentUser(db)).id;
    const { key, rawKey } = await createAdminApiKey(db, {
      userId: ownerId,
      name: parsed.name,
      access: parsed.access,
      expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : undefined,
    });
    res.status(201).json({ data: { ...key, rawKey } });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.post("/api-keys/:id/suspend", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      sendError(res, 400, "invalid_id", "Invalid key id");
      return;
    }
    res.json({ data: await suspendApiKey(db, id) });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.post("/api-keys/:id/unsuspend", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      sendError(res, 400, "invalid_id", "Invalid key id");
      return;
    }
    res.json({ data: await unsuspendApiKey(db, id) });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.post("/api-keys/:id/expire", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      sendError(res, 400, "invalid_id", "Invalid key id");
      return;
    }
    res.json({ data: await expireApiKey(db, id) });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.post("/api-keys/:id/revoke", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      sendError(res, 400, "invalid_id", "Invalid key id");
      return;
    }
    res.json({ data: await revokeApiKey(db, id) });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

// ── System properties ──────────────────────────────────────────────────────

adminRouter.get("/system-properties", async (_req, res) => {
  try {
    res.json({ data: await getSystemProperties(db) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

const patchPropsBody = z
  .object({
    apiRateLimitPerMinute: z.number().int().min(1).max(100_000).optional(),
    loginFailureThreshold: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

adminRouter.patch("/system-properties", async (req, res) => {
  try {
    const parsed = patchPropsBody.parse(req.body);
    if (
      parsed.apiRateLimitPerMinute === undefined &&
      parsed.loginFailureThreshold === undefined
    ) {
      sendError(res, 400, "empty_patch", "No updatable fields provided");
      return;
    }
    res.json({ data: await patchSystemProperties(db, parsed) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

// ── API usage + logs ───────────────────────────────────────────────────────

adminRouter.get("/api-usage/summary", async (req, res) => {
  try {
    const range = (String(req.query.range ?? "1d") as UsageRange);
    if (!["1h", "1d", "1w"].includes(range)) {
      sendError(res, 400, "invalid_range", "range must be 1h, 1d, or 1w");
      return;
    }
    res.json({ data: await getApiUsageSummary(db, range) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

adminRouter.get("/api-logs", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
    const outcomeRaw = req.query.outcome ? String(req.query.outcome) : undefined;
    const allowed: ApiLogOutcome[] = [
      "success",
      "api_failure",
      "auth_failure",
      "access_violation",
    ];
    if (outcomeRaw && !allowed.includes(outcomeRaw as ApiLogOutcome)) {
      sendError(res, 400, "invalid_outcome", "Invalid outcome filter");
      return;
    }
    const pathContains = req.query.path
      ? String(req.query.path).slice(0, 200)
      : undefined;
    const since = req.query.since ? new Date(String(req.query.since)) : undefined;
    const until = req.query.until ? new Date(String(req.query.until)) : undefined;
    if (since && Number.isNaN(since.getTime())) {
      sendError(res, 400, "invalid_since", "Invalid since datetime");
      return;
    }
    if (until && Number.isNaN(until.getTime())) {
      sendError(res, 400, "invalid_until", "Invalid until datetime");
      return;
    }

    const result = await listApiRequestLogs(db, {
      limit,
      offset,
      outcome: outcomeRaw as ApiLogOutcome | undefined,
      pathContains,
      since,
      until,
    });
    res.json({ data: result.data, total: result.total, limit, offset });
  } catch (err) {
    handleRouteError(res, err);
  }
});
