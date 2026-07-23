import { Router } from "express";
import { z } from "zod";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import {
  listBackups,
  overallBackupHealth,
  readSchedule,
  runBackup,
  writeSchedule,
} from "../../services/backups.js";

export const backupsRouter = Router();

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

backupsRouter.post("/run", async (_req, res) => {
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
