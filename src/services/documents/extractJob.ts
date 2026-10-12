import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { getUploadDir } from "../../lib/paths.js";
import { enqueue, registerJob } from "../jobs/queue.js";
import type { JobDefinition } from "../jobs/definitions.js";
import { extractEpub } from "./extractEpub.js";
import { extractPdf } from "./extractPdf.js";
import { extractionFailureMessage } from "./extractTypes.js";

export const JOB_DOCUMENT_EXTRACT = "document-extract-text";

export const DOCUMENT_EXTRACT_JOB: JobDefinition = {
  name: JOB_DOCUMENT_EXTRACT,
  label: "Document text extraction",
  retryLimit: 2,
  retryDelaySeconds: 30,
  retryBackoff: true,
  concurrency: 1,
  policy: "short",
  expireInSeconds: 180,
  cron: null,
};

export function registerDocumentExtractJob(): void {
  registerJob(DOCUMENT_EXTRACT_JOB, (data) => extractDocumentJob(data));
}

/** Mark a PDF or EPUB pending and enqueue extraction. Safe to call again for the same document. */
export async function queueDocumentExtraction(documentId: number, uploadId: number): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.documentTextSpans)
      .where(eq(schema.documentTextSpans.documentId, documentId));
    await tx
      .insert(schema.documentExtractions)
      .values({
        documentId,
        uploadId,
        status: "pending",
        errorMessage: null,
        unitCount: 0,
        charCount: 0,
        truncated: false,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.documentExtractions.documentId,
        set: {
          uploadId,
          status: "pending",
          errorMessage: null,
          unitCount: 0,
          charCount: 0,
          truncated: false,
          updatedAt: now,
        },
      });
  });
  try {
    await enqueue(JOB_DOCUMENT_EXTRACT, { documentId }, { singletonKey: String(documentId) });
  } catch (err) {
    console.error("[jobs] document extract enqueue failed", err);
  }
}

/** Enqueue binary documents that have no current extraction. */
export async function sweepDocumentExtractions(): Promise<void> {
  const rows = await db
    .select({
      id: schema.projectDocuments.id,
      uploadId: schema.projectDocuments.uploadId,
      extractUploadId: schema.documentExtractions.uploadId,
      status: schema.documentExtractions.status,
    })
    .from(schema.projectDocuments)
    .leftJoin(
      schema.documentExtractions,
      eq(schema.documentExtractions.documentId, schema.projectDocuments.id),
    )
    .where(
      and(
        inArray(schema.projectDocuments.kind, ["pdf", "epub"]),
        isNotNull(schema.projectDocuments.uploadId),
      ),
    );

  for (const row of rows) {
    if (row.uploadId == null) continue;
    const missing = row.status == null;
    const staleUpload = row.extractUploadId !== row.uploadId;
    const stillPending = row.status === "pending";
    if (!missing && !staleUpload && !stillPending) continue;
    await queueDocumentExtraction(row.id, row.uploadId);
  }
}

async function extractDocumentJob(data: object): Promise<void> {
  const documentId = readDocumentId(data);
  if (documentId == null) return;

  const [doc] = await db
    .select()
    .from(schema.projectDocuments)
    .where(eq(schema.projectDocuments.id, documentId));
  if (!doc || (doc.kind !== "pdf" && doc.kind !== "epub") || doc.uploadId == null) return;

  const kind = doc.kind;
  const uploadId = doc.uploadId;
  await markExtraction(documentId, {
    uploadId,
    status: "pending",
    errorMessage: null,
    unitCount: 0,
    charCount: 0,
    truncated: false,
  });

  const [upload] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, uploadId));
  if (!upload) {
    await markExtraction(documentId, {
      uploadId: null,
      status: "failed",
      errorMessage: "File missing.",
      unitCount: 0,
      charCount: 0,
      truncated: false,
    });
    return;
  }

  try {
    const bytes = new Uint8Array(await fs.readFile(path.join(getUploadDir(), upload.storedName)));
    const outcome = kind === "pdf" ? await extractPdf(bytes) : await extractEpub(bytes);
    if (!(await uploadStillCurrent(documentId, uploadId))) return;
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.documentTextSpans)
        .where(eq(schema.documentTextSpans.documentId, documentId));
      if (outcome.spans.length > 0) {
        await tx.insert(schema.documentTextSpans).values(
          outcome.spans.map((span) => ({
            documentId,
            ordinal: span.ordinal,
            locator: span.locator,
            label: span.label,
            text: span.text,
          })),
        );
      }
      await tx
        .update(schema.documentExtractions)
        .set({
          uploadId,
          status: outcome.status,
          errorMessage: outcome.errorMessage,
          unitCount: outcome.unitCount,
          charCount: outcome.charCount,
          truncated: outcome.truncated,
          updatedAt: new Date(),
        })
        .where(eq(schema.documentExtractions.documentId, documentId));
    });
  } catch (err) {
    if (!(await uploadStillCurrent(documentId, uploadId))) return;
    await markExtraction(documentId, {
      uploadId,
      status: "failed",
      errorMessage: extractionFailureMessage(kind, err),
      unitCount: 0,
      charCount: 0,
      truncated: false,
    });
    if (!isDeterministicExtractError(err)) throw err;
  }
}

function readDocumentId(data: object): number | null {
  if (!("documentId" in data)) return null;
  const id = data.documentId;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

async function uploadStillCurrent(documentId: number, uploadId: number): Promise<boolean> {
  const [current] = await db
    .select({ uploadId: schema.projectDocuments.uploadId })
    .from(schema.projectDocuments)
    .where(eq(schema.projectDocuments.id, documentId));
  return current?.uploadId === uploadId;
}

async function markExtraction(
  documentId: number,
  fields: {
    uploadId: number | null;
    status: "pending" | "ready" | "empty" | "failed";
    errorMessage: string | null;
    unitCount: number;
    charCount: number;
    truncated: boolean;
  },
): Promise<void> {
  const now = new Date();
  await db
    .insert(schema.documentExtractions)
    .values({ documentId, ...fields, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.documentExtractions.documentId,
      set: { ...fields, updatedAt: now },
    });
}

function isDeterministicExtractError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  return name === "PasswordException" || name === "InvalidPDFException" || name === "FormatError";
}
