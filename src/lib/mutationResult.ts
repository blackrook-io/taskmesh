import type { Response } from "express";
import { sendError } from "./httpError.js";

export type MutationResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; code: string; message: string };

export function sendMutation(res: Response, result: MutationResult): void {
  if (!result.ok) {
    sendError(res, result.status, result.code, result.message);
    return;
  }
  res.status(result.status).json({ data: result.data });
}
