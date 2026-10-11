import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { MESH_APPEARANCE_DEFAULTS } from "../lib/meshAppearance.js";
import {
  invalidateSystemPropertiesCache,
  readSystemPropertiesCache,
  rememberSystemPropertiesCache,
  SYSTEM_PROPERTIES_CACHE_TTL_MS,
  systemPropertiesPatchSchema,
  type SystemProperties,
} from "./systemProperties.js";

function sample(overrides: Partial<SystemProperties> = {}): SystemProperties {
  return {
    apiRateLimitPerMinute: 60,
    globalApiRateLimitPerMinute: 300,
    searchRateLimitPerMinute: 60,
    loginFailureThreshold: 3,
    sessionTimeoutMinutes: 60,
    maxConcurrentSessions: 1,
    defaultTheme: "green",
    mfaEnforcement: "none",
    mfaGraceDays: 7,
    mfaTrustedDeviceDays: 15,
    mfaTrustedDeviceMax: 5,
    meshAppearance: MESH_APPEARANCE_DEFAULTS,
    updatedAt: null,
    ...overrides,
  };
}

describe("system properties cache", () => {
  after(() => {
    invalidateSystemPropertiesCache();
  });

  it("serves a remembered value until the TTL, then drops it", () => {
    const now = 1_700_000_000_000;
    rememberSystemPropertiesCache(sample({ globalApiRateLimitPerMinute: 1000 }), now);
    assert.equal(
      readSystemPropertiesCache(now + SYSTEM_PROPERTIES_CACHE_TTL_MS - 1)
        ?.globalApiRateLimitPerMinute,
      1000,
    );
    assert.equal(readSystemPropertiesCache(now + SYSTEM_PROPERTIES_CACHE_TTL_MS), null);
  });

  it("drops the remembered value when a save invalidates the cache", () => {
    rememberSystemPropertiesCache(sample({ searchRateLimitPerMinute: 120 }));
    assert.equal(readSystemPropertiesCache()?.searchRateLimitPerMinute, 120);
    invalidateSystemPropertiesCache();
    assert.equal(readSystemPropertiesCache(), null);
  });
});

describe("system properties patch schema", () => {
  it("accepts the configurable rate-limit bounds", () => {
    const low = systemPropertiesPatchSchema.safeParse({
      globalApiRateLimitPerMinute: 10,
      searchRateLimitPerMinute: 10,
    });
    const high = systemPropertiesPatchSchema.safeParse({
      globalApiRateLimitPerMinute: 100_000,
      searchRateLimitPerMinute: 100_000,
    });
    assert.equal(low.success, true);
    assert.equal(high.success, true);
  });

  it("rejects rate limits outside 10–100000", () => {
    for (const value of [9, 100_001, 9.5]) {
      assert.equal(
        systemPropertiesPatchSchema.safeParse({ globalApiRateLimitPerMinute: value }).success,
        false,
      );
      assert.equal(
        systemPropertiesPatchSchema.safeParse({ searchRateLimitPerMinute: value }).success,
        false,
      );
    }
  });
});
