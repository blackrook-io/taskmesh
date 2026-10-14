import { and, eq, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AiChatMessage } from "@taskmesh/ai-provider-contract";
import * as schema from "../../../db/schema.js";
import { entityEndKey } from "../../../lib/entityLinkRules.js";
import { ENTITY_REF_PREFIXES } from "../../../lib/entityRef.js";
import { ENTITY_TYPES, isEntityType, type EntityType } from "../../../lib/entityType.js";
import { createManualLink, loadVisibleEnds, type LinkActor, type LinkEntityEnd } from "../../entityLinks.js";
import { semanticEntityScores } from "../../knowledge/search.js";
import { userHasAdministrator } from "../../roles.js";
import { getSystemProperties } from "../../systemProperties.js";
import { writeAiAudit } from "../aiAudit.js";
import { recordAiFeedback } from "../aiFeedback.js";
import { effectiveAiAccess } from "../aiAccess.js";
import { noteAllowUsage, pluginBudgetReason, recordUsageDenial, sumDayUsage, type AiUsageMeter } from "../aiBudgets.js";
import { noteStoredKeyUse } from "../aiCredentialHealth.js";
import { followRouteAttempts } from "../aiFeatureRoutes.js";
import { excerptText, redactSecrets } from "../aiMinimize.js";
import { auditRouteSkips, resolveFeatureRoute, type ResolvedAttempt } from "../aiRouting.js";
import { loadActorAiPermission } from "../aiUserPolicy.js";
import { runCaptureModel } from "../capture/service.js";
import { loadPrompt } from "../promptRegistry.js";
import { getAiProjectAccessCeiling, resolveEffectiveLocalOnly } from "../projectAiAccess.js";
import { assertLocalProviderBaseUrl, assertPublicProviderBaseUrl } from "../providerBaseUrl.js";
import { wrapUntrusted } from "../untrustedContent.js";
import {
  applyModelScore,
  isLinkSubjectType,
  planLinkSuggestions,
  referencesLinkEnds,
  unorderedPairKey,
  visibleCandidates,
  type LinkCandidate,
  type LinkSubjectType,
  type PlannedLink,
} from "./plan.js";
import { parseLinkScores } from "./parse.js";

type Db = NodePgDatabase<typeof schema>;

export class LinkSuggestionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "LinkSuggestionError";
    this.status = status;
    this.code = code;
  }
}

export type LinkSuggestionView = {
  id: number;
  matchPercent: number;
  reason: string;
  source: LinkEntityEnd;
  target: LinkEntityEnd;
};

type SubjectRow = {
  entityType: LinkSubjectType;
  entityId: number;
  number: number;
  title: string;
  description: string | null;
  projectId: number | null;
};

type Accum = {
  entityType: EntityType;
  entityId: number;
  sharedTags: number;
  mention: boolean;
  sameList: boolean;
  sameBoard: boolean;
  semantic: number | null;
};

const MENTION_TABLES: Array<{
  table: string;
  entityType: EntityType;
  fields: string[];
  skipDeleted: boolean;
}> = [
  { table: "tasks", entityType: "task", fields: ["title", "description"], skipDeleted: true },
  { table: "todos", entityType: "todo", fields: ["title", "description"], skipDeleted: true },
  { table: "ideas", entityType: "idea", fields: ["title", "body"], skipDeleted: false },
  { table: "project_documents", entityType: "document", fields: ["title", "body"], skipDeleted: false },
  { table: "projects", entityType: "project", fields: ["name", "description"], skipDeleted: false },
  { table: "todo_lists", entityType: "todo_list", fields: ["title"], skipDeleted: false },
  { table: "boards", entityType: "board", fields: ["name"], skipDeleted: false },
  { table: "wiki_nodes", entityType: "wiki_node", fields: ["title"], skipDeleted: false },
  { table: "canvases", entityType: "canvas", fields: ["title"], skipDeleted: false },
  { table: "image_boards", entityType: "image_board", fields: ["title"], skipDeleted: false },
];

