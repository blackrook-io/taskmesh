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

You have tools to search and read TaskMesh records, fetch public web pages (fetch_url), and propose creating or updating ideas, documents, and tasks.
Proposed creates/updates are NOT saved until the user confirms in the UI. Never claim you saved or applied a change.
When the user asks to add or create a task/idea/document, use propose_task_create / propose_idea_create / propose_document_create (not update tools).
When editing an existing record, use the propose_*_update tools after get_entity or search when needed.
Prefer get_entity / search_records / list_project_context so you work from current content.
When researching with fetch_url, cite the source URL in your reply (title + link). Do not invent URLs you did not fetch.
If page context is attached, treat it as the user's current draft/record and prefer it over guessing.
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
