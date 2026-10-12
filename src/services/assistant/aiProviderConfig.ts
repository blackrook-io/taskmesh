export type AiProviderEntry = {
  enabled: boolean;
  config: Record<string, unknown>;
};

/** Non-secret plugin enablement stored in `system_properties.ai_providers`. */
export type AiProvidersFile = Record<string, AiProviderEntry>;

export const OPENAI_KEY_DEPRECATION_LOG =
  "OPENAI_API_KEY is deprecated. The OpenAI provider plugin is enabled and this environment variable remains the API key until instance keys are configured.";

export function normalizeAiProviders(value: unknown): AiProvidersFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: AiProvidersFile = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.enabled !== "boolean") continue;
    const config = rec.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) continue;
    out[id] = { enabled: rec.enabled, config: { ...(config as Record<string, unknown>) } };
  }
  return out;
}

/** Seed used only when the property row does not exist yet. Null means insert `{}`. */
export function openAiPluginSeed(env: NodeJS.ProcessEnv): AiProvidersFile | null {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const model = env.ASSISTANT_DEFAULT_MODEL?.trim() || "gpt-4.1-mini";
  return {
    openai: {
      enabled: true,
      config: {
        baseUrl: "https://api.openai.com/v1",
        defaultModel: model,
      },
    },
  };
}

const ENV_KEY_BY_PLUGIN: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  "azure-openai": "AZURE_OPENAI_API_KEY",
};

/** Chat model from plugin config. Azure stores the deployment as `chatDeployment`. */
export function configuredChatModel(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;
  const rec = config as { defaultModel?: unknown; chatDeployment?: unknown };
  if (typeof rec.defaultModel === "string" && rec.defaultModel.trim()) return rec.defaultModel.trim();
  if (typeof rec.chatDeployment === "string" && rec.chatDeployment.trim()) return rec.chatDeployment.trim();
  return null;
}

export function resolvePluginApiKey(pluginId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const name = ENV_KEY_BY_PLUGIN[pluginId];
  if (!name) return null;
  const key = env[name]?.trim();
  return key || null;
}

export function selectChatPlugin(args: {
  plugins: Array<{ id: string; chat: boolean }>;
  file: AiProvidersFile;
  hasKey: (id: string) => boolean;
  configValid: (id: string, config: Record<string, unknown>) => boolean;
}): string | null {
  const ready = args.plugins.filter((plugin) => {
    if (!plugin.chat) return false;
    const entry = args.file[plugin.id];
    if (!entry?.enabled) return false;
    if (!args.hasKey(plugin.id)) return false;
    return args.configValid(plugin.id, entry.config);
  });
  if (ready.some((plugin) => plugin.id === "openai")) return "openai";
  return ready[0]?.id ?? null;
}