export async function listLinkSuggestions(
  db: Db,
  actor: LinkActor,
  entityType: string,
  entityId: number,
): Promise<LinkSuggestionView[]> {
  if (!isLinkSubjectType(entityType)) return [];
  await refreshLinkSuggestions(db, actor, entityType, entityId);
  return readPending(db, actor, entityType, entityId);
}

export async function acceptLinkSuggestion(
  db: Db,
  actor: LinkActor,
  suggestionId: number,
): Promise<void> {
  const row = await loadOwn(db, actor.userId, suggestionId);
  if (!row || !isEntityType(row.srcType) || !isEntityType(row.dstType)) {
    throw new LinkSuggestionError(404, "not_found", "Suggestion not found.");
  }
  if (row.status !== "pending") {
    throw new LinkSuggestionError(409, "not_pending", "That suggestion was already settled.");
  }
  const ends = await loadVisibleEnds(
    db,
    [
      { entityType: row.srcType, id: row.srcId },
      { entityType: row.dstType, id: row.dstId },
    ],
    actor,
  );
  if (ends.size < 2) {
    throw new LinkSuggestionError(404, "not_found", "Suggestion not found.");
  }
  const link = referencesLinkEnds({
    srcType: row.srcType,
    srcId: row.srcId,
    dstType: row.dstType,
    dstId: row.dstId,
  });
  await createManualLink(db, { ...link, createdById: actor.userId }, actor);
  const [updated] = await db
    .update(schema.aiLinkSuggestions)
    .set({ status: "accepted", updatedAt: new Date() })
    .where(
      and(
        eq(schema.aiLinkSuggestions.id, row.id),
        eq(schema.aiLinkSuggestions.userId, actor.userId),
        eq(schema.aiLinkSuggestions.status, "pending"),
      ),
    )
    .returning({ id: schema.aiLinkSuggestions.id });
  if (!updated) {
    throw new LinkSuggestionError(409, "not_pending", "That suggestion was already settled.");
  }
  await writeDecisionFeedback(db, actor, row.auditId, "accept");
}

export async function dismissLinkSuggestion(
  db: Db,
  actor: LinkActor,
  suggestionId: number,
): Promise<void> {
  const row = await loadOwn(db, actor.userId, suggestionId);
  if (!row) throw new LinkSuggestionError(404, "not_found", "Suggestion not found.");
  if (row.status !== "pending") {
    throw new LinkSuggestionError(409, "not_pending", "That suggestion was already settled.");
  }
  const [updated] = await db
    .update(schema.aiLinkSuggestions)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(
      and(
        eq(schema.aiLinkSuggestions.id, row.id),
        eq(schema.aiLinkSuggestions.userId, actor.userId),
        eq(schema.aiLinkSuggestions.status, "pending"),
      ),
    )
    .returning({ id: schema.aiLinkSuggestions.id });
  if (!updated) {
    throw new LinkSuggestionError(409, "not_pending", "That suggestion was already settled.");
  }
  await writeDecisionFeedback(db, actor, row.auditId, "dismiss");
}

