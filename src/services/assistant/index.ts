import { createOpenAiProvider } from "./openaiProvider.js";
import { runAssistantWithTools } from "./runWithTools.js";
import type { LlmProvider } from "./types.js";
import { getAssistantConfig } from "./types.js";

export { getAssistantConfig } from "./types.js";
export type { ChatMessage, LlmProvider } from "./types.js";
export { runAssistantWithTools } from "./runWithTools.js";
export type { AssistantProposal } from "./tools.js";

const SYSTEM_PROMPT = `You are the TaskMesh assistant embedded in a personal project / ideas / tasks app.
Help the user research, summarize, draft Markdown, and plan work.

You have tools to search and read TaskMesh records, and to propose updates to ideas, documents, and tasks.
Proposed updates are NOT saved until the user confirms in the UI. Never claim you saved or applied a change.
When the user asks to edit something, use the propose_* tools with a clear summary and the fields to change.
Prefer get_entity / search_records before proposing edits so you work from current content.
Be concise. Prefer clear Markdown structure.`;

export function resolveProvider(): LlmProvider | null {
  const cfg = getAssistantConfig();
  if (cfg.provider === "openai" || !cfg.provider) {
    const p = createOpenAiProvider();
    return p.configured ? p : null;
  }
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
