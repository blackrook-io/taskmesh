import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AiChatMessage } from "@taskmesh/ai-provider-contract";
import * as schema from "../../../db/schema.js";
import type { EntityType } from "../../../lib/entityType.js";
import { isTaggableEntityType, type TaggableEntityType } from "../../entities.js";
import { assertCanAccessTaggableEntity } from "../../ownership.js";
import { userHasAdministrator } from "../../roles.js";
import { contentHash } from "../../knowledge/chunk.js";
import { searchKnowledge } from "../../knowledge/search.js";
import { getSystemProperties } from "../../systemProperties.js";
import { writeAiAudit } from "../aiAudit.js";
import { pluginBudgetReason, noteAllowUsage, recordUsageDenial, sumDayUsage, type AiUsageMeter } from "../aiBudgets.js";
import { recordAiFeedback } from "../aiFeedback.js";
import { auditRouteSkips, resolveFeatureRoute, type ResolvedAttempt } from "../aiRouting.js";
import { followRouteAttempts } from "../aiFeatureRoutes.js";
import { noteStoredKeyUse } from "../aiCredentialHealth.js";
import { check } from "../aiPolicy.js";
import { loadActorAiPermission } from "../aiUserPolicy.js";
import { classifyOperation } from "../aiTiers.js";
import { shouldAutoApplyTier1, insertUndoJournal } from "../aiUndo.js";
import { redactSecrets } from "../aiMinimize.js";
import { loadPrompt } from "../promptRegistry.js";
import { assertLocalProviderBaseUrl, assertPublicProviderBaseUrl } from "../providerBaseUrl.js";
import { resolveEffectiveAiAccess, resolveEffectiveLocalOnly } from "../projectAiAccess.js";
import { runCaptureModel } from "../capture/service.js";
import { wrapUntrusted } from "../untrustedContent.js";
import { isClosedTaskState, TASK_TAG_CAP } from "../../taskWorkflow.js";
import { applyTaskGroupAutoTagsForTask } from "../../taskGroupAutoTag.js";
import {
  MAX_CANDIDATES,
  MAX_SURFACED,
  planTaggingRun,
  type ModelScore,
  type PlannedTag,
} from "./decide.js";
import { parseModelScores } from "./parse.js";

type Db = NodePgDatabase<typeof schema>;

const NEIGHBORS = 12;
const EXCERPT = 1500;

type Subject = {
  ownerId: number;
  projectId: number | null;
  title: string;
  excerpt: string;
  closed: boolean;
};

