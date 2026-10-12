import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as schema from "../db/schema.js";
import { instanceBrand } from "../lib/instanceBrand.js";
import {
  MESH_APPEARANCE_DEFAULTS,
  meshAppearanceSchema,
  normalizeMeshAppearance,
  type MeshAppearance,
} from "../lib/meshAppearance.js";
import { DEFAULT_THEME, isThemeId, THEME_IDS, type ThemeId } from "../lib/theme.js";
import {
  normalizeAiFeatureRoutes,
  type AiFeatureRoutesFile,
} from "./assistant/aiFeatureRoutes.js";
import {
  normalizeAiProviders,
  OPENAI_KEY_DEPRECATION_LOG,
  openAiPluginSeed,
  type AiProvidersFile,
} from "./assistant/aiProviderConfig.js";
import {
  defaultStoredAiPermissionTiers,
  parseStoredAiPermissionTiers,
  type StoredAiPermissionTiers,
} from "./assistant/aiTiers.js";
import { isAiAccess, type AiAccess } from "./assistant/aiAccess.js";
import { parseAiKeyMode, type AiKeyMode } from "./assistant/aiKeyMode.js";

type Db = NodePgDatabase<typeof schema>;

export const MFA_ENFORCEMENT_VALUES = ["none", "administrators"] as const;
export type MfaEnforcement = (typeof MFA_ENFORCEMENT_VALUES)[number];

export function isMfaEnforcement(value: unknown): value is MfaEnforcement {
  return (
    typeof value === "string" &&
    (MFA_ENFORCEMENT_VALUES as readonly string[]).includes(value)
  );
}

/** Shared bounds for the Administrator-adjustable global and search ceilings. */
export const CONFIGURABLE_RATE_LIMIT_MIN = 10;
export const CONFIGURABLE_RATE_LIMIT_MAX = 100_000;

/** In-memory lifetime for `getSystemProperties`. Admin saves clear the cache immediately. */
export const SYSTEM_PROPERTIES_CACHE_TTL_MS = 15_000;

export const SYSTEM_PROPERTY_KEYS = [
  "api_rate_limit_per_minute",
  "global_api_rate_limit_per_minute",
  "search_rate_limit_per_minute",
  "login_failure_threshold",
  "session_timeout_minutes",
  "max_concurrent_sessions",
  "default_theme",
  "mfa_enforcement",
  "mfa_grace_days",
  "mfa_trusted_device_days",
  "mfa_trusted_device_max",
  "mesh_appearance",
  "ai_providers",
  "ai_web_fetch",
  "ai_permission_tiers",
  "ai_undo_window_days",
  "ai_project_access_default",
  "ai_key_mode",
  "ai_feature_routes",
] as const;

export type SystemPropertyKey = (typeof SYSTEM_PROPERTY_KEYS)[number];

export type SystemProperties = {
  apiRateLimitPerMinute: number;
  globalApiRateLimitPerMinute: number;
  searchRateLimitPerMinute: number;
  loginFailureThreshold: number;
  sessionTimeoutMinutes: number;
  maxConcurrentSessions: number;
  defaultTheme: ThemeId;
  mfaEnforcement: MfaEnforcement;
  mfaGraceDays: number;
  mfaTrustedDeviceDays: number;
  mfaTrustedDeviceMax: number;
  meshAppearance: MeshAppearance;
  aiProviders: AiProvidersFile;
  /** When true, assistant chat may call `web_fetch`. Default false. */
  aiWebFetch: boolean;
  /** Instance ceiling for project AI access. Projects can only narrow this. */
  aiProjectAccessDefault: AiAccess;
  /** Administrator tier matrix and blast-radius thresholds. User opt-in is not stored here. */
  aiPermissionTiers: StoredAiPermissionTiers;
  /** Days an auto-applied change stays undoable. Default 7. */
  aiUndoWindowDays: number;
  /** Who may spend an instance provider key. Changed only through the billing-risk route. */
  aiKeyMode: AiKeyMode;
  /** Per-feature model defaults, fallbacks, and model-profile overrides (T0205). */
  aiFeatureRoutes: AiFeatureRoutesFile;
  updatedAt: string | null;
};

/** Public subset safe to expose without admin auth. */
export type PublicSystemConfig = {
  defaultTheme: ThemeId;
  /** Runtime instance; not stored in the database. */
  instance: "dev" | "prod";
  /** Overlay default for DEV (yellow). Null on PROD — use `defaultTheme`. */
  instanceTheme: ThemeId | null;
  /** MFA trust duration in days (0 = trust-this-device disabled). */
  mfaTrustedDeviceDays: number;
  meshAppearance: MeshAppearance;
};

