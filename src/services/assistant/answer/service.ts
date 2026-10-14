import type { AiChatMessage } from "@taskmesh/ai-provider-contract";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../../db/schema.js";
import type { EntityType } from "../../../lib/entityType.js";
import { userHasAdministrator } from "../../roles.js";
import { searchEntityReferences, type ReferenceActor } from "../../references.js";
import { getSystemProperties } from "../../systemProperties.js";
import { check } from "../aiPolicy.js";
import { writeAiAudit } from "../aiAudit.js";
import { loadActorAiPermission } from "../aiUserPolicy.js";
import { pluginBudgetReason, noteAllowUsage, recordUsageDenial, sumDayUsage, type AiUsageMeter } from "../aiBudgets.js";
import { auditRouteSkips, resolveFeatureRoute, type ResolvedAttempt } from "../aiRouting.js";
import { followRouteAttempts } from "../aiFeatureRoutes.js";
import { noteStoredKeyUse } from "../aiCredentialHealth.js";
import { runCaptureModel } from "../capture/service.js";
import { assembleContext, ContextAssemblyError, type AssembledContext } from "../contextAssembly.js";
import { assistantUnconfiguredMessage } from "../index.js";
import { loadPrompt } from "../promptRegistry.js";
import { assertLocalProviderBaseUrl, assertPublicProviderBaseUrl } from "../providerBaseUrl.js";
import { loadResolvedKeys } from "../aiUserKeys.js";
import { resolveEffectiveAiAccess, resolveEffectiveLocalOnly } from "../projectAiAccess.js";
import { parseEntityRefToken } from "../../../lib/entityRef.js";
import {
  citationsInAnswer,
  citableRefs,
  type AnswerCitation,
  type ResolvedRef,
} from "./citations.js";
import { answerMessages, type AnswerTurn } from "./messages.js";

type Db = NodePgDatabase<typeof schema>;

export const NOTHING_TO_ANSWER_FROM = "There is nothing in this project to answer from.";

export class AnswerError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AnswerError";
    this.status = status;
    this.code = code;
  }
}

export type AnswerResult = {
  answer: string;
  citations: AnswerCitation[];
  grounded: boolean;
};

export function answerContextRequest(args: {
  actorId: number;
  projectId: number;
  question: string;
}): {
  actorId: number;
  feature: "answer";
  entityType: "project";
  entityId: number;
  query: string;
} {
  return {
    actorId: args.actorId,
    feature: "answer",
    entityType: "project",
    entityId: args.projectId,
    query: args.question.trim(),
  };
}

function ungrounded(): AnswerResult {
  return { answer: NOTHING_TO_ANSWER_FROM, citations: [], grounded: false };
}

export function groundAnswer(args: {
  text: string;
  packet: AssembledContext;
  resolved: ReadonlyMap<string, ResolvedRef>;
}): AnswerResult {
  const answer = args.text.trim();
  if (!answer) return ungrounded();
  const citations = citationsInAnswer(answer, citableRefs(args.packet), args.resolved);
  return { answer, citations, grounded: citations.length > 0 };
}

export async function runAnswer(args: {
  question: string;
  history: readonly AnswerTurn[];
  prompt: string;
  packet: AssembledContext;
  resolved: ReadonlyMap<string, ResolvedRef>;
  complete: (messages: AiChatMessage[]) => Promise<{ text: string }>;
}): Promise<AnswerResult> {
  if (args.packet.blocked === "project_excluded" || citableRefs(args.packet).length === 0) {
    return ungrounded();
  }
  const reply = await args.complete(
    answerMessages({
      prompt: args.prompt,
      contextText: args.packet.text,
      question: args.question,
      history: args.history,
    }),
  );
  return groundAnswer({ text: reply.text, packet: args.packet, resolved: args.resolved });
}

async function resolveCitable(
  db: Db,
  actor: ReferenceActor,
  packet: AssembledContext,
): Promise<Map<string, ResolvedRef>> {
  const map = new Map<string, ResolvedRef>();
  for (const item of citableRefs(packet)) {
    const parsed = parseEntityRefToken(item.ref);
    if (!parsed.entityType || parsed.number == null) continue;
    const rows = await searchEntityReferences(db, parsed.entityType, item.ref, actor, { limit: 8 });
    const hit = rows.find((row) => row.entityType === parsed.entityType && row.number === parsed.number);
    if (!hit || hit.entityType === "user") continue;
    map.set(item.ref, { entityType: hit.entityType, entityId: hit.id });
  }
  return map;
}

