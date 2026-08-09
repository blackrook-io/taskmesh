import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";

export const searchRouter = Router();

const emptyResults = {
  ideas: [] as const,
  projects: [] as const,
  tasks: [] as const,
  documents: [] as const,
  boards: [] as const,
  canvases: [] as const,
  todo_lists: [] as const,
  wiki: [] as const,
  tag: null as null,
};

/**
 * Global search across ideas, projects, tasks, documents, boards, canvases, todo lists, and wiki.
 * Query params: `q` (text), `tag` (tag name) and/or `tagId` (number).
 * At least one of q / tag / tagId is required.
 */
searchRouter.get("/", async (req, res) => {
  try {
    const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const tagName =
      typeof req.query.tag === "string" ? req.query.tag.trim() : "";
    const tagIdParsed =
      req.query.tagId !== undefined && req.query.tagId !== ""
        ? z.coerce.number().int().positive().safeParse(req.query.tagId)
        : null;

    if (tagIdParsed && !tagIdParsed.success) {
      sendError(res, 400, "validation_error", "Invalid tagId");
      return;
    }

    const tagId = tagIdParsed?.success ? tagIdParsed.data : undefined;

    if (!qRaw && !tagName && tagId == null) {
      sendError(
        res,
        400,
        "validation_error",
        "Provide q, tag, and/or tagId",
      );
      return;
    }

    let filterTagId = tagId;
    if (tagName && filterTagId == null) {
      const [tagRow] = await db
        .select()
        .from(schema.tags)
        .where(eq(schema.tags.name, tagName));
      if (!tagRow) {
        res.json({ data: { ...emptyResults } });
        return;
      }
      filterTagId = tagRow.id;
    }

    let tagMeta: { id: number; name: string; color: string | null } | null = null;
    if (filterTagId != null) {
      const [t] = await db
        .select({
          id: schema.tags.id,
          name: schema.tags.name,
          color: schema.tags.color,
        })
        .from(schema.tags)
        .where(eq(schema.tags.id, filterTagId));
      tagMeta = t ?? null;
      if (!tagMeta) {
        res.json({ data: { ...emptyResults } });
        return;
      }
    }

    const pattern = qRaw ? `%${qRaw}%` : null;

    async function idsForType(entityType: string): Promise<number[] | null> {
      if (filterTagId == null) return null;
      const rows = await db
        .select({ entityId: schema.taggings.entityId })
        .from(schema.taggings)
        .where(
          and(
            eq(schema.taggings.tagId, filterTagId),
            eq(schema.taggings.entityType, entityType),
          ),
        );
      return rows.map((r) => r.entityId);
    }

    const [
      ideaIds,
      projectIds,
      taskIds,
      documentIds,
      boardIds,
      canvasIds,
      todoListIds,
      wikiNodeIds,
    ] = await Promise.all([
      idsForType("idea"),
      idsForType("project"),
      idsForType("task"),
      idsForType("document"),
      idsForType("board"),
      idsForType("canvas"),
      idsForType("todo_list"),
      idsForType("wiki_node"),
    ]);

    const ideas =
      ideaIds != null && ideaIds.length === 0
        ? []
        : await db
            .select()
            .from(schema.ideas)
            .where(
              and(
                ideaIds != null ? inArray(schema.ideas.id, ideaIds) : sql`true`,
                pattern
                  ? or(
                      ilike(schema.ideas.title, pattern),
                      ilike(schema.ideas.body, pattern),
                    )
                  : sql`true`,
              ),
            )
            .orderBy(desc(schema.ideas.updatedAt))
            .limit(50);

    const projects =
      projectIds != null && projectIds.length === 0
        ? []
        : await db
            .select()
            .from(schema.projects)
            .where(
              and(
                projectIds != null
                  ? inArray(schema.projects.id, projectIds)
                  : sql`true`,
                pattern
                  ? or(
                      ilike(schema.projects.name, pattern),
                      ilike(schema.projects.description, pattern),
                    )
                  : sql`true`,
              ),
            )
            .orderBy(desc(schema.projects.updatedAt))
            .limit(50);

    const tasks =
      taskIds != null && taskIds.length === 0
        ? []
        : await db
            .select()
            .from(schema.tasks)
            .where(
              and(
                ne(schema.tasks.state, "deleted"),
                taskIds != null ? inArray(schema.tasks.id, taskIds) : sql`true`,
                pattern
                  ? or(
                      ilike(schema.tasks.title, pattern),
                      ilike(schema.tasks.description, pattern),
                      sql`CAST(${schema.tasks.number} AS TEXT) ILIKE ${pattern}`,
                      sql`('T' || LPAD(CAST(${schema.tasks.number} AS TEXT), 4, '0')) ILIKE ${pattern}`,
                    )
                  : sql`true`,
              ),
            )
            .orderBy(desc(schema.tasks.updatedAt))
            .limit(50);

    const documents =
      documentIds != null && documentIds.length === 0
        ? []
        : await db
            .select()
            .from(schema.projectDocuments)
            .where(
              and(
                documentIds != null
                  ? inArray(schema.projectDocuments.id, documentIds)
                  : sql`true`,
                pattern
                  ? or(
                      ilike(schema.projectDocuments.title, pattern),
                      ilike(schema.projectDocuments.body, pattern),
                    )
                  : sql`true`,
              ),
            )
            .orderBy(desc(schema.projectDocuments.updatedAt))
            .limit(50);

    const boards =
      boardIds != null && boardIds.length === 0
        ? []
        : await db
            .select()
            .from(schema.boards)
            .where(
              and(
                boardIds != null ? inArray(schema.boards.id, boardIds) : sql`true`,
                pattern ? ilike(schema.boards.name, pattern) : sql`true`,
              ),
            )
            .orderBy(desc(schema.boards.updatedAt))
            .limit(50);

    const canvases =
      canvasIds != null && canvasIds.length === 0
        ? []
        : await db
            .select({
              id: schema.canvases.id,
              projectId: schema.canvases.projectId,
              title: schema.canvases.title,
              sortOrder: schema.canvases.sortOrder,
              createdAt: schema.canvases.createdAt,
              updatedAt: schema.canvases.updatedAt,
            })
            .from(schema.canvases)
            .where(
              and(
                canvasIds != null ? inArray(schema.canvases.id, canvasIds) : sql`true`,
                pattern ? ilike(schema.canvases.title, pattern) : sql`true`,
              ),
            )
            .orderBy(desc(schema.canvases.updatedAt))
            .limit(50);

    const todo_lists =
      todoListIds != null && todoListIds.length === 0
        ? []
        : await db
            .select()
            .from(schema.todoLists)
            .where(
              and(
                todoListIds != null
                  ? inArray(schema.todoLists.id, todoListIds)
                  : sql`true`,
                pattern ? ilike(schema.todoLists.title, pattern) : sql`true`,
              ),
            )
            .orderBy(desc(schema.todoLists.updatedAt))
            .limit(50);

    const wikiNodeIdFilter: number[] | null =
      filterTagId == null
        ? null
        : await (async () => {
            const fromNodes = wikiNodeIds ?? [];
            const docSet = new Set(documentIds ?? []);
            const canvasSet = new Set(canvasIds ?? []);
            if (fromNodes.length === 0 && docSet.size === 0 && canvasSet.size === 0) {
              return [] as number[];
            }
            const linked = await db
              .select({ id: schema.wikiNodes.id })
              .from(schema.wikiNodes)
              .where(
                or(
                  fromNodes.length ? inArray(schema.wikiNodes.id, fromNodes) : sql`false`,
                  docSet.size
                    ? and(
                        eq(schema.wikiNodes.entityType, "document"),
                        inArray(schema.wikiNodes.entityId, [...docSet]),
                      )
                    : sql`false`,
                  canvasSet.size
                    ? and(
                        eq(schema.wikiNodes.entityType, "canvas"),
                        inArray(schema.wikiNodes.entityId, [...canvasSet]),
                      )
                    : sql`false`,
                ),
              );
            return [...new Set(linked.map((r) => r.id))];
          })();

    const wiki =
      wikiNodeIdFilter != null && wikiNodeIdFilter.length === 0
        ? []
        : await db
            .select()
            .from(schema.wikiNodes)
            .where(
              and(
                wikiNodeIdFilter != null
                  ? inArray(schema.wikiNodes.id, wikiNodeIdFilter)
                  : sql`true`,
                pattern ? ilike(schema.wikiNodes.title, pattern) : sql`true`,
              ),
            )
            .orderBy(desc(schema.wikiNodes.updatedAt))
            .limit(50);

    res.json({
      data: {
        ideas,
        projects,
        tasks,
        documents,
        boards,
        canvases,
        todo_lists,
        wiki,
        tag: tagMeta,
      },
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});
