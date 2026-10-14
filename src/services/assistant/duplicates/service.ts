import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AiChatMessage } from "@taskmesh/ai-provider-contract";
import * as schema from "../../../db/schema.js";
import { formatEntityRef } from "../../../lib/entityRef.js";
import type { EntityType } from "../../../lib/entityType.js";
import { contentHash } from "../../knowledge/chunk.js";
import { semanticEntityScores } from "../../knowledge/search.js";
import { createManualLink, type LinkActor } from "../../entityLinks.js";
import { hrefFor } from "../../references.js";
import { dualScopeListFilter } from "../../ownership.js";
import { userHasAdministrator } from "../../roles.js";
import { writeAiAudit } from "../aiAudit.js";
import { pluginBudgetReason, noteAllowUsage, recordUsageDenial, sumDayUsage, type AiUsageMeter } from "../aiBudgets.js";
import { noteStoredKeyUse } from "../aiCredentialHealth.js";
import { followRouteAttempts } from "../aiFeatureRoutes.js";
import { redactSecrets } from "../aiMinimize.js";
import { auditRouteSkips, resolveFeatureRoute, type ResolvedAttempt } from "../aiRouting.js";
import { loadActorAiPermission } from "../aiUserPolicy.js";
import { loadPrompt } from "../promptRegistry.js";
import { effectiveAiAccess, getAiProjectAccessCeiling, resolveEffectiveLocalOnly } from "../projectAiAccess.js";
import { assertLocalProviderBaseUrl, assertPublicProviderBaseUrl } from "../providerBaseUrl.js";
import { getSystemProperties } from "../../systemProperties.js";
import { runCaptureModel } from "../capture/service.js";
import { wrapUntrusted } from "../untrustedContent.js";
import {
  applyModelAnswer,
  canonicalEnds,
  isDuplicateEntityType,
  pairKey,
  planDuplicateHits,
  type DuplicateEnd,
  type DuplicateEntityType,
  type PlannedDuplicate,
  type TitleCandidate,
} from "./match.js";
import { parseDuplicateAnswer } from "./parse.js";

type Db = NodePgDatabase<typeof schema>;

export class DuplicateActionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "DuplicateActionError";
    this.status = status;
    this.code = code;
  }
}

export type DuplicateHit = {
  entityType: DuplicateEntityType;
  entityId: number;
  referenceId: string;
  title: string;
  href: string;
  score: number;
  reason: string;
};

type VisibleRecord = {
  entityType: DuplicateEntityType;
  entityId: number;
  number: number;
  title: string;
  projectId: number | null;
  ownerId: number;
};

const CLOSED = new Set(["deleted"]);

export async function checkDraftDuplicates(
  db: Db,
  actorId: number,
  entityType: DuplicateEntityType,
  title: string,
  excludeId: number | null,
  projectId: number | null,
): Promise<DuplicateHit[]> {
  if (await featureOff(db, actorId)) return [];
  const subject = excludeId != null ? { entityType, entityId: excludeId } : null;
  const visible = await loadVisible(db, actorId);
  const blocked = await excludedProjects(db);
  const subjectBlocked = projectId != null && blocked.has(projectId);
  const semantic = subjectBlocked ? new Map<string, number>() : await semanticEntityScores({
    actorId,
    isAdmin: await userHasAdministrator(db, actorId),
    text: title,
    entityTypes: ["task", "todo"],
    exclude: subject ?? undefined,
  });
  const suppressed = subject ? await suppressedKeys(db, actorId, subject) : new Set<string>();
  const hits = planDuplicateHits({
    subject,
    subjectTitle: title,
    candidates: toCandidates(visible, blocked, semantic),
    suppressedKeys: suppressed,
    subjectBlocked,
  });
  const views = hits.flatMap((hit) => {
    const view = toHit(visible, hit);
    return view ? [view] : [];
  });
  for (const view of views) {
    const row = visible.find((item) => item.entityType === view.entityType && item.entityId === view.entityId);
    if (row) view.href = await duplicateHref(db, actorId, row);
  }
  return views;
}

