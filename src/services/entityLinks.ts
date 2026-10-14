import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { formatEntityRef } from "../lib/entityRef.js";
import { isEntityType, type EntityType } from "../lib/entityType.js";
import {
  entityEndKey,
  filterLinksVisibleAtBothEnds,
  isLinkOrigin,
  isLinkRelation,
  isSelfLink,
  type EntityEndRef,
  type LinkOrigin,
  type LinkRelation,
} from "../lib/entityLinkRules.js";
import { hrefFor } from "./references.js";
import {
  dualScopeListFilter,
  ownerScope,
  projectAccessListFilter,
  projectOwnedListFilter,
} from "./ownership.js";

type Db = NodePgDatabase<typeof schema>;

export type LinkActor = {
  userId: number;
  isAdministrator: boolean;
};

export type LinkEntityEnd = {
  entityType: EntityType;
  id: number;
  referenceId: string;
  title: string;
  href: string;
  projectId: number | null;
};

export type LinkListItem = {
  id: number;
  relation: LinkRelation;
  origin: LinkOrigin;
  createdAt: Date;
  entity: LinkEntityEnd;
};

export type EntityLinkRecord = {
  id: number;
  relation: LinkRelation;
  origin: LinkOrigin;
  createdAt: Date;
  src: LinkEntityEnd;
  dst: LinkEntityEnd;
};

export class EntityLinkError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "EntityLinkError";
    this.status = status;
    this.code = code;
  }
}

type StoredLink = typeof schema.entityLinks.$inferSelect;

type EndRow = {
  id: number;
  number: number;
  title: string;
  projectId: number | null;
};

function groupIds(refs: EntityEndRef[]): Map<EntityType, number[]> {
  const grouped = new Map<EntityType, number[]>();
  for (const ref of refs) {
    if (!isEntityType(ref.entityType)) continue;
    const ids = grouped.get(ref.entityType) ?? [];
    ids.push(ref.id);
    grouped.set(ref.entityType, ids);
  }
  return grouped;
}

