import { AiProviderError, type AiChatMessage, type AiProviderPlugin } from "@taskmesh/ai-provider-contract";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../../db/schema.js";
import { entityEndKey } from "../../../lib/entityLinkRules.js";
import type { EntityType } from "../../../lib/entityType.js";
import { parseEntityRefToken } from "../../../lib/entityRef.js";
import { userHasAdministrator } from "../../roles.js";
import { loadVisibleEnds, type LinkActor } from "../../entityLinks.js";
import { searchEntityReferences, type ReferenceActor } from "../../references.js";
import { getSystemProperties } from "../../systemProperties.js";
import { check, type PolicyCheckInput } from "../aiPolicy.js";
import { writeAiAudit, type AiAuditSink } from "../aiAudit.js";
import { pluginBudgetReason, noteAllowUsage, recordUsageDenial, sumDayUsage, type AiUsageMeter } from "../aiBudgets.js";
import { loadActorAiPermission } from "../aiUserPolicy.js";
import { classifyChangePlan, type ChangePlan } from "../aiTiers.js";
import { assembleContext } from "../contextAssembly.js";
import { auditRouteSkips, resolveFeatureRoute, type ResolvedAttempt } from "../aiRouting.js";
import { followRouteAttempts } from "../aiFeatureRoutes.js";
import { noteStoredKeyUse } from "../aiCredentialHealth.js";
import { redactSecrets } from "../aiMinimize.js";
import { loadPrompt } from "../promptRegistry.js";
import { assertLocalProviderBaseUrl, assertPublicProviderBaseUrl } from "../providerBaseUrl.js";
import { loadResolvedKeys } from "../aiUserKeys.js";
import { assistantUnconfiguredMessage } from "../index.js";
import { resolveEffectiveAiAccess, resolveEffectiveLocalOnly } from "../projectAiAccess.js";
import { wrapUntrusted } from "../untrustedContent.js";
import { civilDate, formatIso, isValidTimeZone } from "./dates.js";
import { CaptureParseError, parseCaptureExtraction } from "./extract.js";
import {
  captureOperations,
  resolveCapture,
  type ResolveCaptureInput,
} from "./resolve.js";
import type { CaptureHit, CaptureLookup, CaptureLookupType, CaptureProposal, CaptureQuestion, ResolvedCapture } from "./types.js";

type Db = NodePgDatabase<typeof schema>;

const LOOKUP_TYPES = new Set<CaptureLookupType>([
  "task",
  "todo",
  "idea",
  "project",
  "document",
  "todo_list",
]);

export class CaptureError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CaptureError";
    this.status = status;
    this.code = code;
  }
}

export type CaptureResult = {
  proposal: CaptureProposal;
  questions: CaptureQuestion[];
  plan: ChangePlan;
  confirmable: boolean;
  denied: string | null;
  timeZone: string;
};

function hitFromEnd(end: {
  entityType: EntityType;
  id: number;
  referenceId: string;
  title: string;
  projectId: number | null;
}): CaptureHit | null {
  if (!LOOKUP_TYPES.has(end.entityType as CaptureLookupType)) return null;
  const parsed = parseEntityRefToken(end.referenceId, end.entityType);
  if (parsed.number == null) return null;
  return {
    entityType: end.entityType as CaptureLookupType,
    id: end.id,
    number: parsed.number,
    title: end.title,
    projectId: end.projectId,
  };
}

async function visibleHit(
  db: Db,
  actor: LinkActor,
  entityType: "project" | "todo_list",
  entityId: number,
): Promise<CaptureHit | null> {
  const ends = await loadVisibleEnds(db, [{ entityType, id: entityId }], actor);
  const end = ends.get(entityEndKey(entityType, entityId));
  return end ? hitFromEnd(end) : null;
}

export function captureMessages(args: {
  prompt: string;
  text: string;
  now: Date;
  timeZone: string;
  contextText: string | null;
}): AiChatMessage[] {
  const today = civilDate(args.now, args.timeZone);
  const messages: AiChatMessage[] = [
    {
      role: "system",
      content: `${args.prompt}\n\nToday is ${formatIso(today)} in ${args.timeZone}. Return JSON only.`,
    },
  ];
  if (args.contextText?.trim()) {
    messages.push({ role: "system", content: args.contextText });
  }
  messages.push({
    role: "user",
    content: wrapUntrusted(redactSecrets(args.text.trim()).slice(0, 2_000), "capture"),
  });
  return messages;
}