export async function runAutoTag(db: Db, entityType: string, entityId: number): Promise<void> {
  if (!isTaggableEntityType(entityType) || !Number.isInteger(entityId) || entityId <= 0) return;
  const subject = await loadSubject(db, entityType, entityId);
  if (!subject || subject.closed) return;

  const access =
    subject.projectId == null ? null : await resolveEffectiveAiAccess(db, subject.projectId);
  const permission = await loadActorAiPermission(db, subject.ownerId);
  const featureOff = permission.policy.featuresOff.includes("tagging");
  if (access === "excluded" || featureOff) {
    await clearOpenSuggestions(db, subject.ownerId, entityType, entityId);
    return;
  }

  const hash = await recordHash(db, entityType, entityId);
  if (!hash) {
    await clearOpenSuggestions(db, subject.ownerId, entityType, entityId);
    return;
  }
  const previousHash = await latestHash(db, subject.ownerId, entityType, entityId);
  if (previousHash === hash) return;

  const neighbors = await neighborRecords(db, subject, entityType, entityId);
  const candidates = await neighborTags(db, subject.ownerId, neighbors);
  const already = await attachedNames(db, entityType, entityId);
  const remaining = await remainingSlots(db, entityType, entityId);
  const model = await scoreWithModel(db, subject, candidates.map((row) => row.name), permission.policy.allowInventTags);
  const classified = classifyOperation(
    {
      action: "tag",
      entityType,
      entityId,
      projectId: subject.projectId,
      actorUserId: subject.ownerId,
      targetOwnerId: subject.ownerId,
    },
    permission.settings,
  );
  const decision = check(
    {
      action: "tag",
      entityType: entityType as EntityType,
      entityId,
      projectId: subject.projectId,
      actorUserId: subject.ownerId,
      feature: "tagging",
      userOff: permission.off,
      projectAiAccess: access,
    },
    undefined,
    permission.settings,
  );
  const plan = planTaggingRun({
    contentHash: hash,
    previousHash,
    access,
    featureOff: false,
    allowInventTags: permission.policy.allowInventTags,
    canAutoApply:
      model.scores != null &&
      decision.decision === "allow" &&
      shouldAutoApplyTier1(classified.tier, permission.settings),
    candidates,
    neighborCount: neighbors.length,
    alreadyNames: already,
    modelScores: model.scores,
    remainingSlots: remaining,
  });
  if (plan.skip) return;

  await clearOpenSuggestions(db, subject.ownerId, entityType, entityId);
  if (model.scores != null) {
    await writeAiAudit({
      userId: subject.ownerId,
      feature: "tagging",
      provider: model.provider,
      model: model.model,
      action: "respond",
      entityType,
      entityId,
      projectId: subject.projectId,
      decision: "allow",
      reason: "scored tags",
      tier: 0,
      tokensIn: model.tokensIn,
      tokensOut: model.tokensOut,
      promptId: model.promptId,
      promptVersion: model.promptVersion,
      promptRef: model.promptRef,
    });
  }

  const applied: Array<{ suggestionId: number; taggingId: number; createdTagId: number | null; name: string; auditId: number }> = [];
  for (const tag of [...plan.apply, ...plan.suggest]) {
    const bucket = plan.apply.includes(tag) ? "apply" : "suggest";
    const auditId = await writeAiAudit({
      userId: subject.ownerId,
      feature: "tagging",
      provider: model.provider,
      model: model.model,
      action: "tag",
      entityType,
      entityId,
      projectId: subject.projectId,
      decision: "allow",
      reason: bucket === "apply" ? "auto-apply" : "suggestion",
      tier: bucket === "apply" ? 1 : 2,
      promptId: model.promptId,
      promptVersion: model.promptVersion,
      promptRef: model.promptRef,
    });
    if (auditId == null) continue;
    let status: "pending" | "applied" = "pending";
    let taggingId: number | null = null;
    let createdTagId: number | null = null;
    if (bucket === "apply") {
      const attached = await attachTag(db, {
        ownerId: subject.ownerId,
        entityType,
        entityId,
        tag,
      });
      if (attached) {
        status = "applied";
        taggingId = attached.taggingId;
        createdTagId = attached.createdTagId;
      }
    }
    const [row] = await db
      .insert(schema.aiTagSuggestions)
      .values({
        userId: subject.ownerId,
        entityType,
        entityId,
        tagId: tag.tagId,
        proposedName: tag.tagId == null ? tag.name : null,
        confidence: tag.confidence,
        status,
        auditId,
        contentHash: hash,
      })
      .returning({ id: schema.aiTagSuggestions.id });
    if (status === "applied" && taggingId != null && row) {
      applied.push({ suggestionId: row.id, taggingId, createdTagId, name: tag.name, auditId });
    }
  }

  if (applied.length === 0) return;
  const summary = `Added ${applied.map((row) => row.name).join(", ")}`.slice(0, 500);
  const journal = await insertUndoJournal(db, {
    userId: subject.ownerId,
    auditId: applied[0]?.auditId ?? null,
    action: "tag",
    entityType,
    entityId,
    summary,
    inverse: {
      kind: "remove_taggings",
      taggingIds: applied.map((row) => row.taggingId),
      createdTagIds: applied.flatMap((row) => (row.createdTagId == null ? [] : [row.createdTagId])),
    },
  });
  await db
    .update(schema.aiTagSuggestions)
    .set({ journalId: journal.id })
    .where(inArray(schema.aiTagSuggestions.id, applied.map((row) => row.suggestionId)));
  for (const row of applied) {
    await recordAiFeedback(db, {
      auditId: row.auditId,
      actorUserId: subject.ownerId,
      isAdministrator: false,
      kind: "accept",
    });
  }
}

