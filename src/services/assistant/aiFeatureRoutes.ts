import { selectChatPlugin, type AiProvidersFile } from "./aiProviderConfig.js";
import { AiProviderError } from "@taskmesh/ai-provider-contract";

export type AiFeatureSize = "small" | "large";

export type AiFeatureNeeds = {
  id: string;
  tools: boolean;
  longContext: boolean;
  embeddings: boolean;
  localOnly: boolean;
  size: AiFeatureSize;
};

/** Features the router knows. Later tasks register their own entry. */
export const AI_FEATURES: Record<string, AiFeatureNeeds> = {
  assistant: {
    id: "assistant",
    tools: true,
    longContext: true,
    embeddings: false,
    localOnly: false,
    size: "large",
  },
  capture: {
    id: "capture",
    tools: false,
    longContext: false,
    embeddings: false,
    localOnly: false,
    size: "small",
  },
  tagging: {
    id: "tagging",
    tools: false,
    longContext: false,
    embeddings: false,
    localOnly: false,
    size: "small",
  },
  duplicates: {
    id: "duplicates",
    tools: false,
    longContext: false,
    embeddings: false,
    localOnly: false,
    size: "small",
  },
  digest: {
    id: "digest",
    tools: false,
    longContext: false,
    embeddings: false,
    localOnly: false,
    size: "small",
  },
  links: {
    id: "links",
    tools: false,
    longContext: false,
    embeddings: false,
    localOnly: false,
    size: "small",
  },
  answer: {
    id: "answer",
    tools: false,
    longContext: true,
    embeddings: false,
    localOnly: false,
    size: "large",
  },
};

export function aiFeatureNeeds(id: string): AiFeatureNeeds | null {
  return AI_FEATURES[id] ?? null;
}

/** Cloud models we already ship as plugin defaults. Size follows the id. */
const CATALOG = new Set([
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4o",
  "gpt-4o-mini",
  "claude-sonnet-4-5",
  "claude-3-5-haiku-latest",
  "gemini-3.8-flash",
  "gemini-2.5-pro",
]);

export function catalogModelIds(): string[] {
  return [...CATALOG];
}

export type ModelProfile = {
  tools: boolean;
  embeddings: boolean;
  longContext: boolean;
  size: AiFeatureSize;
};

export type ProfileOverride = {
  tools?: boolean;
  embeddings?: boolean;
  longContext?: boolean;
  size?: AiFeatureSize;
};

export type RoutePin = {
  pluginId: string;
  model: string;
};

export type AiFeatureRouteConfig = {
  default: RoutePin | null;
  fallbacks: RoutePin[];
};

export type AiFeatureRoutesFile = {
  features: Record<string, AiFeatureRouteConfig>;
  profiles: Array<RoutePin & ProfileOverride>;
};

export type RoutePlugin = {
  id: string;
  chat: boolean;
  tools: boolean;
  embeddings: boolean;
  local: boolean;
  enabled: boolean;
  configValid: boolean;
  hasKey: boolean;
  configuredModel: string | null;
  /** Per-plugin default from the user's key row. Null when that key is not spent. */
  userModel: string | null;
};

export type RouteAttempt = {
  pluginId: string;
  model: string;
  local: boolean;
  profile: ModelProfile;
  /** `user` | `admin` | `fallback:N` | `automatic` | `request` */
  reason: string;
};

export type RouteSkip = {
  pluginId: string;
  model: string;
  reason: "capability_mismatch" | "local_only";
};

const EMPTY_ROUTES: AiFeatureRoutesFile = { features: {}, profiles: [] };

function isSize(value: unknown): value is AiFeatureSize {
  return value === "small" || value === "large";
}

function isPin(value: unknown): value is RoutePin {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as { pluginId?: unknown; model?: unknown };
  return (
    typeof rec.pluginId === "string" &&
    /^[a-z0-9-]+$/.test(rec.pluginId) &&
    typeof rec.model === "string" &&
    rec.model.trim().length > 0 &&
    rec.model.trim().length <= 120
  );
}

function cleanPin(value: RoutePin): RoutePin {
  return { pluginId: value.pluginId, model: value.model.trim() };
}

export function normalizeAiFeatureRoutes(value: unknown): AiFeatureRoutesFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_ROUTES;
  const raw = value as { features?: unknown; profiles?: unknown };
  const features: Record<string, AiFeatureRouteConfig> = {};
  if (raw.features && typeof raw.features === "object" && !Array.isArray(raw.features)) {
    for (const [id, entry] of Object.entries(raw.features as Record<string, unknown>)) {
      if (!AI_FEATURES[id] || !entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const rec = entry as { default?: unknown; fallbacks?: unknown };
      const fallbacks = Array.isArray(rec.fallbacks)
        ? rec.fallbacks.filter(isPin).map(cleanPin).slice(0, 8)
        : [];
      features[id] = {
        default: isPin(rec.default) ? cleanPin(rec.default) : null,
        fallbacks,
      };
    }
  }
  const profiles: Array<RoutePin & ProfileOverride> = [];
  if (Array.isArray(raw.profiles)) {
    for (const entry of raw.profiles) {
      if (!isPin(entry) || profiles.length >= 50) continue;
      const rec = entry as RoutePin & {
        tools?: unknown;
        embeddings?: unknown;
        longContext?: unknown;
        size?: unknown;
      };
      const override: RoutePin & ProfileOverride = cleanPin(rec);
      if (typeof rec.tools === "boolean") override.tools = rec.tools;
      if (typeof rec.embeddings === "boolean") override.embeddings = rec.embeddings;
      if (typeof rec.longContext === "boolean") override.longContext = rec.longContext;
      if (isSize(rec.size)) override.size = rec.size;
      profiles.push(override);
    }
  }
  return { features, profiles };
}

