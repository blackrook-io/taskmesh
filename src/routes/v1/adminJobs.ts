import { Router } from "express";
import { z } from "zod";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { isUsageRange } from "../../lib/usageRange.js";
import { readKnowledgeCursor, type KnowledgeCursor } from "../../services/knowledge/cursor.js";
import { startKnowledgeRebuild } from "../../services/knowledge/jobs.js";
import {
  deleteFailedJob,
  getJobAdminSummary,
  retryFailedJob,
} from "../../services/jobs/queue.js";

const jobId = z.string().uuid();

export function registerAdminJobRoutes(adminRouter: Router): void {
  adminRouter.get("/jobs", async (req, res) => {
    try {
      const raw = typeof req.query.range === "string" ? req.query.range : "1d";
      if (!isUsageRange(raw)) {
        sendError(res, 400, "invalid_range", "range must be 1h, 1d, 1w, or 1m");
        return;
      }
      const summary = await getJobAdminSummary(raw);
      res.json({ data: { ...summary, knowledgeIndex: knowledgeStatus(await readKnowledgeCursor()) } });
    } catch (err) {
      if (serviceError(res, err)) return;
      handleRouteError(res, err);
    }
  });

  adminRouter.post("/jobs/knowledge/rebuild", async (_req, res) => {
    try {
      const result = await startKnowledgeRebuild();
      const cursor = await readKnowledgeCursor();
      res.json({ data: { result, knowledgeIndex: knowledgeStatus(cursor) } });
    } catch (err) {
      if (serviceError(res, err)) return;
      handleRouteError(res, err);
    }
  });

  adminRouter.post("/jobs/:id/retry", async (req, res) => {
    try {
      const id = jobId.parse(req.params.id);
      await retryFailedJob(id);
      res.json({ data: { id, retried: true } });
    } catch (err) {
      if (serviceError(res, err)) return;
      handleRouteError(res, err);
    }
  });

  adminRouter.delete("/jobs/:id", async (req, res) => {
    try {
      const id = jobId.parse(req.params.id);
      await deleteFailedJob(id);
      res.status(204).end();
    } catch (err) {
      if (serviceError(res, err)) return;
      handleRouteError(res, err);
    }
  });
}

function knowledgeStatus(cursor: KnowledgeCursor): { status: "idle" | "running" } {
  return { status: cursor.status };
}

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
