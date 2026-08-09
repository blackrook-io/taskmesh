import type { Request } from "express";

export type ActivitySource = "ui" | "api";

/** SPA sends `X-TaskMesh-Client: ui`; anything else is treated as API. */
export function activitySourceFromRequest(req: Request): ActivitySource {
  const raw = req.get("x-taskmesh-client");
  return raw?.trim().toLowerCase() === "ui" ? "ui" : "api";
}

/**
 * Modal autosaves send `X-TaskMesh-History: defer` so field updates persist
 * without writing History; a session flush records one summary on Close.
 */
export function shouldRecordHistory(req: Request): boolean {
  const raw = req.get("x-taskmesh-history");
  return raw?.trim().toLowerCase() !== "defer";
}
