import { z } from "zod";
import { db } from "../../db/client.js";
import type { ActivitySource } from "../../lib/activityRequest.js";
import type { MutationResult } from "../../lib/mutationResult.js";
import { writeAiAudit } from "../../services/assistant/aiAudit.js";
import { check, tierForAction, type PolicyDecision } from "../../services/assistant/aiPolicy.js";
import { attachProjectAiAccess } from "../../services/assistant/projectAiAccess.js";
import { AI_DELETE_DENY_REASON, isAiDeleteProposal } from "../../services/assistant/aiTiers.js";
import { createDocumentForActor, updateDocumentForActor } from "./documents.js";
import { createIdeaForActor, updateIdeaForActor } from "./ideas.js";
import { createProjectTask, patchProjectTask } from "./tasks.js";

const proposalBody = z.object({
  id: z.string().max(80).optional(),
  action: z.enum(["create", "update"]),
  entityType: z.enum(["idea", "document", "task"]),
  entityId: z.number().int().positive().optional(),
  projectId: z.number().int().positive().optional(),
  summary: z.string().max(500).optional(),
  fields: z.record(z.string(), z.unknown()),
  method: z.enum(["POST", "PATCH"]),
  path: z.string().min(1).max(500),
});

export type AssistantProposalInput = z.infer<typeof proposalBody>;

export type ApplyOutcome =
  | { kind: "denied"; decision: PolicyDecision }
  | { kind: "result"; result: MutationResult };

type ApplyTarget =
  | { kind: "idea-create" }
  | { kind: "idea-update"; id: number }
  | { kind: "document-create"; projectId: number }
  | { kind: "document-update"; projectId: number; docId: number }
  | { kind: "task-create"; projectId: number }
  | { kind: "task-update"; projectId: number; taskId: number };

