import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { sendError } from "../../lib/httpError.js";
import {
  NOTIFICATION_FREQUENCIES,
  NOTIFICATION_TYPES,
} from "../../lib/notificationSchedule.js";
import { notificationTypeLabel } from "../../services/notifications/templates.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../services/notifications/inbox.js";
import {
  listNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreference,
} from "../../services/notifications/preferences.js";
import { unsubscribeByToken } from "../../services/notifications/unsubscribe.js";
import { getCurrentUserId } from "../../services/users.js";

export const notificationsRouter = Router();

const preferenceSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  inApp: z.boolean(),
  email: z.boolean(),
  frequency: z.enum(NOTIFICATION_FREQUENCIES),
  quietStart: z.number().int().min(0).max(23).nullable(),
  quietEnd: z.number().int().min(0).max(23).nullable(),
  timeZone: z.string().trim().min(1).max(80),
});

notificationsRouter.post("/unsubscribe", async (req, res) => {
  const parsed = z.object({ token: z.string().trim().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, "validation_error", "This unsubscribe link is invalid.");
    return;
  }
  const result = await unsubscribeByToken(db, parsed.data.token);
  if (!result) {
    sendError(res, 400, "invalid_token", "This unsubscribe link is invalid.");
    return;
  }
  res.json({
    data: {
      type: result.type,
      label: notificationTypeLabel(result.type),
    },
  });
});

notificationsRouter.get("/preferences", async (_req, res) => {
  const userId = await getCurrentUserId(db);
  res.json({ data: await listNotificationPreferences(db, userId) });
});

notificationsRouter.put("/preferences", async (req, res) => {
  const parsed = z.object({ items: z.array(preferenceSchema).length(4) }).safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, "validation_error", "Notification preferences are invalid.");
    return;
  }
  const userId = await getCurrentUserId(db);
  try {
    const items = parsed.data.items as NotificationPreference[];
    const saved = await saveNotificationPreferences(db, userId, items);
    res.json({ data: saved });
  } catch (err) {
    if (err instanceof Error && "status" in err && (err as { status?: number }).status === 400) {
      sendError(res, 400, "validation_error", err.message);
      return;
    }
    throw err;
  }
});

notificationsRouter.get("/", async (req, res) => {
  const parsed = z.coerce.number().int().min(1).max(100).optional().safeParse(req.query.limit);
  const limit = parsed.success && parsed.data != null ? parsed.data : 40;
  const userId = await getCurrentUserId(db);
  res.json(await listNotifications(db, userId, limit));
});

notificationsRouter.post("/read-all", async (_req, res) => {
  const userId = await getCurrentUserId(db);
  await markAllNotificationsRead(db, userId);
  res.json({ data: { ok: true } });
});

notificationsRouter.post("/:id/read", async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) {
    sendError(res, 400, "validation_error", "Notification id is invalid.");
    return;
  }
  const userId = await getCurrentUserId(db);
  const row = await markNotificationRead(db, userId, id.data);
  if (!row) {
    sendError(res, 404, "not_found", "Notification not found");
    return;
  }
  res.json({ data: row });
});
