import { Router } from "express";
import { z } from "zod";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { heavyWriteRateLimit } from "../../middleware/rateLimits.js";
import { requireAdministrator } from "../../middleware/requireAdministrator.js";
import {
  deleteBackup,
  listBackups,
  overallBackupHealth,
  readSchedule,
  restoreBackup,
  runBackup,
  writeSchedule,
} from "../../services/backups.js";

export const backupsRouter = Router();

backupsRouter.use(requireAdministrator);

backupsRouter.get("/", (_req, res) => {
  try {
    const items = listBackups();
    res.json({
      data: {
        health: overallBackupHealth(items),
        freshHours: 36,
        items,
      },
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

backupsRouter.post("/run", heavyWriteRateLimit, async (_req, res) => {
  try {
    const manifest = await runBackup();
    res.json({ data: manifest });
  } catch (err) {
    handleRouteError(res, err);
  }
});

backupsRouter.get("/schedule", (_req, res) => {
  try {
    res.json({ data: readSchedule() });
  } catch (err) {
    handleRouteError(res, err);
  }
});

const scheduleBody = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  retainDays: z.number().int().min(1).max(365),
});

backupsRouter.patch("/schedule", (req, res) => {
  try {
    const parsed = scheduleBody.parse(req.body);
    const data = writeSchedule(parsed);
    res.json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});

const restoreBody = z
  .object({
    restoreUploads: z.boolean().optional(),
    takeSafetyBackup: z.boolean().optional(),
  })
  .optional();

backupsRouter.post("/:id/restore", heavyWriteRateLimit, async (req, res) => {
  try {
    const id = z.string().min(1).max(64).parse(req.params.id);
    const body = restoreBody.parse(req.body ?? {});
    const result = await restoreBackup(id, {
      restoreUploads: body?.restoreUploads,
      takeSafetyBackup: body?.takeSafetyBackup,
    });
    if (!result.databaseRestored) {
      sendError(res, 500, "restore_failed", result.error ?? "Restore failed");
      return;
    }
    res.json({ data: result });
  } catch (err) {
    if (
      err instanceof Error &&
      /not found|no successful|missing|already in progress|Could not take/i.test(err.message)
    ) {
      sendError(res, 400, "restore_error", err.message);
      return;
    }
    handleRouteError(res, err);
  }
});

backupsRouter.delete("/:id", async (req, res) => {
  try {
    const id = z.string().min(1).max(64).parse(req.params.id);
    const data = await deleteBackup(id);
    res.json({ data });
  } catch (err) {
    if (
      err instanceof Error &&
      /not found|Invalid backup|already in progress/i.test(err.message)
    ) {
      sendError(res, 400, "delete_error", err.message);
      return;
    }
    handleRouteError(res, err);
  }
});
