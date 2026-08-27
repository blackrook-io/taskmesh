import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getProdReleasePath } from "./paths.js";

/**
 * UTC instant this version string is recorded as landing on `main`.
 * Update together with `package.json` `version` on finish-up (merge to main).
 */
export const APP_VERSION_CREATED_AT: string | null = "2026-08-27T01:56:46.000Z";

export type AppVersionMeta = {
  version: string;
  createdAt: string | null;
  releasedAt: string | null;
};

function packageJsonPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");
}

export function readPackageVersion(pkgPath = packageJsonPath()): string {
  const raw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as { version?: unknown };
  return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : "0.0.0";
}

export function releasedAtFromSidecar(sidecar: unknown, version: string): string | null {
  if (!sidecar || typeof sidecar !== "object" || Array.isArray(sidecar)) return null;
  const rec = sidecar as Record<string, unknown>;
  if (typeof rec.version !== "string" || typeof rec.releasedAt !== "string") return null;
  if (rec.version !== version) return null;
  if (Number.isNaN(Date.parse(rec.releasedAt))) return null;
  return rec.releasedAt;
}

export function readProdReleaseSidecar(filePath = getProdReleasePath()): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export function getAppVersionMeta(): AppVersionMeta {
  const version = readPackageVersion();
  return {
    version,
    createdAt: APP_VERSION_CREATED_AT,
    releasedAt: releasedAtFromSidecar(readProdReleaseSidecar(), version),
  };
}

export function mergeResponseMeta(body: unknown, meta: AppVersionMeta): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const rec = body as Record<string, unknown>;
  const existing =
    rec.meta && typeof rec.meta === "object" && !Array.isArray(rec.meta)
      ? (rec.meta as Record<string, unknown>)
      : {};
  return { ...rec, meta: { ...existing, ...meta } };
}
