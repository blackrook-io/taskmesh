import { Router } from "express";
import { db } from "../../db/client.js";
import { handleRouteError } from "../../lib/httpError.js";
import { getPublicSystemConfig } from "../../services/systemProperties.js";

export const configRouter = Router();

configRouter.get("/", async (_req, res) => {
  try {
    res.json({ data: await getPublicSystemConfig(db) });
  } catch (err) {
    handleRouteError(res, err);
  }
});
