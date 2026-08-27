import { Router } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import {
  activitySourceFromRequest,
  shouldRecordHistory,
} from "../../lib/activityRequest.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { parseRouteId } from "../../lib/routeParams.js";
import { requireAdministrator } from "../../middleware/requireAdministrator.js";
import { plainTitle } from "../../lib/markdownFields.js";
import {
  createAdminApiKey,
  deleteApiKeyRecord,
  expireApiKey,
  listAdminApiKeys,
  parseApiKeyExpiresAt,
  revokeApiKey,
  suspendApiKey,
  unsuspendApiKey,
  updateApiKeyExpiry,
} from "../../services/adminApiKeys.js";
import {
  createAdminUser,
  deactivateUser,
  deleteAdminUser,
  listAdminUsers,
  lockUser,
  reactivateUser,
  resetUserPassword,
  unlockUser,
} from "../../services/adminUsers.js";
import {
  assignRole,
  createRole,
  deleteRole,
  listRoles,
  removeRole,
  renameRole,
} from "../../services/roles.js";
import {
  getApiUsageSummary,
  listApiRequestLogs,
  type ApiLogLevel,
  type ApiLogOutcome,
} from "../../services/apiRequestLogs.js";
import { getDatabaseStatsSummary } from "../../services/dbStats.js";
import { isUsageRange } from "../../lib/usageRange.js";
import { THEME_IDS } from "../../lib/theme.js";
import {
  getSystemProperties,
  patchSystemProperties,
} from "../../services/systemProperties.js";
import {
  deleteAdminTemplate,
  listAdminTemplates,
  patchAdminTemplate,
} from "../../services/taskDescriptionTemplates.js";
import { recordTaskChanges } from "../../services/tasks.js";
import {
  attachTaskActor,
  getCurrentUser,
  getCurrentUserId,
} from "../../services/users.js";

export const adminRouter = Router();

adminRouter.use(requireAdministrator);

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

const createUserBody = z
  .object({
    displayName: plainTitle(200),
    email: z.string().trim().email().max(320),
    password: z.string().min(1).max(200),
  })
  .strict();

