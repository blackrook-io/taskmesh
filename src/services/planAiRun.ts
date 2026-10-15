import { AiProviderError, type AiChatMessage } from "@taskmesh/ai-provider-contract";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { pluginBudgetReason, noteAllowUsage, recordUsageDenial, sumDayUsage, type AiUsageMeter } from "./assistant/aiBudgets.js";
import { noteStoredKeyUse } from "./assistant/aiCredentialHealth.js";
import { writeAiAudit } from "./assistant/aiAudit.js";
import { followRouteAttempts } from "./assistant/aiFeatureRoutes.js";
import { redactSecrets } from "./assistant/aiMinimize.js";
import { tierForAction } from "./assistant/aiPolicy.js";
import { auditRouteSkips, resolveFeatureRoute, type ResolvedAttempt } from "./assistant/aiRouting.js";
import { loadPrompt } from "./assistant/promptRegistry.js";
import { resolveEffectiveAiAccess, resolveEffectiveLocalOnly } from "./assistant/projectAiAccess.js";
import { assertLocalProviderBaseUrl, assertPublicProviderBaseUrl } from "./assistant/providerBaseUrl.js";
import { getSystemProperties } from "./systemProperties.js";
import { wrapUntrusted } from "./assistant/untrustedContent.js";
import { loadPlanAiContext } from "./planRecords.js";
import {
  buildPlanAiPacket,
  hashPlanAiPacket,
  resolvePlanAi,
  type PlanAiAccess,
  type PlanAiPacket,
  type PlanAiResult,
} from "./planAiProjection.js";

type Db = NodePgDatabase<typeof schema>;

export class PlanAiRunError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlanAiRunError";
  }
}

export type PlanAiView = PlanAiResult & {
  stale: boolean;
  auditId: number | null;
};

const REJECT_NOTE: Record<"malformed_projection" | "projection_out_of_range", string> = {
  malformed_projection: "The model did not return a finish range. The baseline is unchanged.",
  projection_out_of_range: "The model date was outside the expected window. The baseline is unchanged.",
};

async function accessFor(db: Db, projectId: number | null): Promise<PlanAiAccess> {
  if (projectId == null) return "standalone";
  return (await resolveEffectiveAiAccess(db, projectId)) ?? "excluded";
}

function packetFor(
  ctx: Awaited<ReturnType<typeof loadPlanAiContext>>,
  access: PlanAiAccess,
  now: Date,
): PlanAiPacket | null {
  if (access === "excluded" || ctx.projection.center == null) return null;
  return buildPlanAiPacket({
    now,
    includeTitles: access === "full" || access === "standalone",
    capacityHoursPerWeek: ctx.capacityHoursPerWeek,
    targetDate: ctx.targetDate,
    baselineCenter: ctx.projection.center,
    items: ctx.items,
    dependencies: ctx.dependencies,
    externalBlockerCount: ctx.externalBlockerCount,
  });
}

async function readCache(db: Db, planId: number) {
  const [row] = await db
    .select()
    .from(schema.planAiProjections)
    .where(eq(schema.planAiProjections.planId, planId));
  return row ?? null;
}

function viewFrom(result: PlanAiResult, stale: boolean, auditId: number | null): PlanAiView {
  return { ...result, stale, auditId };
}

export async function getPlanProjectionWithAi(db: Db, actorId: number, planId: number) {
  const ctx = await loadPlanAiContext(db, actorId, planId);
  const access = await accessFor(db, ctx.projectId);
  const packet = packetFor(ctx, access, new Date());
  if (!packet) return { ...ctx.projection, ai: null as PlanAiView | null, aiEnabled: false };
  const cached = await readCache(db, planId);
  const hash = hashPlanAiPacket(packet);
  const ai =
    cached == null
      ? null
      : viewFrom(cached.result, cached.inputHash !== hash, cached.auditId);
  return { ...ctx.projection, ai, aiEnabled: true };
}