export async function runCaptureModel(args: {
  plugin: AiProviderPlugin;
  apiKey: string | null;
  config: unknown;
  model: string;
  messages: AiChatMessage[];
  assertBaseUrl: (url: string) => Promise<string>;
  signal?: AbortSignal;
}): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;
  for await (const event of args.plugin.streamChat(
    {
      config: args.config,
      apiKey: args.apiKey,
      assertBaseUrl: args.assertBaseUrl,
    },
    { messages: args.messages, model: args.model, signal: args.signal },
  )) {
    if (event.type === "delta") text += event.text;
    if (event.type === "usage") {
      tokensIn = event.usage.inputTokens;
      tokensOut = event.usage.outputTokens;
    }
  }
  return { text, tokensIn, tokensOut };
}

function finish(
  resolved: ResolvedCapture,
  actorUserId: number,
  permission: Awaited<ReturnType<typeof loadActorAiPermission>>,
  accessFor: (projectId: number) => "full" | "read_only" | "excluded" | null,
  timeZone: string,
): CaptureResult {
  const operations = captureOperations(resolved.proposal, actorUserId);
  const plan = classifyChangePlan(operations, permission.settings);
  let denied: string | null = null;
  for (const operation of operations) {
    const projectId = operation.projectId ?? null;
    const input: PolicyCheckInput = {
      action: operation.action as PolicyCheckInput["action"],
      entityType: (operation.entityType ?? null) as PolicyCheckInput["entityType"],
      entityId: operation.entityId ?? null,
      projectId,
      actorUserId,
      fields: operation.fields ?? null,
      feature: "capture",
      userOff: permission.off,
      projectAiAccess: projectId == null ? null : accessFor(projectId),
    };
    const decision = check(input, undefined, permission.settings);
    if (decision.decision === "deny") {
      denied = decision.reason;
      break;
    }
  }
  return {
    proposal: resolved.proposal,
    questions: resolved.questions,
    plan,
    confirmable: resolved.confirmable && denied == null,
    denied,
    timeZone,
  };
}