async function loadEndRows(
  db: Db,
  entityType: EntityType,
  ids: number[],
  actor: LinkActor,
): Promise<EndRow[]> {
  if (ids.length === 0) return [];
  const { userId, isAdministrator } = actor;

  if (entityType === "task") {
    return db
      .select({
        id: schema.tasks.id,
        number: schema.tasks.number,
        title: schema.tasks.title,
        projectId: schema.tasks.projectId,
      })
      .from(schema.tasks)
      .where(
        and(
          inArray(schema.tasks.id, ids),
          ne(schema.tasks.state, "deleted"),
          dualScopeListFilter(db, schema.tasks.projectId, schema.tasks.ownerId, userId, isAdministrator) ??
            sql`true`,
        ),
      );
  }

  if (entityType === "todo") {
    return db
      .select({
        id: schema.todos.id,
        number: schema.todos.number,
        title: schema.todos.title,
        projectId: schema.todos.projectId,
      })
      .from(schema.todos)
      .where(
        and(
          inArray(schema.todos.id, ids),
          ne(schema.todos.state, "deleted"),
          dualScopeListFilter(db, schema.todos.projectId, schema.todos.ownerId, userId, isAdministrator) ??
            sql`true`,
        ),
      );
  }

  if (entityType === "idea") {
    const rows = await db
      .select({
        id: schema.ideas.id,
        number: schema.ideas.number,
        title: schema.ideas.title,
      })
      .from(schema.ideas)
      .where(
        and(
          inArray(schema.ideas.id, ids),
          ownerScope(schema.ideas.ownerId, userId, isAdministrator) ?? sql`true`,
        ),
      );
    return rows.map((row) => ({ ...row, projectId: null }));
  }

  if (entityType === "project") {
    const rows = await db
      .select({
        id: schema.projects.id,
        number: schema.projects.number,
        title: schema.projects.name,
      })
      .from(schema.projects)
      .where(
        and(
          inArray(schema.projects.id, ids),
          projectAccessListFilter(db, userId, isAdministrator) ?? sql`true`,
        ),
      );
    return rows.map((row) => ({ ...row, projectId: row.id }));
  }

  if (entityType === "document") {
    return db
      .select({
        id: schema.projectDocuments.id,
        number: schema.projectDocuments.number,
        title: schema.projectDocuments.title,
        projectId: schema.projectDocuments.projectId,
      })
      .from(schema.projectDocuments)
      .where(
        and(
          inArray(schema.projectDocuments.id, ids),
          projectOwnedListFilter(db, schema.projectDocuments.projectId, userId, isAdministrator) ??
            sql`true`,
        ),
      );
  }

  if (entityType === "board") {
    return db
      .select({
        id: schema.boards.id,
        number: schema.boards.number,
        title: schema.boards.name,
        projectId: schema.boards.projectId,
      })
      .from(schema.boards)
      .where(
        and(
          inArray(schema.boards.id, ids),
          projectOwnedListFilter(db, schema.boards.projectId, userId, isAdministrator) ?? sql`true`,
        ),
      );
  }

  if (entityType === "canvas") {
    return db
      .select({
        id: schema.canvases.id,
        number: schema.canvases.number,
        title: schema.canvases.title,
        projectId: schema.canvases.projectId,
      })
      .from(schema.canvases)
      .where(
        and(
          inArray(schema.canvases.id, ids),
          projectOwnedListFilter(db, schema.canvases.projectId, userId, isAdministrator) ?? sql`true`,
        ),
      );
  }

  if (entityType === "wiki_node") {
    return db
      .select({
        id: schema.wikiNodes.id,
        number: schema.wikiNodes.number,
        title: schema.wikiNodes.title,
        projectId: schema.wikiNodes.projectId,
      })
      .from(schema.wikiNodes)
      .where(
        and(
          inArray(schema.wikiNodes.id, ids),
          projectOwnedListFilter(db, schema.wikiNodes.projectId, userId, isAdministrator) ?? sql`true`,
        ),
      );
  }

  if (entityType === "todo_list") {
    return db
      .select({
        id: schema.todoLists.id,
        number: schema.todoLists.number,
        title: schema.todoLists.title,
        projectId: schema.todoLists.projectId,
      })
      .from(schema.todoLists)
      .where(
        and(
          inArray(schema.todoLists.id, ids),
          dualScopeListFilter(
            db,
            schema.todoLists.projectId,
            schema.todoLists.ownerId,
            userId,
            isAdministrator,
          ) ?? sql`true`,
        ),
      );
  }

  if (entityType === "image_board") {
    return db
      .select({
        id: schema.imageBoards.id,
        number: schema.imageBoards.number,
        title: schema.imageBoards.title,
        projectId: schema.imageBoards.projectId,
      })
      .from(schema.imageBoards)
      .where(
        and(
          inArray(schema.imageBoards.id, ids),
          dualScopeListFilter(
            db,
            schema.imageBoards.projectId,
            schema.imageBoards.ownerId,
            userId,
            isAdministrator,
          ) ?? sql`true`,
        ),
      );
  }

  if (entityType === "plan") {
    return db
      .select({
        id: schema.plans.id,
        number: schema.plans.number,
        title: schema.plans.title,
        projectId: schema.plans.projectId,
      })
      .from(schema.plans)
      .where(
        and(
          inArray(schema.plans.id, ids),
          dualScopeListFilter(
            db,
            schema.plans.projectId,
            schema.plans.ownerId,
            userId,
            isAdministrator,
          ) ?? sql`true`,
        ),
      );
  }

  const _exhaustive: never = entityType;
  return _exhaustive;
}

export async function loadVisibleEnds(
  db: Db,
  refs: EntityEndRef[],
  actor: LinkActor,
): Promise<Map<string, LinkEntityEnd>> {
  const ends = new Map<string, LinkEntityEnd>();
  for (const [entityType, ids] of groupIds(refs)) {
    const uniqueIds = [...new Set(ids)];
    const rows = await loadEndRows(db, entityType, uniqueIds, actor);
    for (const row of rows) {
      ends.set(entityEndKey(entityType, row.id), {
        entityType,
        id: row.id,
        referenceId: formatEntityRef(entityType, row.number),
        title: row.title,
        href: hrefFor(entityType, row.id, row.projectId),
        projectId: row.projectId,
      });
    }
  }
  return ends;
}

function toRecord(row: StoredLink, ends: Map<string, LinkEntityEnd>): EntityLinkRecord | null {
  if (!isLinkRelation(row.relation) || !isLinkOrigin(row.origin)) return null;
  const src = ends.get(entityEndKey(row.srcType, row.srcId));
  const dst = ends.get(entityEndKey(row.dstType, row.dstId));
  if (!src || !dst) return null;
  return {
    id: row.id,
    relation: row.relation,
    origin: row.origin,
    createdAt: row.createdAt,
    src,
    dst,
  };
}

