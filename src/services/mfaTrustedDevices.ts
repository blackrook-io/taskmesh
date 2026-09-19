import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { getSystemProperties } from "./systemProperties.js";

type Db = NodePgDatabase<typeof schema>;

function hashTrustToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newTrustToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function revokeAllTrustedDevices(db: Db, userId: number): Promise<number> {
  const deleted = await db
    .delete(schema.mfaTrustedDevices)
    .where(eq(schema.mfaTrustedDevices.userId, userId))
    .returning({ id: schema.mfaTrustedDevices.id });
  return deleted.length;
}

export async function purgeExpiredTrustedDevices(db: Db): Promise<void> {
  await db
    .delete(schema.mfaTrustedDevices)
    .where(lt(schema.mfaTrustedDevices.expiresAt, new Date()));
}

/**
 * Validate a trust cookie for this user. Returns true when MFA may be skipped.
 * Updates lastUsedAt on success. When days policy is 0, never trusts.
 */
export async function validateTrustedDevice(
  db: Db,
  userId: number,
  token: string | null | undefined,
): Promise<boolean> {
  if (!token || token.length < 16) return false;
  const props = await getSystemProperties(db);
  if (props.mfaTrustedDeviceDays <= 0) return false;

  const tokenHash = hashTrustToken(token);
  const now = new Date();
  const [row] = await db
    .select()
    .from(schema.mfaTrustedDevices)
    .where(
      and(
        eq(schema.mfaTrustedDevices.userId, userId),
        eq(schema.mfaTrustedDevices.tokenHash, tokenHash),
        gt(schema.mfaTrustedDevices.expiresAt, now),
      ),
    )
    .limit(1);
  if (!row) return false;

  await db
    .update(schema.mfaTrustedDevices)
    .set({ lastUsedAt: now })
    .where(eq(schema.mfaTrustedDevices.id, row.id));
  return true;
}

export type MintTrustedDeviceResult = {
  token: string;
  maxAgeSeconds: number;
  expiresAt: Date;
};

/**
 * Mint a trusted device after successful MFA. No-op when days is 0.
 * Enforces max devices by dropping oldest first.
 */
export async function mintTrustedDevice(
  db: Db,
  userId: number,
  opts?: { userAgent?: string | null },
): Promise<MintTrustedDeviceResult | null> {
  const props = await getSystemProperties(db);
  const days = props.mfaTrustedDeviceDays;
  if (days <= 0) return null;

  const max = Math.max(1, props.mfaTrustedDeviceMax);
  const existing = await db
    .select({ id: schema.mfaTrustedDevices.id })
    .from(schema.mfaTrustedDevices)
    .where(eq(schema.mfaTrustedDevices.userId, userId))
    .orderBy(asc(schema.mfaTrustedDevices.createdAt));

  const overflow = existing.length + 1 - max;
  if (overflow > 0) {
    const dropIds = existing.slice(0, overflow).map((r) => r.id);
    for (const id of dropIds) {
      await db.delete(schema.mfaTrustedDevices).where(eq(schema.mfaTrustedDevices.id, id));
    }
  }

  const token = newTrustToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const maxAgeSeconds = Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));

  await db.insert(schema.mfaTrustedDevices).values({
    userId,
    tokenHash: hashTrustToken(token),
    userAgent: opts?.userAgent?.slice(0, 512) ?? null,
    expiresAt,
    lastUsedAt: now,
    createdAt: now,
  });

  return { token, maxAgeSeconds, expiresAt };
}
