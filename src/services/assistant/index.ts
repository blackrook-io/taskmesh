import type { AiProviderPlugin } from "@taskmesh/ai-provider-contract";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../../db/schema.js";
import { describeAllowedPolicy } from "./aiPolicy.js";
import { redactSecrets } from "./aiMinimize.js";
import { getSystemProperties } from "../systemProperties.js";
import {
  configuredChatModel,
  resolvePluginApiKey,
  selectChatPlugin,
  type AiProvidersFile,
} from "./aiProviderConfig.js";
import { loadDecryptedInstanceKeys, listInstancePluginIds } from "./aiInstanceKeys.js";
import { assertPublicProviderBaseUrl } from "./providerBaseUrl.js";
import { getAiProvider, loadedAiProviders } from "./providerLoader.js";
import { runAssistantWithTools } from "./runWithTools.js";
import type { ChatMessage } from "./types.js";

export type { ChatMessage } from "./types.js";
export { runAssistantWithTools } from "./runWithTools.js";
export type { AssistantProposal } from "./tools.js";

type Db = NodePgDatabase<typeof schema>;

const SYSTEM_PROMPT_BASE = `You are the TaskMesh assistant embedded in a personal project / ideas / tasks app.
Help the user research, summarize, draft Markdown, and plan work.

You have tools to search and read TaskMesh records and propose creating or updating ideas, documents, tasks, todos, and todo lists.
You can also propose a link, a tag, a comment, or a task dependency. You cannot delete, unlink, untag, or remove a dependency.
Proposed changes are NOT saved until the user confirms in the UI. Never claim you saved or applied a change.
When the user asks to add or create a task, idea, document, todo, or list, use the matching propose_*_create tool (not an update tool).
When editing an existing record, use the propose_*_update tools after get_entity or search when needed.
Use get_neighbourhood for nearby records. There is no path-finding tool.
Prefer get_entity / search_records / list_project_context / list_todos so you work from current content.
If page context is attached, treat it as the user's current draft/record and prefer it over guessing.
Be concise. Prefer clear Markdown structure.`;

const SYSTEM_PROMPT_FETCH = `You can fetch public web pages with fetch_url.
When researching with fetch_url, cite the source URL in your reply (title + link). Do not invent URLs you did not fetch.`;

function systemPrompt(webFetchEnabled: boolean): string {
  return webFetchEnabled ? `${SYSTEM_PROMPT_BASE}\n${SYSTEM_PROMPT_FETCH}` : SYSTEM_PROMPT_BASE;
}

export const ASSISTANT_UNCONFIGURED =
  "Assistant is not configured. An Administrator must enable a chat provider and set an instance key, or the deprecated provider environment variable.";

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
  const keys = await loadDecryptedInstanceKeys(db);
  return sessionFrom(props.aiProviders, (pluginId) => keys.get(pluginId) ?? resolvePluginApiKey(pluginId));
}

export function sessionFrom(
  file: AiProvidersFile,
  resolveKey: (pluginId: string) => string | null = (pluginId) => resolvePluginApiKey(pluginId),
): AssistantSession | null {
  const plugins = loadedAiProviders();
  const id = selectChatPlugin({
    plugins: plugins.map((plugin) => ({ id: plugin.id, chat: plugin.capabilities.chat })),
    file,
    hasKey: (pluginId) => Boolean(resolveKey(pluginId)),
    configValid: (pluginId, config) => {
      const plugin = getAiProvider(pluginId);
      return plugin ? configValid(plugin, config) : false;
    },
  });
  if (!id) return null;
  const plugin = getAiProvider(id);
  const entry = file[id];
  const apiKey = resolveKey(id);
  if (!plugin || !entry || !apiKey) return null;
  const parsed = plugin.configSchema.safeParse(entry.config);
  if (!parsed.success) return null;
  const model = configuredChatModel(parsed.data) ?? "gpt-4.1-mini";
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
  const instanceIds = await listInstancePluginIds(db);
  const session = await resolveAssistantSession(db);
  const plugins = loadedAiProviders().map((plugin) => {
    const entry = props.aiProviders[plugin.id];
    return {
      id: plugin.id,
      displayName: plugin.displayName,
      enabled: Boolean(entry?.enabled),
      configured: Boolean(
        entry?.enabled && (instanceIds.has(plugin.id) || resolvePluginApiKey(plugin.id)),
      ),
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
  webFetchEnabled?: boolean;
}): ChatMessage[] {
  const webFetchEnabled = args.webFetchEnabled === true;
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${systemPrompt(webFetchEnabled)}\n\n${describeAllowedPolicy("assistant", { webFetchEnabled })}`,
    },
  ];
  if (args.pageContext?.trim()) {
    const redacted = redactSecrets(args.pageContext.trim());
    messages.push({
      role: "system",
      content: `Current page context:\n${redacted.slice(0, 12_000)}`,
    });
  }
  for (const m of args.history.slice(-20)) {
    messages.push({ role: m.role, content: redactSecrets(m.content) });
  }
  messages.push({ role: "user", content: redactSecrets(args.userMessage) });
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
  const props = await getSystemProperties(args.db);
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
    webFetchEnabled: props.aiWebFetch,
  });
  return true;
}
