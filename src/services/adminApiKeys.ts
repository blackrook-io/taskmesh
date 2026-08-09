import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { generateApiKey, type ApiKeyAccess } from "../lib/apiKeyCrypto.js";
import { toUserRef, type UserRef } from "../lib/userFields.js";

type Db = NodePgDatabase<typeof schema>;

export type ApiKeyStatus = "active" | "suspended" | "expired" | "revoked";

export type AdminApiKeyRow = {
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
): AdminApiKeyRow {
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

async function loadKeyWithOwner(db: Db, id: number) {
  const [row] = await db
    .select({ key: schema.apiKeys, owner: schema.users })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.apiKeys.userId, schema.users.id))
    .where(eq(schema.apiKeys.id, id))
    .limit(1);
  return row ?? null;
}

function refreshExpired(key: typeof schema.apiKeys.$inferSelect): typeof schema.apiKeys.$inferSelect {
  if (key.status === "active" && key.expiresAt.getTime() <= Date.now()) {
    return { ...key, status: "expired" };
  }
  return key;
}

export async function listAdminApiKeys(db: Db): Promise<AdminApiKeyRow[]> {
  const rows = await db
    .select({ key: schema.apiKeys, owner: schema.users })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.apiKeys.userId, schema.users.id))
    .orderBy(desc(schema.apiKeys.createdAt));

  const out: AdminApiKeyRow[] = [];
  for (const { key, owner } of rows) {
    let k = refreshExpired(key);
    if (k.status !== key.status) {
      const [updated] = await db
        .update(schema.apiKeys)
        .set({ status: "expired", updatedAt: new Date() })
        .where(and(eq(schema.apiKeys.id, key.id), eq(schema.apiKeys.status, "active")))
        .returning();
      if (updated) k = updated;
    }
    out.push(mapKey(k, owner));
  }
  return out;
}

export async function createAdminApiKey(
  db: Db,
  input: {
    userId: number;
    name: string;
    access: ApiKeyAccess;
    expiresAt?: Date;
  },
): Promise<{ key: AdminApiKeyRow; rawKey: string }> {
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

  const { rawKey, prefix, keyHash } = generateApiKey(input.access);
  const expiresAt =
    input.expiresAt ?? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days

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

export async function suspendApiKey(db: Db, id: number): Promise<AdminApiKeyRow> {
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

export async function unsuspendApiKey(db: Db, id: number): Promise<AdminApiKeyRow> {
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

export async function expireApiKey(db: Db, id: number): Promise<AdminApiKeyRow> {
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

export async function revokeApiKey(db: Db, id: number): Promise<AdminApiKeyRow> {
  const loaded = await loadKeyWithOwner(db, id);
  if (!loaded) {
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
