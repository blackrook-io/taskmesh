import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import type { MutationResult } from "../../lib/mutationResult.js";
import { scheduleKnowledgeIndex } from "../../services/knowledge/schedule.js";
import { assertCanAccessDualScoped } from "../../services/ownership.js";
import { writeAiAudit } from "../../services/assistant/aiAudit.js";
import { loadActorAiPermission } from "../../services/assistant/aiUserPolicy.js";
import { resolveEffectiveAiAccess } from "../../services/assistant/projectAiAccess.js";
import { CaptureError } from "../../services/assistant/capture/service.js";
import {
  executeCaptureConfirm,
  type CaptureConfirmResult,
} from "../../services/assistant/capture/confirm.js";
import type { CaptureProposal, CaptureRecordType, CaptureRef } from "../../services/assistant/capture/types.js";
import { applyManualLink, applyTagAdd, applyTodoCreate } from "../../services/assistant/expandedApply.js";
import { createIdeaForActor } from "./ideas.js";
import { createStandaloneTask } from "./standaloneTasks.js";
import { createProjectTask } from "./tasks.js";

function createdRow(result: MutationResult): { id: number; number: number } {
  if (!result.ok) {
    throw new CaptureError(result.status, result.code, result.message);
  }
  const data = result.data;
  if (!data || typeof data !== "object") {
    throw new CaptureError(500, "insert_failed", "Could not create the record.");
  }
  const row = data as { id?: unknown; number?: unknown };
  if (typeof row.id !== "number" || typeof row.number !== "number") {
    throw new CaptureError(500, "insert_failed", "Could not create the record.");
  }
  return { id: row.id, number: row.number };
}

async function assertListWritable(actorId: number, listId: number): Promise<void> {
  const [list] = await db.select().from(schema.todoLists).where(eq(schema.todoLists.id, listId));
  if (!list) throw new CaptureError(404, "not_found", "List not found");
  await assertCanAccessDualScoped(db, actorId, list, "write");
  if (list.kind === "inbox") {
    throw new CaptureError(400, "virtual_list", "Unsorted is computed automatically.");
  }
}

async function createRecord(actorId: number, proposal: CaptureProposal): Promise<{ id: number; number: number }> {
  if (proposal.recordType === "idea") {
    return createdRow(
      await createIdeaForActor({
        actorId,
        body: { title: proposal.title, body: proposal.description },
      }),
    );
  }
  if (proposal.recordType === "todo") {
    if (proposal.list) await assertListWritable(actorId, proposal.list.id);
    const created = createdRow(
      await applyTodoCreate(
        {
          title: proposal.title,
          ...(proposal.description ? { description: proposal.description } : {}),
          ...(proposal.dueDate ? { dueDate: proposal.dueDate } : {}),
          ...(proposal.priority ? { priority: proposal.priority } : {}),
          ...(proposal.project ? { projectId: proposal.project.id } : {}),
        },
        actorId,
      ),
    );
    try {
      await scheduleKnowledgeIndex("todo", created.id);
    } catch {
      // The ToDo is already saved. A later edit can refresh the search index.
    }
    return created;
  }
  const body = {
    title: proposal.title,
    description: proposal.description,
    dueDate: proposal.dueDate,
    ...(proposal.priority ? { priority: proposal.priority } : {}),
    parentId: proposal.parent?.id ?? null,
  };
  if (proposal.project) {
    return createdRow(
      await createProjectTask({
        projectId: proposal.project.id,
        body,
        actorId,
        source: "ai",
        recordHistory: true,
      }),
    );
  }
  return createdRow(
    await createStandaloneTask({
      body,
      actorId,
      source: "ai",
      recordHistory: true,
    }),
  );
}

async function appendTodo(actorId: number, listId: number, todoId: number): Promise<void> {
  await assertListWritable(actorId, listId);
  const existing = await db
    .select({ sortOrder: schema.todoListItems.sortOrder })
    .from(schema.todoListItems)
    .where(eq(schema.todoListItems.listId, listId));
  const nextSort = existing.length ? Math.max(...existing.map((row) => row.sortOrder)) + 1 : 0;
  try {
    await db.insert(schema.todoListItems).values({
      listId,
      entityType: "todo",
      entityId: todoId,
      checked: false,
      sortOrder: nextSort,
    });
  } catch (err) {
    const pg = err as { code?: string };
    if (pg.code === "23505") {
      throw new CaptureError(409, "already_on_list", "That item is already on this list.");
    }
    throw err;
  }
}

function warning(result: MutationResult): string | null {
  return result.ok ? null : result.message;
}

export async function confirmCaptureRequest(
  actorUserId: number,
  body: unknown,
): Promise<CaptureConfirmResult> {
  const permission = await loadActorAiPermission(db, actorUserId);
  return executeCaptureConfirm({
    actorUserId,
    body,
    permission,
    accessFor: (projectId) => resolveEffectiveAiAccess(db, projectId),
    writers: {
      create: (proposal) => createRecord(actorUserId, proposal),
      addToList: (listId, entityId) => appendTodo(actorUserId, listId, entityId),
      addTag: async (entityType: CaptureRecordType, entityId, name) =>
        warning(await applyTagAdd({ name }, actorUserId, entityType, entityId)),
      addLink: async (entityType, entityId, link: CaptureRef) =>
        warning(
          await applyManualLink(
            {
              srcType: entityType,
              srcId: entityId,
              dstType: link.entityType,
              dstId: link.id,
              relation: "relates_to",
            },
            actorUserId,
          ),
        ),
    },
    audit: async (row) => {
      await writeAiAudit(row);
    },
  });
}