export async function listPendingDuplicates(
  db: Db,
  actorId: number,
  entityType: DuplicateEntityType,
  entityId: number,
): Promise<DuplicateHit[]> {
  const visible = await loadVisible(db, actorId);
  const known = new Map(visible.map((row) => [`${row.entityType}:${row.entityId}`, row]));
  if (!known.has(`${entityType}:${entityId}`)) return [];
  const rows = await db
    .select()
    .from(schema.aiDuplicatePairs)
    .where(
      and(
        eq(schema.aiDuplicatePairs.userId, actorId),
        eq(schema.aiDuplicatePairs.status, "pending"),
        or(
          and(eq(schema.aiDuplicatePairs.aType, entityType), eq(schema.aiDuplicatePairs.aId, entityId)),
          and(eq(schema.aiDuplicatePairs.bType, entityType), eq(schema.aiDuplicatePairs.bId, entityId)),
        ),
      ),
    );
  const hits: DuplicateHit[] = [];
  for (const row of rows) {
    const other = otherEnd(row, { entityType, entityId });
    const match = known.get(`${other.entityType}:${other.entityId}`);
    if (!match) continue;
  const view = toHit(visible, {
      entityType: match.entityType,
      entityId: match.entityId,
      score: row.score,
      reason: row.reason as PlannedDuplicate["reason"],
      needsModel: false,
    });
    if (!view) continue;
    view.href = await duplicateHref(db, actorId, match);
    hits.push(view);
  }
  return hits;
}

export async function ignoreDuplicatePair(
  db: Db,
  actorId: number,
  subject: DuplicateEnd,
  match: DuplicateEnd,
): Promise<void> {
  await assertPairVisible(db, actorId, subject, match);
  await writePair(db, actorId, subject, match, "ignored", 1, "near_title", contentHash("ignored"));
}

export async function linkDuplicatePair(
  db: Db,
  actorId: number,
  subject: DuplicateEnd,
  match: DuplicateEnd,
): Promise<void> {
  await assertPairVisible(db, actorId, subject, match);
  const [src, dst] = canonicalEnds(subject, match);
  const actor: LinkActor = { userId: actorId, isAdministrator: await userHasAdministrator(db, actorId) };
  await createManualLink(
    db,
    {
      srcType: src.entityType,
      srcId: src.entityId,
      dstType: dst.entityType,
      dstId: dst.entityId,
      relation: "duplicate_of",
      createdById: actorId,
    },
    actor,
  );
  await writePair(db, actorId, subject, match, "linked", 1, "near_title", contentHash("linked"));
}

export async function runDuplicateCheck(db: Db, entityType: string, entityId: number): Promise<void> {
  if (!isDuplicateEntityType(entityType)) return;
  const subject = await loadOwned(db, entityType, entityId);
  if (!subject || CLOSED.has(subject.state)) return;
  if (await featureOff(db, subject.ownerId)) {
    await clearPending(db, subject.ownerId, subject);
    return;
  }
  const visible = await loadVisible(db, subject.ownerId);
  await checkOne(db, subject.ownerId, subject, visible);
}

export async function sweepDuplicateChecks(db: Db): Promise<void> {
  const owners = await db.execute<{ id: number }>(sql`
    SELECT owner_id AS id FROM tasks WHERE state <> 'deleted'
    UNION
    SELECT owner_id AS id FROM todos WHERE state <> 'deleted'
  `);
  for (const row of owners.rows) {
    const ownerId = Number(row.id);
    if (!Number.isInteger(ownerId) || ownerId <= 0) continue;
    if (await featureOff(db, ownerId)) {
      await db
        .delete(schema.aiDuplicatePairs)
        .where(and(eq(schema.aiDuplicatePairs.userId, ownerId), eq(schema.aiDuplicatePairs.status, "pending")));
      continue;
    }
    const visible = await loadVisible(db, ownerId);
    const subjects = visible.filter((record) => record.ownerId === ownerId);
    for (const subject of subjects) {
      const full = await loadOwned(db, subject.entityType, subject.entityId);
      if (!full) continue;
      await checkOne(db, ownerId, full, visible);
    }
  }
}

type OwnedRecord = VisibleRecord & { state: string; description: string | null };

