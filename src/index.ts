import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { sql } from "drizzle-orm";
import { db, pool } from "./db/client.js";
import { getClientDistDir, ensureUploadDir, ensureBackupDir } from "./lib/paths.js";
import { sendError } from "./lib/httpError.js";
import { attachApiVersionMeta } from "./middleware/apiVersionMeta.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { v1Router } from "./routes/v1/index.js";
import { startBackupScheduler, stopBackupScheduler } from "./services/backups.js";

ensureUploadDir();
ensureBackupDir();

const app = express();
app.use(securityHeaders);
app.use(express.json({ limit: "10mb" }));
app.use("/api", attachApiVersionMeta);

app.get("/api/health", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ ok: true, database: "connected" });
  } catch {
    res.status(503).json({ ok: false, database: "disconnected" });
  }
});

app.use("/api/v1", v1Router);

app.use("/api", (_req, res) => {
  sendError(res, 404, "not_found", "No such API route");
});

const clientDist = getClientDistDir();
if (process.env.NODE_ENV === "production" && fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendError(res, 404, "not_found", "No such route");
      return;
    }
    if (req.path.startsWith("/api")) {
      sendError(res, 404, "not_found", "No such API route");
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        sendError(res, 413, "file_too_large", "File exceeds upload size limit");
        return;
      }
    }
    console.error(err);
    const detail = err instanceof Error ? err.message : "Unexpected server error";
    if (!res.locals.logMessage) {
      res.locals.logMessage = `System error: ${detail}`.slice(0, 500);
    }
    sendError(res, 500, "internal_error", "Unexpected server error");
  },
);

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host, () => {
  console.log(`TaskMesh API listening on http://${host}:${port}`);
  startBackupScheduler();
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}, closing…`);
  stopBackupScheduler();
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
