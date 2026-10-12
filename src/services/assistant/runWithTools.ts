import type { AiChatMessage, AiProviderPlugin, AiToolCall } from "@taskmesh/ai-provider-contract";
import { AiProviderError } from "@taskmesh/ai-provider-contract";
import { writeAiAudit, type AiAuditSink } from "./aiAudit.js";
import {
  AI_BUDGET_MESSAGE,
  isAiWriteAction,
  noteAllowUsage,
  pluginBudgetReason,
  recordUsageDenial,
  runBudgetReason,
  type AiUsageMeter,
} from "./aiBudgets.js";
import { configuredChatModel } from "./aiProviderConfig.js";
import { redactSecrets } from "./aiMinimize.js";
import type { ChatMessage } from "./types.js";
import { TOOL_REGISTRY } from "./toolRegistry.js";
import {
  assistantToolDefinitions,
  executeAssistantTool,
  type AssistantProposal,
  type ToolHandlers,
} from "./tools.js";
import {
  containsPrivateUntrusted,
  toolUntrustedSource,
  wrapUntrusted,
} from "./untrustedContent.js";

const MAX_TOOL_ROUNDS = 6;
const DELTA_CHUNK = 48;

export type RunAssistantHandlers = ToolHandlers & {
  onDelta: (text: string) => void;
  onDone: (info?: { auditId: number | null }) => void | Promise<void>;
  onError: (message: string) => void;
};

/**
 * Tool-calling loop through a provider plugin, then emit the final assistant text as deltas.
 */
export async function runAssistantWithTools(args: {
  plugin: AiProviderPlugin;
  apiKey: string | null;
  config: unknown;
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
  handlers: RunAssistantHandlers;
  actorUserId: number;
  isAdministrator: boolean;
  assertBaseUrl: (url: string) => Promise<string>;
  webFetchEnabled?: boolean;
  /** Test seam. Production calls `executeAssistantTool`. */
  executeTool?: typeof executeAssistantTool;
  /** When set, a provider error on the first model call is rethrown so the router can try the next candidate. */
  rethrowFirstProviderError?: boolean;
  /** Written once, after the first model call succeeds. */
  routeReason?: string | null;
  /** Prompt files sent with this call. Recorded on the respond row only. */
  prompt?: { promptId: string; promptVersion: number; promptRef: string } | null;
  /** Test seam. Production writes to `ai_audit_log`. */
  auditSink?: AiAuditSink;
  /** When set, each plugin round is metered and limits are checked first. */
  meter?: AiUsageMeter;
}): Promise<void> {
  const model = args.model?.trim() || readDefaultModel(args.config);
  const tools = assistantToolDefinitions({ webFetchEnabled: args.webFetchEnabled === true });
  const execute = args.executeTool ?? executeAssistantTool;
  const messages: AiChatMessage[] = args.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  let sawPrivate = args.messages.some((message) => containsPrivateUntrusted(message.content));
  let committed = false;
  let toolCalls = 0;
  let writes = 0;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (args.signal?.aborted) {
        await args.handlers.onDone();
        return;
      }
      if (args.meter) {
        const blocked = pluginBudgetReason(args.meter.limits, args.meter.totals, args.meter.keySource);
        if (blocked) {
          await recordUsageDenial(args.meter, blocked);
          args.handlers.onError(AI_BUDGET_MESSAGE);
          return;
        }
      }
      const roundStarted = Date.now();
      let outcome: Awaited<ReturnType<typeof readRound>>;
      try {
        outcome = await readRound(args, sanitizeProviderMessages(messages), tools, model);
      } catch (err) {
        if (!committed && args.rethrowFirstProviderError && err instanceof AiProviderError) throw err;
        throw err;
      }
      if (!committed) {
        committed = true;
        if (args.routeReason) {
          await writeAiAudit({
            userId: args.actorUserId,
            feature: "assistant",
            provider: args.plugin.id,
            model,
            tool: null,
            action: "route",
            decision: "allow",
            reason: args.routeReason,
            tier: 0,
          }, args.auditSink);
        }
      }
      const roundLatency = Date.now() - roundStarted;
      if (args.meter) {
        const tokensIn = outcome.usage?.inputTokens ?? 0;
        const tokensOut = outcome.usage?.outputTokens ?? 0;
        const cost = noteAllowUsage(args.meter, tokensIn, tokensOut);
        await writeAiAudit(
          {
            userId: args.actorUserId,
            feature: args.meter.feature,
            provider: args.plugin.id,
            model,
            action: "usage",
            decision: "allow",
            reason: "Plugin call",
            tier: 0,
            tokensIn,
            tokensOut,
            latencyMs: roundLatency,
            keySource: args.meter.keySource,
            costMicrousd: cost,
          },
          args.meter.auditSink ?? args.auditSink,
        );
      }
      if (outcome.toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: outcome.text || null,
          toolCalls: outcome.toolCalls,
        });
        for (const call of outcome.toolCalls) {
          const action = TOOL_REGISTRY[call.name]?.action ?? "read";
          if (args.meter) {
            const blocked = runBudgetReason(
              args.meter.limits,
              { toolCalls, writes },
              action,
            );
            if (blocked) {
              await writeAiAudit(
                {
                  userId: args.actorUserId,
                  feature: args.meter.feature,
                  provider: args.plugin.id,
                  model,
                  tool: call.name,
                  action,
                  decision: "deny",
                  reason: blocked,
                  tier: 0,
                },
                args.meter.auditSink ?? args.auditSink,
              );
              args.handlers.onError(AI_BUDGET_MESSAGE);
              return;
            }
          }
          toolCalls += 1;
          if (isAiWriteAction(action)) writes += 1;
          const result = await execute(call.name, call.arguments || "{}", {
            onTool: args.handlers.onTool,
            onProposal: args.handlers.onProposal,
            signal: args.signal,
            actorUserId: args.actorUserId,
            isAdministrator: args.isAdministrator,
            feature: args.handlers.feature ?? "assistant",
            provider: args.plugin.id,
            model,
            webFetchEnabled: args.webFetchEnabled === true,
            checkPolicy: args.handlers.checkPolicy,
            recordAudit: args.handlers.recordAudit,
            privateRecordsInTurn: sawPrivate,
          });
          if (TOOL_REGISTRY[call.name]?.action === "read") sawPrivate = true;
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: wrapUntrusted(redactSecrets(result), toolUntrustedSource(call.name)),
          });
        }
        continue;
      }

      const auditId = await writeAiAudit({
        userId: args.actorUserId,
        feature: "assistant",
        provider: args.plugin.id,
        model,
        tool: null,
        action: "respond",
        decision: "allow",
        reason: "Assistant reply",
        tier: 0,
        latencyMs: roundLatency,
        promptId: args.prompt?.promptId ?? null,
        promptVersion: args.prompt?.promptVersion ?? null,
        promptRef: args.prompt?.promptRef ?? null,
      }, args.auditSink);

      const text = outcome.text.trim() || "Done.";
      for (let i = 0; i < text.length; i += DELTA_CHUNK) {
        if (args.signal?.aborted) break;
        args.handlers.onDelta(text.slice(i, i + DELTA_CHUNK));
      }
      await args.handlers.onDone({ auditId });
      return;
    }
    args.handlers.onError("Too many tool rounds; try a simpler request.");
  } catch (err) {
    if (!committed && args.rethrowFirstProviderError && err instanceof AiProviderError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      try {
        args.handlers.onError("Cancelled");
      } catch {
        await args.handlers.onDone();
      }
      return;
    }
    const message =
      err instanceof AiProviderError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Assistant failed";
    args.handlers.onError(message);
  }
}

