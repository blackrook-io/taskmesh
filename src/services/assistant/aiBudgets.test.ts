import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import type { AiProviderPlugin, AiToolCall } from "@taskmesh/ai-provider-contract";
import { db, pool } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import type { AiAuditInput } from "./aiAudit.js";
import { listAiCapabilities } from "./aiCapabilities.js";
import { loadAiProviderPlugins } from "./providerLoader.js";
import { invalidateSystemPropertiesCache } from "../systemProperties.js";
import { runAssistantWithTools } from "./runWithTools.js";
import {
  EMPTY_AI_BUDGETS,
  estimateCostMicroUsd,
  pluginBudgetReason,
  runBudgetReason,
  sumDayUsage,
  usageWarning,
  type AiUsageMeter,
} from "./aiBudgets.js";

const EMPTY_ENV = {} as NodeJS.ProcessEnv;

function meter(partial: Partial<AiUsageMeter> & Pick<AiUsageMeter, "limits" | "totals">): AiUsageMeter {
  return {
    keySource: "instance",
    usdPerMillionTokens: 1,
    feature: "assistant",
    provider: "stub",
    model: "test",
    userId: 1,
    ...partial,
  };
}

function scripted(
  rounds: Array<{ calls?: AiToolCall[]; text?: string; usage?: { inputTokens: number; outputTokens: number } }>,
): AiProviderPlugin {
  let round = 0;
  return {
    id: "stub",
    displayName: "Stub",
    version: "0",
    configSchema: z.object({}),
    capabilities: { chat: true, streaming: true, tools: true, embeddings: false, local: true },
    async listModels() {
      return [];
    },
    async verifyKey() {
      return { ok: true };
    },
    async *streamChat() {
      const step = rounds[round] ?? { text: "Done." };
      round += 1;
      if (step.usage) yield { type: "usage" as const, usage: step.usage };
      if (step.calls) yield { type: "tool_calls" as const, calls: step.calls };
      if (step.text) yield { type: "delta" as const, text: step.text };
      yield { type: "done" as const };
    },
  };
}