adminRouter.post("/users", async (req, res) => {
  try {
    const parsed = createUserBody.parse(req.body);
    const actor = await getCurrentUser(db);
    const data = await createAdminUser(db, parsed);
    res.locals.logUserId = actor.id;
    res.locals.logMessage = `User created: ${data.referenceId} (${data.email})`;
    res.status(201).json({ data });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.delete("/users/:id", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const actor = await getCurrentUser(db);
    await deleteAdminUser(db, id, actor.id);
    res.locals.logUserId = actor.id;
    res.locals.logMessage = `User deleted: id ${id}`;
    res.status(204).send();
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.post("/users/:id/lock", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const actor = await getCurrentUser(db);
    const data = await lockUser(db, id);
    res.locals.logUserId = actor.id;
    res.locals.logMessage = `User locked: ${data.referenceId}`;
    res.json({ data });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.post("/users/:id/unlock", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const actor = await getCurrentUser(db);
    const data = await unlockUser(db, id);
    res.locals.logUserId = actor.id;
    res.locals.logMessage = `User unlocked: ${data.referenceId}`;
    res.json({ data });
  } catch (err) {
    if (serviceError(res, err)) return;
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
    const id = parseRouteId(req, "id");
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
    const id = parseRouteId(req, "id");
    const data = await deactivateUser(db, id);
    res.json({ data });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.post("/users/:id/reactivate", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const data = await reactivateUser(db, id);
    res.json({ data });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

// ── Roles ──────────────────────────────────────────────────────────────────

adminRouter.get("/roles", async (_req, res) => {
  try {
    res.json({ data: await listRoles(db) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

const createRoleBody = z
  .object({
    name: z.string().trim().min(1).max(80),
  })
  .strict();

adminRouter.post("/roles", async (req, res) => {
  try {
    const parsed = createRoleBody.parse(req.body);
    const actor = await getCurrentUser(db);
    const data = await createRole(db, parsed.name);
    res.locals.logUserId = actor.id;
    res.locals.logMessage = `Role created: ${data.name} (${data.slug})`;
    res.status(201).json({ data });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

const patchRoleBody = z
  .object({
    name: z.string().trim().min(1).max(80),
  })
  .strict();

adminRouter.patch("/roles/:id", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const parsed = patchRoleBody.parse(req.body);
    const actor = await getCurrentUser(db);
    const data = await renameRole(db, id, parsed.name);
    res.locals.logUserId = actor.id;
    res.locals.logMessage = `Role renamed: ${data.name} (${data.slug})`;
    res.json({ data });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.delete("/roles/:id", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const actor = await getCurrentUser(db);
    await deleteRole(db, id);
    res.locals.logUserId = actor.id;
    res.locals.logMessage = `Role deleted: id ${id}`;
    res.status(204).send();
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

const assignRoleBody = z
  .object({
    roleId: z.number().int().positive(),
  })
  .strict();

adminRouter.post("/users/:id/roles", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const parsed = assignRoleBody.parse(req.body);
    const actor = await getCurrentUser(db);
    const roles = await assignRole(db, id, parsed.roleId);
    res.locals.logUserId = actor.id;
    res.locals.logMessage = `Role assigned: user ${id} role ${parsed.roleId}`;
    res.json({ data: roles });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.delete("/users/:id/roles/:roleId", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const roleId = parseRouteId(req, "roleId");
    const actor = await getCurrentUser(db);
    const roles = await removeRole(db, id, roleId);
    res.locals.logUserId = actor.id;
    res.locals.logMessage = `Role removed: user ${id} role ${roleId}`;
    res.json({ data: roles });
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
    const actor = await getCurrentUser(db);
    const ownerId = parsed.userId ?? actor.id;
    const { key, rawKey } = await createAdminApiKey(db, {
      userId: ownerId,
      name: parsed.name,
      access: parsed.access,
      expiresAt: parsed.expiresAt ? parseApiKeyExpiresAt(parsed.expiresAt) : undefined,
    });
    res.locals.logUserId = actor.id;
    res.locals.logApiKeyId = key.id;
    res.locals.logMessage =
      `API key created: ${key.name} (${key.prefix}, ${key.access}) for ${key.owner.referenceId}`;
    res.status(201).json({ data: { ...key, rawKey } });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

const patchKeyBody = z
  .object({
    expiresAt: z.string().datetime(),
  })
  .strict();

adminRouter.patch("/api-keys/:id", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const parsed = patchKeyBody.parse(req.body);
    const actor = await getCurrentUser(db);
    const key = await updateApiKeyExpiry(db, id, parseApiKeyExpiresAt(parsed.expiresAt));
    res.locals.logUserId = actor.id;
    res.locals.logApiKeyId = key.id;
    res.locals.logMessage = `API key expiry updated: ${key.name} (${key.prefix})`;
    res.json({ data: key });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.post("/api-keys/:id/suspend", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const actor = await getCurrentUser(db);
    const key = await suspendApiKey(db, id);
    res.locals.logUserId = actor.id;
    res.locals.logApiKeyId = key.id;
    res.locals.logMessage = `API key suspended: ${key.name} (${key.prefix})`;
    res.json({ data: key });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.post("/api-keys/:id/unsuspend", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const actor = await getCurrentUser(db);
    const key = await unsuspendApiKey(db, id);
    res.locals.logUserId = actor.id;
    res.locals.logApiKeyId = key.id;
    res.locals.logMessage = `API key unsuspended: ${key.name} (${key.prefix}) → ${key.status}`;
    res.json({ data: key });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.post("/api-keys/:id/expire", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const actor = await getCurrentUser(db);
    const key = await expireApiKey(db, id);
    res.locals.logUserId = actor.id;
    res.locals.logApiKeyId = key.id;
    res.locals.logMessage = `API key expired: ${key.name} (${key.prefix})`;
    res.json({ data: key });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.post("/api-keys/:id/revoke", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const actor = await getCurrentUser(db);
    const key = await revokeApiKey(db, id);
    res.locals.logUserId = actor.id;
    res.locals.logApiKeyId = key.id;
    res.locals.logMessage = `API key revoked: ${key.name} (${key.prefix})`;
    res.json({ data: key });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.delete("/api-keys/:id", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const actor = await getCurrentUser(db);
    const key = await deleteApiKeyRecord(db, id);
    res.locals.logUserId = actor.id;
    res.locals.logMessage = `API key deleted: ${key.name} (${key.prefix})`;
    res.json({ data: key });
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
    sessionTimeoutMinutes: z.number().int().min(1).max(10_080).optional(),
    defaultTheme: z.enum(THEME_IDS).optional(),
  })
  .strict();

adminRouter.patch("/system-properties", async (req, res) => {
  try {
    const parsed = patchPropsBody.parse(req.body);
    if (
      parsed.apiRateLimitPerMinute === undefined &&
      parsed.loginFailureThreshold === undefined &&
      parsed.sessionTimeoutMinutes === undefined &&
      parsed.defaultTheme === undefined
    ) {
      sendError(res, 400, "empty_patch", "No updatable fields provided");
      return;
    }
    const before = await getSystemProperties(db);
    const actor = await getCurrentUser(db);
    const after = await patchSystemProperties(db, parsed);
    const parts: string[] = [];
    if (
      parsed.apiRateLimitPerMinute !== undefined &&
      before.apiRateLimitPerMinute !== after.apiRateLimitPerMinute
    ) {
      parts.push(
        `api_rate_limit_per_minute ${before.apiRateLimitPerMinute}→${after.apiRateLimitPerMinute}`,
      );
    }
    if (
      parsed.loginFailureThreshold !== undefined &&
      before.loginFailureThreshold !== after.loginFailureThreshold
    ) {
      parts.push(
        `login_failure_threshold ${before.loginFailureThreshold}→${after.loginFailureThreshold}`,
      );
    }
    if (
      parsed.sessionTimeoutMinutes !== undefined &&
      before.sessionTimeoutMinutes !== after.sessionTimeoutMinutes
    ) {
      parts.push(
        `session_timeout_minutes ${before.sessionTimeoutMinutes}→${after.sessionTimeoutMinutes}`,
      );
    }
    if (
      parsed.defaultTheme !== undefined &&
      before.defaultTheme !== after.defaultTheme
    ) {
      parts.push(`default_theme ${before.defaultTheme}→${after.defaultTheme}`);
    }
    res.locals.logUserId = actor.id;
    res.locals.logMessage =
      parts.length > 0
        ? `System properties updated: ${parts.join("; ")}`
        : "System properties update (no value change)";
    res.json({ data: after });
  } catch (err) {
    handleRouteError(res, err);
  }
});

// ── API usage + logs ───────────────────────────────────────────────────────

adminRouter.get("/api-usage/summary", async (req, res) => {
  try {
    const range = String(req.query.range ?? "1d");
    if (!isUsageRange(range)) {
      sendError(res, 400, "invalid_range", "range must be 1h, 1d, 1w, or 1m");
      return;
    }
    res.json({ data: await getApiUsageSummary(db, range) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

adminRouter.get("/database-stats/summary", async (req, res) => {
  try {
    const range = String(req.query.range ?? "1d");
    if (!isUsageRange(range)) {
      sendError(res, 400, "invalid_range", "range must be 1h, 1d, 1w, or 1m");
      return;
    }
    res.json({ data: await getDatabaseStatsSummary(db, range) });
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
    const levelRaw = req.query.level ? String(req.query.level) : undefined;
    const levels: ApiLogLevel[] = ["info", "warn", "error"];
    if (levelRaw && !levels.includes(levelRaw as ApiLogLevel)) {
      sendError(res, 400, "invalid_level", "level must be info, warn, or error");
      return;
    }
    const pathContains = req.query.path
      ? String(req.query.path).slice(0, 200)
      : undefined;
    const q = req.query.q ? String(req.query.q).slice(0, 200) : undefined;
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
      level: levelRaw as ApiLogLevel | undefined,
      pathContains,
      q,
      since,
      until,
    });
    res.json({ data: result.data, total: result.total, limit, offset });
  } catch (err) {
    handleRouteError(res, err);
  }
});

// ── Task description templates ─────────────────────────────────────────────

adminRouter.get("/task-description-templates", async (_req, res) => {
  try {
    res.json({ data: await listAdminTemplates(db) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

const templatePatchBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    isGlobal: z.boolean().optional(),
  })
  .strict()
  .refine((b) => b.name !== undefined || b.isGlobal !== undefined, {
    message: "At least one of name or isGlobal is required",
  });

adminRouter.patch("/task-description-templates/:id", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const patch = templatePatchBody.parse(req.body);
    const data = await patchAdminTemplate(db, id, patch);
    res.json({ data });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

adminRouter.delete("/task-description-templates/:id", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    await deleteAdminTemplate(db, id);
    res.status(204).send();
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

// ── Soft-deleted tasks ─────────────────────────────────────────────────────

adminRouter.get("/deleted-tasks", async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: schema.tasks.id,
        number: schema.tasks.number,
        title: schema.tasks.title,
        projectId: schema.tasks.projectId,
        projectTitle: schema.projects.name,
        updatedAt: schema.tasks.updatedAt,
        createdAt: schema.tasks.createdAt,
      })
      .from(schema.tasks)
      .leftJoin(schema.projects, eq(schema.tasks.projectId, schema.projects.id))
      .where(eq(schema.tasks.state, "deleted"))
      .orderBy(desc(schema.tasks.updatedAt), desc(schema.tasks.id));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

adminRouter.post("/deleted-tasks/:id/restore", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const [existing] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
    if (!existing) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    if (existing.state !== "deleted") {
      sendError(res, 400, "not_deleted", "Task is not deleted");
      return;
    }
    const actorId = await getCurrentUserId(db);
    const [row] = await db
      .update(schema.tasks)
      .set({
        state: "new",
        updatedAt: new Date(),
        updatedById: actorId,
      })
      .where(eq(schema.tasks.id, id))
      .returning();
    if (!row) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    await recordTaskChanges(db, id, existing, row, {
      actorId,
      source: activitySourceFromRequest(req),
      recordHistory: shouldRecordHistory(req),
    });
    res.json({ data: await attachTaskActor(db, row) });
  } catch (err) {
    handleRouteError(res, err);
  }
});
