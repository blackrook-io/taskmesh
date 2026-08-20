import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { optionalPlainTitle } from "../../lib/markdownFields.js";
import { toUserProfile } from "../../lib/userFields.js";
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

/** Current (sole) user until auth exists. */
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