describe("AI usage budgets", () => {
  it("prices instance-key tokens and leaves user keys at zero", () => {
    assert.equal(estimateCostMicroUsd(1_000_000, 0, "instance", 1), 1_000_000);
    assert.equal(estimateCostMicroUsd(2, 3, "instance", 1), 5);
    assert.equal(estimateCostMicroUsd(100, 50, "user", 5), 0);
    assert.equal(estimateCostMicroUsd(100, 50, "local", 5), 0);
  });

  it("leaves a null cap unlimited and warns at 80 percent without blocking", () => {
    const heavy = { tokens: 1_000_000, instanceSpendMicroUsd: 50_000_000 };
    assert.equal(pluginBudgetReason(EMPTY_AI_BUDGETS, heavy, "instance"), null);
    const limits = { ...EMPTY_AI_BUDGETS, tokensPerUserPerDay: 10, instanceSpendUsdPerDay: 2 };
    assert.equal(usageWarning(limits, { tokens: 8, instanceSpendMicroUsd: 0 }, "user"), true);
    assert.equal(pluginBudgetReason(limits, { tokens: 8, instanceSpendMicroUsd: 0 }, "user"), null);
    assert.equal(pluginBudgetReason(limits, { tokens: 10, instanceSpendMicroUsd: 0 }, "user"), "budget_tokens");
    assert.equal(
      pluginBudgetReason(limits, { tokens: 0, instanceSpendMicroUsd: 2_000_000 }, "user"),
      null,
    );
    assert.equal(
      pluginBudgetReason(limits, { tokens: 0, instanceSpendMicroUsd: 2_000_000 }, "instance"),
      "budget_spend",
    );
  });

  it("counts tool calls and writes before the next one", () => {
    const limits = { ...EMPTY_AI_BUDGETS, toolCallsPerRun: 1, writesPerRun: 1 };
    assert.equal(runBudgetReason(limits, { toolCalls: 0, writes: 0 }, "read"), null);
    assert.equal(runBudgetReason(limits, { toolCalls: 1, writes: 0 }, "read"), "budget_tools");
    const writesOnly = { ...EMPTY_AI_BUDGETS, writesPerRun: 1 };
    assert.equal(runBudgetReason(writesOnly, { toolCalls: 3, writes: 0 }, "read"), null);
    assert.equal(runBudgetReason(writesOnly, { toolCalls: 3, writes: 0 }, "web_fetch"), null);
    assert.equal(runBudgetReason(writesOnly, { toolCalls: 3, writes: 1 }, "propose_update"), "budget_writes");
  });

  it("records one usage row per plugin round and does not copy tokens onto tools", async () => {
    const rows: AiAuditInput[] = [];
    const seen: Array<number | null | undefined> = [];
    const plugin = scripted([
      {
        usage: { inputTokens: 3, outputTokens: 4 },
        calls: [
          { id: "a", name: "search_records", arguments: "{}" },
          { id: "b", name: "search_records", arguments: "{}" },
        ],
      },
      { usage: { inputTokens: 1, outputTokens: 2 }, text: "Done." },
    ]);
    const totals = { tokens: 0, instanceSpendMicroUsd: 0 };
    await runAssistantWithTools({
      plugin,
      apiKey: null,
      config: {},
      messages: [{ role: "user", content: "Find notes" }],
      actorUserId: 1,
      isAdministrator: false,
      assertBaseUrl: async (url) => url,
      executeTool: async (_name, _args, handlers) => {
        seen.push(handlers?.tokensIn ?? null);
        return "ok";
      },
      handlers: {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (message) => {
          throw new Error(message);
        },
        recordAudit: async (row) => {
          rows.push(row);
        },
      },
      meter: meter({
        limits: EMPTY_AI_BUDGETS,
        totals,
        keySource: "local",
        auditSink: async (row) => {
          rows.push(row);
        },
      }),
    });
    const usage = rows.filter((row) => row.action === "usage" && row.decision === "allow");
    assert.equal(usage.length, 2);
    assert.deepEqual(
      usage.map((row) => [row.tokensIn, row.tokensOut]),
      [
        [3, 4],
        [1, 2],
      ],
    );
    assert.deepEqual(seen, [null, null]);
    assert.equal(totals.tokens, 10);
    assert.equal(totals.instanceSpendMicroUsd, 0);
  });

  it("does not call the plugin once the token cap is already met", async () => {
    const rows: AiAuditInput[] = [];
    let calls = 0;
    const plugin: AiProviderPlugin = {
      id: "stub",
      displayName: "Stub",
      version: "0",
      configSchema: z.object({}),
      capabilities: { chat: true, streaming: true, tools: true, embeddings: false, local: true },
      async listModels() {
        return [];
      },
      async verifyKey() {
        return { ok: true };
      },
      async *streamChat() {
        calls += 1;
        yield { type: "delta" as const, text: "nope" };
        yield { type: "done" as const };
      },
    };
    let message = "";
    await runAssistantWithTools({
      plugin,
      apiKey: null,
      config: {},
      messages: [{ role: "user", content: "Hi" }],
      actorUserId: 1,
      isAdministrator: false,
      assertBaseUrl: async (url) => url,
      handlers: {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (text) => {
          message = text;
        },
      },
      meter: meter({
        limits: { ...EMPTY_AI_BUDGETS, tokensPerUserPerDay: 10 },
        totals: { tokens: 10, instanceSpendMicroUsd: 0 },
        auditSink: async (row) => {
          rows.push(row);
        },
      }),
    });
    assert.equal(calls, 0);
    assert.equal(message, "You have reached the AI usage budget.");
    assert.equal(rows[0]?.action, "usage");
    assert.equal(rows[0]?.decision, "deny");
    assert.equal(rows[0]?.reason, "budget_tokens");
    assert.equal(rows[0]?.tokensIn ?? null, null);
  });

  it("stops the run on the tool-call cap and the write cap", async () => {
    const toolRows: AiAuditInput[] = [];
    let tools = 0;
    const toolPlugin = scripted([
      {
        calls: [
          { id: "a", name: "search_records", arguments: "{}" },
          { id: "b", name: "search_records", arguments: "{}" },
        ],
      },
    ]);
    let toolMessage = "";
    await runAssistantWithTools({
      plugin: toolPlugin,
      apiKey: null,
      config: {},
      messages: [{ role: "user", content: "Search twice" }],
      actorUserId: 1,
      isAdministrator: false,
      assertBaseUrl: async (url) => url,
      executeTool: async () => {
        tools += 1;
        return "ok";
      },
      handlers: {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (text) => {
          toolMessage = text;
        },
      },
      meter: meter({
        limits: { ...EMPTY_AI_BUDGETS, toolCallsPerRun: 1 },
        totals: { tokens: 0, instanceSpendMicroUsd: 0 },
        auditSink: async (row) => {
          toolRows.push(row);
        },
      }),
    });
    assert.equal(tools, 1);
    assert.equal(toolMessage, "You have reached the AI usage budget.");
    assert.equal(toolRows.some((row) => row.reason === "budget_tools"), true);

    let writes = 0;
    const writeRows: AiAuditInput[] = [];
    const writePlugin = scripted([
      {
        calls: [
          { id: "a", name: "propose_idea_update", arguments: "{}" },
          { id: "b", name: "propose_idea_update", arguments: "{}" },
        ],
      },
    ]);
    await runAssistantWithTools({
      plugin: writePlugin,
      apiKey: null,
      config: {},
      messages: [{ role: "user", content: "Edit twice" }],
      actorUserId: 1,
      isAdministrator: false,
      assertBaseUrl: async (url) => url,
      executeTool: async () => {
        writes += 1;
        return "ok";
      },
      handlers: {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: () => undefined,
      },
      meter: meter({
        limits: { ...EMPTY_AI_BUDGETS, writesPerRun: 1 },
        totals: { tokens: 0, instanceSpendMicroUsd: 0 },
        auditSink: async (row) => {
          writeRows.push(row);
        },
      }),
    });
    assert.equal(writes, 1);
    assert.equal(writeRows.some((row) => row.reason === "budget_writes"), true);
  });
});

