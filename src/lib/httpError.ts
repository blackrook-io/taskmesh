import type { Response } from "express";
import { ZodError } from "zod";
import { AuthenticationError } from "./authErrors.js";
import { ImmutableFieldError } from "./immutableFields.js";

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  if (!res.locals.logMessage) {
    res.locals.logMessage = message.slice(0, 500);
  }
  res.status(status).json({ error: { code, message } });
}

export function handleRouteError(res: Response, err: unknown): void {
  if (err instanceof AuthenticationError) {
    sendError(res, err.status, err.code, err.message);
    return;
  }
  if (err instanceof ImmutableFieldError) {
    sendError(res, err.status, err.code, err.message);
    return;
  }
  if (err instanceof ZodError) {
    const msg = err.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    sendError(res, 400, "validation_error", msg || "Invalid input");
    return;
  }
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  ) {
    const detail = "constraint" in err ? String((err as { constraint?: string }).constraint ?? "") : "";
    if (detail.includes("email") || detail.includes("users_email")) {
      sendError(res, 409, "email_taken", "Email is already in use");
      return;
    }
    sendError(res, 409, "conflict", "Unique constraint violation");
    return;
  }
  console.error(err);
  const detail = err instanceof Error ? err.message : "Unexpected server error";
  if (!res.locals.logMessage) {
    res.locals.logMessage = `System error: ${detail}`.slice(0, 500);
  }
  sendError(res, 500, "internal_error", "Unexpected server error");
}
