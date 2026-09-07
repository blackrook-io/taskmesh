import { and, asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { EPUB_MIME } from "../../lib/epubMagic.js";
import { PDF_MIME } from "../../lib/pdfMagic.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { optionalMarkdown, optionalPlainTitle, plainTitle } from "../../lib/markdownFields.js";
import { parseRouteId } from "../../lib/routeParams.js";
import { allocateDocumentNumber } from "../../services/entityNumbers.js";
import {
  attachDocumentActor,
  attachDocumentActors,
  deleteUploadById,
} from "../../services/documents.js";
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

documentsRouter.post("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!proj) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const parsed = docBody.parse(req.body);
    const kind = parsed.kind ?? "markdown";
    const maxPos = await db
      .select({ p: schema.projectDocuments.position })
      .from(schema.projectDocuments)
      .where(eq(schema.projectDocuments.projectId, projectId));
    const nextPos =
      parsed.position ?? (maxPos.length ? Math.max(...maxPos.map((r) => r.p)) + 1 : 0);

    let uploadId: number | null = null;
    if (kind === "epub" || kind === "pdf") {
      const uid = parsed.uploadId!;
      const [upload] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, uid));
      const expectMime = binaryMimeForKind(kind);
      if (!upload || upload.mimeType !== expectMime) {
        sendError(
          res,
          400,
          "invalid_upload",
          `uploadId must reference a ${binaryLabel(kind)} upload`,
        );
        return;
      }
      uploadId = uid;
    }

    const actorId = await getCurrentUserId(db);
    const number = await allocateDocumentNumber(db);
    const [row] = await db
      .insert(schema.projectDocuments)
      .values({
        number,
        projectId,
        title: parsed.title,
        body: kind === "markdown" ? (parsed.body ?? null) : null,
        kind,
        uploadId,
        position: nextPos,
        updatedById: actorId,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create document");
      return;
    }
    res.status(201).json({ data: await attachDocumentActor(db, row) });
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

documentsRouter.patch("/:docId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const docId = parseRouteId(req, "docId");
    const parsed = docPatch.parse(req.body);
    if (!hasDefinedKeys(parsed, ["title", "body", "position", "uploadId"])) {
      sendError(res, 400, "empty_patch", "Provide title, body, position, and/or uploadId");
      return;
    }
    const [existing] = await db
      .select()
      .from(schema.projectDocuments)
      .where(eq(schema.projectDocuments.id, docId));
    if (!existing || existing.projectId !== projectId) {
      sendError(res, 404, "not_found", "Document not found");
      return;
    }

    const binaryKind =
      existing.kind === "epub" || existing.kind === "pdf" ? existing.kind : null;

    if (binaryKind && parsed.body !== undefined) {
      sendError(
        res,
        400,
        "invalid_patch",
        `${binaryLabel(binaryKind)} documents do not use a Markdown body`,
      );
      return;
    }
    if (existing.kind === "markdown" && parsed.uploadId !== undefined) {
      sendError(res, 400, "invalid_patch", "Markdown documents cannot have uploadId");
      return;
    }

    let nextUploadId = existing.uploadId;
    let oldUploadToDelete: number | null = null;
    if (binaryKind && parsed.uploadId !== undefined) {
      if (parsed.uploadId == null) {
        sendError(
          res,
          400,
          "invalid_upload",
          `${binaryLabel(binaryKind)} documents require an upload`,
        );
        return;
      }
      const [upload] = await db
        .select()
        .from(schema.uploads)
        .where(eq(schema.uploads.id, parsed.uploadId));
      if (!upload || upload.mimeType !== binaryMimeForKind(binaryKind)) {
        sendError(
          res,
          400,
          "invalid_upload",
          `uploadId must reference a ${binaryLabel(binaryKind)} upload`,
        );
        return;
      }
      if (existing.uploadId != null && existing.uploadId !== parsed.uploadId) {
        oldUploadToDelete = existing.uploadId;
      }
      nextUploadId = parsed.uploadId;
    }

    const actorId = await getCurrentUserId(db);
    const [row] = await db
      .update(schema.projectDocuments)
      .set({
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.body !== undefined && existing.kind === "markdown" ? { body: parsed.body } : {}),
        ...(parsed.position !== undefined ? { position: parsed.position } : {}),
        ...(binaryKind && parsed.uploadId !== undefined ? { uploadId: nextUploadId } : {}),
        updatedAt: new Date(),
        updatedById: actorId,
      })
      .where(eq(schema.projectDocuments.id, docId))
      .returning();

    if (oldUploadToDelete != null) {
      await deleteUploadById(db, oldUploadToDelete);
    }

    res.json({ data: await attachDocumentActor(db, row!) });
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
