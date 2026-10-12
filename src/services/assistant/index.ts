import type { AiProviderPlugin } from "@taskmesh/ai-provider-contract";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../../db/schema.js";
import { describeAllowedPolicy } from "./aiPolicy.js";
import { redactSecrets } from "./aiMinimize.js";
import { getSystemProperties } from "../systemProperties.js";
import { providerEntryConfigured } from "./aiProviderConfig.js";
import type { AiKeyMode } from "./aiKeyMode.js";
import { loadResolvedKeys } from "./aiUserKeys.js";
import { assertLocalProviderBaseUrl, assertPublicProviderBaseUrl } from "./providerBaseUrl.js";
import { loadedAiProviders } from "./providerLoader.js";
import { runAssistantWithTools } from "./runWithTools.js";
import { auditRouteSkips, resolveFeatureRoute } from "./aiRouting.js";
import { followRouteAttempts } from "./aiFeatureRoutes.js";
import { writeAiAudit } from "./aiAudit.js";
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
  "Assistant is not configured. An Administrator must enable a chat provider. Cloud providers also need an instance key, or the deprecated provider environment variable.";

export function assistantUnconfiguredMessage(mode: AiKeyMode): string {
  if (mode === "user_only") {
    return "Assistant is not configured. An Administrator must enable a chat provider. Cloud providers need your own provider key.";
  }
  if (mode === "user_preferred_instance_fallback") {
    return "Assistant is not configured. An Administrator must enable a chat provider. Cloud providers need your provider key, or an instance key.";
  }
  return ASSISTANT_UNCONFIGURED;
}

export type AssistantSession = {
  plugin: AiProviderPlugin;
  config: unknown;
  apiKey: string | null;
  model: string;
};

export async function resolveAssistantSession(
  db: Db,
  userId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantSession | null> {
  const route = await resolveFeatureRoute(db, { userId, env });
  const attempt = route.attempts[0];
  if (!attempt) return null;
  return {
    plugin: attempt.plugin,
    config: attempt.config,
    apiKey: attempt.apiKey,
    model: attempt.model,
  };
}

export type AssistantPluginStatus = {
  id: string;
  displayName: string;
  enabled: boolean;
  configured: boolean;
  capabilities: AiProviderPlugin["capabilities"];
};

export async function assistantStatus(
  db: Db,
  userId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  enabled: boolean;
  provider: string;
  model: string;
  keyMode: AiKeyMode;
  configuredProviders: { openai: boolean };
  plugins: AssistantPluginStatus[];
  toolsEnabled: boolean;
}> {
  const props = await getSystemProperties(db);
  const keys = await loadResolvedKeys(db, userId, env);
  const session = await resolveAssistantSession(db, userId, env);
  const plugins = loadedAiProviders().map((plugin) => {
    const entry = props.aiProviders[plugin.id];
    return {
      id: plugin.id,
      displayName: plugin.displayName,
      enabled: Boolean(entry?.enabled),
      configured: providerEntryConfigured({
        local: plugin.capabilities.local,
        enabled: Boolean(entry?.enabled),
        configValid: plugin.configSchema.safeParse(entry?.config ?? {}).success,
        hasKey: Boolean(keys.resolve(plugin.id).apiKey),
      }),
      capabilities: plugin.capabilities,
    };
  });
  const openai = plugins.find((plugin) => plugin.id === "openai");
  return {
    enabled: Boolean(session),
    provider: session?.plugin.id ?? "none",
    model: session?.model ?? "",
    configuredProviders: { openai: Boolean(openai?.configured) },
    keyMode: keys.mode,
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
  localOnly?: boolean;
}): Promise<boolean> {
  const props = await getSystemProperties(args.db);
  const route = await resolveFeatureRoute(args.db, {
    userId: args.actorUserId,
    localOnly: args.localOnly,
    requestedModel: args.model,
  });
  if (route.attempts.length === 0) return false;
  await auditRouteSkips(route.skipped, { userId: args.actorUserId, feature: "assistant" });
  try {
    await followRouteAttempts({
      attempts: route.attempts,
      onDeny: async (attempt, code) => {
        await writeAiAudit({
          userId: args.actorUserId,
          feature: "assistant",
          provider: attempt.pluginId,
          model: attempt.model,
          action: "route",
          decision: "deny",
          reason: code,
          tier: 0,
        });
      },
      call: async (attempt) => {
        await runAssistantWithTools({
          plugin: attempt.plugin,
          apiKey: attempt.apiKey,
          config: attempt.config,
          messages: args.messages,
          model: attempt.model,
          signal: args.signal,
          handlers: args.handlers,
          actorUserId: args.actorUserId,
          isAdministrator: args.isAdministrator,
          assertBaseUrl: attempt.plugin.capabilities.local
            ? assertLocalProviderBaseUrl
            : assertPublicProviderBaseUrl,
          webFetchEnabled: props.aiWebFetch,
          rethrowFirstProviderError: true,
          routeReason: attempt.reason,
        });
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Assistant failed";
    args.handlers.onError(message);
  }
  return true;
}