const DEFAULTS: {
  api_rate_limit_per_minute: number;
  global_api_rate_limit_per_minute: number;
  search_rate_limit_per_minute: number;
  login_failure_threshold: number;
  session_timeout_minutes: number;
  max_concurrent_sessions: number;
  default_theme: ThemeId;
  mfa_enforcement: MfaEnforcement;
  mfa_grace_days: number;
  mfa_trusted_device_days: number;
  mfa_trusted_device_max: number;
  mesh_appearance: MeshAppearance;
  ai_web_fetch: boolean;
  ai_permission_tiers: StoredAiPermissionTiers;
  ai_undo_window_days: number;
  ai_project_access_default: AiAccess;
  ai_key_mode: AiKeyMode;
  ai_feature_routes: AiFeatureRoutesFile;
} = {
  api_rate_limit_per_minute: 60,
  global_api_rate_limit_per_minute: 300,
  search_rate_limit_per_minute: 60,
  login_failure_threshold: 3,
  session_timeout_minutes: 60,
  max_concurrent_sessions: 1,
  default_theme: DEFAULT_THEME,
  mfa_enforcement: "none",
  mfa_grace_days: 7,
  mfa_trusted_device_days: 15,
  mfa_trusted_device_max: 5,
  mesh_appearance: MESH_APPEARANCE_DEFAULTS,
  ai_web_fetch: false,
  ai_permission_tiers: defaultStoredAiPermissionTiers(),
  ai_undo_window_days: 7,
  ai_project_access_default: "full",
  ai_key_mode: "instance_only",
  ai_feature_routes: { features: {}, profiles: [] },
};

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function asIntInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = asNumber(value, fallback);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

