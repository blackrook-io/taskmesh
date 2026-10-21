import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { isUsageRange } from "../../lib/usageRange.js";
import { MAIL_RESULTS } from "../../services/mail/constants.js";
import {
  getMailActivity,
  listMailLog,
  sendTestMail,
  testMailConnection,
} from "../../services/mail/outbound.js";
import { getMailSettingsPublic, mailPatchSchema, saveMailSettings } from "../../services/mail/settings.js";
import { getCurrentUserId } from "../../services/users.js";

const testSendSchema = z.object({
  to: z.string().trim().email().max(320),
});

export function registerAdminMailRoutes(adminRouter: Router): void {
  adminRouter.get("/mail", async (_req, res) => {
    try {
      res.json({ data: await getMailSettingsPublic(db) });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  adminRouter.patch("/mail", async (req, res) => {
    try {
      const patch = mailPatchSchema.parse(req.body);
      const actorId = await getCurrentUserId(db);
      res.json({ data: await saveMailSettings(db, patch, actorId) });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  adminRouter.post("/mail/test-connection", async (_req, res) => {
    try {
      await testMailConnection(db);
      res.json({ data: { ok: true } });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  adminRouter.post("/mail/test-send", async (req, res) => {
    try {
      const body = testSendSchema.parse(req.body);
      const result = await sendTestMail(db, body.to);
      res.json({ data: result });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  adminRouter.get("/mail/log", async (req, res) => {
    try {
      const limit = clampInt(req.query.limit, 50, 1, 100);
      const offset = clampInt(req.query.offset, 0, 0, 10_000);
      const result = typeof req.query.result === "string" ? req.query.result : "";
      if (result && !(MAIL_RESULTS as readonly string[]).includes(result)) {
        sendError(res, 400, "invalid_result", "result is not a mail log result");
        return;
      }
      const sinceRaw = typeof req.query.since === "string" ? req.query.since : "";
      const since = sinceRaw ? new Date(sinceRaw) : undefined;
      if (since && Number.isNaN(since.getTime())) {
        sendError(res, 400, "invalid_since", "since must be an ISO timestamp");
        return;
      }
      const q = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : undefined;
      const page = await listMailLog(db, {
        limit,
        offset,
        result: result || undefined,
        since,
        q,
      });
      res.json(page);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  adminRouter.get("/mail/activity", async (req, res) => {
    try {
      const raw = typeof req.query.range === "string" ? req.query.range : "1d";
      if (!isUsageRange(raw)) {
        sendError(res, 400, "invalid_range", "range must be 1h, 1d, 1w, or 1m");
        return;
      }
      res.json({ data: await getMailActivity(raw) });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
