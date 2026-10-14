import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import { getSystemProperties, invalidateSystemPropertiesCache } from "../systemProperties.js";
import { writeAiAudit, type AiAuditSink } from "./aiAudit.js";
import {
  AI_FEATURES,
  aiFeatureNeeds,
  catalogModelIds,
  modelProfile,
  normalizeAiFeatureRoutes,
  planAiRoute,
  profileOverrideFor,
  isRoutablePin,
  routeMismatch,
  type AiFeatureRoutesFile,
  type RouteAttempt,
  type RoutePin,
  type RoutePlugin,
  type RouteSkip,
} from "./aiFeatureRoutes.js";
import { configuredChatModel, type AiProvidersFile } from "./aiProviderConfig.js";
import { loadResolvedKeys } from "./aiUserKeys.js";
import type { AiProviderPlugin } from "@taskmesh/ai-provider-contract";
import { getAiProvider, loadedAiProviders } from "./providerLoader.js";

type Db = NodePgDatabase<typeof schema>;

export class AiRoutingError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AiRoutingError";
    this.status = status;
    this.code = code;
  }
}

export type ResolvedAttempt = RouteAttempt & {
  plugin: AiProviderPlugin;
  config: unknown;
  apiKey: string | null;
  keySource: "user" | "instance" | "local" | null;
  storedKey: "user" | "instance" | null;
};

export type ResolvedRoute = {
  attempts: ResolvedAttempt[];
  skipped: RouteSkip[];
};

function pluginsForRoute(args: {
  file: AiProvidersFile;
  resolveKey: (pluginId: string) => { apiKey: string | null; defaultModel: string | null };
}): RoutePlugin[] {
  return loadedAiProviders().map((plugin) => {
    const entry = args.file[plugin.id];
    const resolved = args.resolveKey(plugin.id);
    return {
      id: plugin.id,
      chat: plugin.capabilities.chat,
      tools: plugin.capabilities.tools,
      embeddings: plugin.capabilities.embeddings,
      local: plugin.capabilities.local,
      enabled: Boolean(entry?.enabled),
      configValid: plugin.configSchema.safeParse(entry?.config ?? {}).success,
      hasKey: Boolean(resolved.apiKey),
      configuredModel: configuredChatModel(entry?.config),
      userModel: resolved.defaultModel,
    };
  });
}

async function userPin(db: Db, userId: number, feature: string): Promise<RoutePin | null> {
  const [row] = await db
    .select({
      pluginId: schema.userAiRoutePrefs.pluginId,
      model: schema.userAiRoutePrefs.model,
    })
    .from(schema.userAiRoutePrefs)
    .where(and(eq(schema.userAiRoutePrefs.userId, userId), eq(schema.userAiRoutePrefs.feature, feature)))
    .limit(1);
  if (!row) return null;
  return { pluginId: row.pluginId, model: row.model };
}

export async function resolveFeatureRoute(
  db: Db,
  args: {
    userId: number;
    feature?: string;
    localOnly?: boolean;
    requestedModel?: string | null;
    env?: NodeJS.ProcessEnv;
  },
): Promise<ResolvedRoute> {
  const feature = aiFeatureNeeds(args.feature ?? "assistant");
  if (!feature) return { attempts: [], skipped: [] };
  const props = await getSystemProperties(db);
  const keys = await loadResolvedKeys(db, args.userId, args.env);
  const plugins = pluginsForRoute({
    file: props.aiProviders,
    resolveKey: (pluginId) => keys.resolve(pluginId),
  });
  const planned = planAiRoute({
    feature,
    plugins,
    routes: props.aiFeatureRoutes,
    userPin: await userPin(db, args.userId, feature.id),
    localOnly: args.localOnly,
    requestedModel: args.requestedModel,
    loaderOrder: loadedAiProviders().map((plugin) => plugin.id),
    providersFile: props.aiProviders,
  });
  const attempts: ResolvedAttempt[] = [];
  for (const attempt of planned.attempts) {
    const plugin = getAiProvider(attempt.pluginId);
    const entry = props.aiProviders[attempt.pluginId];
    if (!plugin || !entry) continue;
    const parsed = plugin.configSchema.safeParse(entry.config);
    if (!parsed.success) continue;
    const resolved = keys.resolve(attempt.pluginId);
    const apiKey = plugin.capabilities.local ? null : resolved.apiKey;
    if (!plugin.capabilities.local && !apiKey) continue;
    attempts.push({
      ...attempt,
      plugin,
      config: parsed.data,
      apiKey,
      keySource: plugin.capabilities.local ? "local" : resolved.keySource,
      storedKey: plugin.capabilities.local ? null : resolved.storedKey,
      model: attempt.model,
    });
  }
  return { attempts, skipped: planned.skipped };
}

export async function auditRouteSkips(
  skipped: RouteSkip[],
  args: { userId: number; feature: string; sink?: AiAuditSink },
): Promise<void> {
  for (const skip of skipped) {
    await writeAiAudit(
      {
        userId: args.userId,
        feature: args.feature,
        provider: skip.pluginId,
        model: skip.model,
        action: "route",
        decision: "deny",
        reason: skip.reason,
        tier: 0,
      },
      args.sink,
    );
  }
}

