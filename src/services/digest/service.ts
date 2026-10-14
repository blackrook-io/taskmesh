import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { alias } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema.js";
import { classifyDigest, type DigestChange, type DigestNotice, type DigestSubject } from "../../lib/digestClassify.js";
import {
  changeWindowStart,
  parseDigestPrefs,
  readDigestCounts,
  readDigestEnabled,
  readDigestSections,
  readExcludedProjects,
  shouldSummarize,
  summaryFactLines,
  withheldProjects,
  type DigestCounts,
  type DigestEnabled,
  type DigestFrequency,
  type DigestSections,
} from "../../lib/digest.js";
import { digestPeriod } from "../../lib/digestSignals.js";
import { ACTIVITY_UPDATE_FIELDS } from "../../lib/entityActivity.js";
import { formatEntityRef } from "../../lib/entityRef.js";
import { isEntityType, type EntityType } from "../../lib/entityType.js";
import { resolveEffectiveAiAccess, resolveEffectiveLocalOnly } from "../assistant/projectAiAccess.js";
import { hrefFor } from "../references.js";
import { getSystemProperties } from "../systemProperties.js";
import { digestFeatureOff, writeDigestSummary } from "./summary.js";

export type Db = NodePgDatabase<typeof schema>;

const assigneeUser = alias(schema.users, "digest_assignee");

export type DigestView = {
  id: number;
  periodKey: string;
  frequency: DigestFrequency;
  timeZone: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  sections: DigestSections;
  counts: DigestCounts;
  enabled: DigestEnabled;
  summary: string | null;
  summarySource: "model" | null;
  excludedProjects: { id: number; name: string }[];
};

