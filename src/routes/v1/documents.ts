import { and, asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { activitySourceFromRequest, type ActivitySource } from "../../lib/activityRequest.js";
import { EPUB_MIME } from "../../lib/epubMagic.js";
import { PDF_MIME } from "../../lib/pdfMagic.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { sendMutation, type MutationResult } from "../../lib/mutationResult.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { optionalMarkdown, optionalPlainTitle, plainTitle } from "../../lib/markdownFields.js";
import { parseRouteId } from "../../lib/routeParams.js";
import { allocateDocumentNumber } from "../../services/entityNumbers.js";
import {
  attachDocumentActor,
  attachDocumentActors,
  deleteUploadById,
} from "../../services/documents.js";
import { queueDocumentExtraction } from "../../services/documents/extractJob.js";
import { recordDocumentBodyChange } from "../../services/entityActivity.js";
import { syncMentionLinks } from "../../services/mentionLinks.js";
import { assertCanAccessOwned, assertCanAccessProject } from "../../services/ownership.js";
import { getCurrentUserId } from "../../services/users.js";

const documentKind = z.enum(["markdown", "epub", "pdf"]);
const BINARY_KINDS = new Set(["epub", "pdf"]);

function binaryMimeForKind(kind: "epub" | "pdf"): string {
  return kind === "epub" ? EPUB_MIME : PDF_MIME;
}

function binaryLabel(kind: "epub" | "pdf"): string {
  return kind === "epub" ? "EPUB" : "PDF";
}

const docBody = z
  .object({
    title: plainTitle(500),
    body: optionalMarkdown(500_000),
    position: z.number().int().optional(),
    kind: documentKind.optional(),
    uploadId: z.number().int().positive().optional().nullable(),
  })
  .superRefine((val, ctx) => {
    const kind = val.kind ?? "markdown";
    if (BINARY_KINDS.has(kind)) {
      if (val.uploadId == null) {
        ctx.addIssue({
          code: "custom",
          message: `${binaryLabel(kind as "epub" | "pdf")} documents require uploadId`,
          path: ["uploadId"],
        });
      }
      if (val.body != null && val.body !== "") {
        ctx.addIssue({
          code: "custom",
          message: `${binaryLabel(kind as "epub" | "pdf")} documents do not use a Markdown body`,
          path: ["body"],
        });
      }
    } else if (val.uploadId != null) {
      ctx.addIssue({
        code: "custom",
        message: "Markdown documents cannot have uploadId",
        path: ["uploadId"],
      });
    }
  });

const docPatch = z.object({
  title: optionalPlainTitle(500),
  body: optionalMarkdown(500_000),
  position: z.number().int().optional(),
  uploadId: z.number().int().positive().optional().nullable(),
});

export const documentsRouter = Router({ mergeParams: true });

documentsRouter.get("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!proj) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const rows = await db
      .select()
      .from(schema.projectDocuments)
      .where(eq(schema.projectDocuments.projectId, projectId))
      .orderBy(asc(schema.projectDocuments.position), asc(schema.projectDocuments.id));
    res.json({ data: await attachDocumentActors(db, rows) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

export async function createDocumentForActor(args: {
  projectId: number;
  body: unknown;
  actorId: number;
}): Promise<MutationResult> {
  const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, args.projectId));
  if (!proj) {
    return { ok: false, status: 404, code: "not_found", message: "Project not found" };
  }
  await assertCanAccessProject(db, args.actorId, args.projectId, "write");
  const parsed = docBody.parse(args.body);
  const kind = parsed.kind ?? "markdown";
  const maxPos = await db
    .select({ p: schema.projectDocuments.position })
    .from(schema.projectDocuments)
    .where(eq(schema.projectDocuments.projectId, args.projectId));
  const nextPos = parsed.position ?? (maxPos.length ? Math.max(...maxPos.map((r) => r.p)) + 1 : 0);

  let uploadId: number | null = null;
  if (kind === "epub" || kind === "pdf") {
    const uid = parsed.uploadId!;
    const [upload] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, uid));
    const expectMime = binaryMimeForKind(kind);
    if (!upload || upload.mimeType !== expectMime) {
      return {
        ok: false,
        status: 400,
        code: "invalid_upload",
        message: `uploadId must reference a ${binaryLabel(kind)} upload`,
      };
    }
    await assertCanAccessOwned(db, args.actorId, upload.ownerId);
    uploadId = uid;
  }

  const number = await allocateDocumentNumber(db);
  const [row] = await db
    .insert(schema.projectDocuments)
    .values({
      number,
      projectId: args.projectId,
      title: parsed.title,
      body: kind === "markdown" ? (parsed.body ?? null) : null,
      kind,
      uploadId,
      position: nextPos,
      updatedById: args.actorId,
    })
    .returning();
  if (!row) {
    return { ok: false, status: 500, code: "insert_failed", message: "Could not create document" };
  }
  if (row.kind === "markdown") {
    await syncMentionLinks(db, {
      srcType: "document",
      srcId: row.id,
      markdown: row.body,
      actorUserId: args.actorId,
    });
  }
  if ((row.kind === "pdf" || row.kind === "epub") && row.uploadId != null) {
    await queueDocumentExtraction(row.id, row.uploadId);
  }
  return { ok: true, status: 201, data: await attachDocumentActor(db, row) };
}