export type AiRoutingFeatureView = {
  id: string;
  needs: {
    tools: boolean;
    longContext: boolean;
    embeddings: boolean;
    localOnly: boolean;
    size: "small" | "large";
  };
  preference: RoutePin | null;
  adminDefault: RoutePin | null;
  fallbacks: RoutePin[];
  eligible: Array<RoutePin & { local: boolean; tools: boolean; embeddings: boolean; longContext: boolean; size: "small" | "large" }>;
};

export async function listAiRouting(
  db: Db,
  userId: number,
  env?: NodeJS.ProcessEnv,
): Promise<{ features: AiRoutingFeatureView[] }> {
  const props = await getSystemProperties(db);
  const keys = await loadResolvedKeys(db, userId, env);
  const plugins = pluginsForRoute({
    file: props.aiProviders,
    resolveKey: (pluginId) => keys.resolve(pluginId),
  });
  const features: AiRoutingFeatureView[] = [];
  for (const feature of Object.values(AI_FEATURES)) {
    const pin = await userPin(db, userId, feature.id);
    const route = props.aiFeatureRoutes.features[feature.id];
    const eligible: AiRoutingFeatureView["eligible"] = [];
    const seen = new Set<string>();
    for (const plugin of plugins) {
      if (!plugin.chat || !plugin.enabled || !plugin.configValid) continue;
      if (!plugin.local && !plugin.hasKey) continue;
      const models = new Set<string>();
      if (plugin.configuredModel) models.add(plugin.configuredModel);
      if (plugin.userModel?.trim()) models.add(plugin.userModel.trim());
      if (!plugin.local) {
        for (const id of catalogModelIds()) models.add(id);
      }
      for (const profile of props.aiFeatureRoutes.profiles) {
        if (profile.pluginId === plugin.id) models.add(profile.model);
      }
      if (route?.default?.pluginId === plugin.id) models.add(route.default.model);
      for (const pin of route?.fallbacks ?? []) {
        if (pin.pluginId === plugin.id) models.add(pin.model);
      }
      for (const model of models) {
        const key = `${plugin.id}\0${model}`;
        if (seen.has(key)) continue;
        const profile = modelProfile({
          plugin,
          model,
          configuredModel: plugin.configuredModel,
          userModel: plugin.userModel,
          override: profileOverrideFor(props.aiFeatureRoutes, plugin.id, model),
        });
        if (routeMismatch(feature, profile, plugin.local, feature.localOnly)) continue;
        seen.add(key);
        eligible.push({
          pluginId: plugin.id,
          model,
          local: plugin.local,
          tools: profile.tools,
          embeddings: profile.embeddings,
          longContext: profile.longContext,
          size: profile.size,
        });
      }
    }
    features.push({
      id: feature.id,
      needs: {
        tools: feature.tools,
        longContext: feature.longContext,
        embeddings: feature.embeddings,
        localOnly: feature.localOnly,
        size: feature.size,
      },
      preference: pin,
      adminDefault: route?.default ?? null,
      fallbacks: route?.fallbacks ?? [],
      eligible,
    });
  }
  return { features };
}

function choiceAllowed(
  plugins: RoutePlugin[],
  routes: AiFeatureRoutesFile,
  featureId: string,
  pin: RoutePin,
): boolean {
  const feature = aiFeatureNeeds(featureId);
  const plugin = plugins.find((row) => row.id === pin.pluginId);
  if (!feature || !plugin) return false;
  return isRoutablePin({ feature, plugin, model: pin.model, routes });
}

export async function setUserRoutePreference(
  db: Db,
  args: { userId: number; feature: string; pin: RoutePin | null; env?: NodeJS.ProcessEnv },
): Promise<RoutePin | null> {
  if (!aiFeatureNeeds(args.feature)) {
    throw new AiRoutingError(404, "not_found", "No such AI feature.");
  }
  if (args.pin) {
    const props = await getSystemProperties(db);
    const keys = await loadResolvedKeys(db, args.userId, args.env);
    const plugins = pluginsForRoute({
      file: props.aiProviders,
      resolveKey: (pluginId) => keys.resolve(pluginId),
    });
    if (!choiceAllowed(plugins, props.aiFeatureRoutes, args.feature, args.pin)) {
      throw new AiRoutingError(400, "invalid_route", "That model cannot serve this feature.");
    }
    const now = new Date();
    await db
      .insert(schema.userAiRoutePrefs)
      .values({
        userId: args.userId,
        feature: args.feature,
        pluginId: args.pin.pluginId,
        model: args.pin.model.trim(),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.userAiRoutePrefs.userId, schema.userAiRoutePrefs.feature],
        set: { pluginId: args.pin.pluginId, model: args.pin.model.trim(), updatedAt: now },
      });
    return { pluginId: args.pin.pluginId, model: args.pin.model.trim() };
  }
  await db
    .delete(schema.userAiRoutePrefs)
    .where(and(eq(schema.userAiRoutePrefs.userId, args.userId), eq(schema.userAiRoutePrefs.feature, args.feature)));
  return null;
}

export async function saveAiFeatureRoutes(db: Db, value: unknown): Promise<AiFeatureRoutesFile> {
  const routes = normalizeAiFeatureRoutes(value);
  const now = new Date();
  await db
    .insert(schema.systemProperties)
    .values({ key: "ai_feature_routes", value: routes, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.systemProperties.key,
      set: { value: routes, updatedAt: now },
    });
  invalidateSystemPropertiesCache();
  return routes;
}
