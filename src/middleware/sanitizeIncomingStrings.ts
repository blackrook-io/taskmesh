import type { NextFunction, Request, Response } from "express";
import { sanitizeIncomingValue } from "../lib/sanitizeIncoming.js";

/** Strip HTML from all JSON body and query string values (passwords skipped). */
export function sanitizeIncomingStrings(req: Request, _res: Response, next: NextFunction): void {
  if (req.body != null && typeof req.body === "object") {
    req.body = sanitizeIncomingValue(req.body);
  }
  if (req.query != null && typeof req.query === "object") {
    req.query = sanitizeIncomingValue(req.query) as Request["query"];
  }
  next();
}
