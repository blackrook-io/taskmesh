import type { Response } from "express";
import { ZodError } from "zod";

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json({ error: { code, message } });
}

export function handleRouteError(res: Response, err: unknown): void {
  if (err instanceof ZodError) {
    const msg = err.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    sendError(res, 400, "validation_error", msg || "Invalid input");
    return;
  }
  console.error(err);
  sendError(res, 500, "internal_error", "Unexpected server error");
}
