import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, desc, eq } from "drizzle-orm";
import { db, pool } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { invalidateSystemPropertiesCache } from "../systemProperties.js";
import { listAiCapabilities } from "./aiCapabilities.js";
import { loadAiProviderPlugins } from "./providerLoader.js";
import { defaultStoredAiPermissionTiers } from "./aiTiers.js";
import {
  loadUserAiPolicy,
  lockedUserPolicyKeys,
  saveUserAiPolicy,
  UserAiPolicyError,
  validateUserAiPolicyPut,
} from "./aiUserPolicy.js";

const OPENAI_ON = {
  openai: {
    enabled: true,
    config: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini" },
  },
};

describe("user AI policy", { concurrency: false }, () => {
  let originalProviders: unknown;
  let originalMode: unknown;
  let userId = 0;

  before(async () => {
    await loadAiProviderPlugins();
    const [providers] = await db
      .select({ value: schema.systemProperties.value })
      .from(schema.systemProperties)
      .where(eq(schema.systemProperties.key, "ai_providers"))
      .limit(1);
    originalProviders = providers?.value ?? null;
    const [mode] = await db
      .select({ value: schema.systemProperties.value })
      .from(schema.systemProperties)
      .where(eq(schema.systemProperties.key, "ai_key_mode"))
      .limit(1);
    originalMode = mode?.value ?? "instance_only";
    const [maxUser] = await db
      .select({ n: schema.users.number })
      .from(schema.users)
      .orderBy(desc(schema.users.number))
      .limit(1);
    const [user] = await db
      .insert(schema.users)
      .values({
        number: Number(maxUser?.n ?? 0) + 1,
        displayName: `t0190-user-${Date.now()}`,
        email: `t0190-${Date.now()}@example.test`,
      })
      .returning({ id: schema.users.id });
    userId = user!.id;
  });

  after(async () => {
    await db.delete(schema.aiAuditLog).where(eq(schema.aiAuditLog.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    const now = new Date();
    if (originalProviders == null) {
      await db.delete(schema.systemProperties).where(eq(schema.systemProperties.key, "ai_providers"));
    } else {
      await db
        .insert(schema.systemProperties)
        .values({ key: "ai_providers", value: originalProviders, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.systemProperties.key,
          set: { value: originalProviders, updatedAt: now },
        });
    }
    await db
      .insert(schema.systemProperties)
      .values({ key: "ai_key_mode", value: originalMode, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: originalMode, updatedAt: now },
      });
    invalidateSystemPropertiesCache();
    await pool.end();
  });

  it("locks cells the instance already denies and lets the user raise or turn off the rest", () => {
    const ceiling = defaultStoredAiPermissionTiers();
    const locked = lockedUserPolicyKeys(false);
    assert.ok(locked.includes("propose_delete"));
    assert.ok(locked.includes("propose_delete:task"));
    assert.ok(locked.includes("web_fetch"));
    assert.equal(locked.includes("link:task"), false);
    assert.equal(lockedUserPolicyKeys(true).includes("web_fetch"), false);
    assert.ok(lockedUserPolicyKeys(true).includes("web_fetch:task"));

    assert.throws(
      () =>
        validateUserAiPolicyPut(
          { raised: { apply: 0 }, off: [], featuresOff: [] },
          { ceiling, locked, adminLockedFeatures: [] },
        ),
      (err: unknown) => err instanceof UserAiPolicyError && err.status === 400,
    );
    assert.throws(
      () =>
        validateUserAiPolicyPut(
          { raised: { propose_delete: 1 }, off: [], featuresOff: [] },
          { ceiling, locked, adminLockedFeatures: [] },
        ),
      (err: unknown) =>
        err instanceof UserAiPolicyError && err.message === "Disabled by your Administrator.",
    );
    assert.throws(
      () =>
        validateUserAiPolicyPut(
          { raised: {}, off: [], featuresOff: [] },
          { ceiling, locked, adminLockedFeatures: ["assistant"] },
        ),
      (err: unknown) => err instanceof UserAiPolicyError && err.status === 400,
    );

    const saved = validateUserAiPolicyPut(
      { raised: { apply: 2, link: 3 }, off: ["link:task"], featuresOff: ["assistant"] },
      { ceiling, locked, adminLockedFeatures: ["assistant"] },
    );
    assert.deepEqual(saved.raised, { link: 3 });
    assert.deepEqual(saved.off, ["link:task"]);
    assert.deepEqual(saved.featuresOff, ["assistant"]);
  });

  it("rejects a save that enables a locked action and leaves the row unchanged", async () => {
    const before = await loadUserAiPolicy(db, userId);
    await assert.rejects(
      () =>
        saveUserAiPolicy(
          db,
          userId,
          { raised: { propose_delete: 0 }, off: [], featuresOff: [] },
          { adminLockedFeatures: [] },
        ),
      (err: unknown) => err instanceof UserAiPolicyError && err.status === 400,
    );
    assert.deepEqual(await loadUserAiPolicy(db, userId), before);
  });

  it("stores an off switch, audits the field name, and reports turned_off", async () => {
    const now = new Date();
    await db
      .insert(schema.systemProperties)
      .values({ key: "ai_providers", value: OPENAI_ON, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: OPENAI_ON, updatedAt: now },
      });
    await db
      .insert(schema.systemProperties)
      .values({ key: "ai_key_mode", value: "user_only", updatedAt: now })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: "user_only", updatedAt: now },
      });
    invalidateSystemPropertiesCache();

    const saved = await saveUserAiPolicy(
      db,
      userId,
      { raised: {}, off: ["link:task"], featuresOff: ["assistant"] },
      { adminLockedFeatures: [] },
    );
    assert.deepEqual(saved.off, ["link:task"]);
    assert.equal(JSON.stringify(saved).includes("sk-"), false);

    const [audit] = await db
      .select({ reason: schema.aiAuditLog.reason, feature: schema.aiAuditLog.feature })
      .from(schema.aiAuditLog)
      .where(and(eq(schema.aiAuditLog.userId, userId), eq(schema.aiAuditLog.action, "settings")))
      .orderBy(desc(schema.aiAuditLog.id))
      .limit(1);
    assert.equal(audit?.feature, "user");
    assert.match(audit?.reason ?? "", /off/);
    assert.match(audit?.reason ?? "", /featuresOff/);
    assert.equal((audit?.reason ?? "").includes("link:task"), false);

    const shown = await listAiCapabilities(db, { userId });
    assert.equal(shown[0]?.available, false);
    assert.equal(shown[0]?.reason, "turned_off");
  });
});
