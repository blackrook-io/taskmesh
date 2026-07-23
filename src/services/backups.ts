import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  ensureBackupDir,
  getBackupDir,
  getBackupSchedulePath,
  getUploadDir,
} from "../lib/paths.js";

const execFileAsync = promisify(execFile);

export type BackupManifest = {
  id: string;
  createdAt: string;
  pgDumpOk: boolean;
  uploadsOk: boolean;
  sqlFile: string | null;
  uploadsFile: string | null;
  bytes: number;
  error: string | null;
};

export type BackupSchedule = {
  enabled: boolean;
  hour: number;
  minute: number;
  retainDays: number;
};

export type BackupHealth = "ok" | "warn" | "missing";

export type BackupListItem = BackupManifest & {
  health: BackupHealth;
  ageHours: number | null;
};

const DEFAULT_SCHEDULE: BackupSchedule = {
  enabled: true,
  hour: 3,
  minute: 0,
  retainDays: 14,
};

const FRESH_HOURS = 36;

let runLock: Promise<BackupManifest> | null = null;
let lastScheduledKey: string | null = null;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

function stampNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function parseDatabaseUrl(urlStr: string): {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
} {
  const u = new URL(urlStr);
  const database = u.pathname.replace(/^\//, "") || "taskmesh";
  return {
    user: decodeURIComponent(u.username || "taskmesh"),
    password: decodeURIComponent(u.password || ""),
    host: u.hostname || "127.0.0.1",
    port: u.port || "5432",
    database,
  };
}

export function readSchedule(): BackupSchedule {
  const p = getBackupSchedulePath();
  try {
    if (!fs.existsSync(p)) return { ...DEFAULT_SCHEDULE };
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<BackupSchedule>;
    return {
      enabled: raw.enabled ?? DEFAULT_SCHEDULE.enabled,
      hour: clampInt(raw.hour, 0, 23, DEFAULT_SCHEDULE.hour),
      minute: clampInt(raw.minute, 0, 59, DEFAULT_SCHEDULE.minute),
      retainDays: clampInt(raw.retainDays, 1, 365, DEFAULT_SCHEDULE.retainDays),
    };
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

export function writeSchedule(next: BackupSchedule): BackupSchedule {
  const normalized: BackupSchedule = {
    enabled: Boolean(next.enabled),
    hour: clampInt(next.hour, 0, 23, DEFAULT_SCHEDULE.hour),
    minute: clampInt(next.minute, 0, 59, DEFAULT_SCHEDULE.minute),
    retainDays: clampInt(next.retainDays, 1, 365, DEFAULT_SCHEDULE.retainDays),
  };
  const p = getBackupSchedulePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function manifestPath(id: string): string {
  return path.join(getBackupDir(), id, "manifest.json");
}

export function listBackups(): BackupListItem[] {
  ensureBackupDir();
  const root = getBackupDir();
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();

  const now = Date.now();
  const items: BackupListItem[] = [];
  for (const id of dirs) {
    const mp = manifestPath(id);
    if (!fs.existsSync(mp)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(mp, "utf8")) as BackupManifest;
      const created = Date.parse(m.createdAt);
      const ageHours = Number.isFinite(created) ? (now - created) / 3_600_000 : null;
      let health: BackupHealth = "missing";
      if (m.pgDumpOk && ageHours != null) {
        health = ageHours <= FRESH_HOURS ? "ok" : "warn";
      } else if (m.pgDumpOk) {
        health = "warn";
      }
      items.push({ ...m, health, ageHours });
    } catch {
      /* skip corrupt */
    }
  }
  return items;
}

export function overallBackupHealth(items: BackupListItem[]): BackupHealth {
  const latestOk = items.find((i) => i.pgDumpOk);
  if (!latestOk) return "missing";
  return latestOk.health;
}

function pruneOldBackups(retainDays: number) {
  const root = getBackupDir();
  const cutoff = Date.now() - retainDays * 86_400_000;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const mp = path.join(root, ent.name, "manifest.json");
    let created = 0;
    try {
      if (fs.existsSync(mp)) {
        const m = JSON.parse(fs.readFileSync(mp, "utf8")) as BackupManifest;
        created = Date.parse(m.createdAt) || 0;
      }
    } catch {
      created = 0;
    }
    if (!created) {
      const st = fs.statSync(path.join(root, ent.name));
      created = st.mtimeMs;
    }
    if (created < cutoff) {
      fs.rmSync(path.join(root, ent.name), { recursive: true, force: true });
    }
  }
}

async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  const walk = (p: string) => {
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, ent.name);
      if (ent.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  walk(dir);
  return total;
}

export async function runBackup(): Promise<BackupManifest> {
  if (runLock) return runLock;
  runLock = (async () => {
    ensureBackupDir();
    const id = stampNow();
    const dir = path.join(getBackupDir(), id);
    fs.mkdirSync(dir, { recursive: true });

    const sqlName = `taskmesh-${id}.sql`;
    const uploadsName = `uploads-${id}.tar.gz`;
    const sqlPath = path.join(dir, sqlName);
    const uploadsPath = path.join(dir, uploadsName);

    let pgDumpOk = false;
    let uploadsOk = false;
    let error: string | null = null;

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      error = "DATABASE_URL is not set";
    } else {
      try {
        const cfg = parseDatabaseUrl(dbUrl);
        await execFileAsync(
          "pg_dump",
          [
            "-h",
            cfg.host,
            "-p",
            cfg.port,
            "-U",
            cfg.user,
            "-d",
            cfg.database,
            "-F",
            "p",
            "-f",
            sqlPath,
          ],
          {
            env: { ...process.env, PGPASSWORD: cfg.password },
            maxBuffer: 64 * 1024 * 1024,
          },
        );
        pgDumpOk = fs.existsSync(sqlPath) && fs.statSync(sqlPath).size > 0;
        if (!pgDumpOk) error = "pg_dump produced an empty file";
      } catch (err) {
        error = err instanceof Error ? err.message : "pg_dump failed";
        pgDumpOk = false;
      }
    }

    const uploadDir = getUploadDir();
    try {
      if (fs.existsSync(uploadDir)) {
        await execFileAsync(
          "tar",
          ["-czf", uploadsPath, "-C", path.dirname(uploadDir), path.basename(uploadDir)],
          { maxBuffer: 64 * 1024 * 1024 },
        );
        uploadsOk = fs.existsSync(uploadsPath);
      } else {
        uploadsOk = true; // nothing to back up
      }
    } catch (err) {
      uploadsOk = false;
      const msg = err instanceof Error ? err.message : "tar failed";
      error = error ? `${error}; ${msg}` : msg;
    }

    const bytes = await dirSizeBytes(dir);
    const manifest: BackupManifest = {
      id,
      createdAt: new Date().toISOString(),
      pgDumpOk,
      uploadsOk,
      sqlFile: pgDumpOk ? sqlName : null,
      uploadsFile: uploadsOk && fs.existsSync(uploadsPath) ? uploadsName : null,
      bytes,
      error,
    };
    fs.writeFileSync(manifestPath(id), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const schedule = readSchedule();
    pruneOldBackups(schedule.retainDays);

    return manifest;
  })().finally(() => {
    runLock = null;
  });

  return runLock;
}

export function startBackupScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    void tickScheduler();
  }, 30_000);
  void tickScheduler();
}

export function stopBackupScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

async function tickScheduler() {
  const schedule = readSchedule();
  if (!schedule.enabled) return;
  const now = new Date();
  if (now.getHours() !== schedule.hour || now.getMinutes() !== schedule.minute) return;
  const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${schedule.hour}-${schedule.minute}`;
  if (lastScheduledKey === key) return;
  lastScheduledKey = key;
  try {
    console.log("[backup] scheduled run starting…");
    const m = await runBackup();
    console.log(`[backup] scheduled run finished id=${m.id} ok=${m.pgDumpOk}`);
  } catch (err) {
    console.error("[backup] scheduled run failed", err);
  }
}