describe("AI usage budgets against the database", { concurrency: false }, () => {
  let originalBudgets: unknown;
  let originalProviders: unknown;
  let userId = 0;

  before(async () => {
    await loadAiProviderPlugins();
    const [budgets] = await db
      .select({ value: schema.systemProperties.value })
      .from(schema.systemProperties)
      .where(eq(schema.systemProperties.key, "ai_budgets"))
      .limit(1);
    originalBudgets = budgets?.value ?? null;
    const [providers] = await db
      .select({ value: schema.systemProperties.value })
      .from(schema.systemProperties)
      .where(eq(schema.systemProperties.key, "ai_providers"))
      .limit(1);
    originalProviders = providers?.value ?? null;
    const [maxUser] = await db
      .select({ n: schema.users.number })
      .from(schema.users)
      .orderBy(desc(schema.users.number))
      .limit(1);
    const [user] = await db
      .insert(schema.users)
      .values({
        number: Number(maxUser?.n ?? 0) + 1,
        displayName: `t0188-user-${Date.now()}`,
        email: `t0188-${Date.now()}@example.test`,
      })
      .returning({ id: schema.users.id });
    userId = user!.id;
  });

  after(async () => {
    await db.delete(schema.aiAuditLog).where(eq(schema.aiAuditLog.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    if (originalBudgets == null) {
      await db.delete(schema.systemProperties).where(eq(schema.systemProperties.key, "ai_budgets"));
    } else {
      await db
        .insert(schema.systemProperties)
        .values({ key: "ai_budgets", value: originalBudgets })
        .onConflictDoUpdate({
          target: schema.systemProperties.key,
          set: { value: originalBudgets, updatedAt: new Date() },
        });
    }
    if (originalProviders != null) {
      await db
        .update(schema.systemProperties)
        .set({ value: originalProviders, updatedAt: new Date() })
        .where(eq(schema.systemProperties.key, "ai_providers"));
    }
    invalidateSystemPropertiesCache();
    await pool.end();
  });

  it("reports budget_reached and ignores tool-row tokens and user-key spend", async () => {
    await db
      .insert(schema.systemProperties)
      .values({
        key: "ai_providers",
        value: {
          openai: {
            enabled: true,
            config: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini" },
          },
        },
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: {
          value: {
            openai: {
              enabled: true,
              config: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini" },
            },
          },
          updatedAt: new Date(),
        },
      });
    await db
      .insert(schema.systemProperties)
      .values({
        key: "ai_budgets",
        value: {
          tokensPerUserPerDay: 10,
          instanceSpendUsdPerDay: 1,
          toolCallsPerRun: null,
          writesPerRun: null,
        },
      })
      .onConflictDoUpdate({
        target: schema.systemProperties.key,
        set: {
          value: {
            tokensPerUserPerDay: 10,
            instanceSpendUsdPerDay: 1,
            toolCallsPerRun: null,
            writesPerRun: null,
          },
          updatedAt: new Date(),
        },
      });
    invalidateSystemPropertiesCache();

    await db.insert(schema.aiAuditLog).values([
      {
        userId,
        feature: "assistant",
        provider: "openai",
        action: "usage",
        decision: "allow",
        tier: 0,
        tokensIn: 4,
        tokensOut: 6,
        keySource: "instance",
        costMicrousd: 10,
      },
      {
        userId,
        feature: "assistant",
        provider: "openai",
        action: "read",
        decision: "allow",
        tier: 0,
        tool: "search_records",
        tokensIn: 100,
        tokensOut: 100,
        keySource: null,
        costMicrousd: null,
      },
      {
        userId,
        feature: "assistant",
        provider: "openai",
        action: "usage",
        decision: "allow",
        tier: 0,
        tokensIn: 1_000_000,
        tokensOut: 0,
        keySource: "user",
        costMicrousd: 0,
      },
    ]);

    const totals = await sumDayUsage(db, { userId });
    assert.equal(totals.tokens, 1_000_010);
    assert.equal(totals.instanceSpendMicroUsd, 10);

    const env = { OPENAI_API_KEY: "sk-unit-test-budget-key" } as NodeJS.ProcessEnv;
    const blocked = await listAiCapabilities(db, { userId, env });
    assert.equal(blocked[0]?.reason, "budget_reached");

    await db
      .update(schema.systemProperties)
      .set({
        value: {
          tokensPerUserPerDay: null,
          instanceSpendUsdPerDay: 1,
          toolCallsPerRun: null,
          writesPerRun: null,
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.systemProperties.key, "ai_budgets"));
    invalidateSystemPropertiesCache();
    const open = await listAiCapabilities(db, { userId, env: EMPTY_ENV });
    assert.notEqual(open[0]?.reason, "budget_reached");
  });
});
