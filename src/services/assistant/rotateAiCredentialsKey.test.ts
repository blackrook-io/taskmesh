import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AiProviderError, type AiProviderPlugin } from "@taskmesh/ai-provider-contract";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import {
  aiCredentialsKeyFromPassphrase,
  decryptAiSecretWithKey,
  encryptAiSecretWithKey,
} from "../../lib/aiCredentialsCrypto.js";
import { noteStoredKeyUse } from "./aiCredentialHealth.js";
import { runAssistantWithTools } from "./runWithTools.js";
import {
  AiCredentialsRotationError,
  rotateAiCredentialsKey,
} from "./rotateAiCredentialsKey.js";

const CURRENT = "rotate-test-current-key-32-chars!!";
const NEXT = "rotate-test-next-key-32-characters!";
const OTHER = "rotate-test-other-key-32-characters";
const PLUGINS = ["t0213-rot-a", "t0213-rot-b"] as const;
const USER_ID = 1;

function throwingPlugin(code: "auth" | "rate_limit"): AiProviderPlugin {
  return {
    id: "stub",
    displayName: "Stub",
    version: "0",
    configSchema: z.object({}),
    capabilities: { chat: true, streaming: true, tools: false, embeddings: false, local: false },
    async listModels() {
      return [];
    },
    async verifyKey() {
      return { ok: true };
    },
    async *streamChat() {
      throw new AiProviderError(code, code === "auth" ? "invalid api key" : "slow down", code === "auth" ? 401 : 429);
    },
  };
}

describe("AI credentials key rotation", { concurrency: false }, () => {
  before(async () => {
    await db.delete(schema.userAiCredentials).where(inArray(schema.userAiCredentials.pluginId, [...PLUGINS]));
    await db.delete(schema.aiInstanceCredentials).where(inArray(schema.aiInstanceCredentials.pluginId, [...PLUGINS]));
  });

  after(async () => {
    await db.delete(schema.userAiCredentials).where(inArray(schema.userAiCredentials.pluginId, [...PLUGINS]));
    await db.delete(schema.aiInstanceCredentials).where(inArray(schema.aiInstanceCredentials.pluginId, [...PLUGINS]));
  });

  async function insertPair(passphrase: string): Promise<{ instanceEnc: string; userEnc: string }> {
    const key = aiCredentialsKeyFromPassphrase(passphrase);
    const instanceEnc = encryptAiSecretWithKey("sk-instance-rot-a", key);
    const userEnc = encryptAiSecretWithKey("sk-user-rot-b", key);
    const now = new Date();
    await db.insert(schema.aiInstanceCredentials).values({
      pluginId: PLUGINS[0],
      secretEnc: instanceEnc,
      hint: "rot-a".slice(-4),
      updatedAt: now,
    });
    await db.insert(schema.userAiCredentials).values({
      userId: USER_ID,
      pluginId: PLUGINS[1],
      secretEnc: userEnc,
      hint: "rotb",
      updatedAt: now,
    });
    return { instanceEnc, userEnc };
  }

  async function clearPair(): Promise<void> {
    await db.delete(schema.userAiCredentials).where(inArray(schema.userAiCredentials.pluginId, [...PLUGINS]));
    await db.delete(schema.aiInstanceCredentials).where(inArray(schema.aiInstanceCredentials.pluginId, [...PLUGINS]));
  }

  it("dry run reports counts and leaves ciphertext unchanged", async () => {
    const { instanceEnc } = await insertPair(CURRENT);
    const result = await rotateAiCredentialsKey(db, {
      currentKey: CURRENT,
      nextKey: NEXT,
      apply: false,
      pluginIds: [...PLUGINS],
    });
    assert.equal(result.wrote, false);
    assert.equal(result.instanceCount, 1);
    assert.equal(result.userCount, 1);
    assert.deepEqual(result.failures, []);
    const [row] = await db
      .select({ secretEnc: schema.aiInstanceCredentials.secretEnc })
      .from(schema.aiInstanceCredentials)
      .where(eq(schema.aiInstanceCredentials.pluginId, PLUGINS[0]))
      .limit(1);
    assert.equal(row?.secretEnc, instanceEnc);
    await clearPair();
  });

  it("apply re-encrypts under the next key and keeps the provider secret", async () => {
    await insertPair(CURRENT);
    const result = await rotateAiCredentialsKey(db, {
      currentKey: CURRENT,
      nextKey: NEXT,
      apply: true,
      pluginIds: [...PLUGINS],
    });
    assert.equal(result.wrote, true);
    const next = aiCredentialsKeyFromPassphrase(NEXT);
    const current = aiCredentialsKeyFromPassphrase(CURRENT);
    const [instance] = await db
      .select({ secretEnc: schema.aiInstanceCredentials.secretEnc })
      .from(schema.aiInstanceCredentials)
      .where(eq(schema.aiInstanceCredentials.pluginId, PLUGINS[0]))
      .limit(1);
    const [user] = await db
      .select({ secretEnc: schema.userAiCredentials.secretEnc })
      .from(schema.userAiCredentials)
      .where(
        and(eq(schema.userAiCredentials.userId, USER_ID), eq(schema.userAiCredentials.pluginId, PLUGINS[1])),
      )
      .limit(1);
    assert.equal(decryptAiSecretWithKey(instance!.secretEnc, next), "sk-instance-rot-a");
    assert.equal(decryptAiSecretWithKey(user!.secretEnc, next), "sk-user-rot-b");
    assert.throws(() => decryptAiSecretWithKey(instance!.secretEnc, current));
    await clearPair();
  });

  it("refuses to write when any scoped row cannot be decrypted", async () => {
    const { instanceEnc } = await insertPair(CURRENT);
    const other = aiCredentialsKeyFromPassphrase(OTHER);
    await db
      .update(schema.userAiCredentials)
      .set({ secretEnc: encryptAiSecretWithKey("sk-user-rot-b", other) })
      .where(
        and(eq(schema.userAiCredentials.userId, USER_ID), eq(schema.userAiCredentials.pluginId, PLUGINS[1])),
      );
    const result = await rotateAiCredentialsKey(db, {
      currentKey: CURRENT,
      nextKey: NEXT,
      apply: true,
      pluginIds: [...PLUGINS],
    });
    assert.equal(result.wrote, false);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.kind, "user");
    assert.equal(result.failures[0]?.userId, USER_ID);
    const [row] = await db
      .select({ secretEnc: schema.aiInstanceCredentials.secretEnc })
      .from(schema.aiInstanceCredentials)
      .where(eq(schema.aiInstanceCredentials.pluginId, PLUGINS[0]))
      .limit(1);
    assert.equal(row?.secretEnc, instanceEnc);
    await clearPair();
  });

  it("rejects a next key that matches the current key", async () => {
    await assert.rejects(
      () => rotateAiCredentialsKey(db, { currentKey: CURRENT, nextKey: CURRENT, apply: false, pluginIds: [...PLUGINS] }),
      (err: unknown) => err instanceof AiCredentialsRotationError,
    );
  });
});

