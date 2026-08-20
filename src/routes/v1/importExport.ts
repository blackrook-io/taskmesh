import { eq, inArray } from "drizzle-orm";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import {
  findImmutableFieldsWithValues,
  ImmutableFieldError,
} from "../../lib/immutableFields.js";
import { ensureProjectModules } from "../../services/projectModules.js";
import { allocateProjectNumber } from "../../services/entityNumbers.js";
import { nextProjectSortOrder } from "../../services/projectSortOrder.js";
import { allocateTaskNumber, assertPhaseForProject } from "../../services/tasks.js";
import { getCurrentUserId } from "../../services/users.js";
import {
  objectsToCsv,
  objectsToXlsxBuffer,
  optionalPositiveInt,
  parseOptionalDate,
  sheetToObjects,
  workbookToBuffer,
  type DiscardRow,
  type ImportResult,
} from "../../lib/spreadsheet.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const formatQuery = z.enum(["csv", "xlsx"]).default("csv");
const projectStatus = z.enum(["idea", "active", "paused", "done"]);

export const importExportRouter = Router();

function projectExportRow(p: typeof schema.projects.$inferSelect): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    status: p.status,
    sourceIdeaId: p.sourceIdeaId ?? "",
  };
}

function taskExportRow(t: typeof schema.tasks.$inferSelect): Record<string, unknown> {
  return {
    id: t.id,
    projectId: t.projectId ?? "",
    phaseId: t.phaseId ?? "",
    parentId: t.parentId ?? "",
    title: t.title,
    description: t.description ?? "",
    state: t.state,
    priority: t.priority,
    dueDate: t.dueDate ?? "",
    dueAt: t.dueAt ? t.dueAt.toISOString() : "",
    color: t.color ?? "",
    sortOrder: t.sortOrder,
  };
}

function discardIfImmutable(raw: Record<string, unknown>, rowNum: number): DiscardRow | null {
  const fields = findImmutableFieldsWithValues(raw);
  if (fields.length === 0) return null;
  return {
    row: rowNum,
    code: "immutable_field",
    reason: new ImmutableFieldError(fields).message,
  };
}

function sendDownload(
  res: import("express").Response,
  format: "csv" | "xlsx",
  basename: string,
  rows: Record<string, unknown>[],
  sheetName: string,
) {
  if (format === "csv") {
    const body = objectsToCsv(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${basename}.csv"`);
    res.send(body);
    return;
  }
  const buf = objectsToXlsxBuffer(rows, sheetName);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${basename}.xlsx"`);
  res.send(buf);
}

importExportRouter.get("/export/projects", async (req, res) => {
  try {
    const format = formatQuery.parse(req.query.format ?? "csv");
    const rows = await db.select().from(schema.projects);
    sendDownload(
      res,
      format,
      "taskmesh-projects",
      rows.map(projectExportRow),
      "projects",
    );
  } catch (err) {
    handleRouteError(res, err);
  }
});

importExportRouter.get("/export/tasks", async (req, res) => {
  try {
    const format = formatQuery.parse(req.query.format ?? "csv");
    const projectIdRaw = req.query.projectId;
    let rows;
    if (projectIdRaw != null && projectIdRaw !== "") {
      const projectId = z.coerce.number().int().positive().parse(projectIdRaw);
      rows = await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.projectId, projectId));
    } else {
      rows = await db.select().from(schema.tasks);
    }
    sendDownload(res, format, "taskmesh-tasks", rows.map(taskExportRow), "tasks");
  } catch (err) {
    handleRouteError(res, err);
  }
});

importExportRouter.get("/export/bundle", async (req, res) => {
  try {
    const format = formatQuery.parse(req.query.format ?? "xlsx");
    const projects = await db.select().from(schema.projects);
    const tasks = await db.select().from(schema.tasks);
    const projectRows = projects.map(projectExportRow);
    const taskRows = tasks.map(taskExportRow);

    if (format === "csv") {
      // Single CSV is awkward for two tables — return xlsx-style multi not available;
      // prefer projects sheet as primary note: use xlsx for bundle.
      sendError(
        res,
        400,
        "validation_error",
        "Bundle export requires format=xlsx (two sheets)",
      );
      return;
    }

    const buf = workbookToBuffer([
      { name: "projects", rows: projectRows },
      { name: "tasks", rows: taskRows },
    ]);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", 'attachment; filename="taskmesh-bundle.xlsx"');
    res.send(buf);
  } catch (err) {
    handleRouteError(res, err);
  }
});

