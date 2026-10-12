import type { AiChatMessage, AiProviderPlugin, AiToolCall } from "@taskmesh/ai-provider-contract";
import { AiProviderError } from "@taskmesh/ai-provider-contract";
import { writeAiAudit } from "./aiAudit.js";
import { redactSecrets } from "./aiMinimize.js";
import type { ChatMessage } from "./types.js";
import {
  assistantToolDefinitions,
  executeAssistantTool,
  type AssistantProposal,
  type ToolHandlers,
} from "./tools.js";

const MAX_TOOL_ROUNDS = 6;
const DELTA_CHUNK = 48;

export type RunAssistantHandlers = ToolHandlers & {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

/**
 * Tool-calling loop through a provider plugin, then emit the final assistant text as deltas.
 */
export async function runAssistantWithTools(args: {
  plugin: AiProviderPlugin;
  apiKey: string;
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
}): Promise<void> {
  const model = args.model?.trim() || readDefaultModel(args.config);
  const tools = assistantToolDefinitions({ webFetchEnabled: args.webFetchEnabled === true });
  const execute = args.executeTool ?? executeAssistantTool;
  const messages: AiChatMessage[] = args.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (args.signal?.aborted) {
        args.handlers.onDone();
        return;
      }
      const roundStarted = Date.now();
      const outcome = await readRound(args, sanitizeProviderMessages(messages), tools, model);
      const roundLatency = Date.now() - roundStarted;
      if (outcome.toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: outcome.text || null,
          toolCalls: outcome.toolCalls,
        });
        for (const call of outcome.toolCalls) {
          const result = await execute(call.name, call.arguments || "{}", {
            onTool: args.handlers.onTool,
            onProposal: args.handlers.onProposal,
            signal: args.signal,
            actorUserId: args.actorUserId,
            isAdministrator: args.isAdministrator,
            feature: "assistant",
            provider: args.plugin.id,
            model,
            tokensIn: outcome.usage?.inputTokens ?? null,
            tokensOut: outcome.usage?.outputTokens ?? null,
            webFetchEnabled: args.webFetchEnabled === true,
          });
          messages.push({ role: "tool", toolCallId: call.id, content: redactSecrets(result) });
        }
        continue;
      }

      await writeAiAudit({
        userId: args.actorUserId,
        feature: "assistant",
        provider: args.plugin.id,
        model,
        tool: null,
        action: "respond",
        decision: "allow",
        reason: "Assistant reply",
        tier: 0,
        tokensIn: outcome.usage?.inputTokens ?? null,
        tokensOut: outcome.usage?.outputTokens ?? null,
        latencyMs: roundLatency,
      });

      const text = outcome.text.trim() || "Done.";
      for (let i = 0; i < text.length; i += DELTA_CHUNK) {
        if (args.signal?.aborted) break;
        args.handlers.onDelta(text.slice(i, i + DELTA_CHUNK));
      }
      args.handlers.onDone();
      return;
    }
    args.handlers.onError("Too many tool rounds; try a simpler request.");
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      try {
        args.handlers.onError("Cancelled");
      } catch {
        args.handlers.onDone();
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
  if (config && typeof config === "object" && "defaultModel" in config) {
    const model = (config as { defaultModel?: unknown }).defaultModel;
    if (typeof model === "string" && model.trim()) return model.trim();
  }
  return "gpt-4.1-mini";
}

async function readRound(
  args: {
    plugin: AiProviderPlugin;
    apiKey: string;
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