async function checkOne(db: Db, ownerId: number, subject: OwnedRecord, visible: VisibleRecord[]): Promise<void> {
  const blocked = await excludedProjects(db);
  const subjectBlocked = subject.projectId != null && blocked.has(subject.projectId);
  const isAdmin = await userHasAdministrator(db, ownerId);
  const semantic = subjectBlocked
    ? new Map<string, number>()
    : await semanticEntityScores({
        actorId: ownerId,
        isAdmin,
        text: excerpt(subject.title, subject.description),
        entityTypes: ["task", "todo"],
        exclude: { entityType: subject.entityType, entityId: subject.entityId },
      });
  const suppressed = await suppressedKeys(db, ownerId, subject);
  const planned = planDuplicateHits({
    subject,
    subjectTitle: subject.title,
    candidates: toCandidates(visible, blocked, semantic),
    suppressedKeys: suppressed,
    subjectBlocked,
  });
  const kept: PlannedDuplicate[] = [];
  for (const hit of planned) {
    const match = visible.find((row) => row.entityType === hit.entityType && row.entityId === hit.entityId);
    if (!hit.needsModel) {
      kept.push(hit);
      continue;
    }
    const answer = match ? await confirmWithModel(db, ownerId, subject, match) : null;
    const next = applyModelAnswer(hit, answer);
    if (next) kept.push(next);
    else {
      await writePair(
        db,
        ownerId,
        subject,
        hit,
        "rejected",
        hit.score,
        hit.reason,
        pairHash(subject.title, match?.title ?? ""),
      );
    }
  }
  await replacePending(db, ownerId, subject, kept, visible);
}

async function confirmWithModel(
  db: Db,
  userId: number,
  subject: OwnedRecord,
  match: VisibleRecord,
): Promise<{ duplicate: boolean; confidence: number } | null> {
  try {
    const localOnly =
      subject.projectId == null ? false : (await resolveEffectiveLocalOnly(db, subject.projectId)) === true;
    const props = await getSystemProperties(db);
    const totals = await sumDayUsage(db, { userId });
    const route = await resolveFeatureRoute(db, { userId, feature: "duplicates", localOnly });
    await auditRouteSkips(route.skipped, { userId, feature: "duplicates" });
    const attempt = route.attempts[0];
    if (!attempt) return null;
    const blocked = pluginBudgetReason(props.aiBudgets, totals, attempt.keySource);
    if (blocked) {
      await recordUsageDenial(
        {
          keySource: attempt.keySource,
          usdPerMillionTokens: props.aiInstanceUsdPerMillionTokens,
          limits: props.aiBudgets,
          totals,
          feature: "duplicates",
          provider: attempt.pluginId,
          model: attempt.model,
          userId,
        },
        blocked,
      );
      return null;
    }
    const prompt = loadPrompt({ id: "duplicates", providerId: attempt.pluginId });
    const matchOwned = await loadOwned(db, match.entityType, match.entityId);
    const messages: AiChatMessage[] = [
      { role: "system", content: `${prompt.body}\n\nReturn JSON only.` },
      {
        role: "user",
        content: [
          wrapUntrusted(redactSecrets(excerpt(subject.title, subject.description)), "duplicates"),
          wrapUntrusted(redactSecrets(excerpt(match.title, matchOwned?.description ?? null)), "duplicates"),
        ].join("\n"),
      },
    ];
    const reply = await followRouteAttempts({
      attempts: route.attempts,
      onDeny: async (skipped, code) => {
        await writeAiAudit({
          userId,
          feature: "duplicates",
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
          messages,
          assertBaseUrl: chosen.plugin.capabilities.local ? assertLocalProviderBaseUrl : assertPublicProviderBaseUrl,
        });
        const meter: AiUsageMeter = {
          keySource: chosen.keySource,
          usdPerMillionTokens: props.aiInstanceUsdPerMillionTokens,
          limits: props.aiBudgets,
          totals,
          feature: "duplicates",
          provider: chosen.pluginId,
          model: chosen.model,
          userId,
        };
        noteAllowUsage(meter, result.tokensIn, result.tokensOut);
        await noteStoredKeyUse(db, {
          userId,
          pluginId: chosen.pluginId,
          storedKey: chosen.storedKey,
          apiKey: chosen.apiKey,
          outcome: "ok",
          message: "",
        });
        return { ...result, pluginId: chosen.pluginId, model: chosen.model };
      },
    });
    const answer = parseDuplicateAnswer(reply.text);
    await writeAiAudit({
      userId,
      feature: "duplicates",
      provider: reply.pluginId,
      model: reply.model,
      action: "respond",
      decision: answer ? "allow" : "deny",
      reason: answer ? "duplicate check" : "invalid model output",
      tier: 0,
      tokensIn: reply.tokensIn,
      tokensOut: reply.tokensOut,
      promptId: prompt.id,
      promptVersion: prompt.version,
      promptRef: prompt.ref,
    });
    return answer;
  } catch (err) {
    console.error("[duplicates] model confirmation failed", err);
    return null;
  }
}

