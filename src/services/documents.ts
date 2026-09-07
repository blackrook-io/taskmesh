import fs from "node:fs";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { getUploadDir } from "../lib/paths.js";
import type { UserRef } from "../lib/userFields.js";
import { loadUserMap } from "./users.js";

type Db = NodePgDatabase<typeof schema>;

export type DocumentKind = "markdown" | "epub" | "pdf";

export type ProjectDocumentWithActors = typeof schema.projectDocuments.$inferSelect & {
  updatedBy: UserRef | null;
  fileUrl: string | null;
  fileMimeType: string | null;
  fileOriginalName: string | null;
};

function fileUrlFor(storedName: string | null | undefined): string | null {
  if (!storedName) return null;
  return `/api/v1/files/${encodeURIComponent(storedName)}`;
}

export async function attachDocumentActors(
  db: Db,
  rows: (typeof schema.projectDocuments.$inferSelect)[],
): Promise<ProjectDocumentWithActors[]> {
  if (rows.length === 0) return [];
  const byId = await loadUserMap(db);
  const uploadIds = [
    ...new Set(rows.map((r) => r.uploadId).filter((id): id is number => id != null)),
  ];
  const uploadById = new Map<
    number,
    { storedName: string; mimeType: string; originalName: string }
  >();
  if (uploadIds.length > 0) {
    const uploads = await db
      .select({
        id: schema.uploads.id,
        storedName: schema.uploads.storedName,
        mimeType: schema.uploads.mimeType,
        originalName: schema.uploads.originalName,
      })
      .from(schema.uploads)
      .where(inArray(schema.uploads.id, uploadIds));
    for (const u of uploads) {
      uploadById.set(u.id, u);
    }
  }
  return rows.map((row) => {
    const upload = row.uploadId != null ? uploadById.get(row.uploadId) : undefined;
    return {
      ...row,
      updatedBy: row.updatedById != null ? (byId.get(row.updatedById) ?? null) : null,
      fileUrl: fileUrlFor(upload?.storedName),
      fileMimeType: upload?.mimeType ?? null,
      fileOriginalName: upload?.originalName ?? null,
    };
  });
}

export async function attachDocumentActor(
  db: Db,
  row: typeof schema.projectDocuments.$inferSelect,
): Promise<ProjectDocumentWithActors> {
  const [withActors] = await attachDocumentActors(db, [row]);
  if (!withActors) {
    return {
      ...row,
      updatedBy: null,
      fileUrl: null,
      fileMimeType: null,
      fileOriginalName: null,
    };
  }
  return withActors;
}

/** Delete upload row + on-disk file if present. Ignores missing files. */
export async function deleteUploadById(db: Db, uploadId: number): Promise<void> {
  const [row] = await db
    .delete(schema.uploads)
    .where(eq(schema.uploads.id, uploadId))
    .returning({ storedName: schema.uploads.storedName });
  if (!row) return;
  const filePath = path.join(getUploadDir(), row.storedName);
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* missing on disk is fine */
  }
}
