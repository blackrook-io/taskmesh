import "dotenv/config";
import express from "express";
import { sql } from "drizzle-orm";
import { db, pool } from "./db/client.js";

const app = express();
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ ok: true, database: "connected" });
  } catch {
    res.status(503).json({ ok: false, database: "disconnected" });
  }
});

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
