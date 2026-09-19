import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { instanceBrand } from "../lib/instanceBrand.js";
import { DEFAULT_THEME, isThemeId, type ThemeId } from "../lib/theme.js";

type Db = NodePgDatabase<typeof schema>;

export const MFA_ENFORCEMENT_VALUES = ["none", "administrators"] as const;
export type MfaEnforcement = (typeof MFA_ENFORCEMENT_VALUES)[number];

export function isMfaEnforcement(value: unknown): value is MfaEnforcement {
  return (
    typeof value === "string" &&
    (MFA_ENFORCEMENT_VALUES as readonly string[]).includes(value)
  );
}

export const SYSTEM_PROPERTY_KEYS = [
  "api_rate_limit_per_minute",
  "login_failure_threshold",
  "session_timeout_minutes",
  "default_theme",
  "mfa_enforcement",
  "mfa_grace_days",
  "mfa_trusted_device_days",
  "mfa_trusted_device_max",
] as const;

export type SystemPropertyKey = (typeof SYSTEM_PROPERTY_KEYS)[number];

export type SystemProperties = {
  apiRateLimitPerMinute: number;
  loginFailureThreshold: number;
  sessionTimeoutMinutes: number;
  defaultTheme: ThemeId;
  mfaEnforcement: MfaEnforcement;
  mfaGraceDays: number;
  mfaTrustedDeviceDays: number;
  mfaTrustedDeviceMax: number;
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
};

const DEFAULTS: {
  api_rate_limit_per_minute: number;
  login_failure_threshold: number;
  session_timeout_minutes: number;
  default_theme: ThemeId;
  mfa_enforcement: MfaEnforcement;
  mfa_grace_days: number;
  mfa_trusted_device_days: number;
  mfa_trusted_device_max: number;
} = {
  api_rate_limit_per_minute: 60,
  login_failure_threshold: 3,
  session_timeout_minutes: 60,
  default_theme: DEFAULT_THEME,
  mfa_enforcement: "none",
  mfa_grace_days: 7,
  mfa_trusted_device_days: 15,
  mfa_trusted_device_max: 5,
};

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function asThemeId(value: unknown, fallback: ThemeId): ThemeId {
  if (isThemeId(value)) return value;
  return fallback;
}

function asMfaEnforcement(value: unknown, fallback: MfaEnforcement): MfaEnforcement {
  if (isMfaEnforcement(value)) return value;
  return fallback;
}

export async function getSystemProperties(db: Db): Promise<SystemProperties> {
  const rows = await db
    .select()
    .from(schema.systemProperties)
    .where(inArray(schema.systemProperties.key, [...SYSTEM_PROPERTY_KEYS]));

  const map = new Map(rows.map((r) => [r.key, r]));
  let latest: Date | null = null;

  for (const key of SYSTEM_PROPERTY_KEYS) {
    if (!map.has(key)) {
      const [inserted] = await db
        .insert(schema.systemProperties)
        .values({ key, value: DEFAULTS[key] })
        .onConflictDoNothing()
        .returning();
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

  return {
    apiRateLimitPerMinute: asNumber(
      map.get("api_rate_limit_per_minute")?.value,
      DEFAULTS.api_rate_limit_per_minute,
    ),
    loginFailureThreshold: asNumber(
      map.get("login_failure_threshold")?.value,
      DEFAULTS.login_failure_threshold,
    ),
    sessionTimeoutMinutes: asNumber(
      map.get("session_timeout_minutes")?.value,
      DEFAULTS.session_timeout_minutes,
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
    updatedAt: latest?.toISOString() ?? null,
  };
}

export async function getPublicSystemConfig(db: Db): Promise<PublicSystemConfig> {
  const props = await getSystemProperties(db);
  const brand = instanceBrand();
  return {
    defaultTheme: props.defaultTheme,
    instance: brand.instance,
    instanceTheme: brand.instanceTheme,
    mfaTrustedDeviceDays: props.mfaTrustedDeviceDays,
  };
}

export async function patchSystemProperties(
  db: Db,
  patch: {
    apiRateLimitPerMinute?: number;
    loginFailureThreshold?: number;
    sessionTimeoutMinutes?: number;
    defaultTheme?: ThemeId;
    mfaEnforcement?: MfaEnforcement;
    mfaGraceDays?: number;
    mfaTrustedDeviceDays?: number;
    mfaTrustedDeviceMax?: number;
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
  return getSystemProperties(db);
}