function oneId(path: string, pattern: RegExp): number | null {
  const match = path.match(pattern);
  const raw = match?.[1];
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

function twoIds(path: string, pattern: RegExp): [number, number] | null {
  const match = path.match(pattern);
  const rawA = match?.[1];
  const rawB = match?.[2];
  if (!rawA || !rawB) return null;
  const a = Number(rawA);
  const b = Number(rawB);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  return [a, b];
}

/** The six paths the assistant tools already emit. Ids must match the proposal. */
export function matchProposalTarget(proposal: AssistantProposalInput): ApplyTarget | null {
  const { method, path, action, entityType, entityId, projectId } = proposal;
  if (action === "create" && method === "POST" && entityType === "idea" && path === "/api/v1/ideas") {
    return { kind: "idea-create" };
  }
  if (action === "update" && method === "PATCH" && entityType === "idea") {
    const id = oneId(path, /^\/api\/v1\/ideas\/(\d+)$/);
    if (id != null && id === entityId) return { kind: "idea-update", id };
  }
  if (action === "create" && method === "POST" && entityType === "document") {
    const id = oneId(path, /^\/api\/v1\/projects\/(\d+)\/documents$/);
    if (id != null && id === projectId) return { kind: "document-create", projectId: id };
  }
  if (action === "update" && method === "PATCH" && entityType === "document") {
    const ids = twoIds(path, /^\/api\/v1\/projects\/(\d+)\/documents\/(\d+)$/);
    if (ids && ids[0] === projectId && ids[1] === entityId) {
      return { kind: "document-update", projectId: ids[0], docId: ids[1] };
    }
  }
  if (action === "create" && method === "POST" && entityType === "task") {
    const id = oneId(path, /^\/api\/v1\/projects\/(\d+)\/tasks$/);
    if (id != null && id === projectId) return { kind: "task-create", projectId: id };
  }
  if (action === "update" && method === "PATCH" && entityType === "task") {
    const ids = twoIds(path, /^\/api\/v1\/projects\/(\d+)\/tasks\/(\d+)$/);
    if (ids && ids[0] === projectId && ids[1] === entityId) {
      return { kind: "task-update", projectId: ids[0], taskId: ids[1] };
    }
  }
  return null;
}

async function runTarget(
  target: ApplyTarget,
  fields: Record<string, unknown>,
  actorId: number,
  source: ActivitySource,
): Promise<MutationResult> {
  switch (target.kind) {
    case "idea-create":
      return createIdeaForActor({ body: fields, actorId });
    case "idea-update":
      return updateIdeaForActor({ id: target.id, body: fields, actorId });
    case "document-create":
      return createDocumentForActor({ projectId: target.projectId, body: fields, actorId });
    case "document-update":
      return updateDocumentForActor({
        projectId: target.projectId,
        docId: target.docId,
        body: fields,
        actorId,
        source,
      });
    case "task-create":
      return createProjectTask({
        projectId: target.projectId,
        body: fields,
        actorId,
        source,
        recordHistory: true,
      });
    case "task-update":
      return patchProjectTask({
        projectId: target.projectId,
        taskId: target.taskId,
        body: fields,
        actorId,
        source,
        recordHistory: true,
      });
  }
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export async function applyAssistantProposal(args: {
  body: unknown;
  actorId: number;
}): Promise<ApplyOutcome> {
  if (isAiDeleteProposal(args.body)) {
    const started = Date.now();
    const rec =
      args.body && typeof args.body === "object" ? (args.body as Record<string, unknown>) : {};
    const denied: PolicyDecision = {
      decision: "deny",
      tier: 3,
      reason: AI_DELETE_DENY_REASON,
    };
    await writeAiAudit({
      userId: args.actorId,
      feature: "assistant",
      tool: null,
      action: "apply",
      entityType: optionalText(rec.entityType),
      entityId: optionalId(rec.entityId),
      projectId: optionalId(rec.projectId),
      decision: "deny",
      reason: denied.reason,
      tier: denied.tier,
      latencyMs: Date.now() - started,
    });
    return { kind: "denied", decision: denied };
  }

  const proposal = proposalBody.parse(args.body);
  const fields = { ...proposal.fields };
  delete fields.tier;
  const declaredTier =
    args.body && typeof args.body === "object" ? (args.body as { tier?: unknown }).tier : undefined;
  const started = Date.now();
  const decision = check(
    await attachProjectAiAccess(db, {
      actorUserId: args.actorId,
      feature: "assistant",
      action: "apply",
      entityType: proposal.entityType,
      entityId: proposal.entityId ?? null,
      projectId: proposal.projectId ?? null,
      fields,
      tier: declaredTier,
    }),
  );

  const auditBase = {
    userId: args.actorId,
    feature: "assistant",
    tool: null,
    action: "apply" as const,
    entityType: proposal.entityType,
    entityId: proposal.entityId ?? null,
    projectId: proposal.projectId ?? null,
    tier: decision.tier,
  };

  if (decision.decision === "deny") {
    await writeAiAudit({
      ...auditBase,
      decision: "deny",
      reason: decision.reason,
      latencyMs: Date.now() - started,
    });
    return { kind: "denied", decision };
  }

  const target = matchProposalTarget(proposal);
  if (!target) {
    const denied: PolicyDecision = {
      decision: "deny",
      tier: tierForAction("apply"),
      reason: "Proposal path is not allowed",
    };
    await writeAiAudit({
      ...auditBase,
      decision: "deny",
      reason: denied.reason,
      tier: denied.tier,
      latencyMs: Date.now() - started,
    });
    return { kind: "denied", decision: denied };
  }

  try {
    const result = await runTarget(target, fields, args.actorId, "ai");
    await writeAiAudit({
      ...auditBase,
      decision: "allow",
      reason: decision.reason,
      latencyMs: Date.now() - started,
    });
    return { kind: "result", result };
  } catch (err) {
    await writeAiAudit({
      ...auditBase,
      decision: "allow",
      reason: decision.reason,
      latencyMs: Date.now() - started,
    });
    throw err;
  }
}