async function replacePending(
  db: Db,
  userId: number,
  subject: OwnedRecord,
  hits: PlannedDuplicate[],
  visible: VisibleRecord[],
): Promise<void> {
  const keep = new Set(hits.map((hit) => pairKey(subject, hit)));
  for (const hit of hits) {
    const match = visible.find((row) => row.entityType === hit.entityType && row.entityId === hit.entityId);
    await writePair(
      db,
      userId,
      subject,
      hit,
      "pending",
      hit.score,
      hit.reason,
      pairHash(subject.title, match?.title ?? ""),
    );
  }
  const rows = await db
    .select()
    .from(schema.aiDuplicatePairs)
    .where(
      and(
        eq(schema.aiDuplicatePairs.userId, userId),
        eq(schema.aiDuplicatePairs.status, "pending"),
        or(
          and(eq(schema.aiDuplicatePairs.aType, subject.entityType), eq(schema.aiDuplicatePairs.aId, subject.entityId)),
          and(eq(schema.aiDuplicatePairs.bType, subject.entityType), eq(schema.aiDuplicatePairs.bId, subject.entityId)),
        ),
      ),
    );
  const stale = rows.filter((row) => !keep.has(pairKey(endOf(row, "a"), endOf(row, "b"))));
  if (stale.length > 0) {
    await db.delete(schema.aiDuplicatePairs).where(inArray(schema.aiDuplicatePairs.id, stale.map((row) => row.id)));
  }
}

async function writePair(
  db: Db,
  userId: number,
  subject: DuplicateEnd,
  match: DuplicateEnd,
  status: "pending" | "linked" | "ignored" | "rejected",
  score: number,
  reason: PlannedDuplicate["reason"],
  hash: string,
): Promise<void> {
  const [a, b] = canonicalEnds(subject, match);
  const locked = status === "pending" || status === "rejected";
  await db
    .insert(schema.aiDuplicatePairs)
    .values({
      userId,
      aType: a.entityType,
      aId: a.entityId,
      bType: b.entityType,
      bId: b.entityId,
      score,
      reason,
      status,
      contentHash: hash,
    })
    .onConflictDoUpdate({
      target: [
        schema.aiDuplicatePairs.userId,
        schema.aiDuplicatePairs.aType,
        schema.aiDuplicatePairs.aId,
        schema.aiDuplicatePairs.bType,
        schema.aiDuplicatePairs.bId,
      ],
      set: { score, reason, status, contentHash: hash },
      setWhere: locked ? sql`${schema.aiDuplicatePairs.status} not in ('linked', 'ignored')` : undefined,
    });
}

async function clearPending(db: Db, userId: number, subject: DuplicateEnd): Promise<void> {
  await db
    .delete(schema.aiDuplicatePairs)
    .where(
      and(
        eq(schema.aiDuplicatePairs.userId, userId),
        eq(schema.aiDuplicatePairs.status, "pending"),
        or(
          and(eq(schema.aiDuplicatePairs.aType, subject.entityType), eq(schema.aiDuplicatePairs.aId, subject.entityId)),
          and(eq(schema.aiDuplicatePairs.bType, subject.entityType), eq(schema.aiDuplicatePairs.bId, subject.entityId)),
        ),
      ),
    );
}

async function featureOff(db: Db, userId: number): Promise<boolean> {
  const permission = await loadActorAiPermission(db, userId);
  return permission.policy.featuresOff.includes("duplicates");
}