async function completePacket(
  db: Db,
  actorId: number,
  planId: number,
  projectId: number | null,
  localOnly: boolean,
  packet: PlanAiPacket,
  signal: AbortSignal | undefined,
): Promise<{ text: string; tokensIn: number; tokensOut: number; provider: string; model: string }> {
  const props = await getSystemProperties(db);
  const totals = await sumDayUsage(db, { userId: actorId });
  const route = await resolveFeatureRoute(db, { userId: actorId, feature: "plan_projection", localOnly });
  if (route.attempts.length === 0) {
    throw new PlanAiRunError(503, "assistant_unconfigured", "AI is not configured.");
  }
  await auditRouteSkips(route.skipped, { userId: actorId, feature: "plan_projection" });
  const blocked = pluginBudgetReason(props.aiBudgets, totals, route.attempts[0]?.keySource ?? null);
  if (blocked) {
    const meter: AiUsageMeter = {
      keySource: route.attempts[0]?.keySource ?? null,
      usdPerMillionTokens: props.aiInstanceUsdPerMillionTokens,
      limits: props.aiBudgets,
      totals,
      feature: "plan_projection",
      provider: route.attempts[0]?.pluginId ?? null,
      model: route.attempts[0]?.model ?? null,
      userId: actorId,
    };
    await recordUsageDenial(meter, blocked);
    throw new PlanAiRunError(429, blocked, "You have reached the AI usage budget.");
  }
  const prompt = loadPrompt({ id: "plan_projection" });
  const messages: AiChatMessage[] = [
    { role: "system", content: prompt.body },
    {
      role: "user",
      content: wrapUntrusted(redactSecrets(JSON.stringify(packet)), "plan_projection"),
    },
  ];
  return followRouteAttempts({
    attempts: route.attempts,
    onDeny: async (attempt, code) => {
      await writeAiAudit({
        userId: actorId,
        feature: "plan_projection",
        provider: attempt.pluginId,
        model: attempt.model,
        tool: "plan_projection",
        action: "route",
        entityType: "plan",
        entityId: planId,
        projectId,
        decision: "deny",
        reason: code,
        tier: 0,
      });
    },
    call: async (attempt: ResolvedAttempt) => {
      let text = "";
      let tokensIn = 0;
      let tokensOut = 0;
      try {
        for await (const event of attempt.plugin.streamChat(
          {
            config: attempt.config,
            apiKey: attempt.apiKey,
            assertBaseUrl: attempt.plugin.capabilities.local
              ? assertLocalProviderBaseUrl
              : assertPublicProviderBaseUrl,
          },
          { messages, model: attempt.model, signal },
        )) {
          if (event.type === "delta") text += event.text;
          if (event.type === "usage") {
            tokensIn = event.usage.inputTokens;
            tokensOut = event.usage.outputTokens;
          }
        }
        const meter: AiUsageMeter = {
          keySource: attempt.keySource,
          usdPerMillionTokens: props.aiInstanceUsdPerMillionTokens,
          limits: props.aiBudgets,
          totals,
          feature: "plan_projection",
          provider: attempt.pluginId,
          model: attempt.model,
          userId: actorId,
        };
        noteAllowUsage(meter, tokensIn, tokensOut);
        await noteStoredKeyUse(db, {
          userId: actorId,
          pluginId: attempt.pluginId,
          storedKey: attempt.storedKey,
          apiKey: attempt.apiKey,
          outcome: "ok",
          message: "",
        });
        return { text, tokensIn, tokensOut, provider: attempt.pluginId, model: attempt.model };
      } catch (err) {
        if (err instanceof AiProviderError && err.code === "auth") {
          await noteStoredKeyUse(db, {
            userId: actorId,
            pluginId: attempt.pluginId,
            storedKey: attempt.storedKey,
            apiKey: attempt.apiKey,
            outcome: "auth",
            message: err.message,
          });
        }
        throw err;
      }
    },
  });
}

export async function refinePlanProjection(
  db: Db,
  actorId: number,
  planId: number,
  force: boolean,
  signal?: AbortSignal,
): Promise<{ ai: PlanAiView | null; note: string | null }> {
  const ctx = await loadPlanAiContext(db, actorId, planId);
  const access = await accessFor(db, ctx.projectId);
  if (access === "excluded") {
    throw new PlanAiRunError(403, "project_excluded", "This project is excluded from AI.");
  }
  if (ctx.projection.center == null) {
    throw new PlanAiRunError(400, "projection_unavailable", "Set capacity and estimates before refining the finish range.");
  }
  const now = new Date();
  const packet = packetFor(ctx, access, now);
  if (!packet) {
    throw new PlanAiRunError(400, "projection_unavailable", "Set capacity and estimates before refining the finish range.");
  }
  const cached = await readCache(db, planId);
  const localOnly =
    ctx.projectId != null && (await resolveEffectiveLocalOnly(db, ctx.projectId)) === true;
  const usage: { tokensIn: number; tokensOut: number; provider: string; model: string } = {
    tokensIn: 0,
    tokensOut: 0,
    provider: "",
    model: "",
  };
  const outcome = await resolvePlanAi({
    access,
    hasCenter: true,
    packet,
    cachedHash: cached?.inputHash ?? null,
    force,
    complete: async () => {
      const reply = await completePacket(db, actorId, planId, ctx.projectId, localOnly, packet, signal);
      usage.tokensIn = reply.tokensIn;
      usage.tokensOut = reply.tokensOut;
      usage.provider = reply.provider;
      usage.model = reply.model;
      return reply.text;
    },
  });
  if (outcome.kind === "cache") {
    if (!cached) return { ai: null, note: null };
    return { ai: viewFrom(cached.result, false, cached.auditId), note: null };
  }
  if (outcome.kind === "hidden") {
    return { ai: null, note: null };
  }
  const prompt = loadPrompt({ id: "plan_projection" });
  const auditId = await writeAiAudit({
    userId: actorId,
    feature: "plan_projection",
    provider: usage.provider || null,
    model: usage.model || null,
    tool: "plan_projection",
    action: "read",
    entityType: "plan",
    entityId: planId,
    projectId: ctx.projectId,
    decision: outcome.kind === "accepted" ? "allow" : "deny",
    reason: outcome.kind === "rejected" ? outcome.reason : null,
    tier: tierForAction("read"),
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    promptId: prompt.id,
    promptVersion: prompt.version,
    promptRef: prompt.ref,
  });
  if (outcome.kind === "rejected") {
    return { ai: null, note: REJECT_NOTE[outcome.reason] };
  }
  const hash = hashPlanAiPacket(packet);
  await db
    .insert(schema.planAiProjections)
    .values({
      planId,
      inputHash: hash,
      result: outcome.result,
      auditId,
    })
    .onConflictDoUpdate({
      target: schema.planAiProjections.planId,
      set: {
        inputHash: hash,
        result: outcome.result,
        auditId,
        updatedAt: new Date(),
      },
    });
  return { ai: viewFrom(outcome.result, false, auditId), note: null };
}
