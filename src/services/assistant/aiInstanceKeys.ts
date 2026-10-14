import { count, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AiProviderPlugin, ProviderFetch } from "@taskmesh/ai-provider-contract";
import * as schema from "../../db/schema.js";
import { decryptAiSecret, encryptAiSecret } from "../../lib/aiCredentialsCrypto.js";
import { capStoredKeyError } from "./aiCredentialHealth.js";
import { invalidateSystemPropertiesCache } from "../systemProperties.js";
import { writeAiAudit } from "./aiAudit.js";
import {
  BILLING_RISK_PHRASE,
  billingAckRequired,
  instanceKeyHint,
  parseAiKeyMode,
  redactSecret,
  type AiKeyMode,
} from "./aiKeyMode.js";
import { normalizeAiProviders } from "./aiProviderConfig.js";
import { getAiProvider } from "./providerLoader.js";
import { assertPublicProviderBaseUrl } from "./providerBaseUrl.js";

type Db = NodePgDatabase<typeof schema>;

export class AiCredentialsError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AiCredentialsError";
    this.status = status;
    this.code = code;
  }
}

export type InstanceKeyPublic = {
  pluginId: string;
  keyHint: string | null;
  keyVerifiedAt: string | null;
  keyLastError: string | null;
};

const EMPTY_KEY: Omit<InstanceKeyPublic, "pluginId"> = {
  keyHint: null,
  keyVerifiedAt: null,
  keyLastError: null,
};

function publicFromRow(row: {
  pluginId: string;
  hint: string;
  verifiedAt: Date | null;
  lastError: string | null;
}): InstanceKeyPublic {
  return {
    pluginId: row.pluginId,
    keyHint: row.hint,
    keyVerifiedAt: row.verifiedAt?.toISOString() ?? null,
    keyLastError: row.lastError,
  };
}

function requireKeyedPlugin(pluginId: string): AiProviderPlugin {
  const plugin = getAiProvider(pluginId);
  if (!plugin) {
    throw new AiCredentialsError(404, "not_found", `Unknown AI provider: ${pluginId}`);
  }
  if (plugin.capabilities.local) {
    throw new AiCredentialsError(
      400,
      "instance_key_unsupported",
      "This provider does not use an instance key.",
    );
  }
  return plugin;
}

export async function countActiveUsers(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.users)
    .where(isNull(schema.users.deactivatedAt));
  return Number(row?.n ?? 0);
}

export async function readAiKeyMode(db: Db): Promise<AiKeyMode> {
  const [row] = await db
    .select({ value: schema.systemProperties.value })
    .from(schema.systemProperties)
    .where(eq(schema.systemProperties.key, "ai_key_mode"))
    .limit(1);
  return parseAiKeyMode(row?.value);
}

export async function listInstanceCredentialPublic(db: Db): Promise<Map<string, InstanceKeyPublic>> {
  const rows = await db
    .select({
      pluginId: schema.aiInstanceCredentials.pluginId,
      hint: schema.aiInstanceCredentials.hint,
      verifiedAt: schema.aiInstanceCredentials.verifiedAt,
      lastError: schema.aiInstanceCredentials.lastError,
    })
    .from(schema.aiInstanceCredentials);
  return new Map(rows.map((row) => [row.pluginId, publicFromRow(row)]));
}

export async function listInstancePluginIds(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ pluginId: schema.aiInstanceCredentials.pluginId })
    .from(schema.aiInstanceCredentials);
  return new Set(rows.map((row) => row.pluginId));
}

/** Decrypted keys for the chat path. A row that cannot be opened is skipped. */
export async function loadDecryptedInstanceKeys(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({
      pluginId: schema.aiInstanceCredentials.pluginId,
      secretEnc: schema.aiInstanceCredentials.secretEnc,
    })
    .from(schema.aiInstanceCredentials);
  const out = new Map<string, string>();
  for (const row of rows) {
    try {
      out.set(row.pluginId, decryptAiSecret(row.secretEnc));
    } catch {
      console.warn(`AI instance key for ${row.pluginId} could not be decrypted.`);
    }
  }
  return out;
}

export async function replaceInstanceKey(
  db: Db,
  args: { pluginId: string; apiKey: string; actorUserId: number },
): Promise<InstanceKeyPublic> {
  requireKeyedPlugin(args.pluginId);
  const apiKey = args.apiKey.trim();
  if (apiKey.length < 8 || apiKey.length > 2000) {
    throw new AiCredentialsError(400, "validation_error", "Instance key must be 8 to 2000 characters.");
  }
  const hint = instanceKeyHint(apiKey);
  const secretEnc = encryptAiSecret(apiKey);
  const now = new Date();
  const [row] = await db
    .insert(schema.aiInstanceCredentials)
    .values({
      pluginId: args.pluginId,
      secretEnc,
      hint,
      verifiedAt: null,
      lastError: null,
      updatedById: args.actorUserId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.aiInstanceCredentials.pluginId,
      set: {
        secretEnc,
        hint,
        verifiedAt: null,
        lastError: null,
        updatedById: args.actorUserId,
        updatedAt: now,
      },
    })
    .returning({
      pluginId: schema.aiInstanceCredentials.pluginId,
      hint: schema.aiInstanceCredentials.hint,
      verifiedAt: schema.aiInstanceCredentials.verifiedAt,
      lastError: schema.aiInstanceCredentials.lastError,
    });
  if (!row) throw new AiCredentialsError(500, "internal", "Instance key was not stored.");
  return publicFromRow(row);
}

