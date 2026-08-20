import type { NextFunction, Request, Response } from "express";
import { getAppVersionMeta, mergeResponseMeta } from "../lib/appVersion.js";

/** Attach `meta.version` / `createdAt` / `releasedAt` to every JSON body under `/api`. */
export function attachApiVersionMeta(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => originalJson(mergeResponseMeta(body, getAppVersionMeta()))) as Response["json"];
  next();
}
