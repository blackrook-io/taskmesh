import type { AiProviderPlugin } from "@taskmesh/ai-provider-contract";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import { describeAllowedPolicy } from "./aiPolicy.js";
import { composeAssistantPrompt } from "./promptRegistry.js";
import { redactSecrets } from "./aiMinimize.js";
import { wrapUntrusted } from "./untrustedContent.js";
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
  tier1OptIn: boolean;
  tier1Enabled: boolean;
}> {
  const props = await getSystemProperties(db);
  const [actor] = await db
    .select({ aiTier1OptIn: schema.users.aiTier1OptIn })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
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
    tier1OptIn: actor?.aiTier1OptIn === true,
    tier1Enabled: props.aiPermissionTiers.tier1Enabled,
  };
}

/** Versioned assistant prompt plus the live permission summary. */
export function assistantSystemContent(args: {
  webFetchEnabled: boolean;
  providerId?: string | null;
  root?: string;
}): { content: string; promptId: string; promptVersion: number; promptRef: string } {
  const composed = composeAssistantPrompt(args);
  const policy = describeAllowedPolicy("assistant", { webFetchEnabled: args.webFetchEnabled });
  return {
    content: `${composed.text}\n\n${policy}`,
    promptId: composed.promptId,
    promptVersion: composed.promptVersion,
    promptRef: composed.promptRef,
  };
}

function replaceLeadingSystem(messages: ChatMessage[], content: string): ChatMessage[] {
  const [first, ...rest] = messages;
  if (first?.role === "system") return [{ role: "system", content }, ...rest];
  return [{ role: "system", content }, ...messages];
}

export function buildMessages(args: {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  pageContext?: string | null;
  webFetchEnabled?: boolean;
  providerId?: string | null;
}): ChatMessage[] {
  const webFetchEnabled = args.webFetchEnabled === true;
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: assistantSystemContent({ webFetchEnabled, providerId: args.providerId }).content,
    },
  ];
  if (args.pageContext?.trim()) {
    const redacted = redactSecrets(args.pageContext.trim()).slice(0, 12_000);
    messages.push({
      role: "system",
      content: `Current page context:\n${wrapUntrusted(redacted, "page")}`,
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
        const system = assistantSystemContent({
          webFetchEnabled: props.aiWebFetch,
          providerId: attempt.plugin.id,
        });
        await runAssistantWithTools({
          plugin: attempt.plugin,
          apiKey: attempt.apiKey,
          config: attempt.config,
          messages: replaceLeadingSystem(args.messages, system.content),
          prompt: {
            promptId: system.promptId,
            promptVersion: system.promptVersion,
            promptRef: system.promptRef,
          },
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