export function catalogSize(model: string): AiFeatureSize {
  const id = model.toLowerCase();
  if (id.includes("mini") || id.includes("flash") || id.includes("haiku")) return "small";
  return "large";
}

export function profileOverrideFor(
  routes: AiFeatureRoutesFile,
  pluginId: string,
  model: string,
): (RoutePin & ProfileOverride) | null {
  return routes.profiles.find((row) => row.pluginId === pluginId && row.model === model) ?? null;
}

/**
 * Plugin flags are a ceiling. The configured chat model and the user's per-plugin
 * default inherit them when they are not in the catalog and have no override.
 * Every other unknown model fails closed.
 */
export function modelProfile(args: {
  plugin: { tools: boolean; embeddings: boolean };
  model: string;
  configuredModel: string | null;
  /** Per-plugin default from the user's key. Inherits plugin flags the same way the configured model does. */
  userModel?: string | null;
  override: ProfileOverride | null;
}): ModelProfile {
  const known = CATALOG.has(args.model);
  const trusted =
    args.model === args.configuredModel ||
    (Boolean(args.userModel?.trim()) && args.model === args.userModel?.trim());
  const inherit = !known && trusted && !args.override;
  let profile: ModelProfile;
  if (known) {
    profile = {
      tools: true,
      embeddings: false,
      longContext: true,
      size: catalogSize(args.model),
    };
  } else if (inherit) {
    profile = {
      tools: args.plugin.tools,
      embeddings: args.plugin.embeddings,
      longContext: true,
      size: catalogSize(args.model),
    };
  } else {
    profile = { tools: false, embeddings: false, longContext: false, size: "small" };
  }
  const override = args.override;
  if (override) {
    if (typeof override.tools === "boolean") profile = { ...profile, tools: override.tools };
    if (typeof override.embeddings === "boolean") profile = { ...profile, embeddings: override.embeddings };
    if (typeof override.longContext === "boolean") profile = { ...profile, longContext: override.longContext };
    if (override.size) profile = { ...profile, size: override.size };
  }
  return {
    tools: args.plugin.tools && profile.tools,
    embeddings: args.plugin.embeddings && profile.embeddings,
    longContext: profile.longContext,
    size: profile.size,
  };
}

export function routeMismatch(
  needs: AiFeatureNeeds,
  profile: ModelProfile,
  local: boolean,
  localOnly: boolean,
): "capability_mismatch" | "local_only" | null {
  if ((needs.localOnly || localOnly) && !local) return "local_only";
  if (needs.tools && !profile.tools) return "capability_mismatch";
  if (needs.embeddings && !profile.embeddings) return "capability_mismatch";
  if (needs.longContext && !profile.longContext) return "capability_mismatch";
  return null;
}

export function isRoutablePin(args: {
  feature: AiFeatureNeeds;
  plugin: RoutePlugin;
  model: string;
  routes: AiFeatureRoutesFile;
}): boolean {
  if (!args.plugin.chat || !args.plugin.enabled || !args.plugin.configValid) return false;
  if (!args.plugin.local && !args.plugin.hasKey) return false;
  const profile = modelProfile({
    plugin: args.plugin,
    model: args.model,
    configuredModel: args.plugin.configuredModel,
    userModel: args.plugin.userModel,
    override: profileOverrideFor(args.routes, args.plugin.id, args.model),
  });
  return routeMismatch(args.feature, profile, args.plugin.local, args.feature.localOnly) == null;
}

export function isRouteProviderSkip(code: string): boolean {
  return (
    code === "rate_limit" ||
    code === "quota" ||
    code === "network" ||
    code === "model_not_found" ||
    code === "auth" ||
    code === "unsupported" ||
    code === "invalid_config"
  );
}

function pluginReady(plugin: RoutePlugin): boolean {
  if (!plugin.chat || !plugin.enabled || !plugin.configValid) return false;
  if (!plugin.local && !plugin.hasKey) return false;
  return true;
}