async function loadSubject(db: Db, entityType: TaggableEntityType, entityId: number): Promise<Subject | null> {
  if (entityType === "idea") {
    const [row] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, entityId));
    if (!row) return null;
    return pack(row.ownerId, null, row.title, row.body, false);
  }
  if (entityType === "project") {
    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, entityId));
    if (!row) return null;
    return pack(row.ownerId, row.id, row.name, row.description, false);
  }
  if (entityType === "task") {
    const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, entityId));
    if (!row || row.state === "deleted") return null;
    return pack(row.ownerId, row.projectId, row.title, row.description, isClosedTaskState(row.state));
  }
  if (entityType === "todo") {
    const [row] = await db.select().from(schema.todos).where(eq(schema.todos.id, entityId));
    if (!row || row.state === "deleted") return null;
    return pack(row.ownerId, row.projectId, row.title, row.description, false);
  }
  const [row] = await db
    .select({
      title: schema.projectDocuments.title,
      body: schema.projectDocuments.body,
      projectId: schema.projectDocuments.projectId,
      ownerId: schema.projects.ownerId,
    })
    .from(schema.projectDocuments)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectDocuments.projectId))
    .where(eq(schema.projectDocuments.id, entityId));
  if (!row) return null;
  return pack(row.ownerId, row.projectId, row.title, row.body, false);
}

function pack(
  ownerId: number,
  projectId: number | null,
  title: string,
  body: string | null,
  closed: boolean,
): Subject {
  const excerpt = `${title}\n\n${body ?? ""}`.trim().slice(0, EXCERPT);
  return { ownerId, projectId, title: title.trim(), excerpt, closed };
}

async function recordHash(db: Db, entityType: string, entityId: number): Promise<string | null> {
  const rows = await db
    .select({ contentHash: schema.knowledgeChunks.contentHash })
    .from(schema.knowledgeChunks)
    .where(and(eq(schema.knowledgeChunks.entityType, entityType), eq(schema.knowledgeChunks.entityId, entityId)));
  if (rows.length === 0) return null;
  return contentHash(rows.map((row) => row.contentHash).sort().join("\n"));
}

async function latestHash(
  db: Db,
  userId: number,
  entityType: string,
  entityId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ contentHash: schema.aiTagSuggestions.contentHash })
    .from(schema.aiTagSuggestions)
    .where(
      and(
        eq(schema.aiTagSuggestions.userId, userId),
        eq(schema.aiTagSuggestions.entityType, entityType),
        eq(schema.aiTagSuggestions.entityId, entityId),
      ),
    )
    .orderBy(sql`${schema.aiTagSuggestions.id} desc`)
    .limit(1);
  return row?.contentHash ?? null;
}

async function clearOpenSuggestions(
  db: Db,
  userId: number,
  entityType: string,
  entityId: number,
): Promise<void> {
  await db
    .delete(schema.aiTagSuggestions)
    .where(
      and(
        eq(schema.aiTagSuggestions.userId, userId),
        eq(schema.aiTagSuggestions.entityType, entityType),
        eq(schema.aiTagSuggestions.entityId, entityId),
        inArray(schema.aiTagSuggestions.status, ["pending", "dismissed"]),
      ),
    );
}

type Neighbor = { entityType: EntityType; entityId: number };

