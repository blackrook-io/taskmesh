import { and, count, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import {
  generateApiKey,
  hashApiKeySecret,
  type ApiKeyAccess,
} from "../lib/apiKeyCrypto.js";
import { userCanAuthenticate } from "../lib/userAuth.js";
import { toUserRef, type UserRef } from "../lib/userFields.js";

type Db = NodePgDatabase<typeof schema>;

export const MAX_ACTIVE_API_KEYS = 3;
export const MAX_API_KEY_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export type ApiKeyStatus = "active" | "suspended" | "expired" | "revoked";

export type ApiKeyRow = {
  id: number;
  name: string;
  prefix: string;
  access: ApiKeyAccess;
  status: ApiKeyStatus;
  expiresAt: string;
  lastUsedAt: string | null;
  suspendedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner: UserRef;
};

function mapKey(
  key: typeof schema.apiKeys.$inferSelect,
  owner: typeof schema.users.$inferSelect,
): ApiKeyRow {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    access: key.access as ApiKeyAccess,
    status: key.status as ApiKeyStatus,
    expiresAt: key.expiresAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    suspendedAt: key.suspendedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
    updatedAt: key.updatedAt.toISOString(),
    owner: toUserRef(owner),
  };
}

export function parseApiKeyExpiresAt(iso: string, now = new Date()): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error("Invalid expiresAt"), {
      status: 400,
      code: "invalid_expires_at",
    });
  }
  const t = d.getTime();
  if (!(t > now.getTime())) {
    throw Object.assign(new Error("expiresAt must be in the future"), {
      status: 400,
      code: "invalid_expires_at",
    });
  }
  if (t > now.getTime() + MAX_API_KEY_TTL_MS) {
    throw Object.assign(new Error("expiresAt cannot be more than 60 days from now"), {
      status: 400,
      code: "invalid_expires_at",
    });
  }
  return d;
}

async function loadKeyWithOwner(db: Db, id: number) {
  const [row] = await db
    .select({ key: schema.apiKeys, owner: schema.users })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.apiKeys.userId, schema.users.id))
    .where(eq(schema.apiKeys.id, id))
    .limit(1);
  return row ?? null;
}

function refreshExpired(
  key: typeof schema.apiKeys.$inferSelect,
): typeof schema.apiKeys.$inferSelect {
  if (key.status === "active" && key.expiresAt.getTime() <= Date.now()) {
    return { ...key, status: "expired" };
  }
  return key;
}

async function persistExpiredIfNeeded(
  db: Db,
  key: typeof schema.apiKeys.$inferSelect,
): Promise<typeof schema.apiKeys.$inferSelect> {
  const refreshed = refreshExpired(key);
  if (refreshed.status === key.status) return key;
  const [updated] = await db
    .update(schema.apiKeys)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, key.id), eq(schema.apiKeys.status, "active")))
    .returning();
  return updated ?? refreshed;
}

export async function countActiveApiKeys(db: Db, userId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.userId, userId), eq(schema.apiKeys.status, "active")));
  return Number(row?.n ?? 0);
}

async function assertUnderActiveCap(db: Db, userId: number): Promise<void> {
  const n = await countActiveApiKeys(db, userId);
  if (n >= MAX_ACTIVE_API_KEYS) {
    throw Object.assign(
      new Error(`Users may have at most ${MAX_ACTIVE_API_KEYS} active API keys`),
      { status: 400, code: "too_many_active_keys" },
    );
  }
}

export async function listApiKeysForUser(db: Db, userId: number): Promise<ApiKeyRow[]> {
  const rows = await db
    .select({ key: schema.apiKeys, owner: schema.users })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.apiKeys.userId, schema.users.id))
    .where(eq(schema.apiKeys.userId, userId))
    .orderBy(desc(schema.apiKeys.createdAt));

  const out: ApiKeyRow[] = [];
  for (const { key, owner } of rows) {
    const k = await persistExpiredIfNeeded(db, key);
    out.push(mapKey(k, owner));
  }
  return out;
}

export async function listAllApiKeys(db: Db): Promise<ApiKeyRow[]> {
  const rows = await db
    .select({ key: schema.apiKeys, owner: schema.users })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.apiKeys.userId, schema.users.id))
    .orderBy(desc(schema.apiKeys.createdAt));

  const out: ApiKeyRow[] = [];
  for (const { key, owner } of rows) {
    const k = await persistExpiredIfNeeded(db, key);
    out.push(mapKey(k, owner));
  }
  return out;
}

