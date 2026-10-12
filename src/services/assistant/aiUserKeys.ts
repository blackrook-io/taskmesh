import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AiProviderPlugin, ProviderFetch } from "@taskmesh/ai-provider-contract";
import * as schema from "../../db/schema.js";
import { decryptAiSecret, encryptAiSecret } from "../../lib/aiCredentialsCrypto.js";
import { AiCredentialsError, loadDecryptedInstanceKeys, readAiKeyMode } from "./aiInstanceKeys.js";
import { instanceKeyHint, redactSecret, type AiKeyMode } from "./aiKeyMode.js";
import { normalizeAiProviders, resolvePluginApiKey } from "./aiProviderConfig.js";
import { getAiProvider } from "./providerLoader.js";
import { assertPublicProviderBaseUrl } from "./providerBaseUrl.js";
import { getSystemProperties } from "../systemProperties.js";

type Db = NodePgDatabase<typeof schema>;

const LAST_ERROR_MAX = 500;

export type UserKeyPublic = {
  pluginId: string;
  keyHint: string | null;
  defaultModel: string | null;
  verifiedAt: string | null;
  lastError: string | null;
};

export type ResolvedProviderKey = {
  apiKey: string | null;
  /** Set only when the call spends this user's stored key. */
  defaultModel: string | null;
};

type UserKeySecret = {
  apiKey: string;
  defaultModel: string | null;
};

function publicFromRow(row: {
  pluginId: string;
  hint: string;
  defaultModel: string | null;
  verifiedAt: Date | null;
  lastError: string | null;
}): UserKeyPublic {
  return {
    pluginId: row.pluginId,
    keyHint: row.hint,
    defaultModel: row.defaultModel,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    lastError: row.lastError,
  };
}

function capError(message: string): string {
  const trimmed = message.trim();
  const text = trimmed || "Provider rejected the key.";
  return text.length <= LAST_ERROR_MAX ? text : text.slice(0, LAST_ERROR_MAX);
}

async function requireUserKeyPlugin(db: Db, pluginId: string): Promise<AiProviderPlugin> {
  const plugin = getAiProvider(pluginId);
  if (!plugin) {
    throw new AiCredentialsError(404, "not_found", `Unknown AI provider: ${pluginId}`);
  }
  if (plugin.capabilities.local) {
    throw new AiCredentialsError(400, "user_key_unsupported", "This provider does not use a key.");
  }
  const props = await getSystemProperties(db);
  const entry = props.aiProviders[pluginId];
  if (!entry?.enabled) {
    throw new AiCredentialsError(
      400,
      "provider_disabled",
      "This provider is turned off by your Administrator.",
    );
  }
  const parsed = plugin.configSchema.safeParse(entry.config);
  if (!parsed.success) {
    throw new AiCredentialsError(400, "invalid_provider_config", "Provider settings are incomplete.");
  }
  return plugin;
}

function parseDefaultModel(value: string | null | undefined, secret: string): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 120) {
    throw new AiCredentialsError(400, "validation_error", "Default model must be 120 characters or fewer.");
  }
  if (secret.trim().length >= 8 && trimmed.includes(secret.trim())) {
    throw new AiCredentialsError(400, "validation_error", "Default model cannot contain the provider key.");
  }
  return trimmed;
}

export async function listUserCredentials(db: Db, userId: number): Promise<UserKeyPublic[]> {
  const rows = await db
    .select({
      pluginId: schema.userAiCredentials.pluginId,
      hint: schema.userAiCredentials.hint,
      defaultModel: schema.userAiCredentials.defaultModel,
      verifiedAt: schema.userAiCredentials.verifiedAt,
      lastError: schema.userAiCredentials.lastError,
    })
    .from(schema.userAiCredentials)
    .where(eq(schema.userAiCredentials.userId, userId));
  return rows.map(publicFromRow);
}

/** Decrypted keys for one user. A row that cannot be opened is skipped. */
export async function loadDecryptedUserKeys(db: Db, userId: number): Promise<Map<string, UserKeySecret>> {
  const rows = await db
    .select({
      pluginId: schema.userAiCredentials.pluginId,
      secretEnc: schema.userAiCredentials.secretEnc,
      defaultModel: schema.userAiCredentials.defaultModel,
    })
    .from(schema.userAiCredentials)
    .where(eq(schema.userAiCredentials.userId, userId));
  const out = new Map<string, UserKeySecret>();
  for (const row of rows) {
    try {
      out.set(row.pluginId, {
        apiKey: decryptAiSecret(row.secretEnc),
        defaultModel: row.defaultModel,
      });
    } catch {
      console.warn(`AI user key for plugin ${row.pluginId} could not be decrypted.`);
    }
  }
  return out;
}

/**
 * Key for one plugin and user. `instance_only` ignores user rows.
 * `user_only` never reads the instance key or the environment.
 * `user_preferred_instance_fallback` uses the user row when it decrypts.
 */
export async function resolveProviderKey(
  db: Db,
  args: { userId: number; pluginId: string; local?: boolean; env?: NodeJS.ProcessEnv },
): Promise<ResolvedProviderKey> {
  if (args.local) return { apiKey: null, defaultModel: null };
  const mode = await readAiKeyMode(db);
  const userKeys = mode === "instance_only" ? new Map<string, UserKeySecret>() : await loadDecryptedUserKeys(db, args.userId);
  const instanceKeys = mode === "user_only" ? new Map<string, string>() : await loadDecryptedInstanceKeys(db);
  return pickProviderKey({
    mode,
    pluginId: args.pluginId,
    user: userKeys.get(args.pluginId) ?? null,
    instanceKey: instanceKeys.get(args.pluginId) ?? null,
    env: args.env,
  });
}

