import { and, eq, gte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import type { AiAction } from "./aiPolicy.js";
import { writeAiAudit, type AiAuditSink } from "./aiAudit.js";

type Db = NodePgDatabase<typeof schema>;

export const AI_BUDGET_MESSAGE = "You have reached the AI usage budget.";
export const AI_BUDGET_WARNING = "You have used 80% of today’s AI budget.";

export const AI_KEY_SOURCES = ["user", "instance", "local"] as const;
export type AiKeySource = (typeof AI_KEY_SOURCES)[number];

export type AiBudgets = {
  tokensPerUserPerDay: number | null;
  instanceSpendUsdPerDay: number | null;
  toolCallsPerRun: number | null;
  writesPerRun: number | null;
};

export const EMPTY_AI_BUDGETS: AiBudgets = {
  tokensPerUserPerDay: null,
  instanceSpendUsdPerDay: null,
  toolCallsPerRun: null,
  writesPerRun: null,
};

const WRITE_ACTIONS = new Set<AiAction>([
  "propose_create",
  "propose_update",
  "link",
  "tag",
  "comment",
  "apply",
  "propose_delete",
  "bulk",
]);

export type PluginBudgetReason = "budget_tokens" | "budget_spend";
export type RunBudgetReason = "budget_tools" | "budget_writes";

export type DayUsageTotals = {
  tokens: number;
  instanceSpendMicroUsd: number;
};

/** Shared across plugin rounds in one run so later rounds see tokens just recorded. */
export type AiUsageMeter = {
  keySource: AiKeySource | null;
  usdPerMillionTokens: number;
  limits: AiBudgets;
  totals: DayUsageTotals;
  feature: string;
  provider: string | null;
  model: string | null;
  userId: number;
  auditSink?: AiAuditSink;
};

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function optionalPositiveInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000_000) return null;
  return n;
}

export function normalizeAiBudgets(value: unknown): AiBudgets {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    tokensPerUserPerDay: optionalPositiveInt(raw.tokensPerUserPerDay),
    instanceSpendUsdPerDay: optionalPositiveInt(raw.instanceSpendUsdPerDay),
    toolCallsPerRun: optionalPositiveInt(raw.toolCallsPerRun),
    writesPerRun: optionalPositiveInt(raw.writesPerRun),
  };
}

export function normalizeUsdPerMillionTokens(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return 1;
  return n;
}

/** Micro-USD. User and local keys cost nothing. One token at $1 / million is 1 micro-USD. */
export function estimateCostMicroUsd(
  tokensIn: number,
  tokensOut: number,
  keySource: AiKeySource | null,
  usdPerMillionTokens: number,
): number {
  if (keySource !== "instance") return 0;
  const tokens = Math.max(0, tokensIn) + Math.max(0, tokensOut);
  const rate = normalizeUsdPerMillionTokens(usdPerMillionTokens);
  return Math.round(tokens * rate);
}

export function spendCapMicroUsd(limits: AiBudgets): number | null {
  if (limits.instanceSpendUsdPerDay == null) return null;
  return limits.instanceSpendUsdPerDay * 1_000_000;
}

export function pluginBudgetReason(
  limits: AiBudgets,
  totals: DayUsageTotals,
  keySource: AiKeySource | null,
): PluginBudgetReason | null {
  if (limits.tokensPerUserPerDay != null && totals.tokens >= limits.tokensPerUserPerDay) {
    return "budget_tokens";
  }
  const cap = spendCapMicroUsd(limits);
  if (keySource === "instance" && cap != null && totals.instanceSpendMicroUsd >= cap) {
    return "budget_spend";
  }
  return null;
}

export function usageWarning(
  limits: AiBudgets,
  totals: DayUsageTotals,
  keySource: AiKeySource | null,
): boolean {
  const tokenLimit = limits.tokensPerUserPerDay;
  if (tokenLimit != null && totals.tokens / tokenLimit >= 0.8) return true;
  const cap = spendCapMicroUsd(limits);
  if (keySource === "instance" && cap != null && cap > 0 && totals.instanceSpendMicroUsd / cap >= 0.8) {
    return true;
  }
  return false;
}

export function isAiWriteAction(action: AiAction): boolean {
  return WRITE_ACTIONS.has(action);
}

export function runBudgetReason(
  limits: AiBudgets,
  counts: { toolCalls: number; writes: number },
  action: AiAction,
): RunBudgetReason | null {
  if (limits.toolCallsPerRun != null && counts.toolCalls >= limits.toolCallsPerRun) {
    return "budget_tools";
  }
  if (limits.writesPerRun != null && isAiWriteAction(action) && counts.writes >= limits.writesPerRun) {
    return "budget_writes";
  }
  return null;
}

