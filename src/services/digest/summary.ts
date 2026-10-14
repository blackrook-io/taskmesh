import type { AiChatMessage } from "@taskmesh/ai-provider-contract";
import { pluginBudgetReason, noteAllowUsage, recordUsageDenial, sumDayUsage, type AiUsageMeter } from "../assistant/aiBudgets.js";
import { writeAiAudit } from "../assistant/aiAudit.js";
import { loadActorAiPermission } from "../assistant/aiUserPolicy.js";
import { followRouteAttempts } from "../assistant/aiFeatureRoutes.js";
import { auditRouteSkips, resolveFeatureRoute, type ResolvedAttempt } from "../assistant/aiRouting.js";
import { noteStoredKeyUse } from "../assistant/aiCredentialHealth.js";
import { runCaptureModel } from "../assistant/capture/service.js";
import { loadPrompt } from "../assistant/promptRegistry.js";
import { assertLocalProviderBaseUrl, assertPublicProviderBaseUrl } from "../assistant/providerBaseUrl.js";
import { redactSecrets } from "../assistant/aiMinimize.js";
import { wrapUntrusted } from "../assistant/untrustedContent.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import { getSystemProperties } from "../systemProperties.js";

type Db = NodePgDatabase<typeof schema>;

function cleanSummary(text: string): string | null {
  const trimmed = text.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 2000);
}

/** Optional paragraph over the fact lines. A model failure leaves the summary empty. */
export async function writeDigestSummary(
  db: Db,
  args: { userId: number; lines: readonly string[]; localOnly: boolean },
): Promise<{ summary: string | null; source: "model" | null }> {
  const blank: { summary: string | null; source: "model" | null } = { summary: null, source: null };
  if (args.lines.length === 0) return blank;
  try {
    const props = await getSystemProperties(db);
    const totals = await sumDayUsage(db, { userId: args.userId });
    const route = await resolveFeatureRoute(db, {
      userId: args.userId,
      feature: "digest",
      localOnly: args.localOnly,
    });
    await auditRouteSkips(route.skipped, { userId: args.userId, feature: "digest" });
    const attempt = route.attempts[0];
    if (!attempt) return blank;
    const blocked = pluginBudgetReason(props.aiBudgets, totals, attempt.keySource);
    if (blocked) {
      await recordUsageDenial(
        {
          keySource: attempt.keySource,
          usdPerMillionTokens: props.aiInstanceUsdPerMillionTokens,
          limits: props.aiBudgets,
          totals,
          feature: "digest",
          provider: attempt.pluginId,
          model: attempt.model,
          userId: args.userId,
        },
        blocked,
      );
      return blank;
    }
    const prompt = loadPrompt({ id: "digest", providerId: attempt.pluginId });
    const messages: AiChatMessage[] = [
      { role: "system", content: prompt.body },
      {
        role: "user",
        content: wrapUntrusted(redactSecrets(args.lines.join("\n")), "digest"),
      },
    ];
    const reply = await followSummary(db, {
      userId: args.userId,
      attempts: route.attempts,
      messages,
      props,
      totals,
      prompt,
    });
    const summary = cleanSummary(reply.text);
    if (!summary) {
      await writeAiAudit({
        userId: args.userId,
        feature: "digest",
        provider: reply.pluginId,
        model: reply.model,
        action: "respond",
        decision: "deny",
        reason: "empty summary",
        tier: 0,
        tokensIn: reply.tokensIn,
        tokensOut: reply.tokensOut,
        promptId: prompt.id,
        promptVersion: prompt.version,
        promptRef: prompt.ref,
      });
      return blank;
    }
    await writeAiAudit({
      userId: args.userId,
      feature: "digest",
      provider: reply.pluginId,
      model: reply.model,
      action: "respond",
      decision: "allow",
      reason: "summary",
      tier: 0,
      tokensIn: reply.tokensIn,
      tokensOut: reply.tokensOut,
      promptId: prompt.id,
      promptVersion: prompt.version,
      promptRef: prompt.ref,
      keySource: reply.keySource,
    });
    return { summary, source: "model" };
  } catch (err) {
    console.error("[digest] summary failed", err);
    return blank;
  }
}

export async function digestFeatureOff(db: Db, userId: number): Promise<boolean> {
  const permission = await loadActorAiPermission(db, userId);
  return permission.policy.featuresOff.includes("digest");
}

async function followSummary(
  db: Db,
  args: {
    userId: number;
    attempts: ResolvedAttempt[];
    messages: AiChatMessage[];
    props: Awaited<ReturnType<typeof getSystemProperties>>;
    totals: Awaited<ReturnType<typeof sumDayUsage>>;
    prompt: { id: string; version: number; ref: string };
  },
): Promise<{ text: string; tokensIn: number; tokensOut: number; pluginId: string; model: string; keySource: ResolvedAttempt["keySource"] }> {
  return followRouteAttempts({
    attempts: args.attempts,
    onDeny: async (skipped, code) => {
      await writeAiAudit({
        userId: args.userId,
        feature: "digest",
        provider: skipped.pluginId,
        model: skipped.model,
        action: "route",
        decision: "deny",
        reason: code,
        tier: 0,
      });
    },
    call: async (chosen: ResolvedAttempt) => {
      const result = await runCaptureModel({
        plugin: chosen.plugin,
        apiKey: chosen.apiKey,
        config: chosen.config,
        model: chosen.model,
        messages: args.messages,
        assertBaseUrl: chosen.plugin.capabilities.local ? assertLocalProviderBaseUrl : assertPublicProviderBaseUrl,
      });
      const meter: AiUsageMeter = {
        keySource: chosen.keySource,
        usdPerMillionTokens: args.props.aiInstanceUsdPerMillionTokens,
        limits: args.props.aiBudgets,
        totals: args.totals,
        feature: "digest",
        provider: chosen.pluginId,
        model: chosen.model,
        userId: args.userId,
      };
      noteAllowUsage(meter, result.tokensIn, result.tokensOut);
      await noteStoredKeyUse(db, {
        userId: args.userId,
        pluginId: chosen.pluginId,
        storedKey: chosen.storedKey,
        apiKey: chosen.apiKey,
        outcome: "ok",
        message: "",
      });
      return { ...result, pluginId: chosen.pluginId, model: chosen.model, keySource: chosen.keySource };
    },
  });
}