async function loadVisible(db: Db, actorId: number): Promise<VisibleRecord[]> {
  const isAdmin = await userHasAdministrator(db, actorId);
  const taskScope =
    dualScopeListFilter(db, schema.tasks.projectId, schema.tasks.ownerId, actorId, isAdmin) ?? sql`true`;
  const todoScope =
    dualScopeListFilter(db, schema.todos.projectId, schema.todos.ownerId, actorId, isAdmin) ?? sql`true`;
  const tasks = await db
    .select({
      id: schema.tasks.id,
      number: schema.tasks.number,
      title: schema.tasks.title,
      projectId: schema.tasks.projectId,
      ownerId: schema.tasks.ownerId,
    })
    .from(schema.tasks)
    .where(and(ne(schema.tasks.state, "deleted"), taskScope));
  const todos = await db
    .select({
      id: schema.todos.id,
      number: schema.todos.number,
      title: schema.todos.title,
      projectId: schema.todos.projectId,
      ownerId: schema.todos.ownerId,
    })
    .from(schema.todos)
    .where(and(ne(schema.todos.state, "deleted"), todoScope));
  return [
    ...tasks.map((row) => ({
      entityType: "task" as const,
      entityId: row.id,
      number: row.number,
      title: row.title,
      projectId: row.projectId,
      ownerId: row.ownerId,
    })),
    ...todos.map((row) => ({
      entityType: "todo" as const,
      entityId: row.id,
      number: row.number,
      title: row.title,
      projectId: row.projectId,
      ownerId: row.ownerId,
    })),
  ];
}

async function loadOwned(db: Db, entityType: DuplicateEntityType, entityId: number): Promise<OwnedRecord | null> {
  if (entityType === "task") {
    const [row] = await db
      .select({
        id: schema.tasks.id,
        number: schema.tasks.number,
        title: schema.tasks.title,
        description: schema.tasks.description,
        projectId: schema.tasks.projectId,
        ownerId: schema.tasks.ownerId,
        state: schema.tasks.state,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, entityId));
    if (!row) return null;
    return { entityType, entityId: row.id, number: row.number, title: row.title, description: row.description, projectId: row.projectId, ownerId: row.ownerId, state: row.state };
  }
  const [row] = await db
    .select({
      id: schema.todos.id,
      number: schema.todos.number,
      title: schema.todos.title,
      description: schema.todos.description,
      projectId: schema.todos.projectId,
      ownerId: schema.todos.ownerId,
      state: schema.todos.state,
    })
    .from(schema.todos)
    .where(eq(schema.todos.id, entityId));
  if (!row) return null;
  return { entityType, entityId: row.id, number: row.number, title: row.title, description: row.description, projectId: row.projectId, ownerId: row.ownerId, state: row.state };
}

async function excludedProjects(db: Db): Promise<Set<number>> {
  const ceiling = await getAiProjectAccessCeiling(db);
  const rows = await db.select({ id: schema.projects.id, aiAccess: schema.projects.aiAccess }).from(schema.projects);
  const ids = new Set<number>();
  for (const row of rows) {
    const stored = row.aiAccess === "read_only" || row.aiAccess === "excluded" || row.aiAccess === "full" ? row.aiAccess : "full";
    if (effectiveAiAccess(stored, ceiling) === "excluded") ids.add(row.id);
  }
  return ids;
}

async function suppressedKeys(db: Db, userId: number, subject: DuplicateEnd): Promise<Set<string>> {
  const rows = await db
    .select({
      aType: schema.aiDuplicatePairs.aType,
      aId: schema.aiDuplicatePairs.aId,
      bType: schema.aiDuplicatePairs.bType,
      bId: schema.aiDuplicatePairs.bId,
    })
    .from(schema.aiDuplicatePairs)
    .where(
      and(
        eq(schema.aiDuplicatePairs.userId, userId),
        inArray(schema.aiDuplicatePairs.status, ["ignored", "linked", "rejected"]),
        or(
          and(eq(schema.aiDuplicatePairs.aType, subject.entityType), eq(schema.aiDuplicatePairs.aId, subject.entityId)),
          and(eq(schema.aiDuplicatePairs.bType, subject.entityType), eq(schema.aiDuplicatePairs.bId, subject.entityId)),
        ),
      ),
    );
  return new Set(rows.flatMap((row) => {
    if (!isDuplicateEntityType(row.aType) || !isDuplicateEntityType(row.bType)) return [];
    return [pairKey({ entityType: row.aType, entityId: row.aId }, { entityType: row.bType, entityId: row.bId })];
  }));
}