export function pickProviderKey(args: {
  mode: AiKeyMode;
  pluginId: string;
  user: UserKeySecret | null;
  instanceKey: string | null;
  env?: NodeJS.ProcessEnv;
}): ResolvedProviderKey {
  if (args.mode !== "instance_only" && args.user) {
    if (args.mode === "user_only" || args.mode === "user_preferred_instance_fallback") {
      return { apiKey: args.user.apiKey, defaultModel: args.user.defaultModel };
    }
  }
  if (args.mode === "user_only") return { apiKey: null, defaultModel: null };
  if (args.instanceKey) return { apiKey: args.instanceKey, defaultModel: null };
  const envKey = resolvePluginApiKey(args.pluginId, args.env);
  if (envKey) return { apiKey: envKey, defaultModel: null };
  return { apiKey: null, defaultModel: null };
}

export async function loadResolvedKeys(
  db: Db,
  userId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ mode: AiKeyMode; resolve: (pluginId: string) => ResolvedProviderKey }> {
  const mode = await readAiKeyMode(db);
  const userKeys = mode === "instance_only" ? new Map<string, UserKeySecret>() : await loadDecryptedUserKeys(db, userId);
  const instanceKeys = mode === "user_only" ? new Map<string, string>() : await loadDecryptedInstanceKeys(db);
  return {
    mode,
    resolve: (pluginId) =>
      pickProviderKey({
        mode,
        pluginId,
        user: userKeys.get(pluginId) ?? null,
        instanceKey: instanceKeys.get(pluginId) ?? null,
        env,
      }),
  };
}

export async function replaceUserKey(
  db: Db,
  args: {
    userId: number;
    pluginId: string;
    apiKey: string;
    defaultModel?: string | null;
    fetchImpl?: ProviderFetch;
    assertBaseUrl?: (url: string) => Promise<string>;
  },
): Promise<UserKeyPublic> {
  const plugin = await requireUserKeyPlugin(db, args.pluginId);
  const apiKey = args.apiKey.trim();
  if (apiKey.length < 8 || apiKey.length > 2000) {
    throw new AiCredentialsError(400, "validation_error", "Provider key must be 8 to 2000 characters.");
  }
  const defaultModel = parseDefaultModel(args.defaultModel, apiKey);
  const hint = instanceKeyHint(apiKey);
  const secretEnc = encryptAiSecret(apiKey);
  const now = new Date();
  await db
    .insert(schema.userAiCredentials)
    .values({
      userId: args.userId,
      pluginId: args.pluginId,
      secretEnc,
      hint,
      defaultModel,
      verifiedAt: null,
      lastError: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.userAiCredentials.userId, schema.userAiCredentials.pluginId],
      set: {
        secretEnc,
        hint,
        defaultModel,
        verifiedAt: null,
        lastError: null,
        updatedAt: now,
      },
    });

  const props = await getSystemProperties(db);
  const entry = normalizeAiProviders(props.aiProviders)[plugin.id];
  const parsed = plugin.configSchema.safeParse(entry?.config ?? {});
  if (!parsed.success) {
    throw new AiCredentialsError(400, "invalid_provider_config", "Provider settings are incomplete.");
  }
  const result = await plugin.verifyKey({
    config: parsed.data,
    apiKey,
    fetchImpl: args.fetchImpl,
    assertBaseUrl: args.assertBaseUrl ?? assertPublicProviderBaseUrl,
  });
  if (!result.ok) {
    const message = capError(redactSecret(result.error.message, apiKey) || "Provider rejected the key.");
    await db
      .update(schema.userAiCredentials)
      .set({ verifiedAt: null, lastError: message, updatedAt: new Date() })
      .where(
        and(
          eq(schema.userAiCredentials.userId, args.userId),
          eq(schema.userAiCredentials.pluginId, args.pluginId),
        ),
      );
    throw new AiCredentialsError(422, "user_key_verify_failed", message);
  }
  const verifiedAt = new Date();
  const [row] = await db
    .update(schema.userAiCredentials)
    .set({ verifiedAt, lastError: null, updatedAt: verifiedAt })
    .where(
      and(
        eq(schema.userAiCredentials.userId, args.userId),
        eq(schema.userAiCredentials.pluginId, args.pluginId),
      ),
    )
    .returning({
      pluginId: schema.userAiCredentials.pluginId,
      hint: schema.userAiCredentials.hint,
      defaultModel: schema.userAiCredentials.defaultModel,
      verifiedAt: schema.userAiCredentials.verifiedAt,
      lastError: schema.userAiCredentials.lastError,
    });
  if (!row) throw new AiCredentialsError(500, "internal", "Provider key was not stored.");
  return publicFromRow(row);
}

export async function removeUserKey(db: Db, args: { userId: number; pluginId: string }): Promise<UserKeyPublic> {
  await requireUserKeyPlugin(db, args.pluginId);
  await db
    .delete(schema.userAiCredentials)
    .where(
      and(
        eq(schema.userAiCredentials.userId, args.userId),
        eq(schema.userAiCredentials.pluginId, args.pluginId),
      ),
    );
  return {
    pluginId: args.pluginId,
    keyHint: null,
    defaultModel: null,
    verifiedAt: null,
    lastError: null,
  };
}
