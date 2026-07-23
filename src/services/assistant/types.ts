export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StreamHandlers = {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

export type LlmProvider = {
  id: string;
  configured: boolean;
  defaultModel: string;
  streamChat: (args: {
    model?: string;
    messages: ChatMessage[];
    signal?: AbortSignal;
  } & StreamHandlers) => Promise<void>;
};

export function getAssistantConfig(): {
  provider: string;
  model: string;
  openaiKey: string | null;
} {
  const openaiKey = process.env.OPENAI_API_KEY?.trim() || null;
  return {
    provider: (process.env.ASSISTANT_DEFAULT_PROVIDER || "openai").trim().toLowerCase(),
    model: (process.env.ASSISTANT_DEFAULT_MODEL || "gpt-4.1-mini").trim(),
    openaiKey,
  };
}
