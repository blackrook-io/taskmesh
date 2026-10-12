import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, gte } from "drizzle-orm";
import { db, pool } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { AiCredentialsError, replaceInstanceKey, setAiKeyMode, verifyInstanceKey } from "./aiInstanceKeys.js";
import { readAiKeyMode } from "./aiInstanceKeys.js";
import { loadAiProviderPlugins } from "./providerLoader.js";

const SECRET = "sk-unit-test-instance-wxyz";
const TEST_KEK = "test-ai-credentials-key-32chars!!";
const ACTOR = 1;

describe("instance keys and key mode", { concurrency: false }, () => {
  const started = new Date();
  let originalMode: Awaited<ReturnType<typeof readAiKeyMode>> = "instance_only";
  let originalCred: typeof schema.aiInstanceCredentials.$inferSelect | null = null;
  const prevKek = process.env.AI_CREDENTIALS_KEY;

  after(async () => {
    if (prevKek === undefined) delete process.env.AI_CREDENTIALS_KEY;
    else process.env.AI_CREDENTIALS_KEY = prevKek;
    const now = new Date();
    await db
      .insert(schema.systemProperties)
      .values({ key: "ai_key_mode", value: originalMode, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: { value: originalMode, updatedAt: now },
      });
    if (originalCred) {
      await db
        .insert(schema.aiInstanceCredentials)
        .values(originalCred)
        .onConflictDoUpdate({
          target: schema.aiInstanceCredentials.pluginId,
          set: {
            secretEnc: originalCred.secretEnc,
            hint: originalCred.hint,
            verifiedAt: originalCred.verifiedAt,
            updatedById: originalCred.updatedById,
            updatedAt: originalCred.updatedAt,
          },
        });
    } else {
      await db
        .delete(schema.aiInstanceCredentials)
        .where(eq(schema.aiInstanceCredentials.pluginId, "openai"));
    }
    await db
      .delete(schema.aiAuditLog)
      .where(
        and(
          eq(schema.aiAuditLog.feature, "key_mode"),
          eq(schema.aiAuditLog.userId, ACTOR),
          gte(schema.aiAuditLog.createdAt, started),
        ),
      );
    await pool.end();
  });

  before(async () => {
    process.env.AI_CREDENTIALS_KEY = TEST_KEK;
    await loadAiProviderPlugins();
    originalMode = await readAiKeyMode(db);
    const [existing] = await db
      .select()
      .from(schema.aiInstanceCredentials)
      .where(eq(schema.aiInstanceCredentials.pluginId, "openai"))
      .limit(1);
    originalCred = existing ?? null;
  });

  it("rejects a multi-user mode change without the exact phrase", async () => {
    await setAiKeyMode(db, { mode: "user_only", actorUserId: ACTOR }, async () => 1);
    await assert.rejects(
      () => setAiKeyMode(db, { mode: "instance_only", actorUserId: ACTOR, acknowledgement: "no" }, async () => 2),
      (err: unknown) => {
        assert.ok(err instanceof AiCredentialsError);
        assert.equal(err.code, "billing_ack_required");
        assert.equal(err.message.includes(SECRET), false);
        return true;
      },
    );
    assert.equal(await readAiKeyMode(db), "user_only");
  });

  it("records acceptance without the key, and skips the phrase for one user or user_only", async () => {
    const accepted = await setAiKeyMode(
      db,
      {
        mode: "user_preferred_instance_fallback",
        acknowledgement: "I understand and accept",
        actorUserId: ACTOR,
      },
      async () => 2,
    );
    assert.equal(accepted.acknowledged, true);
    assert.equal(accepted.mode, "user_preferred_instance_fallback");
    const [audit] = await db
      .select()
      .from(schema.aiAuditLog)
      .where(
        and(eq(schema.aiAuditLog.feature, "key_mode"), eq(schema.aiAuditLog.userId, ACTOR), gte(schema.aiAuditLog.createdAt, started)),
      )
      .limit(1);
    assert.ok(audit);
    assert.equal(audit.reason, "mode=user_preferred_instance_fallback activeUsers=2");
    assert.equal(JSON.stringify(audit).includes(SECRET), false);
    assert.equal(audit.action, "key_mode");

    const single = await setAiKeyMode(db, { mode: "instance_only", actorUserId: ACTOR }, async () => 1);
    assert.equal(single.acknowledged, false);
    assert.equal(await readAiKeyMode(db), "instance_only");

    const userOnly = await setAiKeyMode(db, { mode: "user_only", actorUserId: ACTOR }, async () => 5);
    assert.equal(userOnly.acknowledged, false);
    assert.equal(await readAiKeyMode(db), "user_only");
  });

  it("stores only the last 4 characters and redacts the key from a failed verify", async () => {
    const replaced = await replaceInstanceKey(db, {
      pluginId: "openai",
      apiKey: SECRET,
      actorUserId: ACTOR,
    });
    assert.equal(replaced.keyHint, "wxyz");
    assert.equal(replaced.keyVerifiedAt, null);
    assert.equal(JSON.stringify(replaced).includes(SECRET), false);

    const verified = await verifyInstanceKey(db, {
      pluginId: "openai",
      actorUserId: ACTOR,
      assertBaseUrl: async (url) => url,
      fetchImpl: async () =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ data: [{ id: "gpt-test" }] }),
        }) as Response,
    });
    assert.ok(verified.keyVerifiedAt);
    assert.equal(JSON.stringify(verified).includes(SECRET), false);

    await assert.rejects(
      () =>
        verifyInstanceKey(db, {
          pluginId: "openai",
          actorUserId: ACTOR,
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
        assert.equal(err.message.includes(SECRET), false);
        assert.match(err.message, /\[redacted\]/);
        return true;
      },
    );
    const [row] = await db
      .select({ verifiedAt: schema.aiInstanceCredentials.verifiedAt })
      .from(schema.aiInstanceCredentials)
      .where(eq(schema.aiInstanceCredentials.pluginId, "openai"))
      .limit(1);
    assert.equal(row?.verifiedAt, null);
  });
});
