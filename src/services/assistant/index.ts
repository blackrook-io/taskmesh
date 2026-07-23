import { createOpenAiProvider } from "./openaiProvider.js";
import type { LlmProvider } from "./types.js";
import { getAssistantConfig } from "./types.js";

export { getAssistantConfig } from "./types.js";
export type { ChatMessage, LlmProvider } from "./types.js";

const SYSTEM_PROMPT = `You are the TaskMesh assistant embedded in a personal project / ideas / tasks app.
Help the user research, summarize, draft Markdown, and plan work.
You can see optional page context the UI attaches (current idea, project, document, or task).
In this version you cannot directly edit records; suggest Markdown or wording the user can paste or apply later.
Be concise. Prefer clear structure. Do not claim you saved changes unless the user confirms they did.`;

export function resolveProvider(): LlmProvider | null {
  const cfg = getAssistantConfig();
  if (cfg.provider === "openai" || !cfg.provider) {
    const p = createOpenAiProvider();
    return p.configured ? p : null;
  }
  // Future: anthropic
  const openai = createOpenAiProvider();
  return openai.configured ? openai : null;
}

export function buildMessages(args: {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  pageContext?: string | null;
}): import("./types.js").ChatMessage[] {
  const messages: import("./types.js").ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];
  if (args.pageContext?.trim()) {
    messages.push({
      role: "system",
      content: `Current page context:\n${args.pageContext.trim().slice(0, 12_000)}`,
    });
  }
  for (const m of args.history.slice(-20)) {
    messages.push({ role: m.role, content: m.content });
  }
  messages.push({ role: "user", content: args.userMessage });
  return messages;
}