export async function proposeCapture(
  db: Db,
  args: {
    actorUserId: number;
    text: string;
    projectId?: number;
    todoListId?: number;
    timeZone?: string;
    now?: Date;
    signal?: AbortSignal;
    auditSink?: AiAuditSink;
    /** Test seam. Production calls the routed provider. */
    complete?: (
      messages: AiChatMessage[],
    ) => Promise<{ text: string; tokensIn: number; tokensOut: number; costMicrousd?: number }>;
    lookup?: CaptureLookup;
    projectById?: (projectId: number) => CaptureHit | null;
    accessFor?: (projectId: number) => "full" | "read_only" | "excluded" | null;
  },
): Promise<CaptureResult> {
  const now = args.now ?? new Date();
  const timeZone = args.timeZone && isValidTimeZone(args.timeZone) ? args.timeZone : "UTC";
  const isAdmin = await userHasAdministrator(db, args.actorUserId);
  const actor: LinkActor & ReferenceActor = { userId: args.actorUserId, isAdministrator: isAdmin };
  const permission = await loadActorAiPermission(db, args.actorUserId);
  if (permission.policy.featuresOff.includes("capture")) {
    throw new CaptureError(403, "feature_off", "Capture is turned off.");
  }

  const pageProject = args.projectId
    ? await visibleHit(db, actor, "project", args.projectId)
    : null;
  if (args.projectId && !pageProject) {
    throw new CaptureError(404, "not_found", "Project not found");
  }
  const pageList = args.todoListId ? await visibleHit(db, actor, "todo_list", args.todoListId) : null;
  if (args.todoListId && !pageList) {
    throw new CaptureError(404, "not_found", "List not found");
  }
  if (pageProject && pageList?.projectId != null && pageList.projectId !== pageProject.id) {
    throw new CaptureError(400, "validation_error", "That list is not in the selected project.");
  }

  const focusProjectId = pageProject?.id ?? pageList?.projectId ?? null;
  let localOnly = false;
  if (focusProjectId != null) {
    const access = await resolveEffectiveAiAccess(db, focusProjectId);
    if (access === "excluded") {
      throw new CaptureError(403, "project_excluded", "Project is excluded from AI");
    }
    if (access === "read_only") {
      throw new CaptureError(403, "project_read_only", "Project is read-only for AI");
    }
    localOnly = (await resolveEffectiveLocalOnly(db, focusProjectId)) === true;
  }

  let contextText: string | null = null;
  const focus = pageList ?? pageProject;
  if (focus) {
    const packet = await assembleContext({
      actorId: args.actorUserId,
      feature: "capture",
      entityType: focus.entityType,
      entityId: focus.id,
      query: args.text,
      budgetTokens: 2_000,
    });
    if (packet.blocked === "project_excluded") {
      throw new CaptureError(403, "project_excluded", "Project is excluded from AI");
    }
    contextText = packet.text;
  }

  const prompt = loadPrompt({ id: "capture" });
  const messages = captureMessages({
    prompt: prompt.body,
    text: args.text,
    now,
    timeZone,
    contextText,
  });

  const accessCache = new Map<number, "full" | "read_only" | "excluded" | null>();
  const accessFor =
    args.accessFor ??
    ((projectId: number) => {
      const cached = accessCache.get(projectId);
      return cached === undefined ? null : cached;
    });

  async function rememberAccess(projectId: number): Promise<void> {
    if (args.accessFor || accessCache.has(projectId)) return;
    accessCache.set(projectId, await resolveEffectiveAiAccess(db, projectId));
  }

  const complete =
    args.complete ??
    (await providerComplete(db, args.actorUserId, localOnly, args.signal, args.auditSink));
  let reply: { text: string; tokensIn: number; tokensOut: number; costMicrousd?: number };
  try {
    reply = await complete(messages);
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    throw err;
  }

  let extraction;
  try {
    extraction = parseCaptureExtraction(reply.text);
  } catch (err) {
    if (err instanceof CaptureParseError) {
      await writeAiAudit(
        {
          userId: args.actorUserId,
          feature: "capture",
          action: "respond",
          decision: "deny",
          reason: err.code,
          tier: 0,
          promptId: prompt.id,
          promptVersion: prompt.version,
          promptRef: prompt.ref,
          tokensIn: reply.tokensIn,
          tokensOut: reply.tokensOut,
        },
        args.auditSink,
      );
      throw new CaptureError(502, err.code, err.message);
    }
    throw err;
  }

  const phrases = [extraction.project, extraction.list, extraction.parent, ...extraction.links].filter(
    (phrase): phrase is string => Boolean(phrase?.trim()),
  );
  const lookedUp = new Map<string, CaptureHit[]>();
  for (const phrase of phrases) {
    lookedUp.set(phrase, args.lookup ? args.lookup(phrase) : await loadPhrase(db, actor, phrase, rememberAccess));
  }
  const projectsById = new Map<number, CaptureHit>();
  for (const hits of lookedUp.values()) {
    for (const hit of hits) {
      if (hit.entityType === "project") projectsById.set(hit.id, hit);
    }
  }
  for (const hits of lookedUp.values()) {
    for (const hit of hits) {
      if (hit.entityType !== "todo_list" || hit.projectId == null || projectsById.has(hit.projectId)) continue;
      const project = await visibleHit(db, actor, "project", hit.projectId);
      if (!project) continue;
      await rememberAccess(project.id);
      const access = args.accessFor ? args.accessFor(project.id) : accessCache.get(project.id);
      if (access === "excluded") continue;
      projectsById.set(project.id, project);
    }
  }
  const resolved = resolveCapture({
    text: args.text,
    extraction,
    now,
    timeZone,
    pageProject,
    pageList,
    lookup: (phrase) => lookedUp.get(phrase) ?? [],
    projectById: args.projectById ?? ((projectId) => projectsById.get(projectId) ?? null),
  } satisfies ResolveCaptureInput);

  const projectIds = [
    resolved.proposal.project?.id,
    resolved.proposal.list?.projectId,
    resolved.proposal.parent?.projectId,
    ...resolved.proposal.links.map((link) => link.projectId),
  ].filter((id): id is number => typeof id === "number");
  for (const projectId of projectIds) await rememberAccess(projectId);

  const result = finish(resolved, args.actorUserId, permission, accessFor, timeZone);
  await writeAiAudit(
    {
      userId: args.actorUserId,
      feature: "capture",
      action: "respond",
      decision: result.denied ? "deny" : "allow",
      reason: result.denied,
      tier: result.plan.tier,
      entityType: result.proposal.recordType,
      projectId: result.proposal.project?.id ?? null,
      promptId: prompt.id,
      promptVersion: prompt.version,
      promptRef: prompt.ref,
      tokensIn: reply.tokensIn,
      tokensOut: reply.tokensOut,
      costMicrousd: reply.costMicrousd ?? null,
    },
    args.auditSink,
  );
  return result;
}

