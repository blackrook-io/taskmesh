import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import { AiCredentialsError } from "./aiInstanceKeys.js";
import { resolveAssistantSession } from "./index.js";
import { resolveEffectiveAiAccess } from "./projectAiAccess.js";
import { getSystemProperties } from "../systemProperties.js";
import { loadedAiProviders } from "./providerLoader.js";

type Db = NodePgDatabase<typeof schema>;

export const AI_CAPABILITY_REASONS = [
  "no_key",
  "disabled_by_administrator",
  "project_excluded",
  "budget_reached",
] as const;

export type AiCapabilityReason = (typeof AI_CAPABILITY_REASONS)[number];

export type AiCapability = {
  id: "assistant";
  available: boolean;
  reason: AiCapabilityReason | null;
};

/**
 * Whether this user can use each AI feature.
 * `budget_reached` is reserved for T0188 and is not returned yet.
 */
export async function listAiCapabilities(
  db: Db,
  args: { userId: number; projectId?: number | null; env?: NodeJS.ProcessEnv },
): Promise<AiCapability[]> {
  if (args.projectId != null) {
    const access = await resolveEffectiveAiAccess(db, args.projectId);
    if (!access) {
      throw new AiCredentialsError(404, "not_found", "No such project.");
    }
    if (access === "excluded") {
      return [{ id: "assistant", available: false, reason: "project_excluded" }];
    }
  }
  const session = await resolveAssistantSession(db, args.userId, args.env);
  if (session) return [{ id: "assistant", available: true, reason: null }];
  return [{ id: "assistant", available: false, reason: await unavailableReason(db) }];
}

async function unavailableReason(db: Db): Promise<Exclude<AiCapabilityReason, "project_excluded" | "budget_reached">> {
  const props = await getSystemProperties(db);
  const ready = loadedAiProviders().filter((plugin) => {
    if (!plugin.capabilities.chat) return false;
    const entry = props.aiProviders[plugin.id];
    if (!entry?.enabled) return false;
    return plugin.configSchema.safeParse(entry.config).success;
  });
  if (ready.length === 0) return "disabled_by_administrator";
  if (ready.some((plugin) => plugin.capabilities.local)) return "disabled_by_administrator";
  return "no_key";
}
