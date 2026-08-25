import type { NextFunction, Request, Response } from "express";
import { db } from "../db/client.js";
import {
  insertApiRequestLog,
  outcomeFromStatus,
} from "../services/apiRequestLogs.js";

const SKIP_PREFIXES = ["/api/health"];

function shouldSkip(path: string): boolean {
  if (SKIP_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) return true;
  if (path.startsWith("/api/v1/admin/api-logs")) return true;
  if (path.startsWith("/api/v1/admin/api-usage")) return true;
  if (path.startsWith("/api/v1/admin/database-stats")) return true;
  if (path === "/api/v1/backups/run") return true;
  return false;
}

function clientIp(req: Request): string | null {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) {
    return xf.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? null;
}

function chunkBytes(chunk: unknown, encoding: unknown): number {
  if (chunk == null || typeof chunk === "function") return 0;
  if (typeof chunk === "string") {
    const enc =
      typeof encoding === "string" && encoding !== "hex" && encoding !== "base64"
        ? (encoding as BufferEncoding)
        : "utf8";
    return Buffer.byteLength(chunk, enc);
  }
  if (Buffer.isBuffer(chunk)) return chunk.length;
  if (chunk instanceof Uint8Array) return chunk.byteLength;
  return 0;
}

function attachResponseByteCounter(res: Response): () => number {
  let written = 0;
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  res.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
    written += chunkBytes(chunk, encoding);
    return origWrite(chunk as never, encoding as never, cb as never);
  }) as typeof res.write;
  res.end = ((chunk?: unknown, encoding?: unknown, cb?: unknown) => {
    written += chunkBytes(chunk, encoding);
    return origEnd(chunk as never, encoding as never, cb as never);
  }) as typeof res.end;
  return () => {
    const hdr = res.getHeader("content-length");
    const n =
      typeof hdr === "number" ? hdr : typeof hdr === "string" ? Number(hdr) : NaN;
    if (Number.isFinite(n) && n >= 0) return n;
    return written;
  };
}

export function apiRequestLogger(req: Request, res: Response, next: NextFunction): void {
  if (shouldSkip(req.originalUrl.split("?")[0] ?? req.path)) {
    next();
    return;
  }

  const startedPath = (req.originalUrl.split("?")[0] ?? req.path).slice(0, 500);
  const method = req.method;
  const declaredIn = Number(req.headers["content-length"]);
  const requestBytes =
    Number.isFinite(declaredIn) && declaredIn > 0 ? declaredIn : 0;
  const responseBytesOf = attachResponseByteCounter(res);

  res.on("finish", () => {
    if (res.locals.skipRequestLog) return;

    const status = res.statusCode;
    const outcome = outcomeFromStatus(status);
    const custom = res.locals.logMessage?.trim();
    const message = custom
      ? custom.slice(0, 500)
      : status >= 400
        ? `HTTP ${status}`
        : `${method} ${startedPath} OK`;

    void insertApiRequestLog(db, {
      outcome,
      method,
      path: startedPath,
      statusCode: status,
      ip: clientIp(req),
      userId: res.locals.logUserId ?? null,
      apiKeyId: res.locals.logApiKeyId ?? null,
      message,
      adminKey: res.locals.logAdminKey ?? false,
      requestBytes,
      responseBytes: responseBytesOf(),
    }).catch((err) => {
      console.error("api_request_log insert failed", err);
    });
  });

  next();
}