async function loadPhrase(
  db: Db,
  actor: ReferenceActor,
  phrase: string,
  rememberAccess: (projectId: number) => Promise<void>,
): Promise<CaptureHit[]> {
  const parsed = parseEntityRefToken(phrase);
  const types: CaptureLookupType[] = parsed.entityType && LOOKUP_TYPES.has(parsed.entityType as CaptureLookupType)
    ? [parsed.entityType as CaptureLookupType]
    : ["project", "todo_list", "task", "todo", "idea", "document"];
  const hits: CaptureHit[] = [];
  for (const entityType of types) {
    const rows = await searchEntityReferences(db, entityType, phrase, actor, { limit: 8 });
    for (const row of rows) {
      if (row.entityType === "user") continue;
      if (row.projectId != null) {
        await rememberAccess(row.projectId);
        const access = await resolveEffectiveAiAccess(db, row.projectId);
        if (access === "excluded") continue;
      }
      hits.push({
        entityType: row.entityType as CaptureLookupType,
        id: row.id,
        number: row.number,
        title: row.title,
        projectId: row.projectId,
      });
    }
  }
  return hits;
}

async function providerComplete(
  db: Db,
  actorUserId: number,
  localOnly: boolean,
  signal: AbortSignal | undefined,
  auditSink: AiAuditSink | undefined,
): Promise<(messages: AiChatMessage[]) => Promise<{ text: string; tokensIn: number; tokensOut: number; costMicrousd?: number }>> {
  const props = await getSystemProperties(db);
  const totals = await sumDayUsage(db, { userId: actorUserId });
  const route = await resolveFeatureRoute(db, { userId: actorUserId, feature: "capture", localOnly });
  if (route.attempts.length === 0) {
    const resolved = await loadResolvedKeys(db, actorUserId);
    throw new CaptureError(503, "assistant_unconfigured", assistantUnconfiguredMessage(resolved.mode));
  }
  await auditRouteSkips(route.skipped, { userId: actorUserId, feature: "capture", sink: auditSink });
  const blocked = pluginBudgetReason(props.aiBudgets, totals, route.attempts[0]?.keySource ?? null);
  if (blocked) {
    const meter: AiUsageMeter = {
      keySource: route.attempts[0]?.keySource ?? null,
      usdPerMillionTokens: props.aiInstanceUsdPerMillionTokens,
      limits: props.aiBudgets,
      totals,
      feature: "capture",
      provider: route.attempts[0]?.pluginId ?? null,
      model: route.attempts[0]?.model ?? null,
      userId: actorUserId,
      auditSink,
    };
    await recordUsageDenial(meter, blocked);
    throw new CaptureError(429, blocked, "You have reached the AI usage budget.");
  }
  return async (messages) =>
    followRouteAttempts({
      attempts: route.attempts,
      onDeny: async (attempt, code) => {
        await writeAiAudit(
          {
            userId: actorUserId,
            feature: "capture",
            provider: attempt.pluginId,
            model: attempt.model,
            action: "route",
            decision: "deny",
            reason: code,
            tier: 0,
          },
          auditSink,
        );
      },
      call: async (attempt: ResolvedAttempt) => {
        try {
          const reply = await runCaptureModel({
            plugin: attempt.plugin,
            apiKey: attempt.apiKey,
            config: attempt.config,
            model: attempt.model,
            messages,
            signal,
            assertBaseUrl: attempt.plugin.capabilities.local
              ? assertLocalProviderBaseUrl
              : assertPublicProviderBaseUrl,
          });
          const meter: AiUsageMeter = {
            keySource: attempt.keySource,
            usdPerMillionTokens: props.aiInstanceUsdPerMillionTokens,
            limits: props.aiBudgets,
            totals,
            feature: "capture",
            provider: attempt.pluginId,
            model: attempt.model,
            userId: actorUserId,
            auditSink,
          };
          const costMicrousd = noteAllowUsage(meter, reply.tokensIn, reply.tokensOut);
          await noteStoredKeyUse(db, {
            userId: actorUserId,
            pluginId: attempt.pluginId,
            storedKey: attempt.storedKey,
            apiKey: attempt.apiKey,
            outcome: "ok",
            message: "",
          });
          return { ...reply, costMicrousd };
        } catch (err) {
          if (err instanceof AiProviderError && err.code === "auth") {
            await noteStoredKeyUse(db, {
              userId: actorUserId,
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
