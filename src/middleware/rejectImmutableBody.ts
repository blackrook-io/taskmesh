import type { NextFunction, Request, Response } from "express";
import { handleRouteError } from "../lib/httpError.js";
import { rejectImmutableFields } from "../lib/immutableFields.js";

/**
 * Reject POST/PATCH/PUT JSON bodies that attempt to set system-only fields.
 * Multipart uploads with an empty/non-object body are skipped.
 */
export function rejectImmutableBody(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const method = req.method.toUpperCase();
  if (method !== "POST" && method !== "PATCH" && method !== "PUT") {
    next();
    return;
  }
  try {
    if (req.body != null && typeof req.body === "object" && !Array.isArray(req.body)) {
      rejectImmutableFields(req.body);
    }
    next();
  } catch (err) {
    handleRouteError(res, err);
  }
}