function asThemeId(value: unknown, fallback: ThemeId): ThemeId {
  if (isThemeId(value)) return value;
  return fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function asAiAccess(value: unknown, fallback: AiAccess): AiAccess {
  if (isAiAccess(value)) return value;
  return fallback;
}

function asMfaEnforcement(value: unknown, fallback: MfaEnforcement): MfaEnforcement {
  if (isMfaEnforcement(value)) return value;
  return fallback;
}

type SystemPropertiesCacheSlot = {
  expiresAt: number;
  value: SystemProperties;
};

let systemPropertiesCache: SystemPropertiesCacheSlot | null = null;

export function invalidateSystemPropertiesCache(): void {
  systemPropertiesCache = null;
}

export function readSystemPropertiesCache(now = Date.now()): SystemProperties | null {
  if (!systemPropertiesCache || now >= systemPropertiesCache.expiresAt) return null;
  return systemPropertiesCache.value;
}

export function rememberSystemPropertiesCache(value: SystemProperties, now = Date.now()): void {
  systemPropertiesCache = {
    value,
    expiresAt: now + SYSTEM_PROPERTIES_CACHE_TTL_MS,
  };
}

function defaultPropertyValue(key: SystemPropertyKey): unknown {
  if (key === "ai_providers") return openAiPluginSeed(process.env) ?? {};
  return DEFAULTS[key];
}

export async function getSystemProperties(db: Db, now = Date.now()): Promise<SystemProperties> {
  const cached = readSystemPropertiesCache(now);
  if (cached) return cached;
  const rows = await db
    .select()
    .from(schema.systemProperties)
    .where(inArray(schema.systemProperties.key, [...SYSTEM_PROPERTY_KEYS]));

  const map = new Map(rows.map((r) => [r.key, r]));
  let latest: Date | null = null;

  for (const key of SYSTEM_PROPERTY_KEYS) {
    if (!map.has(key)) {
      const value = defaultPropertyValue(key);
      const [inserted] = await db
        .insert(schema.systemProperties)
        .values({ key, value })
        .onConflictDoNothing()
        .returning();
      if (inserted && key === "ai_providers" && openAiPluginSeed(process.env)) {
        console.warn(OPENAI_KEY_DEPRECATION_LOG);
      }
      if (inserted) map.set(key, inserted);
      else {
        const [again] = await db
          .select()
          .from(schema.systemProperties)
          .where(eq(schema.systemProperties.key, key))
          .limit(1);
        if (again) map.set(key, again);
      }
    }
    const row = map.get(key);
    if (row && (!latest || row.updatedAt > latest)) latest = row.updatedAt;
  }

  const resolved: SystemProperties = {
    apiRateLimitPerMinute: asNumber(
      map.get("api_rate_limit_per_minute")?.value,
      DEFAULTS.api_rate_limit_per_minute,
    ),
    globalApiRateLimitPerMinute: asIntInRange(
      map.get("global_api_rate_limit_per_minute")?.value,
      DEFAULTS.global_api_rate_limit_per_minute,
      CONFIGURABLE_RATE_LIMIT_MIN,
      CONFIGURABLE_RATE_LIMIT_MAX,
    ),
    searchRateLimitPerMinute: asIntInRange(
      map.get("search_rate_limit_per_minute")?.value,
      DEFAULTS.search_rate_limit_per_minute,
      CONFIGURABLE_RATE_LIMIT_MIN,
      CONFIGURABLE_RATE_LIMIT_MAX,
    ),
    loginFailureThreshold: asNumber(
      map.get("login_failure_threshold")?.value,
      DEFAULTS.login_failure_threshold,
    ),
    sessionTimeoutMinutes: asNumber(
      map.get("session_timeout_minutes")?.value,
      DEFAULTS.session_timeout_minutes,
    ),
    maxConcurrentSessions: asIntInRange(
      map.get("max_concurrent_sessions")?.value,
      DEFAULTS.max_concurrent_sessions,
      1,
      20,
    ),
    defaultTheme: asThemeId(map.get("default_theme")?.value, DEFAULTS.default_theme),
    mfaEnforcement: asMfaEnforcement(
      map.get("mfa_enforcement")?.value,
      DEFAULTS.mfa_enforcement,
    ),
    mfaGraceDays: asNumber(map.get("mfa_grace_days")?.value, DEFAULTS.mfa_grace_days),
    mfaTrustedDeviceDays: asNumber(
      map.get("mfa_trusted_device_days")?.value,
      DEFAULTS.mfa_trusted_device_days,
    ),
    mfaTrustedDeviceMax: asNumber(
      map.get("mfa_trusted_device_max")?.value,
      DEFAULTS.mfa_trusted_device_max,
    ),
    meshAppearance: normalizeMeshAppearance(map.get("mesh_appearance")?.value),
    aiProviders: normalizeAiProviders(map.get("ai_providers")?.value),
    aiWebFetch: asBoolean(map.get("ai_web_fetch")?.value, DEFAULTS.ai_web_fetch),
    aiProjectAccessDefault: asAiAccess(
      map.get("ai_project_access_default")?.value,
      DEFAULTS.ai_project_access_default,
    ),
    aiPermissionTiers: parseStoredAiPermissionTiers(
      map.get("ai_permission_tiers")?.value ?? DEFAULTS.ai_permission_tiers,
    ),
    aiUndoWindowDays: asIntInRange(
      map.get("ai_undo_window_days")?.value,
      DEFAULTS.ai_undo_window_days,
      1,
      90,
    ),
    aiKeyMode: parseAiKeyMode(map.get("ai_key_mode")?.value ?? DEFAULTS.ai_key_mode),
    aiFeatureRoutes: normalizeAiFeatureRoutes(
      map.get("ai_feature_routes")?.value ?? DEFAULTS.ai_feature_routes,
    ),
    updatedAt: latest?.toISOString() ?? null,
  };
  rememberSystemPropertiesCache(resolved, now);
  return resolved;
}

export async function getPublicSystemConfig(db: Db): Promise<PublicSystemConfig> {
  const props = await getSystemProperties(db);
  const brand = instanceBrand();
  return {
    defaultTheme: props.defaultTheme,
    instance: brand.instance,
    instanceTheme: brand.instanceTheme,
    mfaTrustedDeviceDays: props.mfaTrustedDeviceDays,
    meshAppearance: props.meshAppearance,
  };
}

export async function patchSystemProperties(
  db: Db,
  patch: {
    apiRateLimitPerMinute?: number;
    globalApiRateLimitPerMinute?: number;
    searchRateLimitPerMinute?: number;
    loginFailureThreshold?: number;
    sessionTimeoutMinutes?: number;
    maxConcurrentSessions?: number;
    defaultTheme?: ThemeId;
    mfaEnforcement?: MfaEnforcement;
    mfaGraceDays?: number;
    mfaTrustedDeviceDays?: number;
    mfaTrustedDeviceMax?: number;
    meshAppearance?: MeshAppearance;
    aiWebFetch?: boolean;
    aiProjectAccessDefault?: AiAccess;
  },
): Promise<SystemProperties> {
  const now = new Date();
  if (patch.apiRateLimitPerMinute !== undefined) {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "api_rate_limit_per_minute",
        value: patch.apiRateLimitPerMinute,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: patch.apiRateLimitPerMinute, updatedAt: now },
      });
  }
  if (patch.globalApiRateLimitPerMinute !== undefined) {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "global_api_rate_limit_per_minute",
        value: patch.globalApiRateLimitPerMinute,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: patch.globalApiRateLimitPerMinute, updatedAt: now },
      });
  }
  if (patch.searchRateLimitPerMinute !== undefined) {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "search_rate_limit_per_minute",
        value: patch.searchRateLimitPerMinute,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: patch.searchRateLimitPerMinute, updatedAt: now },
      });
  }
  if (patch.loginFailureThreshold !== undefined) {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "login_failure_threshold",
        value: patch.loginFailureThreshold,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: patch.loginFailureThreshold, updatedAt: now },
      });
  }
  if (patch.sessionTimeoutMinutes !== undefined) {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "session_timeout_minutes",
        value: patch.sessionTimeoutMinutes,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: patch.sessionTimeoutMinutes, updatedAt: now },
      });
  }
  if (patch.maxConcurrentSessions !== undefined) {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "max_concurrent_sessions",
        value: patch.maxConcurrentSessions,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: patch.maxConcurrentSessions, updatedAt: now },
      });
  }
  if (patch.defaultTheme !== undefined) {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "default_theme",
        value: patch.defaultTheme,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: patch.defaultTheme, updatedAt: now },
      });
  }
  if (patch.mfaEnforcement !== undefined) {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "mfa_enforcement",
        value: patch.mfaEnforcement,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: patch.mfaEnforcement, updatedAt: now },
      });
  }
  if (patch.mfaGraceDays !== undefined) {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "mfa_grace_days",
        value: patch.mfaGraceDays,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: patch.mfaGraceDays, updatedAt: now },
      });
  }
  if (patch.mfaTrustedDeviceDays !== undefined) {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "mfa_trusted_device_days",
        value: patch.mfaTrustedDeviceDays,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: patch.mfaTrustedDeviceDays, updatedAt: now },
      });
  }
  if (patch.mfaTrustedDeviceMax !== undefined) {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "mfa_trusted_device_max",
        value: patch.mfaTrustedDeviceMax,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: patch.mfaTrustedDeviceMax, updatedAt: now },
      });
  }
  if (patch.meshAppearance !== undefined) {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "mesh_appearance",
        value: patch.meshAppearance,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: patch.meshAppearance, updatedAt: now },
      });
  }
  if (patch.aiWebFetch !== undefined) {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "ai_web_fetch",
        value: patch.aiWebFetch,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: patch.aiWebFetch, updatedAt: now },
      });
  }
  if (patch.aiProjectAccessDefault !== undefined) {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "ai_project_access_default",
        value: patch.aiProjectAccessDefault,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: patch.aiProjectAccessDefault, updatedAt: now },
      });
  }
  invalidateSystemPropertiesCache();
  return getSystemProperties(db);
}