documentsRouter.post("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const actorId = await getCurrentUserId(db);
    sendMutation(res, await createDocumentForActor({ projectId, body: req.body, actorId }));
  } catch (err) {
    handleRouteError(res, err);
  }
});

documentsRouter.get("/:docId/text", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const docId = parseRouteId(req, "docId");
    const locator = Number(req.query.locator);
    if (!Number.isInteger(locator) || locator < 1) {
      sendError(res, 400, "invalid_locator", "locator must be a positive integer");
      return;
    }
    const [row] = await db.select().from(schema.projectDocuments).where(eq(schema.projectDocuments.id, docId));
    if (!row || row.projectId !== projectId) {
      sendError(res, 404, "not_found", "Document not found");
      return;
    }
    if (row.kind !== "pdf" && row.kind !== "epub") {
      sendError(res, 400, "not_binary", "Markdown documents have no extracted text");
      return;
    }
    const [extraction] = await db
      .select({ status: schema.documentExtractions.status })
      .from(schema.documentExtractions)
      .where(eq(schema.documentExtractions.documentId, docId));
    const spans = await db
      .select({
        ordinal: schema.documentTextSpans.ordinal,
        label: schema.documentTextSpans.label,
        text: schema.documentTextSpans.text,
      })
      .from(schema.documentTextSpans)
      .where(
        and(
          eq(schema.documentTextSpans.documentId, docId),
          eq(schema.documentTextSpans.locator, locator),
        ),
      )
      .orderBy(asc(schema.documentTextSpans.ordinal));
    res.json({
      data: {
        locator,
        status: extraction?.status ?? null,
        spans,
      },
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

documentsRouter.get("/:docId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const docId = parseRouteId(req, "docId");
    const [row] = await db.select().from(schema.projectDocuments).where(eq(schema.projectDocuments.id, docId));
    if (!row || row.projectId !== projectId) {
      sendError(res, 404, "not_found", "Document not found");
      return;
    }
    res.json({ data: await attachDocumentActor(db, row) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

export async function updateDocumentForActor(args: {
  projectId: number;
  docId: number;
  body: unknown;
  actorId: number;
  source: ActivitySource;
}): Promise<MutationResult> {
  await assertCanAccessProject(db, args.actorId, args.projectId, "write");
  const parsed = docPatch.parse(args.body);
  if (!hasDefinedKeys(parsed, ["title", "body", "position", "uploadId"])) {
    return {
      ok: false,
      status: 400,
      code: "empty_patch",
      message: "Provide title, body, position, and/or uploadId",
    };
  }
  const [existing] = await db
    .select()
    .from(schema.projectDocuments)
    .where(eq(schema.projectDocuments.id, args.docId));
  if (!existing || existing.projectId !== args.projectId) {
    return { ok: false, status: 404, code: "not_found", message: "Document not found" };
  }

  const binaryKind = existing.kind === "epub" || existing.kind === "pdf" ? existing.kind : null;

  if (binaryKind && parsed.body !== undefined) {
    return {
      ok: false,
      status: 400,
      code: "invalid_patch",
      message: `${binaryLabel(binaryKind)} documents do not use a Markdown body`,
    };
  }
  if (existing.kind === "markdown" && parsed.uploadId !== undefined) {
    return {
      ok: false,
      status: 400,
      code: "invalid_patch",
      message: "Markdown documents cannot have uploadId",
    };
  }

  let nextUploadId = existing.uploadId;
  let oldUploadToDelete: number | null = null;
  if (binaryKind && parsed.uploadId !== undefined) {
    if (parsed.uploadId == null) {
      return {
        ok: false,
        status: 400,
        code: "invalid_upload",
        message: `${binaryLabel(binaryKind)} documents require an upload`,
      };
    }
    const [upload] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, parsed.uploadId));
    if (!upload || upload.mimeType !== binaryMimeForKind(binaryKind)) {
      return {
        ok: false,
        status: 400,
        code: "invalid_upload",
        message: `uploadId must reference a ${binaryLabel(binaryKind)} upload`,
      };
    }
    if (existing.uploadId != null && existing.uploadId !== parsed.uploadId) {
      oldUploadToDelete = existing.uploadId;
    }
    nextUploadId = parsed.uploadId;
  }

  const [row] = await db
    .update(schema.projectDocuments)
    .set({
      ...(parsed.title !== undefined ? { title: parsed.title } : {}),
      ...(parsed.body !== undefined && existing.kind === "markdown" ? { body: parsed.body } : {}),
      ...(parsed.position !== undefined ? { position: parsed.position } : {}),
      ...(binaryKind && parsed.uploadId !== undefined ? { uploadId: nextUploadId } : {}),
      updatedAt: new Date(),
      updatedById: args.actorId,
    })
    .where(eq(schema.projectDocuments.id, args.docId))
    .returning();

  if (row && existing.kind === "markdown" && parsed.body !== undefined) {
    await syncMentionLinks(db, {
      srcType: "document",
      srcId: row.id,
      markdown: row.body,
      actorUserId: args.actorId,
    });
  }
  if (existing.kind === "markdown" && parsed.body !== undefined) {
    await recordDocumentBodyChange(
      db,
      args.docId,
      existing.body,
      parsed.body,
      args.actorId,
      args.source,
    );
  }
  const uploadReplaced =
    binaryKind != null &&
    row != null &&
    parsed.uploadId !== undefined &&
    row.uploadId != null &&
    row.uploadId !== existing.uploadId;
  if (uploadReplaced && row?.uploadId != null) {
    await queueDocumentExtraction(row.id, row.uploadId);
  }
  if (oldUploadToDelete != null) {
    await deleteUploadById(db, oldUploadToDelete);
  }

  return { ok: true, status: 200, data: await attachDocumentActor(db, row!) };
}

documentsRouter.patch("/:docId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const docId = parseRouteId(req, "docId");
    const actorId = await getCurrentUserId(db);
    sendMutation(
      res,
      await updateDocumentForActor({
        projectId,
        docId,
        body: req.body,
        actorId,
        source: activitySourceFromRequest(req),
      }),
    );
  } catch (err) {
    handleRouteError(res, err);
  }
});

documentsRouter.delete("/:docId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const docId = parseRouteId(req, "docId");
    const [existing] = await db
      .select()
      .from(schema.projectDocuments)
      .where(and(eq(schema.projectDocuments.id, docId), eq(schema.projectDocuments.projectId, projectId)));
    if (!existing) {
      sendError(res, 404, "not_found", "Document not found");
      return;
    }
    const uploadId = existing.uploadId;
    await db.delete(schema.projectDocuments).where(eq(schema.projectDocuments.id, docId));
    if (uploadId != null) {
      await deleteUploadById(db, uploadId);
    }
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
