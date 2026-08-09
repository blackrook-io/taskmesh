import type { NextFunction, Request, Response } from "express";
import { db } from "../db/client.js";
import {
  insertApiRequestLog,
  outcomeFromStatus,
} from "../services/apiRequestLogs.js";

const SKIP_PREFIXES = ["/api/health"];

function shouldSkip(path: string): boolean {
  if (SKIP_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) return true;
  // Avoid logging the log/usage endpoints themselves flooding the store.
  if (path.startsWith("/api/v1/admin/api-logs")) return true;
  if (path.startsWith("/api/v1/admin/api-usage")) return true;
  return false;
}

function clientIp(req: Request): string | null {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) {
    return xf.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? null;
}

/**
 * Records one row per completed /api/v1 request (fire-and-forget).
 * Mount on the v1 router before resource routes.
 */
export function apiRequestLogger(req: Request, res: Response, next: NextFunction): void {
  if (shouldSkip(req.originalUrl.split("?")[0] ?? req.path)) {
    next();
    return;
  }

  const startedPath = (req.originalUrl.split("?")[0] ?? req.path).slice(0, 500);
  const method = req.method;

  res.on("finish", () => {
    const status = res.statusCode;
    const outcome = outcomeFromStatus(status);
    const message =
      status >= 400
        ? `HTTP ${status}`
        : `${method} ${startedPath} OK`;

    void insertApiRequestLog(db, {
      outcome,
      method,
      path: startedPath,
      statusCode: status,
      ip: clientIp(req),
      message,
    }).catch((err) => {
      console.error("api_request_log insert failed", err);
    });
  });

  next();
}