export function planAiRoute(args: {
  feature: AiFeatureNeeds;
  plugins: RoutePlugin[];
  routes: AiFeatureRoutesFile;
  userPin: RoutePin | null;
  localOnly?: boolean;
  requestedModel?: string | null;
  /** Loader order. The `selectChatPlugin` winner is placed first in the automatic tail. */
  loaderOrder?: string[];
  providersFile?: AiProvidersFile;
}): { attempts: RouteAttempt[]; skipped: RouteSkip[] } {
  const localOnly = args.localOnly === true;
  const routes = args.routes;
  const byId = new Map(args.plugins.map((plugin) => [plugin.id, plugin]));
  const attempts: RouteAttempt[] = [];
  const skipped: RouteSkip[] = [];
  const seen = new Set<string>();

  function consider(pin: RoutePin, reason: string): void {
    const plugin = byId.get(pin.pluginId);
    if (!plugin || !pluginReady(plugin)) return;
    const key = `${pin.pluginId}\0${pin.model}`;
    if (seen.has(key)) return;
    const override = profileOverrideFor(routes, pin.pluginId, pin.model);
    const profile = modelProfile({
      plugin,
      model: pin.model,
      configuredModel: plugin.configuredModel,
      userModel: plugin.userModel,
      override,
    });
    const mismatch = routeMismatch(args.feature, profile, plugin.local, localOnly);
    seen.add(key);
    if (mismatch) {
      skipped.push({ pluginId: pin.pluginId, model: pin.model, reason: mismatch });
      return;
    }
    attempts.push({
      pluginId: pin.pluginId,
      model: pin.model,
      local: plugin.local,
      profile,
      reason,
    });
  }

  if (args.userPin) consider(args.userPin, "user");
  const featureRoute = routes.features[args.feature.id];
  if (featureRoute?.default) consider(featureRoute.default, "admin");
  featureRoute?.fallbacks.forEach((pin, index) => consider(pin, `fallback:${index}`));

  const ready = args.plugins.filter(pluginReady);
  const primary = selectChatPlugin({
    plugins: ready.map((plugin) => ({ id: plugin.id, chat: plugin.chat, local: plugin.local })),
    file: args.providersFile ?? Object.fromEntries(ready.map((plugin) => [plugin.id, { enabled: true, config: {} }])),
    hasKey: (id) => Boolean(byId.get(id)?.hasKey || byId.get(id)?.local),
    configValid: () => true,
  });
  const loader = args.loaderOrder ?? ready.map((plugin) => plugin.id);
  const automaticIds = [
    ...(primary ? [primary] : []),
    ...loader.filter((id) => id !== primary),
  ];
  const before = attempts.length;
  for (const id of automaticIds) {
    const plugin = byId.get(id);
    if (!plugin || !pluginReady(plugin)) continue;
    const model = plugin.userModel?.trim() || plugin.configuredModel;
    if (!model) continue;
    consider({ pluginId: id, model }, "automatic");
  }
  const tail = attempts.splice(before);
  tail.sort((a, b) => {
    const aMatch = a.profile.size === args.feature.size ? 0 : 1;
    const bMatch = b.profile.size === args.feature.size ? 0 : 1;
    return aMatch - bMatch;
  });
  attempts.push(...tail);

  const requested = args.requestedModel?.trim();
  const host = attempts[0];
  if (requested && host && requested !== host.model) {
    const plugin = byId.get(host.pluginId);
    if (plugin && pluginReady(plugin)) {
      const override = profileOverrideFor(routes, host.pluginId, requested);
      const profile = modelProfile({
        plugin,
        model: requested,
        configuredModel: plugin.configuredModel,
        userModel: plugin.userModel,
        override,
      });
      const mismatch = routeMismatch(args.feature, profile, plugin.local, localOnly);
      if (mismatch) {
        skipped.push({ pluginId: host.pluginId, model: requested, reason: mismatch });
      } else {
        const existing = attempts.findIndex((row) => row.pluginId === host.pluginId && row.model === requested);
        if (existing >= 0) {
          const [row] = attempts.splice(existing, 1);
          attempts.unshift({ ...row!, reason: "request" });
        } else {
          attempts.unshift({
            pluginId: host.pluginId,
            model: requested,
            local: plugin.local,
            profile,
            reason: "request",
          });
        }
      }
    }
  }

  return { attempts, skipped };
}

/** Try candidates in order. A retriable provider error records a deny and moves on. */
export async function followRouteAttempts<TAttempt extends RouteAttempt, T>(args: {
  attempts: TAttempt[];
  call: (attempt: TAttempt) => Promise<T>;
  onDeny: (attempt: TAttempt, code: string) => Promise<void>;
}): Promise<T> {
  let lastMessage = "Assistant failed";
  for (let i = 0; i < args.attempts.length; i++) {
    const attempt = args.attempts[i]!;
    const more = i < args.attempts.length - 1;
    try {
      return await args.call(attempt);
    } catch (err) {
      if (err instanceof AiProviderError && more && isRouteProviderSkip(err.code)) {
        lastMessage = err.message || lastMessage;
        await args.onDeny(attempt, err.code);
        continue;
      }
      if (err instanceof Error && err.message) throw err;
      throw new Error(lastMessage);
    }
  }
  throw new Error(lastMessage);
}