type End = {
  title: string;
  number: number;
  projectId: number | null;
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function taskProgress(done: number | null, total: number | null): number | null {
  if (done == null || total == null || total <= 0) return null;
  return Math.round((100 * done) / total);
}

function audienceOf(ownerId: number, assigneeId: number | null, userId: number): DigestSubject["audience"] | null {
  if (assigneeId === userId) return "action";
  if (assigneeId == null && ownerId === userId) return "action";
  if (ownerId === userId && assigneeId != null && assigneeId !== userId) return "assigned_out";
  return null;
}

function toView(row: typeof schema.attentionDigests.$inferSelect): DigestView {
  const frequency = row.frequency === "weekly" ? "weekly" : "daily";
  return {
    id: row.id,
    periodKey: row.periodKey,
    frequency,
    timeZone: row.timeZone,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    generatedAt: row.generatedAt.toISOString(),
    sections: readDigestSections(row.sections),
    counts: readDigestCounts(row.counts),
    enabled: readDigestEnabled(row.enabled),
    summary: row.summary,
    summarySource: row.summarySource === "model" ? "model" : null,
    excludedProjects: readExcludedProjects(row.excludedProjects),
  };
}

export async function listDigests(db: Db, userId: number, limit: number): Promise<DigestView[]> {
  const rows = await db
    .select()
    .from(schema.attentionDigests)
    .where(eq(schema.attentionDigests.userId, userId))
    .orderBy(desc(schema.attentionDigests.generatedAt))
    .limit(limit);
  return rows.map(toView);
}

export async function getDigest(db: Db, userId: number, id: number): Promise<DigestView | null> {
  const [row] = await db
    .select()
    .from(schema.attentionDigests)
    .where(and(eq(schema.attentionDigests.id, id), eq(schema.attentionDigests.userId, userId)))
    .limit(1);
  return row ? toView(row) : null;
}

export async function buildDigest(
  db: Db,
  userId: number,
  opts: { replace: boolean; now?: Date },
): Promise<DigestView | null> {
  const now = opts.now ?? new Date();
  const [user] = await db
    .select({
      id: schema.users.id,
      deactivatedAt: schema.users.deactivatedAt,
      lockedAt: schema.users.lockedAt,
      digestPrefs: schema.users.digestPrefs,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user || user.deactivatedAt || user.lockedAt) return null;

  const prefs = parseDigestPrefs(user.digestPrefs);
  const period = digestPeriod(now, prefs);
  const [existing] = await db
    .select()
    .from(schema.attentionDigests)
    .where(and(eq(schema.attentionDigests.userId, userId), eq(schema.attentionDigests.periodKey, period.key)))
    .limit(1);
  if (existing && !opts.replace) return toView(existing);
  if (!opts.replace && !period.due) return existing ? toView(existing) : null;

  const props = await getSystemProperties(db);
  const subjects = await loadSubjects(db, userId);
  const [previous] = await db
    .select({ generatedAt: schema.attentionDigests.generatedAt })
    .from(schema.attentionDigests)
    .where(and(eq(schema.attentionDigests.userId, userId), ne(schema.attentionDigests.periodKey, period.key)))
    .orderBy(desc(schema.attentionDigests.generatedAt))
    .limit(1);
  const since = changeWindowStart(previous?.generatedAt ?? null, period.start);
  await applySignals(db, subjects);
  const changes = await loadChanges(db, subjects, since);
  const suggestions = await loadSuggestions(db, userId);
  const duplicates = await loadDuplicates(db, userId);
  const classified = classifyDigest({
    subjects,
    changes,
    suggestions,
    duplicates,
    now,
    timeZone: prefs.timeZone,
    staleDays: props.meshAppearance.staleDays,
    since,
    enabled: prefs.sections,
  });

  const projectIds = projectIdsIn(classified.sections);
  const access = new Map<number, string>();
  const names = new Map<number, string>();
  if (projectIds.length > 0) {
    const rows = await db
      .select({ id: schema.projects.id, name: schema.projects.name })
      .from(schema.projects)
      .where(inArray(schema.projects.id, projectIds));
    for (const row of rows) names.set(row.id, row.name);
    for (const projectId of projectIds) {
      access.set(projectId, (await resolveEffectiveAiAccess(db, projectId)) ?? "full");
    }
  }
  const excluded = new Set(
    [...access.entries()].filter(([, value]) => value === "excluded").map(([id]) => id),
  );
  const excludedProjects = withheldProjects(classified.sections, access, names);
  const lines = summaryFactLines(classified.sections, excluded);
  const featureOff = await digestFeatureOff(db, userId);
  let summary: string | null = null;
  let summarySource: "model" | null = null;
  if (shouldSummarize({ enabled: prefs.summary, featureOff, lineCount: lines.length })) {
    let localOnly = false;
    for (const projectId of projectIds) {
      if (excluded.has(projectId)) continue;
      if ((await resolveEffectiveLocalOnly(db, projectId)) === true) {
        localOnly = true;
        break;
      }
    }
    const written = await writeDigestSummary(db, { userId, lines, localOnly });
    summary = written.summary;
    summarySource = written.source;
  }

  const values = {
    userId,
    periodKey: period.key,
    frequency: prefs.frequency,
    timeZone: prefs.timeZone,
    periodStart: period.start,
    periodEnd: period.end,
    generatedAt: now,
    sections: classified.sections,
    counts: classified.counts,
    enabled: prefs.sections,
    summary,
    summarySource,
    excludedProjects,
  };
  const [saved] = opts.replace
    ? await db
        .insert(schema.attentionDigests)
        .values(values)
        .onConflictDoUpdate({
          target: [schema.attentionDigests.userId, schema.attentionDigests.periodKey],
          set: {
            frequency: values.frequency,
            timeZone: values.timeZone,
            periodStart: values.periodStart,
            periodEnd: values.periodEnd,
            generatedAt: values.generatedAt,
            sections: values.sections,
            counts: values.counts,
            enabled: values.enabled,
            summary: values.summary,
            summarySource: values.summarySource,
            excludedProjects: values.excludedProjects,
          },
        })
        .returning()
    : await db.insert(schema.attentionDigests).values(values).onConflictDoNothing().returning();
  if (saved) return toView(saved);
  const [row] = await db
    .select()
    .from(schema.attentionDigests)
    .where(and(eq(schema.attentionDigests.userId, userId), eq(schema.attentionDigests.periodKey, period.key)))
    .limit(1);
  return row ? toView(row) : null;
}

function projectIdsIn(sections: DigestSections): number[] {
  const ids = new Set<number>();
  for (const list of Object.values(sections)) {
    for (const item of list) {
      if (item.projectId != null) ids.add(item.projectId);
      if (item.alsoProjectId != null) ids.add(item.alsoProjectId);
    }
  }
  return [...ids];
}

async function loadSubjects(db: Db, userId: number): Promise<DigestSubject[]> {
  const subjects: DigestSubject[] = [];
  const taskRows = await db
    .select({
      id: schema.tasks.id,
      number: schema.tasks.number,
      title: schema.tasks.title,
      projectId: schema.tasks.projectId,
      state: schema.tasks.state,
      dueDate: schema.tasks.dueDate,
      createdAt: schema.tasks.createdAt,
      ownerId: schema.tasks.ownerId,
      assigneeId: schema.tasks.assigneeId,
      assigneeName: assigneeUser.displayName,
      rollupDone: schema.tasks.rollupDone,
      rollupTotal: schema.tasks.rollupTotal,
    })
    .from(schema.tasks)
    .leftJoin(assigneeUser, eq(schema.tasks.assigneeId, assigneeUser.id))
    .where(
      and(
        ne(schema.tasks.state, "deleted"),
        or(
          eq(schema.tasks.assigneeId, userId),
          and(isNull(schema.tasks.assigneeId), eq(schema.tasks.ownerId, userId)),
          and(eq(schema.tasks.ownerId, userId), isNotNull(schema.tasks.assigneeId), ne(schema.tasks.assigneeId, userId)),
        ),
      ),
    );
  for (const row of taskRows) {
    const audience = audienceOf(row.ownerId, row.assigneeId, userId);
    if (!audience) continue;
    subjects.push({
      entityType: "task",
      entityId: row.id,
      referenceId: formatEntityRef("task", row.number),
      title: row.title,
      projectId: row.projectId,
      href: hrefFor("task", row.id, row.projectId),
      state: row.state,
      progress: taskProgress(row.rollupDone, row.rollupTotal),
      dueDate: row.dueDate,
      createdAt: iso(row.createdAt),
      signalAt: iso(row.createdAt),
      audience,
      assigneeName: row.assigneeName,
    });
  }

  const todoRows = await db
    .select({
      id: schema.todos.id,
      number: schema.todos.number,
      title: schema.todos.title,
      projectId: schema.todos.projectId,
      state: schema.todos.state,
      progress: schema.todos.progress,
      dueDate: schema.todos.dueDate,
      createdAt: schema.todos.createdAt,
      ownerId: schema.todos.ownerId,
      assigneeId: schema.todos.assigneeId,
      assigneeName: assigneeUser.displayName,
    })
    .from(schema.todos)
    .leftJoin(assigneeUser, eq(schema.todos.assigneeId, assigneeUser.id))
    .where(
      and(
        ne(schema.todos.state, "deleted"),
        or(
          eq(schema.todos.assigneeId, userId),
          and(isNull(schema.todos.assigneeId), eq(schema.todos.ownerId, userId)),
          and(eq(schema.todos.ownerId, userId), isNotNull(schema.todos.assigneeId), ne(schema.todos.assigneeId, userId)),
        ),
      ),
    );
  for (const row of todoRows) {
    const audience = audienceOf(row.ownerId, row.assigneeId, userId);
    if (!audience) continue;
    subjects.push({
      entityType: "todo",
      entityId: row.id,
      referenceId: formatEntityRef("todo", row.number),
      title: row.title,
      projectId: row.projectId,
      href: hrefFor("todo", row.id, row.projectId),
      state: row.state,
      progress: row.progress,
      dueDate: row.dueDate,
      createdAt: iso(row.createdAt),
      signalAt: iso(row.createdAt),
      audience,
      assigneeName: row.assigneeName,
    });
  }

  const projects = await db
    .select({
      id: schema.projects.id,
      number: schema.projects.number,
      name: schema.projects.name,
      status: schema.projects.status,
      createdAt: schema.projects.createdAt,
    })
    .from(schema.projects)
    .where(eq(schema.projects.ownerId, userId));
  for (const row of projects) {
    subjects.push({
      entityType: "project",
      entityId: row.id,
      referenceId: formatEntityRef("project", row.number),
      title: row.name,
      projectId: row.id,
      href: hrefFor("project", row.id, row.id),
      state: row.status === "done" ? "complete" : row.status,
      progress: null,
      dueDate: null,
      createdAt: iso(row.createdAt),
      signalAt: iso(row.createdAt),
      audience: "container",
      assigneeName: null,
    });
  }

  const documents = await db
    .select({
      id: schema.projectDocuments.id,
      number: schema.projectDocuments.number,
      title: schema.projectDocuments.title,
      projectId: schema.projectDocuments.projectId,
      createdAt: schema.projectDocuments.createdAt,
    })
    .from(schema.projectDocuments)
    .innerJoin(schema.projects, eq(schema.projectDocuments.projectId, schema.projects.id))
    .where(eq(schema.projects.ownerId, userId));
  for (const row of documents) {
    subjects.push({
      entityType: "document",
      entityId: row.id,
      referenceId: formatEntityRef("document", row.number),
      title: row.title,
      projectId: row.projectId,
      href: hrefFor("document", row.id, row.projectId),
      state: null,
      progress: null,
      dueDate: null,
      createdAt: iso(row.createdAt),
      signalAt: iso(row.createdAt),
      audience: "container",
      assigneeName: null,
    });
  }

  const lists = await db
    .select({
      id: schema.todoLists.id,
      number: schema.todoLists.number,
      title: schema.todoLists.title,
      projectId: schema.todoLists.projectId,
      createdAt: schema.todoLists.createdAt,
    })
    .from(schema.todoLists)
    .where(eq(schema.todoLists.ownerId, userId));
  for (const row of lists) {
    subjects.push({
      entityType: "todo_list",
      entityId: row.id,
      referenceId: formatEntityRef("todo_list", row.number),
      title: row.title,
      projectId: row.projectId,
      href: hrefFor("todo_list", row.id, row.projectId),
      state: null,
      progress: null,
      dueDate: null,
      createdAt: iso(row.createdAt),
      signalAt: iso(row.createdAt),
      audience: "container",
      assigneeName: null,
    });
  }
  return subjects;
}

async function applySignals(db: Db, subjects: DigestSubject[]): Promise<void> {
  const groups = new Map<string, number[]>();
  for (const subject of subjects) {
    const ids = groups.get(subject.entityType) ?? [];
    ids.push(subject.entityId);
    groups.set(subject.entityType, ids);
  }
  const signals = new Map<string, string>();
  for (const [entityType, ids] of groups) {
    if (ids.length === 0) continue;
    const rows = await db
      .select({
        entityId: schema.taskActivity.entityId,
        at: sql<string>`max(${schema.taskActivity.createdAt})::text`,
      })
      .from(schema.taskActivity)
      .where(
        and(
          eq(schema.taskActivity.entityType, entityType),
          inArray(schema.taskActivity.entityId, ids),
          eq(schema.taskActivity.kind, "change"),
          inArray(schema.taskActivity.field, [...ACTIVITY_UPDATE_FIELDS]),
        ),
      )
      .groupBy(schema.taskActivity.entityId);
    for (const row of rows) {
      const at = iso(row.at);
      if (at) signals.set(`${entityType}:${row.entityId}`, at);
    }
  }
  for (const subject of subjects) {
    subject.signalAt = signals.get(`${subject.entityType}:${subject.entityId}`) ?? subject.createdAt;
  }
}

async function loadChanges(db: Db, subjects: DigestSubject[], since: Date): Promise<DigestChange[]> {
  const groups = new Map<string, number[]>();
  for (const subject of subjects) {
    if (subject.audience === "assigned_out") continue;
    const ids = groups.get(subject.entityType) ?? [];
    ids.push(subject.entityId);
    groups.set(subject.entityType, ids);
  }
  const clauses: SQL[] = [];
  for (const [entityType, ids] of groups) {
    if (ids.length === 0) continue;
    const clause = and(eq(schema.taskActivity.entityType, entityType), inArray(schema.taskActivity.entityId, ids));
    if (clause) clauses.push(clause);
  }
  if (clauses.length === 0) return [];
  const rows = await db
    .select({
      entityType: schema.taskActivity.entityType,
      entityId: schema.taskActivity.entityId,
      kind: schema.taskActivity.kind,
      field: schema.taskActivity.field,
      oldValue: schema.taskActivity.oldValue,
      newValue: schema.taskActivity.newValue,
      createdAt: schema.taskActivity.createdAt,
    })
    .from(schema.taskActivity)
    .where(
      and(
        gt(schema.taskActivity.createdAt, since),
        inArray(schema.taskActivity.kind, ["change", "comment"]),
        or(...clauses),
      ),
    )
    .orderBy(desc(schema.taskActivity.createdAt))
    .limit(500);
  return rows.map((row) => ({
    entityType: row.entityType,
    entityId: row.entityId,
    at: row.createdAt.toISOString(),
    reason: changeReason(row),
  }));
}

function changeReason(row: {
  kind: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
}): string {
  if (row.kind === "comment") return "New comment";
  const field = row.field ?? "change";
  const prev = row.oldValue?.trim() || "";
  const next = row.newValue?.trim() || "";
  if (prev || next) return `${field}: ${prev || "none"} → ${next || "none"}`.slice(0, 160);
  if (field === "body") return "Body updated";
  return "Updated";
}

async function loadSuggestions(db: Db, userId: number): Promise<DigestNotice[]> {
  const rows = await db
    .select({
      entityType: schema.aiTagSuggestions.entityType,
      entityId: schema.aiTagSuggestions.entityId,
      proposedName: schema.aiTagSuggestions.proposedName,
      tagName: schema.tags.name,
    })
    .from(schema.aiTagSuggestions)
    .leftJoin(schema.tags, eq(schema.aiTagSuggestions.tagId, schema.tags.id))
    .where(and(eq(schema.aiTagSuggestions.userId, userId), eq(schema.aiTagSuggestions.status, "pending")))
    .orderBy(desc(schema.aiTagSuggestions.createdAt))
    .limit(200);
  const notices: DigestNotice[] = [];
  for (const row of rows) {
    if (!isEntityType(row.entityType)) continue;
    const end = await loadEnd(db, row.entityType, row.entityId);
    if (!end) continue;
    const tag = row.tagName ?? row.proposedName ?? "tag";
    notices.push({
      entityType: row.entityType,
      entityId: row.entityId,
      referenceId: formatEntityRef(row.entityType, end.number),
      title: end.title,
      projectId: end.projectId,
      href: hrefFor(row.entityType, row.entityId, end.projectId),
      reason: `Suggested tag: ${tag}`,
    });
  }
  return notices;
}

async function loadDuplicates(db: Db, userId: number): Promise<DigestNotice[]> {
  const rows = await db
    .select({
      aType: schema.aiDuplicatePairs.aType,
      aId: schema.aiDuplicatePairs.aId,
      bType: schema.aiDuplicatePairs.bType,
      bId: schema.aiDuplicatePairs.bId,
      score: schema.aiDuplicatePairs.score,
    })
    .from(schema.aiDuplicatePairs)
    .where(and(eq(schema.aiDuplicatePairs.userId, userId), eq(schema.aiDuplicatePairs.status, "pending")))
    .orderBy(desc(schema.aiDuplicatePairs.score))
    .limit(200);
  const notices: DigestNotice[] = [];
  for (const row of rows) {
    if (!isEntityType(row.aType) || !isEntityType(row.bType)) continue;
    const a = await loadEnd(db, row.aType, row.aId);
    const b = await loadEnd(db, row.bType, row.bId);
    if (!a || !b) continue;
    const bRef = formatEntityRef(row.bType, b.number);
    notices.push({
      entityType: row.aType,
      entityId: row.aId,
      referenceId: formatEntityRef(row.aType, a.number),
      title: a.title,
      projectId: a.projectId,
      alsoProjectId: b.projectId,
      href: hrefFor(row.aType, row.aId, a.projectId),
      reason: `Possible duplicate of ${bRef} ${b.title}`,
      score: row.score,
    });
  }
  return notices;
}

async function loadEnd(db: Db, entityType: EntityType, entityId: number): Promise<End | null> {
  if (entityType === "task") {
    const [row] = await db
      .select({ title: schema.tasks.title, number: schema.tasks.number, projectId: schema.tasks.projectId })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, entityId), ne(schema.tasks.state, "deleted")))
      .limit(1);
    return row ?? null;
  }
  if (entityType === "todo") {
    const [row] = await db
      .select({ title: schema.todos.title, number: schema.todos.number, projectId: schema.todos.projectId })
      .from(schema.todos)
      .where(and(eq(schema.todos.id, entityId), ne(schema.todos.state, "deleted")))
      .limit(1);
    return row ?? null;
  }
  if (entityType === "project") {
    const [row] = await db
      .select({ title: schema.projects.name, number: schema.projects.number })
      .from(schema.projects)
      .where(eq(schema.projects.id, entityId))
      .limit(1);
    return row ? { ...row, projectId: entityId } : null;
  }
  if (entityType === "document") {
    const [row] = await db
      .select({
        title: schema.projectDocuments.title,
        number: schema.projectDocuments.number,
        projectId: schema.projectDocuments.projectId,
      })
      .from(schema.projectDocuments)
      .where(eq(schema.projectDocuments.id, entityId))
      .limit(1);
    return row ?? null;
  }
  if (entityType === "idea") {
    const [row] = await db
      .select({ title: schema.ideas.title, number: schema.ideas.number })
      .from(schema.ideas)
      .where(eq(schema.ideas.id, entityId))
      .limit(1);
    return row ? { ...row, projectId: null } : null;
  }
  return null;
}
