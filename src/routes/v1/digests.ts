import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { DIGEST_SECTIONS } from "../../lib/digest.js";
import { sendError } from "../../lib/httpError.js";
import {
  dismissDigestItem,
  getInbox,
  markDigestSeen,
  saveDigestPrefs,
  snoozeDigestItem,
} from "../../services/digest/inbox.js";
import { buildDigest, getDigest, listDigests } from "../../services/digest/service.js";
import { getCurrentUserId } from "../../services/users.js";

export const digestsRouter = Router();

const itemSchema = z.object({
  entityType: z.string().min(1).max(40),
  entityId: z.number().int().positive(),
  section: z.enum(DIGEST_SECTIONS),
});

digestsRouter.get("/", async (req, res) => {
  const parsed = z.coerce.number().int().min(1).max(50).optional().safeParse(req.query.limit);
  const limit = parsed.success && parsed.data != null ? parsed.data : 12;
  const userId = await getCurrentUserId(db);
  const rows = await listDigests(db, userId, limit);
  res.json({ data: rows });
});

digestsRouter.get("/inbox", async (_req, res) => {
  const userId = await getCurrentUserId(db);
  const inbox = await getInbox(db, userId);
  if (!inbox) {
    sendError(res, 404, "not_found", "User not found");
    return;
  }
  res.json({ data: inbox });
});

digestsRouter.patch("/prefs", async (req, res) => {
  const parsed = z
    .object({
      frequency: z.enum(["daily", "weekly"]).optional(),
      summary: z.boolean().optional(),
      timeZone: z.string().min(1).max(80).optional(),
      sections: z.record(z.string(), z.boolean()).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, "validation_error", "Digest preferences are invalid");
    return;
  }
  const userId = await getCurrentUserId(db);
  const saved = await saveDigestPrefs(db, userId, parsed.data);
  if (!saved.ok) {
    sendError(res, saved.status, saved.status === 400 ? "validation_error" : "not_found", saved.message);
    return;
  }
  res.json({ data: saved.prefs });
});

digestsRouter.post("/run", async (_req, res) => {
  const userId = await getCurrentUserId(db);
  const row = await buildDigest(db, userId, { replace: true });
  if (!row) {
    sendError(res, 404, "not_found", "Digest not found");
    return;
  }
  res.json({ data: row });
});

digestsRouter.post("/seen", async (_req, res) => {
  const userId = await getCurrentUserId(db);
  const result = await markDigestSeen(db, userId);
  res.json({ data: result });
});

digestsRouter.post("/items/dismiss", async (req, res) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, "validation_error", "Digest item is invalid");
    return;
  }
  const userId = await getCurrentUserId(db);
  const result = await dismissDigestItem(db, userId, parsed.data);
  if (!result.ok) {
    sendError(res, result.status, result.status === 400 ? "validation_error" : "not_found", result.message);
    return;
  }
  res.json({ data: { ok: true } });
});

digestsRouter.post("/items/snooze", async (req, res) => {
  const parsed = itemSchema.extend({ span: z.enum(["tomorrow", "week"]) }).safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, "validation_error", "Digest item is invalid");
    return;
  }
  const userId = await getCurrentUserId(db);
  const result = await snoozeDigestItem(db, userId, parsed.data);
  if (!result.ok) {
    sendError(res, result.status, result.status === 400 ? "validation_error" : "not_found", result.message);
    return;
  }
  res.json({ data: { ok: true } });
});

digestsRouter.get("/:id", async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) {
    sendError(res, 400, "validation_error", "Digest id must be a positive integer");
    return;
  }
  const userId = await getCurrentUserId(db);
  const row = await getDigest(db, userId, id.data);
  if (!row) {
    sendError(res, 404, "not_found", "Digest not found");
    return;
  }
  res.json({ data: row });
});
