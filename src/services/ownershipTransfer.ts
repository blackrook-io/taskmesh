import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { NotFoundError } from "../lib/notFound.js";

type Db = NodePgDatabase<typeof schema>;

export const OWNERSHIP_TRANSFER_ENTITY_TYPES = [
  "project",
  "idea",
  "task",
  "todo",
  "todo_list",
  "image_board",
  "upload",
  "tag",
  "template",
] as const;

export type OwnershipTransferEntityType = (typeof OWNERSHIP_TRANSFER_ENTITY_TYPES)[number];

export type OwnershipTransferResult = {
  entityType: OwnershipTransferEntityType;
  entityId: number;
  previousOwnerId: number;
  newOwnerId: number;
};

export class OwnershipTransferValidationError extends Error {
  readonly status = 400;
  readonly code: string;

  constructor(message: string, code = "validation_error") {
    super(message);
    this.name = "OwnershipTransferValidationError";
    this.code = code;
  }
}

async function assertActiveUser(db: Db, userId: number): Promise<void> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    throw new NotFoundError("User not found");
  }
  if (user.deactivatedAt != null) {
    throw new OwnershipTransferValidationError(
      "Cannot transfer ownership to a deactivated user",
    );
  }
}

/**
 * Admin-only ownership transfer for top-level owned records.
 * Nested project children inherit access via `projects.ownerId` and are not rewritten.
 */
export async function transferOwnership(
  db: Db,
  input: {
    entityType: OwnershipTransferEntityType;
    entityId: number;
    newOwnerId: number;
  },
): Promise<OwnershipTransferResult> {
  await assertActiveUser(db, input.newOwnerId);

  switch (input.entityType) {
    case "project":
      return updateOwner(db, "project", schema.projects, input.entityId, input.newOwnerId, "Project not found");
    case "idea":
      return updateOwner(db, "idea", schema.ideas, input.entityId, input.newOwnerId, "Idea not found");
    case "task":
      return updateOwner(db, "task", schema.tasks, input.entityId, input.newOwnerId, "Task not found");
    case "todo":
      return updateOwner(db, "todo", schema.todos, input.entityId, input.newOwnerId, "Todo not found");
    case "todo_list":
      return updateOwner(db, "todo_list", schema.todoLists, input.entityId, input.newOwnerId, "Todo list not found");
    case "image_board":
      return updateOwner(
        db,
        "image_board",
        schema.imageBoards,
        input.entityId,
        input.newOwnerId,
        "Image board not found",
      );
    case "upload":
      return updateOwner(db, "upload", schema.uploads, input.entityId, input.newOwnerId, "Upload not found");
    case "tag":
      return transferTag(db, input.entityId, input.newOwnerId);
    case "template":
      return updateOwner(
        db,
        "template",
        schema.taskDescriptionTemplates,
        input.entityId,
        input.newOwnerId,
        "Template not found",
      );
    default: {
      const _exhaustive: never = input.entityType;
      throw new OwnershipTransferValidationError(`Unsupported entity type: ${_exhaustive}`);
    }
  }
}

type OwnedTable =
  | typeof schema.projects
  | typeof schema.ideas
  | typeof schema.tasks
  | typeof schema.todos
  | typeof schema.todoLists
  | typeof schema.imageBoards
  | typeof schema.uploads
  | typeof schema.taskDescriptionTemplates;

async function updateOwner(
  db: Db,
  entityType: OwnershipTransferEntityType,
  table: OwnedTable,
  entityId: number,
  newOwnerId: number,
  notFoundMessage: string,
): Promise<OwnershipTransferResult> {
  const [existing] = await db.select().from(table).where(eq(table.id, entityId));
  if (!existing) {
    throw new NotFoundError(notFoundMessage);
  }
  const previousOwnerId = existing.ownerId;
  if (previousOwnerId !== newOwnerId) {
    await db.update(table).set({ ownerId: newOwnerId }).where(eq(table.id, entityId));
  }
  return { entityType, entityId, previousOwnerId, newOwnerId };
}

async function transferTag(
  db: Db,
  entityId: number,
  newOwnerId: number,
): Promise<OwnershipTransferResult> {
  const [existing] = await db.select().from(schema.tags).where(eq(schema.tags.id, entityId));
  if (!existing) {
    throw new NotFoundError("Tag not found");
  }
  const previousOwnerId = existing.ownerId;
  if (previousOwnerId === newOwnerId) {
    return { entityType: "tag", entityId, previousOwnerId, newOwnerId };
  }
  const [clash] = await db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(and(eq(schema.tags.ownerId, newOwnerId), eq(schema.tags.name, existing.name)));
  if (clash) {
    throw new OwnershipTransferValidationError(
      `New owner already has a tag named "${existing.name}"`,
    );
  }
  await db.update(schema.tags).set({ ownerId: newOwnerId }).where(eq(schema.tags.id, entityId));
  return { entityType: "tag", entityId, previousOwnerId, newOwnerId };
}