async function refreshLinkSuggestions(
  db: Db,
  actor: LinkActor,
  entityType: LinkSubjectType,
  entityId: number,
): Promise<void> {
  const subject = await loadSubject(db, actor, entityType, entityId);
  if (!subject) return;
  const blocked = await excludedProjects(db);
  const subjectBlocked = subject.projectId != null && blocked.has(subject.projectId);
  const semantic = subjectBlocked
    ? new Map<string, number>()
    : await semanticScores(db, actor, subject);
  const accumulated = await gatherSignals(db, subject);
  for (const [key, score] of semantic) {
    const split = key.split(":");
    const type = split[0] ?? "";
    const id = Number(split[1]);
    if (!isEntityType(type) || !Number.isInteger(id)) continue;
    const row = bucket(accumulated, type, id);
    row.semantic = Math.max(row.semantic ?? 0, score);
  }
  const refs = [...accumulated.values()].map((row) => ({ entityType: row.entityType, id: row.entityId }));
  const visible = await loadVisibleEnds(db, refs, actor);
  const candidates: LinkCandidate[] = [];
  for (const row of accumulated.values()) {
    const end = visible.get(entityEndKey(row.entityType, row.entityId));
    if (!end) continue;
    const modelBlocked = subjectBlocked || (end.projectId != null && blocked.has(end.projectId));
    candidates.push({
      entityType: row.entityType,
      entityId: row.entityId,
      sharedTags: row.sharedTags,
      mention: row.mention,
      sameList: row.sameList,
      sameBoard: row.sameBoard,
      semantic: modelBlocked ? null : row.semantic,
      modelBlocked,
    });
  }
  const existing = await rowsTouching(db, actor.userId, entityType, entityId);
  const suppressed = new Set<string>();
  for (const link of await linksTouching(db, entityType, entityId)) {
    suppressed.add(
      unorderedPairKey(
        { entityType: link.srcType, entityId: link.srcId },
        { entityType: link.dstType, entityId: link.dstId },
      ),
    );
  }
  for (const row of existing) {
    if (row.status === "pending") continue;
    suppressed.add(pairOf(row));
  }
  const planned = planLinkSuggestions({
    subject: { entityType, entityId },
    candidates: visibleCandidates(
      candidates,
      new Set([...visible.keys()]),
    ),
    suppressedKeys: suppressed,
  });
  const plannedKeys = new Set(
    planned.map((hit) => unorderedPairKey({ entityType, entityId }, hit)),
  );
  for (const row of existing) {
    if (row.status !== "pending") continue;
    if (row.dstType !== entityType || row.dstId !== entityId) continue;
    if (!plannedKeys.has(pairOf(row))) {
      await db.delete(schema.aiLinkSuggestions).where(eq(schema.aiLinkSuggestions.id, row.id));
    }
  }
  const pendingKeys = new Set(existing.filter((row) => row.status === "pending").map(pairOf));
  const inserted: Array<{ id: number; hit: PlannedLink }> = [];
  for (const hit of planned) {
    const key = unorderedPairKey({ entityType, entityId }, hit);
    if (pendingKeys.has(key)) continue;
    const [row] = await db
      .insert(schema.aiLinkSuggestions)
      .values({
        userId: actor.userId,
        srcType: hit.entityType,
        srcId: hit.entityId,
        dstType: entityType,
        dstId: entityId,
        score: hit.score,
        reason: hit.reason,
        signal: hit.signal,
        status: "pending",
      })
      .onConflictDoNothing()
      .returning({ id: schema.aiLinkSuggestions.id });
    if (row) inserted.push({ id: row.id, hit });
  }
  const toScore = inserted.filter((row) => row.hit.needsModel);
  for (const row of existing) {
    if (row.status !== "pending" || row.auditId != null) continue;
    if (!plannedKeys.has(pairOf(row))) continue;
    const hit = planned.find((item) => unorderedPairKey({ entityType, entityId }, item) === pairOf(row));
    if (!hit?.needsModel || !isEntityType(row.srcType)) continue;
    toScore.push({
      id: row.id,
      hit: { ...hit, entityType: row.srcType, entityId: row.srcId },
    });
  }
  if (toScore.length === 0 || (await featureOff(db, actor.userId))) return;
  await scoreWithModel(db, actor, subject, toScore);
}

async function semanticScores(
  db: Db,
  actor: LinkActor,
  subject: SubjectRow,
): Promise<Map<string, number>> {
  try {
    return await semanticEntityScores({
      actorId: actor.userId,
      isAdmin: actor.isAdministrator,
      text: blurb(subject.title, subject.description),
      entityTypes: [...ENTITY_TYPES],
      exclude: { entityType: subject.entityType, entityId: subject.entityId },
    });
  } catch (err) {
    console.error("[links] embedding lookup failed", err);
    return new Map();
  }
}

