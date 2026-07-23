import type { ChatMessage } from "./types.js";
import { getAssistantConfig } from "./types.js";
import { executeAssistantTool, OPENAI_TOOLS, type AssistantProposal, type ToolHandlers } from "./tools.js";

type OpenAiMessage =
  | { role: "system" | "user" | "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: OpenAiMessage;
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
};

const MAX_TOOL_ROUNDS = 6;

export type RunAssistantHandlers = ToolHandlers & {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

/**
 * Tool-calling loop (non-streaming rounds), then emit the final assistant text as deltas.
 */
export async function runAssistantWithTools(args: {
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
  handlers: RunAssistantHandlers;
}): Promise<void> {
  const cfg = getAssistantConfig();
  const apiKey = cfg.openaiKey;
  if (!apiKey) {
    args.handlers.onError("OpenAI is not configured (set OPENAI_API_KEY)");
    return;
  }
  const model = args.model?.trim() || cfg.model;

  const messages: OpenAiMessage[] = args.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (args.signal?.aborted) {
        args.handlers.onDone();
        return;
      }

      const completion = await requestCompletion({
        apiKey,
        model,
        messages,
        tools: OPENAI_TOOLS,
        signal: args.signal,
      });

      const choice = completion.choices?.[0];
      const msg = choice?.message;
      if (!msg || msg.role === "tool") {
        args.handlers.onError(completion.error?.message ?? "Empty completion from OpenAI");
        return;
      }

      const toolCalls = msg.role === "assistant" ? (msg.tool_calls ?? []) : [];
      if (toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: msg.content ?? null,
          tool_calls: toolCalls,
        });
        for (const call of toolCalls) {
          const result = await executeAssistantTool(
            call.function.name,
            call.function.arguments ?? "{}",
            {
              onTool: args.handlers.onTool,
              onProposal: args.handlers.onProposal,
              signal: args.signal,
            },
          );
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result,
          });
        }
        continue;
      }

      const text = ((msg.content ?? "") as string).trim() || "Done.";
      // Emit in small chunks so the UI still feels like a stream
      const chunkSize = 48;
      for (let i = 0; i < text.length; i += chunkSize) {
        if (args.signal?.aborted) break;
        args.handlers.onDelta(text.slice(i, i + chunkSize));
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
    args.handlers.onError(err instanceof Error ? err.message : "Assistant failed");
  }
}

async function requestCompletion(args: {
  apiKey: string;
  model: string;
  messages: OpenAiMessage[];
  tools: typeof OPENAI_TOOLS;
  signal?: AbortSignal;
}): Promise<ChatCompletionResponse> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      tools: args.tools,
      tool_choice: "auto",
    }),
    signal: args.signal,
  });
  const json = (await res.json()) as ChatCompletionResponse;
  if (!res.ok) {
    throw new Error(json.error?.message ?? `OpenAI error (${res.status})`);
  }
  return json;
}

export type { AssistantProposal };
