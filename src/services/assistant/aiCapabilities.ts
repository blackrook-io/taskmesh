import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import { AiCredentialsError } from "./aiInstanceKeys.js";
import { resolveAssistantSession } from "./index.js";
import { resolveEffectiveAiAccess, resolveEffectiveLocalOnly } from "./projectAiAccess.js";
import { getSystemProperties } from "../systemProperties.js";
import { loadedAiProviders } from "./providerLoader.js";
import { pluginBudgetReason, sumDayUsage, usageWarning, utcDayStart, type AiKeySource } from "./aiBudgets.js";
import { resolveFeatureRoute } from "./aiRouting.js";

type Db = NodePgDatabase<typeof schema>;

export const AI_CAPABILITY_REASONS = [
  "no_key",
  "disabled_by_administrator",
  "project_excluded",
  "no_local_model",
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
 * `budget_reached` means the next plugin call is already over a daily cap.
 */
export async function listAiCapabilities(
  db: Db,
  args: { userId: number; projectId?: number | null; env?: NodeJS.ProcessEnv },
): Promise<AiCapability[]> {
  let localOnly = false;
  if (args.projectId != null) {
    const access = await resolveEffectiveAiAccess(db, args.projectId);
    if (!access) {
      throw new AiCredentialsError(404, "not_found", "No such project.");
    }
    if (access === "excluded") {
      return [{ id: "assistant", available: false, reason: "project_excluded" }];
    }
    localOnly = (await resolveEffectiveLocalOnly(db, args.projectId)) === true;
  }
  const session = await resolveAssistantSession(db, args.userId, args.env);
  const props = await getSystemProperties(db);
  const route = await resolveFeatureRoute(db, { userId: args.userId, env: args.env, localOnly });
  if (localOnly && route.attempts.length === 0) {
    return [{ id: "assistant", available: false, reason: "no_local_model" }];
  }
  if (!session) return [{ id: "assistant", available: false, reason: await unavailableReason(db) }];
  const keySource = route.attempts[0]?.keySource ?? null;
  const totals = await sumDayUsage(db, { userId: args.userId });
  if (pluginBudgetReason(props.aiBudgets, totals, keySource)) {
    return [{ id: "assistant", available: false, reason: "budget_reached" }];
  }
  return [{ id: "assistant", available: true, reason: null }];
}

export type UserAiUsage = {
  dayStart: string;
  tokensUsed: number;
  tokenLimit: number | null;
  /** Set when the next call would spend the instance key. */
  instanceSpendMicroUsd: number | null;
  instanceSpendLimitMicroUsd: number | null;
  keySource: AiKeySource | null;
  warning: boolean;
  blocked: boolean;
};

export async function readUserAiUsage(
  db: Db,
  userId: number,
  env?: NodeJS.ProcessEnv,
): Promise<UserAiUsage> {
  const props = await getSystemProperties(db);
  const route = await resolveFeatureRoute(db, { userId, env });
  const keySource = route.attempts[0]?.keySource ?? null;
  const totals = await sumDayUsage(db, { userId });
  const spendsInstance = keySource === "instance";
  const spendCap =
    props.aiBudgets.instanceSpendUsdPerDay == null
      ? null
      : props.aiBudgets.instanceSpendUsdPerDay * 1_000_000;
  const blocked = pluginBudgetReason(props.aiBudgets, totals, keySource) != null;
  return {
    dayStart: utcDayStart(new Date()).toISOString(),
    tokensUsed: totals.tokens,
    tokenLimit: props.aiBudgets.tokensPerUserPerDay,
    instanceSpendMicroUsd: spendsInstance ? totals.instanceSpendMicroUsd : null,
    instanceSpendLimitMicroUsd: spendsInstance ? spendCap : null,
    keySource,
    warning: usageWarning(props.aiBudgets, totals, keySource),
    blocked,
  };
}

async function unavailableReason(
  db: Db,
): Promise<Exclude<AiCapabilityReason, "project_excluded" | "budget_reached" | "no_local_model">> {
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