async function readPending(
  db: Db,
  actor: LinkActor,
  entityType: EntityType,
  entityId: number,
): Promise<LinkSuggestionView[]> {
  const rows = await db
    .select()
    .from(schema.aiLinkSuggestions)
    .where(
      and(
        eq(schema.aiLinkSuggestions.userId, actor.userId),
        eq(schema.aiLinkSuggestions.status, "pending"),
        or(
          and(
            eq(schema.aiLinkSuggestions.srcType, entityType),
            eq(schema.aiLinkSuggestions.srcId, entityId),
          ),
          and(
            eq(schema.aiLinkSuggestions.dstType, entityType),
            eq(schema.aiLinkSuggestions.dstId, entityId),
          ),
        ),
      ),
    );
  const refs = rows.flatMap((row) =>
    isEntityType(row.srcType) && isEntityType(row.dstType)
      ? [
          { entityType: row.srcType, id: row.srcId },
          { entityType: row.dstType, id: row.dstId },
        ]
      : [],
  );
  const ends = await loadVisibleEnds(db, refs, actor);
  const views: LinkSuggestionView[] = [];
  for (const row of rows) {
    if (!isEntityType(row.srcType) || !isEntityType(row.dstType)) continue;
    const source = ends.get(entityEndKey(row.srcType, row.srcId));
    const target = ends.get(entityEndKey(row.dstType, row.dstId));
    if (!source || !target) continue;
    views.push({
      id: row.id,
      matchPercent: Math.round(row.score * 100),
      reason: row.reason,
      source,
      target,
    });
  }
  views.sort((a, b) => b.matchPercent - a.matchPercent || a.id - b.id);
  return views;
}