async function assertPairVisible(db: Db, actorId: number, subject: DuplicateEnd, match: DuplicateEnd): Promise<void> {
  if (subject.entityType === match.entityType && subject.entityId === match.entityId) {
    throw new DuplicateActionError(400, "validation_error", "A record cannot be a duplicate of itself.");
  }
  const visible = await loadVisible(db, actorId);
  const keys = new Set(visible.map((row) => `${row.entityType}:${row.entityId}`));
  if (!keys.has(`${subject.entityType}:${subject.entityId}`) || !keys.has(`${match.entityType}:${match.entityId}`)) {
    throw new DuplicateActionError(404, "not_found", "That record is not available.");
  }
}

function toCandidates(
  visible: VisibleRecord[],
  blocked: Set<number>,
  semantic: Map<string, number>,
): TitleCandidate[] {
  return visible.map((row) => ({
    entityType: row.entityType,
    entityId: row.entityId,
    title: row.title,
    semantic: semantic.get(`${row.entityType}:${row.entityId}`) ?? null,
    modelBlocked: row.projectId != null && blocked.has(row.projectId),
  }));
}

async function duplicateHref(db: Db, actorId: number, row: VisibleRecord): Promise<string> {
  if (row.entityType === "task") return hrefFor("task", row.entityId, row.projectId);
  const [item] = await db
    .select({
      listId: schema.todoListItems.listId,
      projectId: schema.todoLists.projectId,
    })
    .from(schema.todoListItems)
    .innerJoin(schema.todoLists, eq(schema.todoLists.id, schema.todoListItems.listId))
    .where(and(eq(schema.todoListItems.entityType, "todo"), eq(schema.todoListItems.entityId, row.entityId)))
    .limit(1);
  if (item?.projectId != null) {
    return `/projects/${item.projectId}?tab=todo_lists&list=${item.listId}&todo=${row.entityId}`;
  }
  if (item) return `/todos/${item.listId}?todo=${row.entityId}`;
  const [inbox] = await db
    .select({ id: schema.todoLists.id })
    .from(schema.todoLists)
    .where(
      and(
        eq(schema.todoLists.kind, "inbox"),
        eq(schema.todoLists.ownerId, actorId),
        isNull(schema.todoLists.projectId),
      ),
    )
    .limit(1);
  if (inbox) return `/todos/${inbox.id}?todo=${row.entityId}`;
  return "/todos";
}

function toHit(visible: VisibleRecord[], hit: PlannedDuplicate): DuplicateHit | null {
  const row = visible.find((item) => item.entityType === hit.entityType && item.entityId === hit.entityId);
  if (!row) return null;
  return {
    entityType: row.entityType,
    entityId: row.entityId,
    referenceId: formatEntityRef(row.entityType, row.number),
    title: row.title,
    href: hrefFor(row.entityType as EntityType, row.entityId, row.projectId),
    score: hit.score,
    reason: hit.reason,
  };
}

function otherEnd(
  row: { aType: string; aId: number; bType: string; bId: number },
  subject: DuplicateEnd,
): DuplicateEnd {
  if (row.aType === subject.entityType && row.aId === subject.entityId) {
    return { entityType: row.bType as DuplicateEntityType, entityId: row.bId };
  }
  return { entityType: row.aType as DuplicateEntityType, entityId: row.aId };
}

function endOf(row: { aType: string; aId: number; bType: string; bId: number }, side: "a" | "b"): DuplicateEnd {
  return side === "a"
    ? { entityType: row.aType as DuplicateEntityType, entityId: row.aId }
    : { entityType: row.bType as DuplicateEntityType, entityId: row.bId };
}

function excerpt(title: string, description: string | null): string {
  const body = (description ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  return body ? `${title}\n${body}` : title;
}

function pairHash(left: string, right: string): string {
  return contentHash(`${left}\n${right}`);
}