export async function createApiKeyForUser(
  db: Db,
  input: {
    userId: number;
    name: string;
    access: ApiKeyAccess;
    expiresAt?: Date;
  },
): Promise<{ key: ApiKeyRow; rawKey: string }> {
  const [owner] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, input.userId))
    .limit(1);
  if (!owner) {
    throw Object.assign(new Error("User not found"), { status: 404, code: "not_found" });
  }
  if (owner.deactivatedAt) {
    throw Object.assign(new Error("Cannot create keys for a deactivated user"), {
      status: 400,
      code: "user_deactivated",
    });
  }

  await assertUnderActiveCap(db, input.userId);

  const { rawKey, prefix, keyHash } = generateApiKey(input.access);
  const expiresAt =
    input.expiresAt ?? new Date(Date.now() + MAX_API_KEY_TTL_MS);

  const [row] = await db
    .insert(schema.apiKeys)
    .values({
      userId: input.userId,
      name: input.name,
      prefix,
      keyHash,
      access: input.access,
      status: "active",
      expiresAt,
    })
    .returning();

  return { key: mapKey(row!, owner), rawKey };
}

export async function updateApiKeyExpiry(
  db: Db,
  id: number,
  expiresAt: Date,
  opts?: { ownerUserId?: number },
): Promise<ApiKeyRow> {
  const loaded = await loadKeyWithOwner(db, id);
  if (!loaded) {
    throw Object.assign(new Error("API key not found"), { status: 404, code: "not_found" });
  }
  if (opts?.ownerUserId != null && loaded.key.userId !== opts.ownerUserId) {
    throw Object.assign(new Error("API key not found"), { status: 404, code: "not_found" });
  }
  if (loaded.key.status === "revoked" || loaded.key.status === "expired") {
    throw Object.assign(new Error(`Cannot update expiry on a ${loaded.key.status} key`), {
      status: 400,
      code: "invalid_status",
    });
  }
  const now = new Date();
  const [row] = await db
    .update(schema.apiKeys)
    .set({ expiresAt, updatedAt: now })
    .where(eq(schema.apiKeys.id, id))
    .returning();
  return mapKey(row!, loaded.owner);
}

export async function suspendApiKey(db: Db, id: number): Promise<ApiKeyRow> {
  const loaded = await loadKeyWithOwner(db, id);
  if (!loaded) {
    throw Object.assign(new Error("API key not found"), { status: 404, code: "not_found" });
  }
  if (loaded.key.status === "revoked" || loaded.key.status === "expired") {
    throw Object.assign(new Error(`Cannot suspend a ${loaded.key.status} key`), {
      status: 400,
      code: "invalid_status",
    });
  }
  const now = new Date();
  const [row] = await db
    .update(schema.apiKeys)
    .set({ status: "suspended", suspendedAt: now, updatedAt: now })
    .where(eq(schema.apiKeys.id, id))
    .returning();
  return mapKey(row!, loaded.owner);
}

export async function unsuspendApiKey(db: Db, id: number): Promise<ApiKeyRow> {
  const loaded = await loadKeyWithOwner(db, id);
  if (!loaded) {
    throw Object.assign(new Error("API key not found"), { status: 404, code: "not_found" });
  }
  if (loaded.key.status !== "suspended") {
    throw Object.assign(new Error("Only suspended keys can be unsuspended"), {
      status: 400,
      code: "invalid_status",
    });
  }
  if (loaded.owner.deactivatedAt) {
    throw Object.assign(new Error("Owner is deactivated"), {
      status: 400,
      code: "user_deactivated",
    });
  }
  const expired = loaded.key.expiresAt.getTime() <= Date.now();
  const now = new Date();
  const [row] = await db
    .update(schema.apiKeys)
    .set({
      status: expired ? "expired" : "active",
      suspendedAt: null,
      updatedAt: now,
    })
    .where(eq(schema.apiKeys.id, id))
    .returning();
  return mapKey(row!, loaded.owner);
}