describe("stored key rejection on use", { concurrency: false }, () => {
  const notes: Array<"ok" | "auth"> = [];

  async function run(code: "auth" | "rate_limit"): Promise<void> {
    notes.length = 0;
    await runAssistantWithTools({
      plugin: throwingPlugin(code),
      apiKey: "sk-test",
      config: {},
      messages: [{ role: "user", content: "Hi" }],
      actorUserId: USER_ID,
      isAdministrator: false,
      assertBaseUrl: async (url) => url,
      handlers: {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: () => undefined,
      },
      noteCredential: async (outcome) => {
        notes.push(outcome);
      },
    });
  }

  it("notes an auth failure and ignores a rate limit", async () => {
    await run("auth");
    assert.deepEqual(notes, ["auth"]);
    await run("rate_limit");
    assert.deepEqual(notes, []);
  });

  it("stores a redacted instance-key rejection and clears it after a successful use", async () => {
    const now = new Date();
    await db
      .insert(schema.aiInstanceCredentials)
      .values({
        pluginId: PLUGINS[0],
        secretEnc: "unused",
        hint: "xxxx",
        verifiedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.aiInstanceCredentials.pluginId,
        set: { secretEnc: "unused", hint: "xxxx", verifiedAt: now, lastError: null, updatedAt: now },
      });
    await noteStoredKeyUse(db, {
      userId: USER_ID,
      pluginId: PLUGINS[0],
      storedKey: "instance",
      apiKey: "sk-instance-secret",
      outcome: "auth",
      message: "rejected sk-instance-secret",
    });
    const [rejected] = await db
      .select({
        verifiedAt: schema.aiInstanceCredentials.verifiedAt,
        lastError: schema.aiInstanceCredentials.lastError,
      })
      .from(schema.aiInstanceCredentials)
      .where(eq(schema.aiInstanceCredentials.pluginId, PLUGINS[0]))
      .limit(1);
    assert.equal(rejected?.verifiedAt, null);
    assert.match(rejected?.lastError ?? "", /\[redacted\]/);
    assert.equal((rejected?.lastError ?? "").includes("sk-instance-secret"), false);

    await noteStoredKeyUse(db, {
      userId: USER_ID,
      pluginId: PLUGINS[0],
      storedKey: "instance",
      apiKey: "sk-instance-secret",
      outcome: "ok",
      message: "",
    });
    const [cleared] = await db
      .select({ lastError: schema.aiInstanceCredentials.lastError })
      .from(schema.aiInstanceCredentials)
      .where(eq(schema.aiInstanceCredentials.pluginId, PLUGINS[0]))
      .limit(1);
    assert.equal(cleared?.lastError, null);
    await db.delete(schema.aiInstanceCredentials).where(eq(schema.aiInstanceCredentials.pluginId, PLUGINS[0]));
  });
});

after(async () => {
  await pool.end();
});
