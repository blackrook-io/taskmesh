import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { ilikeEscaped } from "../../lib/ilike.js";
import { searchRateLimit } from "../../middleware/rateLimits.js";
import {
  dualScopeListFilter,
  ownerScope,
  projectAccessListFilter,
  projectOwnedListFilter,
} from "../../services/ownership.js";
import { userHasAdministrator } from "../../services/roles.js";
import { knowledgeEntityIds } from "../../services/knowledge/search.js";
import { getCurrentUserId } from "../../services/users.js";

export const searchRouter = Router();

const emptyResults = {
  ideas: [] as const,
  projects: [] as const,
  tasks: [] as const,
  todos: [] as const,
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
searchRouter.get("/", searchRateLimit, async (req, res) => {
  try {
    const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (qRaw.length > 200) {
      sendError(res, 400, "validation_error", "Query q must be at most 200 characters");
      return;
    }
    const tagName =
      typeof req.query.tag === "string" ? req.query.tag.trim() : "";
    if (tagName.length > 100) {
      sendError(res, 400, "validation_error", "tag must be at most 100 characters");
      return;
    }
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

    const actorId = await getCurrentUserId(db);
    const isAdmin = await userHasAdministrator(db, actorId);
    const ideaScope = ownerScope(schema.ideas.ownerId, actorId, isAdmin) ?? sql`true`;
    const projectScope = projectAccessListFilter(db, actorId, isAdmin) ?? sql`true`;
    const taskScope =
      dualScopeListFilter(db, schema.tasks.projectId, schema.tasks.ownerId, actorId, isAdmin) ??
      sql`true`;
    const todoScope =
      dualScopeListFilter(db, schema.todos.projectId, schema.todos.ownerId, actorId, isAdmin) ??
      sql`true`;
    const todoListScope =
      dualScopeListFilter(
        db,
        schema.todoLists.projectId,
        schema.todoLists.ownerId,
        actorId,
        isAdmin,
      ) ?? sql`true`;
    const documentScope =
      projectOwnedListFilter(db, schema.projectDocuments.projectId, actorId, isAdmin) ?? sql`true`;
    const boardScope =
      projectOwnedListFilter(db, schema.boards.projectId, actorId, isAdmin) ?? sql`true`;
    const canvasScope =
      projectOwnedListFilter(db, schema.canvases.projectId, actorId, isAdmin) ?? sql`true`;
    const wikiScope =
      projectOwnedListFilter(db, schema.wikiNodes.projectId, actorId, isAdmin) ?? sql`true`;

    let filterTagId = tagId;
    if (tagName && filterTagId == null) {
      const tagOwner = ownerScope(schema.tags.ownerId, actorId, isAdmin);
      const [tagRow] = await db
        .select()
        .from(schema.tags)
        .where(
          tagOwner
            ? and(eq(schema.tags.name, tagName), tagOwner)
            : eq(schema.tags.name, tagName),
        );
      if (!tagRow) {
        res.json({ data: { ...emptyResults } });
        return;
      }
      filterTagId = tagRow.id;
    }

    let tagMeta: { id: number; name: string; color: string | null } | null = null;
    if (filterTagId != null) {
      const tagOwner = ownerScope(schema.tags.ownerId, actorId, isAdmin);
      const [t] = await db
        .select({
          id: schema.tags.id,
          name: schema.tags.name,
          color: schema.tags.color,
        })
        .from(schema.tags)
        .where(
          tagOwner
            ? and(eq(schema.tags.id, filterTagId), tagOwner)
            : eq(schema.tags.id, filterTagId),
        );
      tagMeta = t ?? null;
      if (!tagMeta) {
        res.json({ data: { ...emptyResults } });
        return;
      }
    }

    const q = qRaw || null;
    const textIds = q
      ? await Promise.all([
          knowledgeEntityIds("idea", q),
          knowledgeEntityIds("project", q),
          knowledgeEntityIds("task", q),
          knowledgeEntityIds("todo", q),
          knowledgeEntityIds("document", q),
          knowledgeEntityIds("board", q),
          knowledgeEntityIds("canvas", q),
          knowledgeEntityIds("todo_list", q),
          knowledgeEntityIds("wiki_node", q),
        ]).then(([idea, project, task, todo, document, board, canvas, todoList, wiki]) => ({
          idea,
          project,
          task,
          todo,
          document,
          board,
          canvas,
          todoList,
          wiki,
        }))
      : null;

    function proseFilter(
      column:
        | typeof schema.ideas.id
        | typeof schema.projects.id
        | typeof schema.tasks.id
        | typeof schema.todos.id
        | typeof schema.projectDocuments.id
        | typeof schema.boards.id
        | typeof schema.canvases.id
        | typeof schema.todoLists.id
        | typeof schema.wikiNodes.id,
      ids: number[] | undefined,
    ) {
      if (!textIds || !ids) return sql`true`;
      if (ids.length === 0) return sql`false`;
      return inArray(column, ids);
    }

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
      todoIds,
      documentIds,
      boardIds,
      canvasIds,
      todoListIds,
      wikiNodeIds,
    ] = await Promise.all([
      idsForType("idea"),
      idsForType("project"),
      idsForType("task"),
      idsForType("todo"),
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
                proseFilter(schema.ideas.id, textIds?.idea),
                ideaScope
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
                proseFilter(schema.projects.id, textIds?.project),
                projectScope
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
                q
                  ? or(
                      proseFilter(schema.tasks.id, textIds?.task),
                      ilikeEscaped(sql`CAST(${schema.tasks.number} AS TEXT)`, q),
                      ilikeEscaped(
                        sql`('T' || LPAD(CAST(${schema.tasks.number} AS TEXT), 4, '0'))`,
                        q,
                      ),
                    )
                  : sql`true`,
                taskScope
              ),
            )
            .orderBy(desc(schema.tasks.updatedAt))
            .limit(50);

    const todos =
      todoIds != null && todoIds.length === 0
        ? []
        : await db
            .select()
            .from(schema.todos)
            .where(
              and(
                ne(schema.todos.state, "deleted"),
                todoIds != null ? inArray(schema.todos.id, todoIds) : sql`true`,
                q
                  ? or(
                      proseFilter(schema.todos.id, textIds?.todo),
                      ilikeEscaped(sql`CAST(${schema.todos.number} AS TEXT)`, q),
                      ilikeEscaped(
                        sql`('D' || LPAD(CAST(${schema.todos.number} AS TEXT), 4, '0'))`,
                        q,
                      ),
                    )
                  : sql`true`,
                todoScope
              ),
            )
            .orderBy(desc(schema.todos.updatedAt))
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
                proseFilter(schema.projectDocuments.id, textIds?.document),
                documentScope
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
                proseFilter(schema.boards.id, textIds?.board),
                boardScope
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
                proseFilter(schema.canvases.id, textIds?.canvas),
                canvasScope
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
                proseFilter(schema.todoLists.id, textIds?.todoList),
                todoListScope
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
                proseFilter(schema.wikiNodes.id, textIds?.wiki),
                wikiScope,
              ),
            )
            .orderBy(desc(schema.wikiNodes.updatedAt))
            .limit(50);

    res.json({
      data: {
        ideas,
        projects,
        tasks,
        todos,
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