async function importProjects(rows: Record<string, unknown>[]): Promise<ImportResult> {
  const discarded: DiscardRow[] = [];
  let created = 0;

  const idCandidates = rows
    .map((r, i) => ({ i, id: optionalPositiveInt(r.id) }))
    .filter((x) => typeof x.id === "number") as { i: number; id: number }[];

  const existingIds = new Set<number>();
  if (idCandidates.length) {
    const ids = [...new Set(idCandidates.map((x) => x.id))];
    const found = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(inArray(schema.projects.id, ids));
    for (const f of found) existingIds.add(f.id);
  }

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // header = 1
    const raw = rows[i]!;
    const immutableDiscard = discardIfImmutable(raw, rowNum);
    if (immutableDiscard) {
      discarded.push(immutableDiscard);
      continue;
    }
    const idCheck = optionalPositiveInt(raw.id);
    if (idCheck === "invalid") {
      discarded.push({
        row: rowNum,
        code: "invalid_data",
        reason: "id must be a positive integer or empty",
      });
      continue;
    }
    if (typeof idCheck === "number" && existingIds.has(idCheck)) {
      discarded.push({
        row: rowNum,
        code: "id_collision",
        reason: `Project id ${idCheck} already exists; row discarded (no overwrite)`,
      });
      continue;
    }

    const name = String(raw.name ?? "").trim();
    if (!name) {
      discarded.push({ row: rowNum, code: "invalid_data", reason: "name is required" });
      continue;
    }
    if (name.length > 500) {
      discarded.push({
        row: rowNum,
        code: "invalid_data",
        reason: "name must be at most 500 characters",
      });
      continue;
    }

    let description: string | null = null;
    if (raw.description != null && raw.description !== "") {
      description = String(raw.description);
      if (description.length > 500_000) {
        discarded.push({
          row: rowNum,
          code: "invalid_data",
          reason: "description is too long",
        });
        continue;
      }
    }

    let status: z.infer<typeof projectStatus> = "idea";
    if (raw.status != null && raw.status !== "") {
      const st = projectStatus.safeParse(String(raw.status).trim());
      if (!st.success) {
        discarded.push({
          row: rowNum,
          code: "invalid_data",
          reason: "status must be one of: idea, active, paused, done",
        });
        continue;
      }
      status = st.data;
    }

    const sourceIdeaId = optionalPositiveInt(raw.sourceIdeaId);
    if (sourceIdeaId === "invalid") {
      discarded.push({
        row: rowNum,
        code: "invalid_data",
        reason: "sourceIdeaId must be a positive integer or empty",
      });
      continue;
    }
    if (typeof sourceIdeaId === "number") {
      const [idea] = await db
        .select({ id: schema.ideas.id })
        .from(schema.ideas)
        .where(eq(schema.ideas.id, sourceIdeaId));
      if (!idea) {
        discarded.push({
          row: rowNum,
          code: "invalid_data",
          reason: `sourceIdeaId ${sourceIdeaId} does not exist`,
        });
        continue;
      }
    }

    try {
      const number = await allocateProjectNumber(db);
      const sortOrder = await nextProjectSortOrder(db);
      const [row] = await db
        .insert(schema.projects)
        .values({
          number,
          name,
          description,
          status,
          sourceIdeaId: typeof sourceIdeaId === "number" ? sourceIdeaId : null,
          sortOrder,
        })
        .returning();
      if (!row) {
        discarded.push({
          row: rowNum,
          code: "db_reject",
          reason: "Insert returned no row",
        });
        continue;
      }
      await ensureProjectModules(db, row.id);
      created += 1;
    } catch (err) {
      discarded.push({
        row: rowNum,
        code: "db_reject",
        reason: err instanceof Error ? err.message : "Database rejected insert",
      });
    }
  }

  return { created, discarded };
}

