import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { toUserRef } from "../../lib/userFields.js";
import { getCurrentUser } from "../../services/users.js";

const patchBody = z.object({
  displayName: z.string().trim().min(1).max(200),
});

export const usersRouter = Router();

/** Current (sole) user until auth exists. */
usersRouter.get("/me", async (_req, res) => {
  try {
    const user = await getCurrentUser(db);
    res.json({ data: toUserRef(user) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

usersRouter.patch("/me", async (req, res) => {
  try {
    const parsed = patchBody.parse(req.body);
    const current = await getCurrentUser(db);
    const [row] = await db
      .update(schema.users)
      .set({
        displayName: parsed.displayName,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, current.id))
      .returning();
    if (!row) {
      sendError(res, 500, "update_failed", "Could not update profile");
      return;
    }
    res.json({ data: toUserRef(row) });
  } catch (err) {
    handleRouteError(res, err);
  }
});
