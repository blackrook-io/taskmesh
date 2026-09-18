import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import {
  decryptOauthSecret,
  encryptOauthSecret,
  hasOauthCredentialsKey,
  OauthCredentialsKeyError,
} from "../../lib/oauthCrypto.js";

type Db = NodePgDatabase<typeof schema>;

export const OAUTH_SLUGS = ["google", "apple", "github"] as const;
export type OauthSlug = (typeof OAUTH_SLUGS)[number];

export function isOauthSlug(value: string): value is OauthSlug {
  return (OAUTH_SLUGS as readonly string[]).includes(value);
}

export type OauthProviderRow = typeof schema.oauthProviders.$inferSelect;

export type PublicOauthProvider = {
  slug: OauthSlug;
  name: string;
};

export type AdminOauthProvider = {
  id: number;
  slug: OauthSlug;
  name: string;
  protocol: string;
  enabled: boolean;
  clientId: string | null;
  hasClientSecret: boolean;
  appleTeamId: string | null;
  appleKeyId: string | null;
  hasApplePrivateKey: boolean;
  scopes: string | null;
  jitEnabled: boolean;
  defaultRoleId: number | null;
  sortOrder: number;
  updatedAt: string;
  kekConfigured: boolean;
};

function serviceErr(message: string, status: number, code: string): Error {
  return Object.assign(new Error(message), { status, code });
}

export function toAdminOauthProvider(row: OauthProviderRow): AdminOauthProvider {
  return {
    id: row.id,
    slug: row.slug as OauthSlug,
    name: row.name,
    protocol: row.protocol,
    enabled: row.enabled,
    clientId: row.clientId,
    hasClientSecret: Boolean(row.clientSecretEnc),
    appleTeamId: row.appleTeamId,
    appleKeyId: row.appleKeyId,
    hasApplePrivateKey: Boolean(row.applePrivateKeyEnc),
    scopes: row.scopes,
    jitEnabled: row.jitEnabled,
    defaultRoleId: row.defaultRoleId,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
    kekConfigured: hasOauthCredentialsKey(),
  };
}

export async function listOauthProviders(db: Db): Promise<OauthProviderRow[]> {
  return db.select().from(schema.oauthProviders).orderBy(asc(schema.oauthProviders.sortOrder));
}

export async function listPublicOauthProviders(db: Db): Promise<PublicOauthProvider[]> {
  const rows = await listOauthProviders(db);
  return rows
    .filter((r) => r.enabled && r.clientId)
    .map((r) => ({ slug: r.slug as OauthSlug, name: r.name }));
}

export async function getOauthProviderBySlug(
  db: Db,
  slug: string,
): Promise<OauthProviderRow | null> {
  if (!isOauthSlug(slug)) return null;
  const [row] = await db
    .select()
    .from(schema.oauthProviders)
    .where(eq(schema.oauthProviders.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function requireOauthProvider(
  db: Db,
  slug: string,
): Promise<OauthProviderRow> {
  const row = await getOauthProviderBySlug(db, slug);
  if (!row) throw serviceErr("Unknown OAuth provider.", 404, "not_found");
  return row;
}

export type PatchOauthProviderInput = {
  enabled?: boolean;
  clientId?: string | null;
  /** Set to rotate; omit to leave unchanged; null to clear */
  clientSecret?: string | null;
  appleTeamId?: string | null;
  appleKeyId?: string | null;
  applePrivateKey?: string | null;
  scopes?: string | null;
  jitEnabled?: boolean;
  defaultRoleId?: number | null;
};

export async function patchOauthProvider(
  db: Db,
  slug: string,
  patch: PatchOauthProviderInput,
): Promise<AdminOauthProvider> {
  const row = await requireOauthProvider(db, slug);
  const next: Partial<typeof schema.oauthProviders.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.clientId !== undefined) {
    next.clientId = patch.clientId?.trim() || null;
  }
  if (patch.scopes !== undefined) next.scopes = patch.scopes?.trim() || null;
  if (patch.jitEnabled !== undefined) next.jitEnabled = patch.jitEnabled;
  if (patch.defaultRoleId !== undefined) next.defaultRoleId = patch.defaultRoleId;
  if (patch.appleTeamId !== undefined) {
    next.appleTeamId = patch.appleTeamId?.trim() || null;
  }
  if (patch.appleKeyId !== undefined) {
    next.appleKeyId = patch.appleKeyId?.trim() || null;
  }

  try {
    if (patch.clientSecret !== undefined) {
      if (patch.clientSecret === null || patch.clientSecret === "") {
        next.clientSecretEnc = null;
      } else {
        next.clientSecretEnc = encryptOauthSecret(patch.clientSecret);
      }
    }
    if (patch.applePrivateKey !== undefined) {
      if (patch.applePrivateKey === null || patch.applePrivateKey === "") {
        next.applePrivateKeyEnc = null;
      } else {
        next.applePrivateKeyEnc = encryptOauthSecret(patch.applePrivateKey);
      }
    }
  } catch (err) {
    if (err instanceof OauthCredentialsKeyError) {
      throw serviceErr(err.message, 400, "oauth_kek_missing");
    }
    throw err;
  }

  if (patch.enabled === true || next.enabled === true) {
    const enabled = patch.enabled ?? row.enabled;
    if (enabled && !hasOauthCredentialsKey()) {
      throw serviceErr(
        "Set OAUTH_CREDENTIALS_KEY before enabling an OAuth provider.",
        400,
        "oauth_kek_missing",
      );
    }
  }

  const [updated] = await db
    .update(schema.oauthProviders)
    .set(next)
    .where(eq(schema.oauthProviders.id, row.id))
    .returning();
  if (!updated) throw serviceErr("Could not update provider.", 500, "update_failed");
  return toAdminOauthProvider(updated);
}

export function decryptProviderSecret(enc: string | null): string | null {
  if (!enc) return null;
  return decryptOauthSecret(enc);
}