async function neighborRecords(
  db: Db,
  subject: Subject,
  entityType: string,
  entityId: number,
): Promise<Neighbor[]> {
  const query = subject.title.slice(0, 200);
  if (!query) return [];
  const isAdmin = await userHasAdministrator(db, subject.ownerId);
  const hits = await searchKnowledge({
    actorId: subject.ownerId,
    isAdmin,
    q: query,
    projectId: subject.projectId ?? undefined,
    limit: NEIGHBORS,
  });
  const seen = new Set<string>();
  const neighbors: Neighbor[] = [];
  for (const hit of hits) {
    if (hit.entityType === entityType && hit.entityId === entityId) continue;
    const key = `${hit.entityType}:${hit.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    neighbors.push({ entityType: hit.entityType, entityId: hit.entityId });
    if (neighbors.length >= NEIGHBORS) break;
  }
  return neighbors;
}

async function neighborTags(
  db: Db,
  ownerId: number,
  neighbors: Neighbor[],
): Promise<Array<{ tagId: number; name: string; count: number }>> {
  if (neighbors.length === 0) return [];
  const neighborMatch = or(
    ...neighbors.map((row) =>
      and(eq(schema.taggings.entityType, row.entityType), eq(schema.taggings.entityId, row.entityId)),
    ),
  );
  if (!neighborMatch) return [];
  const rows = await db
    .select({
      tagId: schema.tags.id,
      name: schema.tags.name,
      entityType: schema.taggings.entityType,
      entityId: schema.taggings.entityId,
    })
    .from(schema.taggings)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.taggings.tagId))
    .where(and(eq(schema.tags.ownerId, ownerId), neighborMatch));
  const counts = new Map<number, { name: string; entities: Set<string> }>();
  for (const row of rows) {
    const current = counts.get(row.tagId) ?? { name: row.name, entities: new Set<string>() };
    current.entities.add(`${row.entityType}:${row.entityId}`);
    counts.set(row.tagId, current);
  }
  return [...counts.entries()]
    .map(([tagId, value]) => ({ tagId, name: value.name, count: value.entities.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, MAX_CANDIDATES);
}

async function attachedNames(db: Db, entityType: string, entityId: number): Promise<string[]> {
  const rows = await db
    .select({ name: schema.tags.name })
    .from(schema.taggings)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.taggings.tagId))
    .where(and(eq(schema.taggings.entityType, entityType), eq(schema.taggings.entityId, entityId)));
  return rows.map((row) => row.name);
}

async function remainingSlots(db: Db, entityType: string, entityId: number): Promise<number> {
  if (entityType !== "task") return MAX_SURFACED;
  const rows = await db
    .select({ id: schema.taggings.id })
    .from(schema.taggings)
    .where(and(eq(schema.taggings.entityType, entityType), eq(schema.taggings.entityId, entityId)));
  return Math.max(0, Math.min(MAX_SURFACED, TASK_TAG_CAP - rows.length));
}

type ModelResult = {
  scores: ModelScore[] | null;
  provider: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  promptId: string | null;
  promptVersion: number | null;
  promptRef: string | null;
};

async function scoreWithModel(
  db: Db,
  subject: Subject,
  candidateNames: string[],
  allowInventTags: boolean,
): Promise<ModelResult> {
  const blank: ModelResult = {
    scores: null,
    provider: null,
    model: null,
    tokensIn: null,
    tokensOut: null,
    promptId: null,
    promptVersion: null,
    promptRef: null,
  };
  if (!subject.excerpt) return blank;
  if (candidateNames.length === 0 && !allowInventTags) return blank;
  const localOnly =
    subject.projectId == null ? false : (await resolveEffectiveLocalOnly(db, subject.projectId)) === true;
  const props = await getSystemProperties(db);
  const totals = await sumDayUsage(db, { userId: subject.ownerId });
  const route = await resolveFeatureRoute(db, { userId: subject.ownerId, feature: "tagging", localOnly });
  await auditRouteSkips(route.skipped, { userId: subject.ownerId, feature: "tagging" });
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
        feature: "tagging",
        provider: attempt.pluginId,
        model: attempt.model,
        userId: subject.ownerId,
      },
      blocked,
    );
    return blank;
  }
  const prompt = loadPrompt({ id: "tagging", providerId: attempt.pluginId });
  const names = candidateNames.slice(0, MAX_CANDIDATES).join(", ");
  const messages: AiChatMessage[] = [
    { role: "system", content: `${prompt.body}\n\nReturn JSON only.` },
    {
      role: "user",
      content: [
        allowInventTags ? "New names are allowed." : "New names are not allowed.",
        names ? `Candidates: ${names}` : "Candidates: none.",
        wrapUntrusted(redactSecrets(subject.excerpt), "tagging"),
      ].join("\n"),
    },
  ];
  const reply = await followRouteAttempts({
    attempts: route.attempts,
    onDeny: async (skipped, code) => {
      await writeAiAudit({
        userId: subject.ownerId,
        feature: "tagging",
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
        feature: "tagging",
        provider: chosen.pluginId,
        model: chosen.model,
        userId: subject.ownerId,
      };
      noteAllowUsage(meter, result.tokensIn, result.tokensOut);
      await noteStoredKeyUse(db, {
        userId: subject.ownerId,
        pluginId: chosen.pluginId,
        storedKey: chosen.storedKey,
        apiKey: chosen.apiKey,
        outcome: "ok",
        message: "",
      });
      return { ...result, pluginId: chosen.pluginId, model: chosen.model };
    },
  });
  const scores = parseModelScores(reply.text);
  if (!scores) {
    await writeAiAudit({
      userId: subject.ownerId,
      feature: "tagging",
      provider: reply.pluginId,
      model: reply.model,
      action: "respond",
      entityType: null,
      decision: "deny",
      reason: "invalid model output",
      tier: 0,
      tokensIn: reply.tokensIn,
      tokensOut: reply.tokensOut,
      promptId: prompt.id,
      promptVersion: prompt.version,
      promptRef: prompt.ref,
    });
    return blank;
  }
  return {
    scores,
    provider: reply.pluginId,
    model: reply.model,
    tokensIn: reply.tokensIn,
    tokensOut: reply.tokensOut,
    promptId: prompt.id,
    promptVersion: prompt.version,
    promptRef: prompt.ref,
  };
}

async function attachTag(
  db: Db,
  args: { ownerId: number; entityType: string; entityId: number; tag: PlannedTag },
): Promise<{ taggingId: number; tagId: number; createdTagId: number | null } | null> {
  if (args.entityType === "task") {
    const existing = await db
      .select({ id: schema.taggings.id })
      .from(schema.taggings)
      .where(and(eq(schema.taggings.entityType, "task"), eq(schema.taggings.entityId, args.entityId)));
    if (existing.length >= TASK_TAG_CAP) return null;
  }
  const resolved = await resolveTag(db, args.ownerId, args.tag);
  if (!resolved) return null;
  const [already] = await db
    .select({ id: schema.taggings.id })
    .from(schema.taggings)
    .where(
      and(
        eq(schema.taggings.tagId, resolved.tagId),
        eq(schema.taggings.entityType, args.entityType),
        eq(schema.taggings.entityId, args.entityId),
      ),
    );
  if (already) return null;
  const [tagging] = await db
    .insert(schema.taggings)
    .values({ tagId: resolved.tagId, entityType: args.entityType, entityId: args.entityId })
    .returning({ id: schema.taggings.id });
  if (!tagging) return null;
  return {
    taggingId: tagging.id,
    tagId: resolved.tagId,
    createdTagId: resolved.created ? resolved.tagId : null,
  };
}

async function resolveTag(
  db: Db,
  ownerId: number,
  tag: PlannedTag,
): Promise<{ tagId: number; created: boolean } | null> {
  if (tag.tagId != null) {
    const [row] = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(and(eq(schema.tags.id, tag.tagId), eq(schema.tags.ownerId, ownerId)));
    return row ? { tagId: row.id, created: false } : null;
  }
  const name = tag.name.trim().slice(0, 100);
  if (!name) return null;
  const [existing] = await db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(and(eq(schema.tags.ownerId, ownerId), sql`lower(${schema.tags.name}) = ${name.toLowerCase()}`));
  if (existing) return { tagId: existing.id, created: false };
  const [created] = await db
    .insert(schema.tags)
    .values({ name, ownerId })
    .returning({ id: schema.tags.id });
  return created ? { tagId: created.id, created: true } : null;
}

export type TagSuggestionView = {
  id: number;
  name: string;
  confidence: number;
  invented: boolean;
};

export async function listTagSuggestions(
  db: Db,
  userId: number,
  entityType: string,
  entityId: number,
  now: Date,
  windowDays: number,
): Promise<{ suggestions: TagSuggestionView[]; undo: { journalId: number; summary: string } | null }> {
  const suggestions = await db
    .select({
      id: schema.aiTagSuggestions.id,
      proposedName: schema.aiTagSuggestions.proposedName,
      confidence: schema.aiTagSuggestions.confidence,
      tagName: schema.tags.name,
    })
    .from(schema.aiTagSuggestions)
    .leftJoin(schema.tags, eq(schema.tags.id, schema.aiTagSuggestions.tagId))
    .where(
      and(
        eq(schema.aiTagSuggestions.userId, userId),
        eq(schema.aiTagSuggestions.entityType, entityType),
        eq(schema.aiTagSuggestions.entityId, entityId),
        eq(schema.aiTagSuggestions.status, "pending"),
      ),
    );
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const [journal] = await db
    .select({
      id: schema.aiUndoJournal.id,
      summary: schema.aiUndoJournal.summary,
    })
    .from(schema.aiUndoJournal)
    .where(
      and(
        eq(schema.aiUndoJournal.userId, userId),
        eq(schema.aiUndoJournal.entityType, entityType),
        eq(schema.aiUndoJournal.entityId, entityId),
        eq(schema.aiUndoJournal.action, "tag"),
        eq(schema.aiUndoJournal.status, "applied"),
        sql`${schema.aiUndoJournal.appliedAt} >= ${since}`,
      ),
    )
    .orderBy(sql`${schema.aiUndoJournal.id} desc`)
    .limit(1);
  return {
    suggestions: suggestions.flatMap((row) => {
      const name = row.tagName ?? row.proposedName;
      if (!name) return [];
      return [{ id: row.id, name, confidence: row.confidence, invented: row.tagName == null }];
    }),
    undo: journal ? { journalId: journal.id, summary: journal.summary } : null,
  };
}

export class TagSuggestionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TagSuggestionError";
  }
}

export async function acceptTagSuggestion(
  db: Db,
  userId: number,
  suggestionId: number,
): Promise<{ id: number; name: string }> {
  const row = await ownedPending(db, userId, suggestionId);
  if (!isTaggableEntityType(row.entityType)) {
    throw new TagSuggestionError(400, "validation_error", "That record cannot be tagged.");
  }
  await assertCanAccessTaggableEntity(db, userId, row.entityType, row.entityId, "write");
  const attached = await attachTag(db, {
    ownerId: userId,
    entityType: row.entityType,
    entityId: row.entityId,
    tag: {
      name: row.proposedName ?? row.tagName ?? "",
      tagId: row.tagId,
      confidence: row.confidence,
      invented: row.tagId == null,
    },
  });
  if (!attached) {
    throw new TagSuggestionError(400, "tag_not_applied", "That tag could not be added.");
  }
  await db
    .update(schema.aiTagSuggestions)
    .set({ status: "accepted", tagId: attached.tagId })
    .where(eq(schema.aiTagSuggestions.id, row.id));
  if (row.entityType === "task") await applyTaskGroupAutoTagsForTask(db, row.entityId);
  if (row.auditId != null) {
    await recordAiFeedback(db, {
      auditId: row.auditId,
      actorUserId: userId,
      isAdministrator: false,
      kind: "accept",
    });
  }
  const name = row.tagName ?? row.proposedName ?? "";
  return { id: attached.tagId, name };
}

export async function dismissTagSuggestion(db: Db, userId: number, suggestionId: number): Promise<void> {
  const row = await ownedPending(db, userId, suggestionId);
  if (!isTaggableEntityType(row.entityType)) {
    throw new TagSuggestionError(400, "validation_error", "That record cannot be tagged.");
  }
  await assertCanAccessTaggableEntity(db, userId, row.entityType, row.entityId, "write");
  await db
    .update(schema.aiTagSuggestions)
    .set({ status: "dismissed" })
    .where(eq(schema.aiTagSuggestions.id, row.id));
  if (row.auditId != null) {
    await recordAiFeedback(db, {
      auditId: row.auditId,
      actorUserId: userId,
      isAdministrator: false,
      kind: "dismiss",
    });
  }
}

async function ownedPending(db: Db, userId: number, suggestionId: number) {
  const [row] = await db
    .select({
      id: schema.aiTagSuggestions.id,
      entityType: schema.aiTagSuggestions.entityType,
      entityId: schema.aiTagSuggestions.entityId,
      tagId: schema.aiTagSuggestions.tagId,
      proposedName: schema.aiTagSuggestions.proposedName,
      confidence: schema.aiTagSuggestions.confidence,
      auditId: schema.aiTagSuggestions.auditId,
      status: schema.aiTagSuggestions.status,
      tagName: schema.tags.name,
    })
    .from(schema.aiTagSuggestions)
    .leftJoin(schema.tags, eq(schema.tags.id, schema.aiTagSuggestions.tagId))
    .where(and(eq(schema.aiTagSuggestions.id, suggestionId), eq(schema.aiTagSuggestions.userId, userId)));
  if (!row || row.status !== "pending") {
    throw new TagSuggestionError(404, "not_found", "Suggestion not found");
  }
  if (row.entityType === "task") {
    const [task] = await db
      .select({ state: schema.tasks.state })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, row.entityId));
    if (task && isClosedTaskState(task.state)) {
      throw new TagSuggestionError(400, "task_closed", "This task is read-only.");
    }
  }
  return row;
}