function sanitizeProviderMessages(messages: AiChatMessage[]): AiChatMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        ...message,
        content: message.content == null ? null : redactSecrets(message.content),
        toolCalls: message.toolCalls?.map((call) => ({
          ...call,
          arguments: redactSecrets(call.arguments),
        })),
      };
    }
    return { ...message, content: redactSecrets(message.content) };
  });
}

function readDefaultModel(config: unknown): string {
  return configuredChatModel(config) ?? "gpt-4.1-mini";
}

async function readRound(
  args: {
    plugin: AiProviderPlugin;
    apiKey: string | null;
    config: unknown;
    signal?: AbortSignal;
    assertBaseUrl: (url: string) => Promise<string>;
  },
  messages: AiChatMessage[],
  tools: ReturnType<typeof assistantToolDefinitions>,
  model: string,
): Promise<{ text: string; toolCalls: AiToolCall[]; usage: { inputTokens: number; outputTokens: number } | null }> {
  let text = "";
  let toolCalls: AiToolCall[] = [];
  let usage: { inputTokens: number; outputTokens: number } | null = null;
  for await (const event of args.plugin.streamChat(
    {
      config: args.config,
      apiKey: args.apiKey,
      assertBaseUrl: args.assertBaseUrl,
    },
    { messages, tools, model, signal: args.signal },
  )) {
    if (event.type === "delta") text += event.text;
    if (event.type === "tool_calls") toolCalls = event.calls;
    if (event.type === "usage") usage = event.usage;
  }
  return { text, toolCalls, usage };
}

export type { AssistantProposal };
