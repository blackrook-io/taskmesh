import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { optionalPlainTitle } from "../../lib/markdownFields.js";
import { parseRouteId } from "../../lib/routeParams.js";
import { toUserProfile } from "../../lib/userFields.js";
import {
  createApiKeyForUser,
  deleteApiKeyRecord,
  listApiKeysForUser,
  parseApiKeyExpiresAt,
  revokeApiKey,
  updateApiKeyExpiry,
} from "../../services/apiKeys.js";
import { getCurrentUser, setCurrentUserPassword } from "../../services/users.js";

/** Required valid email when provided — null/empty not allowed (T0062). */
const emailSchema = z.string().trim().email().max(320);

const patchBody = z
  .object({
    displayName: optionalPlainTitle(200),
    email: emailSchema.optional(),
    avatarUploadId: z.union([z.number().int().positive(), z.null()]).optional(),
  })
  .strict();

const passwordBody = z
  .object({
    password: z.string().min(1).max(200),
  })
  .strict();

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

async function resolveAvatarStoredName(
  avatarUploadId: number | null,
): Promise<string | null> {
  if (avatarUploadId == null) return null;
  const [upload] = await db
    .select({ storedName: schema.uploads.storedName })
    .from(schema.uploads)
    .where(eq(schema.uploads.id, avatarUploadId))
    .limit(1);
  return upload?.storedName ?? null;
}

async function profilePayload(user: typeof schema.users.$inferSelect) {
  const storedName = await resolveAvatarStoredName(user.avatarUploadId);
  return toUserProfile(user, storedName);
}

export const usersRouter = Router();

/** Authenticated profile for the session user. */
usersRouter.get("/me", async (_req, res) => {
  try {
    const user = await getCurrentUser(db);
    res.json({ data: await profilePayload(user) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

usersRouter.patch("/me", async (req, res) => {
  try {
    const parsed = patchBody.parse(req.body);
    if (
      parsed.displayName === undefined &&
      parsed.email === undefined &&
      parsed.avatarUploadId === undefined
    ) {
      sendError(res, 400, "empty_patch", "No updatable fields provided");
      return;
    }

    const current = await getCurrentUser(db);
    const patch: {
      displayName?: string;
      email?: string;
      avatarUploadId?: number | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (parsed.displayName !== undefined) {
      patch.displayName = parsed.displayName;
    }
    if (parsed.email !== undefined) {
      patch.email = parsed.email;
    }
    if (parsed.avatarUploadId !== undefined) {
      if (parsed.avatarUploadId !== null) {
        const [upload] = await db
          .select({ id: schema.uploads.id })
          .from(schema.uploads)
          .where(eq(schema.uploads.id, parsed.avatarUploadId))
          .limit(1);
        if (!upload) {
          sendError(res, 400, "invalid_avatar", "Upload not found for avatarUploadId");
          return;
        }
      }
      patch.avatarUploadId = parsed.avatarUploadId;
    }

    const [row] = await db
      .update(schema.users)
      .set(patch)
      .where(eq(schema.users.id, current.id))
      .returning();
    if (!row) {
      sendError(res, 500, "update_failed", "Could not update profile");
      return;
    }
    res.json({ data: await profilePayload(row) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

/** Set or change password for the current user. Never returns the secret. */
usersRouter.post("/me/password", async (req, res) => {
  try {
    const { password } = passwordBody.parse(req.body);
    const row = await setCurrentUserPassword(db, password);
    res.json({ data: await profilePayload(row) });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

// ── Own API keys (T0063) ───────────────────────────────────────────────────

usersRouter.get("/me/api-keys", async (_req, res) => {
  try {
    const user = await getCurrentUser(db);
    res.json({ data: await listApiKeysForUser(db, user.id) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

const createOwnKeyBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    access: z.enum(["readonly", "readwrite"]).default("readwrite"),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

usersRouter.post("/me/api-keys", async (req, res) => {
  try {
    const parsed = createOwnKeyBody.parse(req.body);
    const user = await getCurrentUser(db);
    const { key, rawKey } = await createApiKeyForUser(db, {
      userId: user.id,
      name: parsed.name,
      access: parsed.access,
      expiresAt: parsed.expiresAt ? parseApiKeyExpiresAt(parsed.expiresAt) : undefined,
    });
    res.locals.logUserId = user.id;
    res.locals.logApiKeyId = key.id;
    res.locals.logMessage = `API key created: ${key.name} (${key.prefix}, ${key.access})`;
    res.status(201).json({ data: { ...key, rawKey } });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

const patchOwnKeyBody = z
  .object({
    expiresAt: z.string().datetime(),
  })
  .strict();

usersRouter.patch("/me/api-keys/:id", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const parsed = patchOwnKeyBody.parse(req.body);
    const user = await getCurrentUser(db);
    const key = await updateApiKeyExpiry(db, id, parseApiKeyExpiresAt(parsed.expiresAt), {
      ownerUserId: user.id,
    });
    res.locals.logUserId = user.id;
    res.locals.logApiKeyId = key.id;
    res.locals.logMessage = `API key expiry updated: ${key.name} (${key.prefix})`;
    res.json({ data: key });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

usersRouter.delete("/me/api-keys/:id", async (req, res) => {
  try {
    const id = parseRouteId(req, "id");
    const user = await getCurrentUser(db);
    const purge =
      req.query.purge === "1" ||
      req.query.purge === "true" ||
      req.query.delete === "1" ||
      req.query.delete === "true";
    if (purge) {
      const key = await deleteApiKeyRecord(db, id, { ownerUserId: user.id });
      res.locals.logUserId = user.id;
      res.locals.logMessage = `API key deleted: ${key.name} (${key.prefix})`;
      res.json({ data: key });
      return;
    }
    const key = await revokeApiKey(db, id, { ownerUserId: user.id });
    res.locals.logUserId = user.id;
    res.locals.logApiKeyId = key.id;
    res.locals.logMessage = `API key revoked: ${key.name} (${key.prefix})`;
    res.json({ data: key });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});