async function linksTouching(
  db: Db,
  entityType: EntityType,
  entityId: number,
): Promise<StoredLink[]> {
  return db
    .select()
    .from(schema.entityLinks)
    .where(
      or(
        and(eq(schema.entityLinks.srcType, entityType), eq(schema.entityLinks.srcId, entityId)),
        and(eq(schema.entityLinks.dstType, entityType), eq(schema.entityLinks.dstId, entityId)),
      ),
    )
    .orderBy(asc(schema.entityLinks.createdAt), asc(schema.entityLinks.id));
}

export async function listEntityLinks(
  db: Db,
  entityType: EntityType,
  entityId: number,
  actor: LinkActor,
): Promise<{ outgoing: LinkListItem[]; incoming: LinkListItem[] }> {
  const rows = await linksTouching(db, entityType, entityId);
  const refs: EntityEndRef[] = [{ entityType, id: entityId }];
  for (const row of rows) {
    refs.push({ entityType: row.srcType, id: row.srcId });
    refs.push({ entityType: row.dstType, id: row.dstId });
  }
  const ends = await loadVisibleEnds(db, refs, actor);
  const visible = filterLinksVisibleAtBothEnds(
    rows.map((row) => ({
      row,
      src: { entityType: row.srcType, id: row.srcId },
      dst: { entityType: row.dstType, id: row.dstId },
    })),
    new Set(ends.keys()),
  );

  const outgoing: LinkListItem[] = [];
  const incoming: LinkListItem[] = [];
  for (const link of visible) {
    const record = toRecord(link.row, ends);
    if (!record) continue;
    if (link.row.srcType === entityType && link.row.srcId === entityId) {
      outgoing.push({
        id: record.id,
        relation: record.relation,
        origin: record.origin,
        createdAt: record.createdAt,
        entity: record.dst,
      });
    }
    if (link.row.dstType === entityType && link.row.dstId === entityId) {
      incoming.push({
        id: record.id,
        relation: record.relation,
        origin: record.origin,
        createdAt: record.createdAt,
        entity: record.src,
      });
    }
  }
  return { outgoing, incoming };
}

export async function createManualLink(
  db: Db,
  input: {
    srcType: EntityType;
    srcId: number;
    dstType: EntityType;
    dstId: number;
    relation?: LinkRelation;
    createdById: number;
  },
  actor: LinkActor,
): Promise<{ created: boolean; link: EntityLinkRecord }> {
  const relation = input.relation ?? "relates_to";
  if (!isLinkRelation(relation)) {
    throw new EntityLinkError(400, "validation_error", "Unknown link relation.");
  }
  if (isSelfLink(input.srcType, input.srcId, input.dstType, input.dstId)) {
    throw new EntityLinkError(400, "validation_error", "A record cannot link to itself.");
  }

  const inserted = await db
    .insert(schema.entityLinks)
    .values({
      srcType: input.srcType,
      srcId: input.srcId,
      dstType: input.dstType,
      dstId: input.dstId,
      relation,
      origin: "manual",
      createdById: input.createdById,
    })
    .onConflictDoNothing({
      target: [
        schema.entityLinks.srcType,
        schema.entityLinks.srcId,
        schema.entityLinks.dstType,
        schema.entityLinks.dstId,
        schema.entityLinks.relation,
        schema.entityLinks.origin,
      ],
    })
    .returning();

  const row =
    inserted[0] ??
    (
      await db
        .select()
        .from(schema.entityLinks)
        .where(
          and(
            eq(schema.entityLinks.srcType, input.srcType),
            eq(schema.entityLinks.srcId, input.srcId),
            eq(schema.entityLinks.dstType, input.dstType),
            eq(schema.entityLinks.dstId, input.dstId),
            eq(schema.entityLinks.relation, relation),
            eq(schema.entityLinks.origin, "manual"),
          ),
        )
    )[0];

  if (!row) {
    throw new EntityLinkError(500, "insert_failed", "Could not store the link.");
  }

  const ends = await loadVisibleEnds(
    db,
    [
      { entityType: row.srcType, id: row.srcId },
      { entityType: row.dstType, id: row.dstId },
    ],
    actor,
  );
  const link = toRecord(row, ends);
  if (!link) {
    throw new EntityLinkError(500, "insert_failed", "Could not resolve the link.");
  }
  return { created: inserted.length > 0, link };
}

export async function deleteManualLink(db: Db, linkId: number): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.entityLinks)
    .where(eq(schema.entityLinks.id, linkId));
  if (!row) {
    throw new EntityLinkError(404, "not_found", "Link not found.");
  }
  if (row.origin !== "manual") {
    throw new EntityLinkError(403, "link_not_manual", "Only manual links can be deleted here.");
  }
  await db.delete(schema.entityLinks).where(eq(schema.entityLinks.id, linkId));
}