async function completeWithRoute(
  db: Db,
  args: {
    userId: number;
    projectId: number;
    localOnly: boolean;
    signal?: AbortSignal;
  },
): Promise<{ prompt: string; complete: (messages: AiChatMessage[]) => Promise<{ text: string }> }> {
  const props = await getSystemProperties(db);
  const totals = await sumDayUsage(db, { userId: args.userId });
  const route = await resolveFeatureRoute(db, {
    userId: args.userId,
    feature: "answer",
    localOnly: args.localOnly,
  });
  await auditRouteSkips(route.skipped, { userId: args.userId, feature: "answer" });
  const attempt = route.attempts[0];
  if (!attempt) {
    const resolved = await loadResolvedKeys(db, args.userId);
    throw new AnswerError(503, "assistant_unconfigured", assistantUnconfiguredMessage(resolved.mode));
  }
  const blocked = pluginBudgetReason(props.aiBudgets, totals, attempt.keySource);
  if (blocked) {
    const meter: AiUsageMeter = {
      keySource: attempt.keySource,
      usdPerMillionTokens: props.aiInstanceUsdPerMillionTokens,
      limits: props.aiBudgets,
      totals,
      feature: "answer",
      provider: attempt.pluginId,
      model: attempt.model,
      userId: args.userId,
    };
    await recordUsageDenial(meter, blocked);
    throw new AnswerError(429, blocked, "You have reached the AI usage budget.");
  }
  const prompt = loadPrompt({ id: "answer", providerId: attempt.pluginId });
  const complete = async (messages: AiChatMessage[]) => {
    const reply = await followRouteAttempts({
      attempts: route.attempts,
      onDeny: async (skipped, code) => {
        await writeAiAudit({
          userId: args.userId,
          feature: "answer",
          provider: skipped.pluginId,
          model: skipped.model,
          action: "route",
          decision: "deny",
          reason: code,
          tier: 0,
          projectId: args.projectId,
        });
      },
      call: async (chosen: ResolvedAttempt) => {
        const result = await runCaptureModel({
          plugin: chosen.plugin,
          apiKey: chosen.apiKey,
          config: chosen.config,
          model: chosen.model,
          messages,
          assertBaseUrl: chosen.plugin.capabilities.local ? assertLocalProviderBaseUrl : assertPublicProviderBaseUrl,
          signal: args.signal,
        });
        const meter: AiUsageMeter = {
          keySource: chosen.keySource,
          usdPerMillionTokens: props.aiInstanceUsdPerMillionTokens,
          limits: props.aiBudgets,
          totals,
          feature: "answer",
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
        await writeAiAudit({
          userId: args.userId,
          feature: "answer",
          provider: chosen.pluginId,
          model: chosen.model,
          action: "respond",
          decision: "allow",
          reason: "answer",
          tier: 0,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          promptId: prompt.id,
          promptVersion: prompt.version,
          promptRef: prompt.ref,
          keySource: chosen.keySource,
          projectId: args.projectId,
          entityType: "project",
          entityId: args.projectId,
        });
        return result;
      },
    });
    return { text: reply.text };
  };
  return { prompt: prompt.body, complete };
}

export async function answerProject(
  db: Db,
  args: {
    actorUserId: number;
    projectId: number;
    question: string;
    history?: readonly AnswerTurn[];
    signal?: AbortSignal;
    assemble?: (request: ReturnType<typeof answerContextRequest>) => Promise<AssembledContext>;
    complete?: (messages: AiChatMessage[]) => Promise<{ text: string }>;
    resolve?: (packet: AssembledContext) => Promise<ReadonlyMap<string, ResolvedRef>>;
  },
): Promise<AnswerResult> {
  const permission = await loadActorAiPermission(db, args.actorUserId);
  if (permission.policy.featuresOff.includes("answer")) {
    throw new AnswerError(403, "feature_off", "Ask a project is turned off.");
  }

  const request = answerContextRequest({
    actorId: args.actorUserId,
    projectId: args.projectId,
    question: args.question,
  });
  let packet: AssembledContext;
  try {
    packet = await (args.assemble ?? assembleContext)(request);
  } catch (err) {
    if (err instanceof ContextAssemblyError) {
      throw new AnswerError(err.status, err.code, err.message);
    }
    throw err;
  }
  if (packet.blocked === "project_excluded") return ungrounded();

  const access = await resolveEffectiveAiAccess(db, args.projectId);
  const decision = check(
    {
      action: "read",
      entityType: "project" satisfies EntityType,
      entityId: args.projectId,
      projectId: args.projectId,
      actorUserId: args.actorUserId,
      feature: "answer",
      userOff: permission.off,
      projectAiAccess: access,
    },
    undefined,
    permission.settings,
  );
  if (decision.decision === "deny") {
    throw new AnswerError(403, "denied", decision.reason);
  }
  if (citableRefs(packet).length === 0) return ungrounded();

  const isAdmin = await userHasAdministrator(db, args.actorUserId);
  const actor: ReferenceActor = { userId: args.actorUserId, isAdministrator: isAdmin };
  const resolved = args.resolve
    ? await args.resolve(packet)
    : await resolveCitable(db, actor, packet);
  const routed = args.complete
    ? { prompt: loadPrompt({ id: "answer" }).body, complete: args.complete }
    : await completeWithRoute(db, {
        userId: args.actorUserId,
        projectId: args.projectId,
        localOnly: (await resolveEffectiveLocalOnly(db, args.projectId)) === true,
        signal: args.signal,
      });
  return runAnswer({
    question: args.question,
    history: args.history ?? [],
    prompt: routed.prompt,
    packet,
    resolved,
    complete: routed.complete,
  });
}
