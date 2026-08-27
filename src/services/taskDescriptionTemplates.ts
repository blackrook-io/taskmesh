import { asc, eq, isNull, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { getCurrentUser } from "./users.js";

type Db = NodePgDatabase<typeof schema>;

export type TaskDescriptionTemplate = {
  id: number;
  name: string;
  body: string;
  projectId: number | null;
  isGlobal: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminTaskDescriptionTemplate = TaskDescriptionTemplate & {
  projectTitle: string | null;
};

function serialize(
  row: typeof schema.taskDescriptionTemplates.$inferSelect,
): TaskDescriptionTemplate {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    projectId: row.projectId,
    isGlobal: row.isGlobal,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Templates available for a task: Global ∪ matching projectId (incl. null). */
export async function listApplicableTemplates(
  db: Db,
  projectId: number | null,
): Promise<TaskDescriptionTemplate[]> {
  const scope =
    projectId == null
      ? isNull(schema.taskDescriptionTemplates.projectId)
      : eq(schema.taskDescriptionTemplates.projectId, projectId);

  const rows = await db
    .select()
    .from(schema.taskDescriptionTemplates)
    .where(or(eq(schema.taskDescriptionTemplates.isGlobal, true), scope))
    .orderBy(
      asc(schema.taskDescriptionTemplates.name),
      asc(schema.taskDescriptionTemplates.id),
    );

  return rows.map(serialize);
}

export async function createTemplate(
  db: Db,
  input: { name: string; body: string; projectId: number | null },
): Promise<TaskDescriptionTemplate> {
  const user = await getCurrentUser(db);
  if (input.projectId != null) {
    const [project] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.id, input.projectId))
      .limit(1);
    if (!project) {
      const err = new Error("Project not found") as Error & {
        status: number;
        code: string;
      };
      err.status = 404;
      err.code = "not_found";
      throw err;
    }
  }

  const [row] = await db
    .insert(schema.taskDescriptionTemplates)
    .values({
      name: input.name,
      body: input.body,
      projectId: input.projectId,
      isGlobal: false,
      createdById: user.id,
      updatedById: user.id,
      ownerId: user.id,
    })
    .returning();
  if (!row) {
    throw new Error("Could not create template");
  }
  return serialize(row);
}

export async function listAdminTemplates(
  db: Db,
): Promise<AdminTaskDescriptionTemplate[]> {
  const rows = await db
    .select({
      template: schema.taskDescriptionTemplates,
      projectTitle: schema.projects.name,
    })
    .from(schema.taskDescriptionTemplates)
    .leftJoin(
      schema.projects,
      eq(schema.taskDescriptionTemplates.projectId, schema.projects.id),
    )
    .orderBy(
      asc(schema.taskDescriptionTemplates.name),
      asc(schema.taskDescriptionTemplates.id),
    );

  return rows.map(({ template, projectTitle }) => ({
    ...serialize(template),
    projectTitle: projectTitle ?? null,
  }));
}

export async function patchAdminTemplate(
  db: Db,
  id: number,
  patch: { name?: string; isGlobal?: boolean },
): Promise<AdminTaskDescriptionTemplate> {
  const user = await getCurrentUser(db);
  const [existing] = await db
    .select()
    .from(schema.taskDescriptionTemplates)
    .where(eq(schema.taskDescriptionTemplates.id, id))
    .limit(1);
  if (!existing) {
    const err = new Error("Template not found") as Error & {
      status: number;
      code: string;
    };
    err.status = 404;
    err.code = "not_found";
    throw err;
  }

  const [row] = await db
    .update(schema.taskDescriptionTemplates)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.isGlobal !== undefined ? { isGlobal: patch.isGlobal } : {}),
      updatedById: user.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.taskDescriptionTemplates.id, id))
    .returning();
  if (!row) {
    throw new Error("Could not update template");
  }

  let projectTitle: string | null = null;
  if (row.projectId != null) {
    const [project] = await db
      .select({ title: schema.projects.name })
      .from(schema.projects)
      .where(eq(schema.projects.id, row.projectId))
      .limit(1);
    projectTitle = project?.title ?? null;
  }

  return { ...serialize(row), projectTitle };
}

export async function deleteAdminTemplate(db: Db, id: number): Promise<void> {
  const deleted = await db
    .delete(schema.taskDescriptionTemplates)
    .where(eq(schema.taskDescriptionTemplates.id, id))
    .returning({ id: schema.taskDescriptionTemplates.id });
  if (deleted.length === 0) {
    const err = new Error("Template not found") as Error & {
      status: number;
      code: string;
    };
    err.status = 404;
    err.code = "not_found";
    throw err;
  }
}
