import type { NextFunction, Request, Response } from "express";

/**
 * Placeholder for T0063 — validate `Authorization` / API key header and attach
 * `req.apiKeyId` plus auth context for downstream middleware and logging.
 */
export function apiKeyAuth(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
