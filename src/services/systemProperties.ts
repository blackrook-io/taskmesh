import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { instanceBrand } from "../lib/instanceBrand.js";
import { DEFAULT_THEME, isThemeId, type ThemeId } from "../lib/theme.js";

type Db = NodePgDatabase<typeof schema>;

export const SYSTEM_PROPERTY_KEYS = [
  "api_rate_limit_per_minute",
  "login_failure_threshold",
  "default_theme",
] as const;

export type SystemPropertyKey = (typeof SYSTEM_PROPERTY_KEYS)[number];

export type SystemProperties = {
  apiRateLimitPerMinute: number;
  loginFailureThreshold: number;
  defaultTheme: ThemeId;
  updatedAt: string | null;
};

/** Public subset safe to expose without admin auth. */
export type PublicSystemConfig = {
  defaultTheme: ThemeId;
  /** Runtime instance; not stored in the database. */
  instance: "dev" | "prod";
  /** Overlay default for DEV (yellow). Null on PROD — use `defaultTheme`. */
  instanceTheme: ThemeId | null;
};

const DEFAULTS: {
  api_rate_limit_per_minute: number;
  login_failure_threshold: number;
  default_theme: ThemeId;
} = {
  api_rate_limit_per_minute: 60,
  login_failure_threshold: 5,
  default_theme: DEFAULT_THEME,
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
    defaultTheme: asThemeId(map.get("default_theme")?.value, DEFAULTS.default_theme),
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
  };
}

export async function patchSystemProperties(
  db: Db,
  patch: {
    apiRateLimitPerMinute?: number;
    loginFailureThreshold?: number;
    defaultTheme?: ThemeId;
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
  return getSystemProperties(db);
}
