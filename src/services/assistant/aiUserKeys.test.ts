import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { desc, eq } from "drizzle-orm";
import { db, pool } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { encryptAiSecret } from "../../lib/aiCredentialsCrypto.js";
import { AiCredentialsError } from "./aiInstanceKeys.js";
import { listAiCapabilities } from "./aiCapabilities.js";
import { loadAiProviderPlugins } from "./providerLoader.js";
import { invalidateSystemPropertiesCache } from "../systemProperties.js";
import {
  listUserCredentials,
  pickProviderKey,
  removeUserKey,
  replaceUserKey,
  resolveProviderKey,
} from "./aiUserKeys.js";

const SECRET = "sk-unit-test-user-key-wxyz";
const INSTANCE = "sk-unit-test-instance-abcd";
const ENV_KEY = "sk-unit-test-env-key-efgh";
const TEST_KEK = "test-ai-credentials-key-32chars!!";
const ACTOR = 1;
const EMPTY_ENV = {} as NodeJS.ProcessEnv;

const OPENAI_ON = {
  openai: {
    enabled: true,
    config: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini" },
  },
};

describe("user provider keys", { concurrency: false }, () => {
  const prevKek = process.env.AI_CREDENTIALS_KEY;
  let originalProviders: unknown;
  let originalMode: unknown;
  let originalInstance: typeof schema.aiInstanceCredentials.$inferSelect | null = null;
  let userId = 0;
  let projectId = 0;

  before(async () => {
    process.env.AI_CREDENTIALS_KEY = TEST_KEK;
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
    const [existing] = await db
      .select()
      .from(schema.aiInstanceCredentials)
      .where(eq(schema.aiInstanceCredentials.pluginId, "openai"))
      .limit(1);
    originalInstance = existing ?? null;
    const [maxUser] = await db
      .select({ n: schema.users.number })
      .from(schema.users)
      .orderBy(desc(schema.users.number))
      .limit(1);
    const [user] = await db
      .insert(schema.users)
      .values({
        number: Number(maxUser?.n ?? 0) + 1,
        displayName: `t0183-user-${Date.now()}`,
        email: `t0183-${Date.now()}@example.test`,
      })
      .returning({ id: schema.users.id });
    userId = user!.id;
    const [maxProject] = await db
      .select({ n: schema.projects.number })
      .from(schema.projects)
      .orderBy(desc(schema.projects.number))
      .limit(1);
    const [project] = await db
      .insert(schema.projects)
      .values({
        number: Number(maxProject?.n ?? 0) + 1,
        name: `t0183-project-${Date.now()}`,
        ownerId: ACTOR,
        aiAccess: "full",
      })
      .returning({ id: schema.projects.id });
    projectId = project!.id;
  });

  after(async () => {
    if (prevKek === undefined) delete process.env.AI_CREDENTIALS_KEY;
    else process.env.AI_CREDENTIALS_KEY = prevKek;
    await db.delete(schema.userAiCredentials).where(eq(schema.userAiCredentials.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    if (originalInstance) {
      await db
        .insert(schema.aiInstanceCredentials)
        .values(originalInstance)
        .onConflictDoUpdate({
          target: schema.aiInstanceCredentials.pluginId,
          set: {
            secretEnc: originalInstance.secretEnc,
            hint: originalInstance.hint,
            verifiedAt: originalInstance.verifiedAt,
            updatedById: originalInstance.updatedById,
            updatedAt: originalInstance.updatedAt,
          },
        });
    } else {
      await db.delete(schema.aiInstanceCredentials).where(eq(schema.aiInstanceCredentials.pluginId, "openai"));
    }
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

  async function setMode(mode: string): Promise<void> {
    const now = new Date();
    await db
      .insert(schema.systemProperties)
      .values({ key: "ai_key_mode", value: mode, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: mode, updatedAt: now },
      });
    invalidateSystemPropertiesCache();
  }

  async function setProviders(value: unknown): Promise<void> {
    const now = new Date();
    await db
      .insert(schema.systemProperties)
      .values({ key: "ai_providers", value, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value, updatedAt: now },
      });
    invalidateSystemPropertiesCache();
  }

  async function storeUserKey(apiKey: string, defaultModel: string | null = "gpt-user"): Promise<void> {
    await db
      .insert(schema.userAiCredentials)
      .values({
        userId,
        pluginId: "openai",
        secretEnc: encryptAiSecret(apiKey),
        hint: apiKey.slice(-4),
        defaultModel,
        verifiedAt: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.userAiCredentials.userId, schema.userAiCredentials.pluginId],
        set: {
          secretEnc: encryptAiSecret(apiKey),
          hint: apiKey.slice(-4),
          defaultModel,
          updatedAt: new Date(),
        },
      });
  }

  async function storeInstanceKey(apiKey: string | null): Promise<void> {
    if (!apiKey) {
      await db.delete(schema.aiInstanceCredentials).where(eq(schema.aiInstanceCredentials.pluginId, "openai"));
      return;
    }
    await db
      .insert(schema.aiInstanceCredentials)
      .values({
        pluginId: "openai",
        secretEnc: encryptAiSecret(apiKey),
        hint: apiKey.slice(-4),
        verifiedAt: null,
        updatedById: ACTOR,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.aiInstanceCredentials.pluginId,
        set: { secretEnc: encryptAiSecret(apiKey), hint: apiKey.slice(-4), updatedAt: new Date() },
      });
  }

  it("picks the user key, the instance key, or neither according to the mode", () => {
    const user = { apiKey: SECRET, defaultModel: "gpt-user" };
    assert.deepEqual(
      pickProviderKey({ mode: "instance_only", pluginId: "openai", user, instanceKey: INSTANCE, env: EMPTY_ENV }),
      { apiKey: INSTANCE, defaultModel: null, keySource: "instance", storedKey: "instance" },
    );
    assert.deepEqual(
      pickProviderKey({ mode: "user_only", pluginId: "openai", user, instanceKey: INSTANCE, env: { OPENAI_API_KEY: ENV_KEY } }),
      { apiKey: SECRET, defaultModel: "gpt-user", keySource: "user", storedKey: "user" },
    );
    assert.deepEqual(
      pickProviderKey({ mode: "user_only", pluginId: "openai", user: null, instanceKey: INSTANCE, env: { OPENAI_API_KEY: ENV_KEY } }),
      { apiKey: null, defaultModel: null, keySource: null, storedKey: null },
    );
    assert.deepEqual(
      pickProviderKey({
        mode: "user_preferred_instance_fallback",
        pluginId: "openai",
        user,
        instanceKey: INSTANCE,
        env: EMPTY_ENV,
      }),
      { apiKey: SECRET, defaultModel: "gpt-user", keySource: "user", storedKey: "user" },
    );
    assert.deepEqual(
      pickProviderKey({
        mode: "user_preferred_instance_fallback",
        pluginId: "openai",
        user: null,
        instanceKey: INSTANCE,
        env: EMPTY_ENV,
      }),
      { apiKey: INSTANCE, defaultModel: null, keySource: "instance", storedKey: "instance" },
    );
    assert.deepEqual(
      pickProviderKey({
        mode: "user_preferred_instance_fallback",
        pluginId: "openai",
        user: null,
        instanceKey: null,
        env: { OPENAI_API_KEY: ENV_KEY },
      }),
      { apiKey: ENV_KEY, defaultModel: null, keySource: "instance", storedKey: null },
    );
    assert.deepEqual(
      pickProviderKey({ mode: "instance_only", pluginId: "openai", user: null, instanceKey: null, env: EMPTY_ENV }),
      { apiKey: null, defaultModel: null, keySource: null, storedKey: null },
    );
  });

  it("resolves stored rows the same way and never spends the instance key in user_only", async () => {
    await setProviders(OPENAI_ON);
    await storeUserKey(SECRET);
    await storeInstanceKey(INSTANCE);

    await setMode("instance_only");
    const ignored = await resolveProviderKey(db, { userId, pluginId: "openai", env: EMPTY_ENV });
    assert.equal(ignored.apiKey, INSTANCE);
    assert.equal(ignored.defaultModel, null);

    await setMode("user_only");
    const own = await resolveProviderKey(db, { userId, pluginId: "openai", env: { OPENAI_API_KEY: ENV_KEY } });
    assert.equal(own.apiKey, SECRET);
    assert.equal(own.defaultModel, "gpt-user");
    await db.delete(schema.userAiCredentials).where(eq(schema.userAiCredentials.userId, userId));
    const missing = await resolveProviderKey(db, { userId, pluginId: "openai", env: { OPENAI_API_KEY: ENV_KEY } });
    assert.equal(missing.apiKey, null);

    await setMode("user_preferred_instance_fallback");
    await storeUserKey(SECRET);
    const preferred = await resolveProviderKey(db, { userId, pluginId: "openai", env: EMPTY_ENV });
    assert.equal(preferred.apiKey, SECRET);
    await db.delete(schema.userAiCredentials).where(eq(schema.userAiCredentials.userId, userId));
    const fallback = await resolveProviderKey(db, { userId, pluginId: "openai", env: EMPTY_ENV });
    assert.equal(fallback.apiKey, INSTANCE);
    await storeInstanceKey(null);
    const fromEnv = await resolveProviderKey(db, {
      userId,
      pluginId: "openai",
      env: { OPENAI_API_KEY: ENV_KEY },
    });
    assert.equal(fromEnv.apiKey, ENV_KEY);
  });

  it("stores only the hint and keeps a failed verify without the secret", async () => {
    await setProviders(OPENAI_ON);
    await setMode("user_only");
    const okFetch = async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ data: [{ id: "gpt-test" }] }),
      }) as Response;
    const saved = await replaceUserKey(db, {
      userId,
      pluginId: "openai",
      apiKey: SECRET,
      defaultModel: "gpt-user",
      assertBaseUrl: async (url) => url,
      fetchImpl: okFetch,
    });
    assert.equal(saved.keyHint, "wxyz");
    assert.equal(saved.defaultModel, "gpt-user");
    assert.ok(saved.verifiedAt);
    assert.equal(saved.lastError, null);
    assert.equal(JSON.stringify(saved).includes(SECRET), false);

    const listed = await listUserCredentials(db, userId);
    assert.equal(JSON.stringify(listed).includes(SECRET), false);
    assert.equal(listed[0]?.keyHint, "wxyz");

    await assert.rejects(
      () =>
        replaceUserKey(db, {
          userId,
          pluginId: "openai",
          apiKey: SECRET,
          assertBaseUrl: async (url) => url,
          fetchImpl: async () =>
            ({
              ok: false,
              status: 401,
              statusText: "Unauthorized",
              json: async () => ({ error: { message: `bad ${SECRET}` } }),
            }) as Response,
        }),
      (err: unknown) => {
        assert.ok(err instanceof AiCredentialsError);
        assert.equal(err.status, 422);
        assert.equal(err.message.includes(SECRET), false);
        assert.match(err.message, /\[redacted\]/);
        return true;
      },
    );
    const [row] = await db
      .select()
      .from(schema.userAiCredentials)
      .where(eq(schema.userAiCredentials.userId, userId))
      .limit(1);
    assert.ok(row);
    assert.equal(row.verifiedAt, null);
    assert.match(row.lastError ?? "", /\[redacted\]/);
    assert.equal((row.lastError ?? "").includes(SECRET), false);
    assert.equal(row.secretEnc.includes(SECRET), false);

    const removed = await removeUserKey(db, { userId, pluginId: "openai" });
    assert.equal(removed.keyHint, null);
    assert.equal(JSON.stringify(removed).includes(SECRET), false);
    assert.equal((await listUserCredentials(db, userId)).length, 0);
  });

  it("reports no key, a disabled provider, project exclusion, and never a budget", async () => {
    await setProviders(OPENAI_ON);
    await setMode("user_only");
    await db.delete(schema.userAiCredentials).where(eq(schema.userAiCredentials.userId, userId));
    await storeInstanceKey(null);
    const missing = await listAiCapabilities(db, { userId, env: EMPTY_ENV });
    assert.deepEqual(missing, [
      { id: "assistant", available: false, reason: "no_key" },
      { id: "capture", available: false, reason: "no_key" },
      { id: "tagging", available: false, reason: "no_key" },
      { id: "duplicates", available: false, reason: "no_key" },
      { id: "digest", available: false, reason: "no_key" },
      { id: "links", available: false, reason: "no_key" },
      { id: "answer", available: false, reason: "no_key" },
    ]);
    assert.equal(JSON.stringify(missing).includes("budget_reached"), false);

    await setProviders({
      openai: { enabled: false, config: OPENAI_ON.openai.config },
    });
    const disabled = await listAiCapabilities(db, { userId, env: EMPTY_ENV });
    assert.equal(disabled[0]?.reason, "disabled_by_administrator");

    await setProviders(OPENAI_ON);
    await storeUserKey(SECRET);
    await db.update(schema.projects).set({ aiAccess: "excluded" }).where(eq(schema.projects.id, projectId));
    const excluded = await listAiCapabilities(db, { userId, projectId, env: EMPTY_ENV });
    assert.equal(excluded[0]?.reason, "project_excluded");

    await db.update(schema.projects).set({ aiAccess: "read_only" }).where(eq(schema.projects.id, projectId));
    const readable = await listAiCapabilities(db, { userId, projectId, env: EMPTY_ENV });
    assert.equal(readable[0]?.available, true);
    assert.equal(readable[0]?.reason, null);
    assert.equal(JSON.stringify(readable).includes("budget_reached"), false);
  });

  it("removes the credential when the user is deleted", async () => {
    await storeUserKey(SECRET, null);
    const [before] = await db
      .select({ id: schema.userAiCredentials.id })
      .from(schema.userAiCredentials)
      .where(eq(schema.userAiCredentials.userId, userId));
    assert.ok(before);
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    const afterDelete = await db
      .select({ id: schema.userAiCredentials.id })
      .from(schema.userAiCredentials)
      .where(eq(schema.userAiCredentials.userId, userId));
    assert.equal(afterDelete.length, 0);
    userId = 0;
  });
});
