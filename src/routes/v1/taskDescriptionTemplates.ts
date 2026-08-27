import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { markdownString } from "../../lib/markdownFields.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import {
  createTemplate,
  listApplicableTemplates,
} from "../../services/taskDescriptionTemplates.js";
import { getCurrentUserId } from "../../services/users.js";

export const taskDescriptionTemplatesRouter = Router();

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

function parseProjectIdQuery(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "" || raw === "null") return null;
  if (typeof raw === "string" || typeof raw === "number") {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1) return n;
  }
  return undefined;
}

/** List templates applicable to a task's project (Global ∪ project match; owner-scoped). */
taskDescriptionTemplatesRouter.get("/", async (req, res) => {
  try {
    const projectId = parseProjectIdQuery(req.query.projectId);
    if (projectId === undefined && req.query.projectId !== undefined) {
      sendError(res, 400, "validation_error", "Invalid projectId");
      return;
    }
    const actorId = await getCurrentUserId(db);
    const data = await listApplicableTemplates(db, projectId ?? null, actorId);
    res.json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});

const createBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    body: markdownString(200_000).refine((s) => s.trim().length > 0, {
      message: "body must not be empty",
    }),
    projectId: z.number().int().positive().nullable(),
  })
  .strict();

taskDescriptionTemplatesRouter.post("/", async (req, res) => {
  try {
    const parsed = createBody.parse(req.body);
    const data = await createTemplate(db, parsed);
    res.status(201).json({ data });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});
