import { and, asc, eq, ilike, ne, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import * as schema from "../db/schema.js";
import {
  ENTITY_REF_PREFIXES,
  formatEntityRef,
  parseEntityRefToken,
} from "../lib/entityRef.js";
import type { EntityType } from "../lib/entityType.js";
import { formatUserNumber } from "../lib/userFields.js";

type Db = NodePgDatabase<typeof schema>;

export type ReferenceHit = {
  entityType: EntityType | "user";
  id: number;
  number: number;
  title: string;
  referenceId: string;
  href: string;
  projectId: number | null;
};

function hrefFor(
  entityType: EntityType,
  id: number,
  projectId: number | null,
): string {
  switch (entityType) {
    case "task":
      return `/tasks?open=${id}`;
    case "idea":
      return `/ideas/${id}`;
    case "project":
      return `/projects/${id}`;
    case "document":
      return projectId != null
        ? `/projects/${projectId}?tab=documents&doc=${id}`
        : "/";
    case "board":
      return projectId != null
        ? `/projects/${projectId}?tab=boards&board=${id}`
        : "/";
    case "canvas":
      return projectId != null
        ? `/projects/${projectId}?tab=canvases&canvas=${id}`
        : "/";
    case "wiki_node":
      return projectId != null
        ? `/projects/${projectId}?tab=wiki&node=${id}`
        : "/";
    case "todo_list":
      return `/todos/${id}`;
    case "image_board":
      return `/image-board/${id}`;
    default:
      return "/";
  }
}

function matchNumberOrTitle(opts: {
  numberCol: AnyPgColumn;
  titleCol: AnyPgColumn;
  prefix: string;
  q: string;
  exactNumber: number | null;
}) {
  const { numberCol, titleCol, prefix, q, exactNumber } = opts;
  const titlePattern = q ? `%${q}%` : "%";
  const pattern = q ? `%${q}%` : "%";
  const displaySql = sql`(${prefix} || LPAD(CAST(${numberCol} AS TEXT), 4, '0'))`;
  return or(
    ilike(titleCol, titlePattern),
    sql`CAST(${numberCol} AS TEXT) ILIKE ${pattern}`,
    sql`${displaySql} ILIKE ${pattern}`,
    exactNumber != null && Number.isFinite(exactNumber)
      ? eq(numberCol, exactNumber)
      : sql`false`,
  );
}

function toHits(
  entityType: EntityType,
  rows: { id: number; number: number; title: string; projectId: number | null }[],
): ReferenceHit[] {
  return rows.map((r) => ({
    entityType,
    id: r.id,
    number: r.number,
    title: r.title,
    referenceId: formatEntityRef(entityType, r.number),
    href: hrefFor(entityType, r.id, r.projectId),
    projectId: r.projectId,
  }));
}

export async function searchEntityReferences(
  db: Db,
  entityType: EntityType,
  q: string,
  opts?: { limit?: number },
): Promise<ReferenceHit[]> {
  const trimmed = q.trim();
  const limit = opts?.limit ?? 20;
  const parsed = parseEntityRefToken(trimmed, entityType);
  const searchQ = parsed.query;
  const exactNumber = parsed.number;
  const prefix = ENTITY_REF_PREFIXES[entityType];

  if (entityType === "task") {
    const rows = await db
      .select({
        id: schema.tasks.id,
        number: schema.tasks.number,
        title: schema.tasks.title,
        projectId: schema.tasks.projectId,
      })
      .from(schema.tasks)
      .where(
        and(
          ne(schema.tasks.state, "deleted"),
          matchNumberOrTitle({
            numberCol: schema.tasks.number,
            titleCol: schema.tasks.title,
            prefix,
            q: searchQ,
            exactNumber,
          }),
        ),
      )
      .orderBy(asc(schema.tasks.number))
      .limit(limit);
    return toHits(entityType, rows);
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
        matchNumberOrTitle({
          numberCol: schema.ideas.number,
          titleCol: schema.ideas.title,
          prefix,
          q: searchQ,
          exactNumber,
        }),
      )
      .orderBy(asc(schema.ideas.number))
      .limit(limit);
    return toHits(
      entityType,
      rows.map((r) => ({ ...r, projectId: null })),
    );
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
        matchNumberOrTitle({
          numberCol: schema.projects.number,
          titleCol: schema.projects.name,
          prefix,
          q: searchQ,
          exactNumber,
        }),
      )
      .orderBy(asc(schema.projects.number))
      .limit(limit);
    return toHits(
      entityType,
      rows.map((r) => ({ ...r, projectId: r.id })),
    );
  }

  if (entityType === "document") {
    const rows = await db
      .select({
        id: schema.projectDocuments.id,
        number: schema.projectDocuments.number,
        title: schema.projectDocuments.title,
        projectId: schema.projectDocuments.projectId,
      })
      .from(schema.projectDocuments)
      .where(
        matchNumberOrTitle({
          numberCol: schema.projectDocuments.number,
          titleCol: schema.projectDocuments.title,
          prefix,
          q: searchQ,
          exactNumber,
        }),
      )
      .orderBy(asc(schema.projectDocuments.number))
      .limit(limit);
    return toHits(entityType, rows);
  }

  if (entityType === "board") {
    const rows = await db
      .select({
        id: schema.boards.id,
        number: schema.boards.number,
        title: schema.boards.name,
        projectId: schema.boards.projectId,
      })
      .from(schema.boards)
      .where(
        matchNumberOrTitle({
          numberCol: schema.boards.number,
          titleCol: schema.boards.name,
          prefix,
          q: searchQ,
          exactNumber,
        }),
      )
      .orderBy(asc(schema.boards.number))
      .limit(limit);
    return toHits(entityType, rows);
  }

  if (entityType === "canvas") {
    const rows = await db
      .select({
        id: schema.canvases.id,
        number: schema.canvases.number,
        title: schema.canvases.title,
        projectId: schema.canvases.projectId,
      })
      .from(schema.canvases)
      .where(
        matchNumberOrTitle({
          numberCol: schema.canvases.number,
          titleCol: schema.canvases.title,
          prefix,
          q: searchQ,
          exactNumber,
        }),
      )
      .orderBy(asc(schema.canvases.number))
      .limit(limit);
    return toHits(entityType, rows);
  }

  if (entityType === "wiki_node") {
    const rows = await db
      .select({
        id: schema.wikiNodes.id,
        number: schema.wikiNodes.number,
        title: schema.wikiNodes.title,
        projectId: schema.wikiNodes.projectId,
      })
      .from(schema.wikiNodes)
      .where(
        matchNumberOrTitle({
          numberCol: schema.wikiNodes.number,
          titleCol: schema.wikiNodes.title,
          prefix,
          q: searchQ,
          exactNumber,
        }),
      )
      .orderBy(asc(schema.wikiNodes.number))
      .limit(limit);
    return toHits(entityType, rows);
  }

  if (entityType === "todo_list") {
    const rows = await db
      .select({
        id: schema.todoLists.id,
        number: schema.todoLists.number,
        title: schema.todoLists.title,
        projectId: schema.todoLists.projectId,
      })
      .from(schema.todoLists)
      .where(
        matchNumberOrTitle({
          numberCol: schema.todoLists.number,
          titleCol: schema.todoLists.title,
          prefix,
          q: searchQ,
          exactNumber,
        }),
      )
      .orderBy(asc(schema.todoLists.number))
      .limit(limit);
    return toHits(entityType, rows);
  }

  if (entityType === "image_board") {
    const rows = await db
      .select({
        id: schema.imageBoards.id,
        number: schema.imageBoards.number,
        title: schema.imageBoards.title,
        projectId: schema.imageBoards.projectId,
      })
      .from(schema.imageBoards)
      .where(
        matchNumberOrTitle({
          numberCol: schema.imageBoards.number,
          titleCol: schema.imageBoards.title,
          prefix,
          q: searchQ,
          exactNumber,
        }),
      )
      .orderBy(asc(schema.imageBoards.number))
      .limit(limit);
    return toHits(entityType, rows);
  }

  return [];
}

