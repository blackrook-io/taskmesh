import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";

const idParam = z.coerce.number().int().positive();

const commentBody = z.object({
  body: z.string().min(1).max(50_000),
});

/** Task history timeline: comments (editable) + auto-recorded field changes. */
export const taskActivityRouter = Router();

taskActivityRouter.get("/:taskId/activity", async (req, res) => {
  try {
    const taskId = idParam.parse(req.params.taskId);
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!task) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    const rows = await db
      .select()
      .from(schema.taskActivity)
      .where(eq(schema.taskActivity.taskId, taskId))
      .orderBy(asc(schema.taskActivity.createdAt), asc(schema.taskActivity.id));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

taskActivityRouter.post("/:taskId/activity", async (req, res) => {
  try {
    const taskId = idParam.parse(req.params.taskId);
    const parsed = commentBody.parse(req.body);
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!task) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    const [row] = await db
      .insert(schema.taskActivity)
      .values({ taskId, kind: "comment", body: parsed.body })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create comment");
      return;
    }
    res.status(201).json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

taskActivityRouter.patch("/:taskId/activity/:entryId", async (req, res) => {
  try {
    const taskId = idParam.parse(req.params.taskId);
    const entryId = idParam.parse(req.params.entryId);
    const parsed = commentBody.parse(req.body);
    const [existing] = await db
      .select()
      .from(schema.taskActivity)
      .where(eq(schema.taskActivity.id, entryId));
    if (!existing || existing.taskId !== taskId) {
      sendError(res, 404, "not_found", "History entry not found");
      return;
    }
    if (existing.kind !== "comment") {
      sendError(res, 400, "not_editable", "Only comments can be edited");
      return;
    }
    const [row] = await db
      .update(schema.taskActivity)
      .set({ body: parsed.body, editedAt: new Date() })
      .where(eq(schema.taskActivity.id, entryId))
      .returning();
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});