export async function removeInstanceKey(db: Db, pluginId: string): Promise<InstanceKeyPublic> {
  requireKeyedPlugin(pluginId);
  await db
    .delete(schema.aiInstanceCredentials)
    .where(eq(schema.aiInstanceCredentials.pluginId, pluginId));
  return { pluginId, ...EMPTY_KEY };
}

export async function verifyInstanceKey(
  db: Db,
  args: {
    pluginId: string;
    actorUserId: number;
    fetchImpl?: ProviderFetch;
    assertBaseUrl?: (url: string) => Promise<string>;
  },
): Promise<InstanceKeyPublic> {
  const plugin = requireKeyedPlugin(args.pluginId);
  const [stored] = await db
    .select()
    .from(schema.aiInstanceCredentials)
    .where(eq(schema.aiInstanceCredentials.pluginId, args.pluginId))
    .limit(1);
  if (!stored) {
    throw new AiCredentialsError(400, "instance_key_missing", "Store an instance key before verifying it.");
  }
  let plain: string;
  try {
    plain = decryptAiSecret(stored.secretEnc);
  } catch {
    throw new AiCredentialsError(
      400,
      "ai_credentials_key_missing",
      "The instance key could not be decrypted. Check AI_CREDENTIALS_KEY.",
    );
  }
  const [props] = await db
    .select({ value: schema.systemProperties.value })
    .from(schema.systemProperties)
    .where(eq(schema.systemProperties.key, "ai_providers"))
    .limit(1);
  const entry = normalizeAiProviders(props?.value)[plugin.id];
  const parsed = plugin.configSchema.safeParse(entry?.config ?? {});
  if (!parsed.success) {
    throw new AiCredentialsError(400, "invalid_provider_config", "Provider settings are incomplete.");
  }
  const result = await plugin.verifyKey({
    config: parsed.data,
    apiKey: plain,
    fetchImpl: args.fetchImpl,
    assertBaseUrl: args.assertBaseUrl ?? assertPublicProviderBaseUrl,
  });
  const now = new Date();
  if (!result.ok) {
    const message = capStoredKeyError(
      redactSecret(result.error.message, plain) || "Provider rejected the instance key.",
    );
    await db
      .update(schema.aiInstanceCredentials)
      .set({ verifiedAt: null, lastError: message, updatedById: args.actorUserId, updatedAt: now })
      .where(eq(schema.aiInstanceCredentials.pluginId, args.pluginId));
    throw new AiCredentialsError(400, "instance_key_verify_failed", message);
  }
  const [row] = await db
    .update(schema.aiInstanceCredentials)
    .set({ verifiedAt: now, lastError: null, updatedById: args.actorUserId, updatedAt: now })
    .where(eq(schema.aiInstanceCredentials.pluginId, args.pluginId))
    .returning({
      pluginId: schema.aiInstanceCredentials.pluginId,
      hint: schema.aiInstanceCredentials.hint,
      verifiedAt: schema.aiInstanceCredentials.verifiedAt,
      lastError: schema.aiInstanceCredentials.lastError,
    });
  if (!row) throw new AiCredentialsError(500, "internal", "Instance key was not updated.");
  return publicFromRow(row);
}

export async function setAiKeyMode(
  db: Db,
  args: {
    mode: AiKeyMode;
    acknowledgement?: string | null;
    actorUserId: number;
  },
  countUsers: (db: Db) => Promise<number> = countActiveUsers,
): Promise<{ mode: AiKeyMode; activeUserCount: number; acknowledged: boolean }> {
  const activeUserCount = await countUsers(db);
  const current = await readAiKeyMode(db);
  const required = billingAckRequired({ current, next: args.mode, activeUserCount });
  if (required && (args.acknowledgement ?? "").trim() !== BILLING_RISK_PHRASE) {
    throw new AiCredentialsError(
      400,
      "billing_ack_required",
      "Type I understand and accept to confirm this key mode.",
    );
  }
  if (current === args.mode) {
    return { mode: current, activeUserCount, acknowledged: false };
  }
  const now = new Date();
  await db
    .insert(schema.systemProperties)
    .values({ key: "ai_key_mode", value: args.mode, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.systemProperties.key,
      set: { value: args.mode, updatedAt: now },
    });
  invalidateSystemPropertiesCache();
  if (required) {
    await writeAiAudit({
      userId: args.actorUserId,
      feature: "key_mode",
      action: "key_mode",
      decision: "allow",
      reason: `mode=${args.mode} activeUsers=${activeUserCount}`,
      tier: 0,
    });
  }
  return { mode: args.mode, activeUserCount, acknowledged: required };
}
