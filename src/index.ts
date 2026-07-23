import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { sql } from "drizzle-orm";
import { db, pool } from "./db/client.js";
import { getClientDistDir, ensureUploadDir } from "./lib/paths.js";
import { sendError } from "./lib/httpError.js";
import { v1Router } from "./routes/v1/index.js";

ensureUploadDir();

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ ok: true, database: "connected" });
  } catch {
    res.status(503).json({ ok: false, database: "disconnected" });
  }
});

app.use("/api/v1", v1Router);

const clientDist = getClientDistDir();
if (process.env.NODE_ENV === "production" && fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (req.path.startsWith("/api")) {
      next();
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
    sendError(res, 500, "internal_error", "Unexpected server error");
  },
);

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => {
  console.log(`TaskMesh API listening on http://localhost:${port}`);
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}, closing…`);
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