export async function searchUserReferences(
  db: Db,
  q: string,
  opts?: { limit?: number },
): Promise<ReferenceHit[]> {
  const trimmed = q.trim();
  const limit = opts?.limit ?? 20;
  if (!trimmed) {
    const rows = await db
      .select({
        id: schema.users.id,
        number: schema.users.number,
        title: schema.users.displayName,
      })
      .from(schema.users)
      .where(sql`${schema.users.deactivatedAt} IS NULL`)
      .orderBy(asc(schema.users.number))
      .limit(limit);
    return rows.map((r) => ({
      entityType: "user" as const,
      id: r.id,
      number: r.number,
      title: r.title,
      referenceId: formatUserNumber(r.number),
      href: "/settings/profile",
      projectId: null,
    }));
  }
  const pattern = `%${trimmed}%`;
  const rows = await db
    .select({
      id: schema.users.id,
      number: schema.users.number,
      title: schema.users.displayName,
    })
    .from(schema.users)
    .where(
      and(
        sql`${schema.users.deactivatedAt} IS NULL`,
        or(
          ilike(schema.users.displayName, pattern),
          sql`('U' || LPAD(CAST(${schema.users.number} AS TEXT), 4, '0')) ILIKE ${pattern}`,
        ),
      ),
    )
    .orderBy(asc(schema.users.number))
    .limit(limit);

  return rows.map((r) => ({
    entityType: "user" as const,
    id: r.id,
    number: r.number,
    title: r.title,
    referenceId: formatUserNumber(r.number),
    href: "/settings/profile",
    projectId: null,
  }));
}