async function scoreWithModel(
  db: Db,
  actor: LinkActor,
  subject: SubjectRow,
  rows: Array<{ id: number; hit: PlannedLink }>,
): Promise<void> {
  const batch = rows.slice(0, 8);
  try {
    const localOnly =
      subject.projectId == null ? false : (await resolveEffectiveLocalOnly(db, subject.projectId)) === true;
    const props = await getSystemProperties(db);
    const totals = await sumDayUsage(db, { userId: actor.userId });
    const route = await resolveFeatureRoute(db, { userId: actor.userId, feature: "links", localOnly });
    await auditRouteSkips(route.skipped, { userId: actor.userId, feature: "links" });
    const attempt = route.attempts[0];
    if (!attempt) return;
    const blocked = pluginBudgetReason(props.aiBudgets, totals, attempt.keySource);
    if (blocked) {
      await recordUsageDenial(
        {
          keySource: attempt.keySource,
          usdPerMillionTokens: props.aiInstanceUsdPerMillionTokens,
          limits: props.aiBudgets,
          totals,
          feature: "links",
          provider: attempt.pluginId,
          model: attempt.model,
          userId: actor.userId,
        },
        blocked,
      );
      return;
    }
    const prompt = loadPrompt({ id: "links", providerId: attempt.pluginId });
    const ends = [subject, ...batch.map((row) => row.hit)];
    const blurbs = await loadBlurbs(
      db,
      ends.map((end) => ({ entityType: end.entityType, entityId: end.entityId })),
    );
    const tags = await loadTagNames(
      db,
      ends.map((end) => ({ entityType: end.entityType, entityId: end.entityId })),
    );
    const messages: AiChatMessage[] = [
      { role: "system", content: `${prompt.body}\n\nReturn JSON only.` },
      {
        role: "user",
        content: [
          wrapUntrusted(recordBlock(subject, blurbs, tags), "links"),
          ...batch.map((row) => wrapUntrusted(recordBlock(row.hit, blurbs, tags), "links")),
        ].join("\n"),
      },
    ];
    const reply = await followRouteAttempts({
      attempts: route.attempts,
      onDeny: async (skipped, code) => {
        await writeAiAudit({
          userId: actor.userId,
          feature: "links",
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
          feature: "links",
          provider: chosen.pluginId,
          model: chosen.model,
          userId: actor.userId,
        };
        noteAllowUsage(meter, result.tokensIn, result.tokensOut);
        await noteStoredKeyUse(db, {
          userId: actor.userId,
          pluginId: chosen.pluginId,
          storedKey: chosen.storedKey,
          apiKey: chosen.apiKey,
          outcome: "ok",
          message: "",
        });
        return { ...result, pluginId: chosen.pluginId, model: chosen.model };
      },
    });
    const parsed = parseLinkScores(reply.text);
    const auditId = await writeAiAudit({
      userId: actor.userId,
      feature: "links",
      provider: reply.pluginId,
      model: reply.model,
      action: "respond",
      decision: parsed ? "allow" : "deny",
      reason: parsed ? "link suggestions" : "invalid model output",
      tier: 0,
      tokensIn: reply.tokensIn,
      tokensOut: reply.tokensOut,
      promptId: prompt.id,
      promptVersion: prompt.version,
      promptRef: prompt.ref,
      entityType: subject.entityType,
      entityId: subject.entityId,
      projectId: subject.projectId,
    });
    if (!parsed) return;
    const byKey = new Map(parsed.map((item) => [item.key, item]));
    for (const row of batch) {
      const answer = byKey.get(`${row.hit.entityType}:${row.hit.entityId}`) ?? null;
      const next = applyModelScore(row.hit, answer);
      await db
        .update(schema.aiLinkSuggestions)
        .set({
          score: next.score,
          reason: next.reason,
          status: next.status,
          auditId,
          updatedAt: new Date(),
        })
        .where(eq(schema.aiLinkSuggestions.id, row.id));
    }
  } catch (err) {
    console.error("[links] model scoring failed", err);
  }
}

function recordBlock(
  end: { entityType: string; entityId: number; title?: string },
  blurbs: Map<string, { title: string; text: string }>,
  tags: Map<string, string[]>,
): string {
  const key = `${end.entityType}:${end.entityId}`;
  const blurbRow = blurbs.get(key);
  const title = blurbRow?.title ?? end.title ?? key;
  const names = tags.get(key) ?? [];
  const lines = [`${key} ${title}`];
  if (names.length > 0) lines.push(`tags: ${names.join(", ")}`);
  if (blurbRow?.text) lines.push(blurbRow.text);
  return redactSecrets(lines.join("\n"));
}

async function loadSubject(
  db: Db,
  actor: LinkActor,
  entityType: LinkSubjectType,
  entityId: number,
): Promise<SubjectRow | null> {
  const ends = await loadVisibleEnds(db, [{ entityType, id: entityId }], actor);
  const end = ends.get(entityEndKey(entityType, entityId));
  if (!end) return null;
  const number = Number(end.referenceId.replace(/^\D+/, ""));
  if (!Number.isInteger(number)) return null;
  return {
    entityType,
    entityId,
    number,
    title: end.title,
    description: await loadDescription(db, entityType, entityId),
    projectId: end.projectId,
  };
}

async function gatherSignals(db: Db, subject: SubjectRow): Promise<Map<string, Accum>> {
  const found = new Map<string, Accum>();
  const [tags, lists, boards, mentions] = await Promise.all([
    sharedTagHits(db, subject.entityType, subject.entityId),
    sameListHits(db, subject.entityType, subject.entityId),
    sameBoardHits(db, subject.entityType, subject.entityId),
    mentionHits(db, subject),
  ]);
  for (const hit of tags) {
    const row = bucket(found, hit.entityType, hit.entityId);
    row.sharedTags = hit.shared;
  }
  for (const hit of lists) bucket(found, hit.entityType, hit.entityId).sameList = true;
  for (const hit of boards) bucket(found, hit.entityType, hit.entityId).sameBoard = true;
  for (const hit of mentions) bucket(found, hit.entityType, hit.entityId).mention = true;
  return found;
}

async function sharedTagHits(
  db: Db,
  entityType: EntityType,
  entityId: number,
): Promise<Array<{ entityType: EntityType; entityId: number; shared: number }>> {
  const result = await db.execute<{ entity_type: string; entity_id: number; shared: number }>(sql`
    SELECT other.entity_type, other.entity_id, count(*)::int AS shared
    FROM taggings mine
    JOIN taggings other ON other.tag_id = mine.tag_id
    WHERE mine.entity_type = ${entityType}
      AND mine.entity_id = ${entityId}
      AND NOT (other.entity_type = mine.entity_type AND other.entity_id = mine.entity_id)
    GROUP BY other.entity_type, other.entity_id
    ORDER BY shared DESC
    LIMIT 20
  `);
  return result.rows.flatMap((row) => {
    if (!isEntityType(row.entity_type)) return [];
    return [{ entityType: row.entity_type, entityId: row.entity_id, shared: Number(row.shared) }];
  });
}

async function sameListHits(
  db: Db,
  entityType: EntityType,
  entityId: number,
): Promise<Array<{ entityType: EntityType; entityId: number }>> {
  const result = await db.execute<{ entity_type: string; entity_id: number }>(sql`
    SELECT other.entity_type, other.entity_id
    FROM todo_list_items mine
    JOIN todo_list_items other ON other.list_id = mine.list_id
    WHERE mine.entity_type = ${entityType}
      AND mine.entity_id = ${entityId}
      AND NOT (other.entity_type = mine.entity_type AND other.entity_id = mine.entity_id)
    LIMIT 20
  `);
  return typedHits(result.rows);
}

async function sameBoardHits(
  db: Db,
  entityType: EntityType,
  entityId: number,
): Promise<Array<{ entityType: EntityType; entityId: number }>> {
  const result = await db.execute<{ entity_type: string; entity_id: number }>(sql`
    SELECT other.entity_type, other.entity_id
    FROM board_cards mine
    JOIN board_cards other ON other.board_id = mine.board_id
    WHERE mine.entity_type = ${entityType}
      AND mine.entity_id = ${entityId}
      AND NOT (other.entity_type = mine.entity_type AND other.entity_id = mine.entity_id)
    LIMIT 20
  `);
  return typedHits(result.rows);
}

async function mentionHits(
  db: Db,
  subject: SubjectRow,
): Promise<Array<{ entityType: EntityType; entityId: number }>> {
  const prefix = ENTITY_REF_PREFIXES[subject.entityType];
  const pattern = `(^|[^[:alnum:]#])${prefix}0*${subject.number}([^[:digit:]]|$)`;
  const like =
    subject.title.trim().length >= 12 ? `%${escapeLike(subject.title.trim())}%` : null;
  const batches = await Promise.all(
    MENTION_TABLES.map((spec) => mentionTable(db, spec, subject, pattern, like)),
  );
  return batches.flat();
}

async function mentionTable(
  db: Db,
  spec: (typeof MENTION_TABLES)[number],
  subject: SubjectRow,
  pattern: string,
  like: string | null,
): Promise<Array<{ entityType: EntityType; entityId: number }>> {
  const clauses = spec.fields.map((field) => sql`${sql.raw(field)} ~* ${pattern}`);
  if (like) clauses.push(sql`${sql.raw(spec.fields[0]!)} ILIKE ${like} ESCAPE ${"\\"}`);
  const same =
    spec.entityType === subject.entityType ? sql`AND id <> ${subject.entityId}` : sql``;
  const deleted = spec.skipDeleted ? sql`AND state <> 'deleted'` : sql``;
  const result = await db.execute<{ entity_id: number }>(sql`
    SELECT id AS entity_id
    FROM ${sql.raw(spec.table)}
    WHERE (${sql.join(clauses, sql` OR `)})
      ${same}
      ${deleted}
    LIMIT 12
  `);
  return result.rows.map((row) => ({ entityType: spec.entityType, entityId: row.entity_id }));
}

function typedHits(
  rows: Array<{ entity_type: string; entity_id: number }>,
): Array<{ entityType: EntityType; entityId: number }> {
  return rows.flatMap((row) => {
    if (!isEntityType(row.entity_type)) return [];
    return [{ entityType: row.entity_type, entityId: row.entity_id }];
  });
}

function bucket(map: Map<string, Accum>, entityType: EntityType, entityId: number): Accum {
  const key = `${entityType}:${entityId}`;
  const existing = map.get(key);
  if (existing) return existing;
  const created: Accum = {
    entityType,
    entityId,
    sharedTags: 0,
    mention: false,
    sameList: false,
    sameBoard: false,
    semantic: null,
  };
  map.set(key, created);
  return created;
}

async function linksTouching(
  db: Db,
  entityType: EntityType,
  entityId: number,
): Promise<Array<{ srcType: string; srcId: number; dstType: string; dstId: number }>> {
  return db
    .select({
      srcType: schema.entityLinks.srcType,
      srcId: schema.entityLinks.srcId,
      dstType: schema.entityLinks.dstType,
      dstId: schema.entityLinks.dstId,
    })
    .from(schema.entityLinks)
    .where(
      or(
        and(eq(schema.entityLinks.srcType, entityType), eq(schema.entityLinks.srcId, entityId)),
        and(eq(schema.entityLinks.dstType, entityType), eq(schema.entityLinks.dstId, entityId)),
      ),
    );
}

async function rowsTouching(db: Db, userId: number, entityType: EntityType, entityId: number) {
  return db
    .select()
    .from(schema.aiLinkSuggestions)
    .where(
      and(
        eq(schema.aiLinkSuggestions.userId, userId),
        or(
          and(
            eq(schema.aiLinkSuggestions.srcType, entityType),
            eq(schema.aiLinkSuggestions.srcId, entityId),
          ),
          and(
            eq(schema.aiLinkSuggestions.dstType, entityType),
            eq(schema.aiLinkSuggestions.dstId, entityId),
          ),
        ),
      ),
    );
}

async function loadOwn(db: Db, userId: number, suggestionId: number) {
  const [row] = await db
    .select()
    .from(schema.aiLinkSuggestions)
    .where(and(eq(schema.aiLinkSuggestions.id, suggestionId), eq(schema.aiLinkSuggestions.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function loadDescription(
  db: Db,
  entityType: LinkSubjectType,
  entityId: number,
): Promise<string | null> {
  if (entityType === "task") {
    const [row] = await db
      .select({ description: schema.tasks.description })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, entityId));
    return row?.description ?? null;
  }
  if (entityType === "todo") {
    const [row] = await db
      .select({ description: schema.todos.description })
      .from(schema.todos)
      .where(eq(schema.todos.id, entityId));
    return row?.description ?? null;
  }
  if (entityType === "idea") {
    const [row] = await db
      .select({ body: schema.ideas.body })
      .from(schema.ideas)
      .where(eq(schema.ideas.id, entityId));
    return row?.body ?? null;
  }
  const [row] = await db
    .select({ body: schema.projectDocuments.body })
    .from(schema.projectDocuments)
    .where(eq(schema.projectDocuments.id, entityId));
  return row?.body ?? null;
}

async function loadBlurbs(
  db: Db,
  ends: Array<{ entityType: string; entityId: number }>,
): Promise<Map<string, { title: string; text: string }>> {
  const out = new Map<string, { title: string; text: string }>();
  for (const end of ends) {
    if (!isEntityType(end.entityType)) continue;
    const text = await blurbFor(db, end.entityType, end.entityId);
    if (text) out.set(`${end.entityType}:${end.entityId}`, text);
  }
  return out;
}

async function blurbFor(
  db: Db,
  entityType: EntityType,
  entityId: number,
): Promise<{ title: string; text: string } | null> {
  if (entityType === "task" || entityType === "todo") {
    const table = entityType === "task" ? schema.tasks : schema.todos;
    const [row] = await db
      .select({ title: table.title, description: table.description })
      .from(table)
      .where(eq(table.id, entityId));
    if (!row) return null;
    return { title: row.title, text: excerptText(row.description ?? "", 400) };
  }
  if (entityType === "idea") {
    const [row] = await db
      .select({ title: schema.ideas.title, body: schema.ideas.body })
      .from(schema.ideas)
      .where(eq(schema.ideas.id, entityId));
    if (!row) return null;
    return { title: row.title, text: excerptText(row.body ?? "", 400) };
  }
  if (entityType === "document") {
    const [row] = await db
      .select({ title: schema.projectDocuments.title, body: schema.projectDocuments.body })
      .from(schema.projectDocuments)
      .where(eq(schema.projectDocuments.id, entityId));
    if (!row) return null;
    return { title: row.title, text: excerptText(row.body ?? "", 400) };
  }
  if (entityType === "project") {
    const [row] = await db
      .select({ name: schema.projects.name, description: schema.projects.description })
      .from(schema.projects)
      .where(eq(schema.projects.id, entityId));
    if (!row) return null;
    return { title: row.name, text: excerptText(row.description ?? "", 400) };
  }
  return null;
}

async function loadTagNames(
  db: Db,
  ends: Array<{ entityType: string; entityId: number }>,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ends.length === 0) return out;
  const result = await db.execute<{ entity_type: string; entity_id: number; name: string }>(sql`
    SELECT taggings.entity_type, taggings.entity_id, tags.name
    FROM taggings
    JOIN tags ON tags.id = taggings.tag_id
    WHERE ${sql.join(
      ends.map((end) => sql`(taggings.entity_type = ${end.entityType} AND taggings.entity_id = ${end.entityId})`),
      sql` OR `,
    )}
    ORDER BY tags.name
  `);
  for (const row of result.rows) {
    const key = `${row.entity_type}:${row.entity_id}`;
    const names = out.get(key) ?? [];
    names.push(row.name);
    out.set(key, names);
  }
  return out;
}

async function excludedProjects(db: Db): Promise<Set<number>> {
  const ceiling = await getAiProjectAccessCeiling(db);
  const rows = await db
    .select({ id: schema.projects.id, aiAccess: schema.projects.aiAccess })
    .from(schema.projects);
  const ids = new Set<number>();
  for (const row of rows) {
    const stored =
      row.aiAccess === "read_only" || row.aiAccess === "excluded" || row.aiAccess === "full"
        ? row.aiAccess
        : "full";
    if (effectiveAiAccess(stored, ceiling) === "excluded") ids.add(row.id);
  }
  return ids;
}

async function featureOff(db: Db, userId: number): Promise<boolean> {
  const permission = await loadActorAiPermission(db, userId);
  return permission.policy.featuresOff.includes("links");
}

async function writeDecisionFeedback(
  db: Db,
  actor: LinkActor,
  auditId: number | null,
  kind: "accept" | "dismiss",
): Promise<void> {
  if (auditId == null) return;
  try {
    await recordAiFeedback(db, {
      auditId,
      actorUserId: actor.userId,
      isAdministrator: actor.isAdministrator,
      kind,
    });
  } catch (err) {
    console.error("[links] feedback failed", err);
  }
}

function pairOf(row: { srcType: string; srcId: number; dstType: string; dstId: number }): string {
  return unorderedPairKey(
    { entityType: row.srcType, entityId: row.srcId },
    { entityType: row.dstType, entityId: row.dstId },
  );
}

function blurb(title: string, description: string | null): string {
  return excerptText(`${title}\n${description ?? ""}`, 400);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
