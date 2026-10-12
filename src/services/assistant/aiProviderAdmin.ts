import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import type { AiProviderPlugin } from "@taskmesh/ai-provider-contract";
import * as schema from "../../db/schema.js";
import { invalidateSystemPropertiesCache } from "../systemProperties.js";
import { normalizeAiProviders, resolvePluginApiKey, type AiProvidersFile } from "./aiProviderConfig.js";
import { assertPublicProviderBaseUrl } from "./providerBaseUrl.js";
import { loadedAiProviders } from "./providerLoader.js";

type Db = NodePgDatabase<typeof schema>;

export const aiProviderPatchSchema = z.object({
  id: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
});

export type AiProviderPublicConfig = {
  baseUrl: string;
  defaultModel: string;
  chatDeployment: string;
  embeddingsDeployment: string;
  apiVersion: string;
};

export type AiProviderAdminRow = {
  id: string;
  displayName: string;
  version: string;
  enabled: boolean;
  configured: boolean;
  capabilities: AiProviderPlugin["capabilities"];
  config: AiProviderPublicConfig;
};

async function readFile(db: Db): Promise<AiProvidersFile> {
  const [row] = await db
    .select()
    .from(schema.systemProperties)
    .where(eq(schema.systemProperties.key, "ai_providers"))
    .limit(1);
  return normalizeAiProviders(row?.value);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function publicConfig(plugin: AiProviderPlugin, raw: Record<string, unknown> | undefined): AiProviderPublicConfig {
  const parsed = plugin.configSchema.safeParse(raw ?? {});
  const data =
    parsed.success && parsed.data && typeof parsed.data === "object"
      ? (parsed.data as Record<string, unknown>)
      : (raw ?? {});
  const apiVersion = stringField(data.apiVersion);
  return {
    baseUrl: stringField(data.baseUrl),
    defaultModel: stringField(data.defaultModel),
    chatDeployment: stringField(data.chatDeployment),
    embeddingsDeployment: stringField(data.embeddingsDeployment),
    apiVersion: apiVersion || (plugin.id === "azure-openai" ? "2024-10-21" : ""),
  };
}

export async function listAiProvidersForAdmin(db: Db): Promise<AiProviderAdminRow[]> {
  const file = await readFile(db);
  return loadedAiProviders()
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((plugin) => {
      const entry = file[plugin.id];
      return {
        id: plugin.id,
        displayName: plugin.displayName,
        version: plugin.version,
        enabled: Boolean(entry?.enabled),
        configured: Boolean(entry?.enabled && resolvePluginApiKey(plugin.id)),
        capabilities: plugin.capabilities,
        config: publicConfig(plugin, entry?.config),
      };
    });
}

export async function patchAiProvider(
  db: Db,
  body: z.infer<typeof aiProviderPatchSchema>,
): Promise<AiProviderAdminRow> {
  const plugin = loadedAiProviders().find((item) => item.id === body.id);
  if (!plugin) {
    const err = new Error(`Unknown AI provider: ${body.id}`);
    (err as Error & { status: number; code: string }).status = 404;
    (err as Error & { status: number; code: string }).code = "not_found";
    throw err;
  }
  const parsed = plugin.configSchema.parse(body.config) as {
    baseUrl?: string;
  };
  if (typeof parsed.baseUrl === "string") {
    parsed.baseUrl = await assertPublicProviderBaseUrl(parsed.baseUrl);
  }
  const file = await readFile(db);
  const next: AiProvidersFile = {
    ...file,
    [plugin.id]: { enabled: body.enabled, config: { ...parsed } },
  };
  const now = new Date();
  await db
    .insert(schema.systemProperties)
    .values({ key: "ai_providers", value: next, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.systemProperties.key,
      set: { value: next, updatedAt: now },
    });
  invalidateSystemPropertiesCache();
  const row = (await listAiProvidersForAdmin(db)).find((item) => item.id === plugin.id);
  if (!row) throw new Error("Provider disappeared after save");
  return row;
}