export async function sumDayUsage(
  db: Db,
  args: { userId: number; now?: Date },
): Promise<DayUsageTotals> {
  const start = utcDayStart(args.now ?? new Date());
  const [row] = await db
    .select({
      tokens: sql<number>`coalesce(sum(case when ${schema.aiAuditLog.userId} = ${args.userId} then coalesce(${schema.aiAuditLog.tokensIn}, 0) + coalesce(${schema.aiAuditLog.tokensOut}, 0) else 0 end), 0)::int`,
      instanceSpendMicroUsd: sql<number>`coalesce(sum(case when ${schema.aiAuditLog.keySource} = 'instance' then coalesce(${schema.aiAuditLog.costMicrousd}, 0) else 0 end), 0)::int`,
    })
    .from(schema.aiAuditLog)
    .where(
      and(
        eq(schema.aiAuditLog.action, "usage"),
        eq(schema.aiAuditLog.decision, "allow"),
        gte(schema.aiAuditLog.createdAt, start),
      ),
    );
  return {
    tokens: Number(row?.tokens ?? 0),
    instanceSpendMicroUsd: Number(row?.instanceSpendMicroUsd ?? 0),
  };
}

export type AdminUsageRow = {
  userId: number | null;
  displayName: string | null;
  feature: string;
  provider: string | null;
  keySource: string | null;
  tokensIn: number;
  tokensOut: number;
  costMicrousd: number;
};

export async function listAdminAiUsage(db: Db, now = new Date()): Promise<{
  dayStart: string;
  rows: AdminUsageRow[];
  instanceSpendMicroUsd: number;
}> {
  const start = utcDayStart(now);
  const rows = await db
    .select({
      userId: schema.aiAuditLog.userId,
      displayName: schema.users.displayName,
      feature: schema.aiAuditLog.feature,
      provider: schema.aiAuditLog.provider,
      keySource: schema.aiAuditLog.keySource,
      tokensIn: sql<number>`coalesce(sum(${schema.aiAuditLog.tokensIn}), 0)::int`,
      tokensOut: sql<number>`coalesce(sum(${schema.aiAuditLog.tokensOut}), 0)::int`,
      costMicrousd: sql<number>`coalesce(sum(${schema.aiAuditLog.costMicrousd}), 0)::int`,
    })
    .from(schema.aiAuditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.aiAuditLog.userId))
    .where(
      and(
        eq(schema.aiAuditLog.action, "usage"),
        eq(schema.aiAuditLog.decision, "allow"),
        gte(schema.aiAuditLog.createdAt, start),
      ),
    )
    .groupBy(
      schema.aiAuditLog.userId,
      schema.users.displayName,
      schema.aiAuditLog.feature,
      schema.aiAuditLog.provider,
      schema.aiAuditLog.keySource,
    );
  const normalized = rows.map((row) => ({
    userId: row.userId,
    displayName: row.displayName,
    feature: row.feature,
    provider: row.provider,
    keySource: row.keySource,
    tokensIn: Number(row.tokensIn),
    tokensOut: Number(row.tokensOut),
    costMicrousd: Number(row.costMicrousd),
  }));
  const instanceSpendMicroUsd = normalized.reduce(
    (sum, row) => sum + (row.keySource === "instance" ? row.costMicrousd : 0),
    0,
  );
  return { dayStart: start.toISOString(), rows: normalized, instanceSpendMicroUsd };
}

export async function recordUsageDenial(
  meter: AiUsageMeter,
  reason: PluginBudgetReason,
): Promise<void> {
  await writeAiAudit(
    {
      userId: meter.userId,
      feature: meter.feature,
      provider: meter.provider,
      model: meter.model,
      action: "usage",
      decision: "deny",
      reason,
      tier: 0,
      keySource: meter.keySource,
    },
    meter.auditSink,
  );
}

export function noteAllowUsage(meter: AiUsageMeter, tokensIn: number, tokensOut: number): number {
  const cost = estimateCostMicroUsd(tokensIn, tokensOut, meter.keySource, meter.usdPerMillionTokens);
  meter.totals.tokens += Math.max(0, tokensIn) + Math.max(0, tokensOut);
  if (meter.keySource === "instance") meter.totals.instanceSpendMicroUsd += cost;
  return cost;
}