export async function expireApiKey(db: Db, id: number): Promise<ApiKeyRow> {
  const loaded = await loadKeyWithOwner(db, id);
  if (!loaded) {
    throw Object.assign(new Error("API key not found"), { status: 404, code: "not_found" });
  }
  if (loaded.key.status === "revoked") {
    throw Object.assign(new Error("Cannot expire a revoked key"), {
      status: 400,
      code: "invalid_status",
    });
  }
  const now = new Date();
  const [row] = await db
    .update(schema.apiKeys)
    .set({
      status: "expired",
      expiresAt: now,
      updatedAt: now,
    })
    .where(eq(schema.apiKeys.id, id))
    .returning();
  return mapKey(row!, loaded.owner);
}

export async function revokeApiKey(
  db: Db,
  id: number,
  opts?: { ownerUserId?: number },
): Promise<ApiKeyRow> {
  const loaded = await loadKeyWithOwner(db, id);
  if (!loaded) {
    throw Object.assign(new Error("API key not found"), { status: 404, code: "not_found" });
  }
  if (opts?.ownerUserId != null && loaded.key.userId !== opts.ownerUserId) {
    throw Object.assign(new Error("API key not found"), { status: 404, code: "not_found" });
  }
  const now = new Date();
  const [row] = await db
    .update(schema.apiKeys)
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where(eq(schema.apiKeys.id, id))
    .returning();
  return mapKey(row!, loaded.owner);
}

/**
 * Permanently remove a key row. Only revoked or expired keys may be deleted
 * (active/suspended must be revoked or expired first).
 */
export async function deleteApiKeyRecord(
  db: Db,
  id: number,
  opts?: { ownerUserId?: number },
): Promise<ApiKeyRow> {
  const loaded = await loadKeyWithOwner(db, id);
  if (!loaded) {
    throw Object.assign(new Error("API key not found"), { status: 404, code: "not_found" });
  }
  if (opts?.ownerUserId != null && loaded.key.userId !== opts.ownerUserId) {
    throw Object.assign(new Error("API key not found"), { status: 404, code: "not_found" });
  }
  const key = await persistExpiredIfNeeded(db, loaded.key);
  if (key.status !== "revoked" && key.status !== "expired") {
    throw Object.assign(
      new Error("Only revoked or expired API keys can be deleted. Revoke the key first."),
      { status: 400, code: "invalid_status" },
    );
  }
  const snapshot = mapKey(key, loaded.owner);
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, id));
  return snapshot;
}

export type ResolvedApiKey = {
  keyId: number;
  userId: number;
  access: ApiKeyAccess;
  prefix: string;
};

/**
 * Resolve a presented raw API key for request auth.
 * Throws service errors with status/code for middleware mapping.
 */
export async function resolveApiKeyForAuth(
  db: Db,
  rawKey: string,
): Promise<ResolvedApiKey> {
  const keyHash = hashApiKeySecret(rawKey);
  const [row] = await db
    .select({ key: schema.apiKeys, owner: schema.users })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.apiKeys.userId, schema.users.id))
    .where(eq(schema.apiKeys.keyHash, keyHash))
    .limit(1);

  if (!row) {
    throw Object.assign(new Error("Invalid API key"), {
      status: 401,
      code: "invalid_api_key",
    });
  }

  let key = await persistExpiredIfNeeded(db, row.key);

  if (key.status === "suspended") {
    throw Object.assign(new Error("API key is suspended"), {
      status: 403,
      code: "key_suspended",
    });
  }
  if (key.status === "expired") {
    throw Object.assign(new Error("API key is expired"), {
      status: 401,
      code: "invalid_api_key",
    });
  }
  if (key.status === "revoked") {
    throw Object.assign(new Error("Invalid API key"), {
      status: 401,
      code: "invalid_api_key",
    });
  }
  if (key.status !== "active") {
    throw Object.assign(new Error("Invalid API key"), {
      status: 401,
      code: "invalid_api_key",
    });
  }

  if (!userCanAuthenticate(row.owner)) {
    throw Object.assign(new Error("Invalid API key"), {
      status: 401,
      code: "invalid_api_key",
    });
  }

  return {
    keyId: key.id,
    userId: key.userId,
    access: key.access as ApiKeyAccess,
    prefix: key.prefix,
  };
}

/** Best-effort last-used stamps (does not block the request path on failure). */
export async function touchApiKeyUsage(db: Db, keyId: number, userId: number): Promise<void> {
  const now = new Date();
  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(eq(schema.apiKeys.id, keyId));
  await db
    .update(schema.users)
    .set({ lastApiAt: now, updatedAt: now })
    .where(eq(schema.users.id, userId));
}