export const systemPropertiesPatchSchema = z
  .object({
    apiRateLimitPerMinute: z.number().int().min(1).max(100_000).optional(),
    globalApiRateLimitPerMinute: z
      .number()
      .int()
      .min(CONFIGURABLE_RATE_LIMIT_MIN)
      .max(CONFIGURABLE_RATE_LIMIT_MAX)
      .optional(),
    searchRateLimitPerMinute: z
      .number()
      .int()
      .min(CONFIGURABLE_RATE_LIMIT_MIN)
      .max(CONFIGURABLE_RATE_LIMIT_MAX)
      .optional(),
    loginFailureThreshold: z.number().int().min(1).max(1000).optional(),
    sessionTimeoutMinutes: z.number().int().min(1).max(10_080).optional(),
    maxConcurrentSessions: z.number().int().min(1).max(20).optional(),
    defaultTheme: z.enum(THEME_IDS).optional(),
    mfaEnforcement: z.enum(["none", "administrators"]).optional(),
    mfaGraceDays: z.number().int().min(0).max(365).optional(),
    mfaTrustedDeviceDays: z.number().int().min(0).max(365).optional(),
    mfaTrustedDeviceMax: z.number().int().min(1).max(50).optional(),
    meshAppearance: meshAppearanceSchema.optional(),
    aiWebFetch: z.boolean().optional(),
    aiProjectAccessDefault: z.enum(["full", "read_only", "excluded"]).optional(),
  })
  .strict();