async function importTasks(rows: Record<string, unknown>[]): Promise<ImportResult> {
  const discarded: DiscardRow[] = [];
  let created = 0;

  const idCandidates = rows
    .map((r) => optionalPositiveInt(r.id))
    .filter((id): id is number => typeof id === "number");
  const existingIds = new Set<number>();
  if (idCandidates.length) {
    const found = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(inArray(schema.tasks.id, [...new Set(idCandidates)]));
    for (const f of found) existingIds.add(f.id);
  }

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const raw = rows[i]!;
    const immutableDiscard = discardIfImmutable(raw, rowNum);
    if (immutableDiscard) {
      discarded.push(immutableDiscard);
      continue;
    }

    const idCheck = optionalPositiveInt(raw.id);
    if (idCheck === "invalid") {
      discarded.push({
        row: rowNum,
        code: "invalid_data",
        reason: "id must be a positive integer or empty",
      });
      continue;
    }
    if (typeof idCheck === "number" && existingIds.has(idCheck)) {
      discarded.push({
        row: rowNum,
        code: "id_collision",
        reason: `Task id ${idCheck} already exists; row discarded (no overwrite)`,
      });
      continue;
    }

    const projectId = optionalPositiveInt(raw.projectId);
    if (projectId === "invalid" || projectId == null) {
      discarded.push({
        row: rowNum,
        code: "invalid_data",
        reason: "projectId is required and must be a positive integer",
      });
      continue;
    }
    const [proj] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    if (!proj) {
      discarded.push({
        row: rowNum,
        code: "invalid_data",
        reason: `projectId ${projectId} does not exist (import projects first)`,
      });
      continue;
    }

    const title = String(raw.title ?? "").trim();
    if (!title) {
      discarded.push({ row: rowNum, code: "invalid_data", reason: "title is required" });
      continue;
    }
    if (title.length > 2000) {
      discarded.push({
        row: rowNum,
        code: "invalid_data",
        reason: "title must be at most 2000 characters",
      });
      continue;
    }

    let description: string | null = null;
    const rawDescription = raw.description ?? raw.notes;
    if (rawDescription != null && rawDescription !== "") {
      description = String(rawDescription);
      if (description.length > 50_000) {
        discarded.push({
          row: rowNum,
          code: "invalid_data",
          reason: "description is too long",
        });
        continue;
      }
    }

    const dueAt = parseOptionalDate(raw.dueAt);
    if (dueAt === "invalid") {
      discarded.push({
        row: rowNum,
        code: "invalid_data",
        reason: "dueAt is not a valid date",
      });
      continue;
    }

    let dueDate: string | null = null;
    if (raw.dueDate != null && String(raw.dueDate).trim() !== "") {
      const d = String(raw.dueDate).trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        discarded.push({
          row: rowNum,
          code: "invalid_data",
          reason: "dueDate must be YYYY-MM-DD",
        });
        continue;
      }
      dueDate = d;
    } else if (dueAt instanceof Date) {
      dueDate = dueAt.toISOString().slice(0, 10);
    }

    let color: string | null = null;
    if (raw.color != null && raw.color !== "") {
      color = String(raw.color);
      if (color.length > 64) {
        discarded.push({
          row: rowNum,
          code: "invalid_data",
          reason: "color must be at most 64 characters",
        });
        continue;
      }
    }

    const phaseIdRaw = optionalPositiveInt(raw.phaseId);
    if (phaseIdRaw === "invalid") {
      discarded.push({
        row: rowNum,
        code: "invalid_data",
        reason: "phaseId must be a positive integer or empty",
      });
      continue;
    }

    let phaseId: number | null = typeof phaseIdRaw === "number" ? phaseIdRaw : null;
    if (phaseId != null) {
      const phaseOk = await assertPhaseForProject(db, projectId, phaseId);
      if (!phaseOk.ok) {
        discarded.push({
          row: rowNum,
          code: "invalid_data",
          reason: phaseOk.message,
        });
        continue;
      }
    }

    let sortOrder = 0;
    if (raw.sortOrder != null && raw.sortOrder !== "") {
      const so = Number(raw.sortOrder);
      if (!Number.isInteger(so)) {
        discarded.push({
          row: rowNum,
          code: "invalid_data",
          reason: "sortOrder must be an integer",
        });
        continue;
      }
      sortOrder = so;
    } else {
      const existing = await db
        .select({ m: schema.tasks.sortOrder })
        .from(schema.tasks)
        .where(eq(schema.tasks.projectId, projectId));
      sortOrder = existing.length ? Math.max(...existing.map((r) => r.m)) + 1 : 0;
    }

    try {
      const number = await allocateTaskNumber(db);
      const actorId = await getCurrentUserId(db);
      const [row] = await db
        .insert(schema.tasks)
        .values({
          projectId,
          phaseId,
          number,
          title,
          description,
          dueDate,
          dueAt: dueAt instanceof Date ? dueAt : null,
          color,
          sortOrder,
          createdById: actorId,
          updatedById: actorId,
        })
        .returning();
      if (!row) {
        discarded.push({
          row: rowNum,
          code: "db_reject",
          reason: "Insert returned no row",
        });
        continue;
      }
      created += 1;
    } catch (err) {
      discarded.push({
        row: rowNum,
        code: "db_reject",
        reason: err instanceof Error ? err.message : "Database rejected insert",
      });
    }
  }

  return { created, discarded };
}

function entityParam(raw: string): "projects" | "tasks" | null {
  if (raw === "projects" || raw === "tasks") return raw;
  return null;
}

importExportRouter.post("/import/:entity", upload.single("file"), async (req, res) => {
  try {
    const entity = entityParam(req.params.entity ?? "");
    if (!entity) {
      sendError(res, 400, "validation_error", "entity must be projects or tasks");
      return;
    }
    const file = req.file;
    if (!file) {
      sendError(res, 400, "no_file", 'Expected multipart field "file"');
      return;
    }
    const name = file.originalname || "upload.xlsx";
    const lower = name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      sendError(res, 400, "unsupported_file_type", "Only .csv or .xlsx allowed");
      return;
    }

    const rows = sheetToObjects(file.buffer, name);
    const result =
      entity === "projects" ? await importProjects(rows) : await importTasks(rows);

    res.json({ data: result });
  } catch (err) {
    handleRouteError(res, err);
  }
});
