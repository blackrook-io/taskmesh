import type { AiProviderPlugin } from "@taskmesh/ai-provider-contract";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../../db/schema.js";
import { describeAllowedPolicy } from "./aiPolicy.js";
import { getSystemProperties } from "../systemProperties.js";
import {
  resolvePluginApiKey,
  selectChatPlugin,
  type AiProvidersFile,
} from "./aiProviderConfig.js";
import { assertPublicProviderBaseUrl } from "./providerBaseUrl.js";
import { getAiProvider, loadedAiProviders } from "./providerLoader.js";
import { runAssistantWithTools } from "./runWithTools.js";
import type { ChatMessage } from "./types.js";

export type { ChatMessage } from "./types.js";
export { runAssistantWithTools } from "./runWithTools.js";
export type { AssistantProposal } from "./tools.js";

type Db = NodePgDatabase<typeof schema>;

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

export const ASSISTANT_UNCONFIGURED =
  "Assistant is not configured. An Administrator must enable the OpenAI provider, and OPENAI_API_KEY must be set in the server .env (deprecated), then restart.";

export type AssistantSession = {
  plugin: AiProviderPlugin;
  config: unknown;
  apiKey: string;
  model: string;
};

function configValid(plugin: AiProviderPlugin, config: Record<string, unknown>): boolean {
  return plugin.configSchema.safeParse(config).success;
}

export async function resolveAssistantSession(db: Db): Promise<AssistantSession | null> {
  const props = await getSystemProperties(db);
  return sessionFrom(props.aiProviders);
}

export function sessionFrom(file: AiProvidersFile): AssistantSession | null {
  const plugins = loadedAiProviders();
  const id = selectChatPlugin({
    plugins: plugins.map((plugin) => ({ id: plugin.id, chat: plugin.capabilities.chat })),
    file,
    hasKey: (pluginId) => Boolean(resolvePluginApiKey(pluginId)),
    configValid: (pluginId, config) => {
      const plugin = getAiProvider(pluginId);
      return plugin ? configValid(plugin, config) : false;
    },
  });
  if (!id) return null;
  const plugin = getAiProvider(id);
  const entry = file[id];
  const apiKey = resolvePluginApiKey(id);
  if (!plugin || !entry || !apiKey) return null;
  const parsed = plugin.configSchema.safeParse(entry.config);
  if (!parsed.success) return null;
  const model =
    parsed.data &&
    typeof parsed.data === "object" &&
    "defaultModel" in parsed.data &&
    typeof (parsed.data as { defaultModel?: unknown }).defaultModel === "string"
      ? (parsed.data as { defaultModel: string }).defaultModel
      : "gpt-4.1-mini";
  return { plugin, config: parsed.data, apiKey, model };
}

export type AssistantPluginStatus = {
  id: string;
  displayName: string;
  enabled: boolean;
  configured: boolean;
  capabilities: AiProviderPlugin["capabilities"];
};

export async function assistantStatus(db: Db): Promise<{
  enabled: boolean;
  provider: string;
  model: string;
  configuredProviders: { openai: boolean };
  plugins: AssistantPluginStatus[];
  toolsEnabled: boolean;
}> {
  const props = await getSystemProperties(db);
  const session = sessionFrom(props.aiProviders);
  const plugins = loadedAiProviders().map((plugin) => {
    const entry = props.aiProviders[plugin.id];
    return {
      id: plugin.id,
      displayName: plugin.displayName,
      enabled: Boolean(entry?.enabled),
      configured: Boolean(entry?.enabled && resolvePluginApiKey(plugin.id)),
      capabilities: plugin.capabilities,
    };
  });
  const openai = plugins.find((plugin) => plugin.id === "openai");
  return {
    enabled: Boolean(session),
    provider: session?.plugin.id ?? "none",
    model: session?.model ?? "",
    configuredProviders: { openai: Boolean(openai?.configured) },
    plugins,
    toolsEnabled: true,
  };
}

export function buildMessages(args: {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  pageContext?: string | null;
}): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${describeAllowedPolicy("assistant")}` },
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

export async function runConfiguredAssistant(args: {
  db: Db;
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
  handlers: Parameters<typeof runAssistantWithTools>[0]["handlers"];
  actorUserId: number;
  isAdministrator: boolean;
}): Promise<boolean> {
  const session = await resolveAssistantSession(args.db);
  if (!session) return false;
  await runAssistantWithTools({
    plugin: session.plugin,
    apiKey: session.apiKey,
    config: session.config,
    messages: args.messages,
    model: args.model,
    signal: args.signal,
    handlers: args.handlers,
    actorUserId: args.actorUserId,
    isAdministrator: args.isAdministrator,
    assertBaseUrl: assertPublicProviderBaseUrl,
  });
  return true;
}
