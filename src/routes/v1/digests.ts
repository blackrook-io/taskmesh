import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { sendError } from "../../lib/httpError.js";
import { getCurrentUserId } from "../../services/users.js";
import { buildDigest, getDigest, listDigests } from "../../services/digest/service.js";

export const digestsRouter = Router();

digestsRouter.get("/", async (req, res) => {
  const parsed = z.coerce.number().int().min(1).max(50).optional().safeParse(req.query.limit);
  const limit = parsed.success && parsed.data != null ? parsed.data : 12;
  const userId = await getCurrentUserId(db);
  const rows = await listDigests(db, userId, limit);
  res.json({ data: rows });
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

digestsRouter.post("/run", async (_req, res) => {
  const userId = await getCurrentUserId(db);
  const row = await buildDigest(db, userId, { replace: true });
  if (!row) {
    sendError(res, 404, "not_found", "Digest not found");
    return;
  }
  res.json({ data: row });
});
