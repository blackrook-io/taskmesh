import fs from "node:fs";
import path from "node:path";

export function getClientDistDir(): string {
  return path.join(process.cwd(), "client", "dist");
}

export function getUploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), "data", "uploads");
}

export function ensureUploadDir(): void {
  const dir = getUploadDir();
  fs.mkdirSync(dir, { recursive: true });
}

export function getBackupDir(): string {
  return process.env.BACKUP_DIR ?? path.join(process.cwd(), "data", "backups");
}

export function ensureBackupDir(): void {
  fs.mkdirSync(getBackupDir(), { recursive: true });
}

export function getBackupSchedulePath(): string {
  return (
    process.env.BACKUP_SCHEDULE_PATH ??
    path.join(process.cwd(), "data", "backup-schedule.json")
  );
}
