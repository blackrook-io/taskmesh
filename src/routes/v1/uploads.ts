import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router } from "express";
import multer from "multer";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { EPUB_MIME, sniffEpubZip } from "../../lib/epubMagic.js";
import { sniffImageMime } from "../../lib/imageMagic.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { getUploadDir } from "../../lib/paths.js";
import { uploadRateLimit } from "../../middleware/rateLimits.js";
import { withRestoredRequestAuth } from "../../middleware/restoreRequestAuth.js";
import { assertCanAccessOwned } from "../../services/ownership.js";
import { getCurrentUserId } from "../../services/users.js";

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const MAX_IMAGE_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 5 * 1024 * 1024);
const MAX_EPUB_BYTES = Number(process.env.UPLOAD_MAX_BYTES_EPUB ?? 100 * 1024 * 1024);
const MULTER_MAX = Math.max(MAX_IMAGE_BYTES, MAX_EPUB_BYTES);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, getUploadDir());
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    let safeExt = ".bin";
    if (IMAGE_EXTS.has(ext)) safeExt = ext === ".jpeg" ? ".jpg" : ext;
    else if (ext === ".epub" || file.mimetype === EPUB_MIME) safeExt = ".epub";
    cb(null, `${randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MULTER_MAX },
  fileFilter: (_req, file, cb) => {
    const ok =
      IMAGE_MIME.has(file.mimetype) ||
      file.mimetype === EPUB_MIME ||
      file.mimetype === "application/zip" ||
      path.extname(file.originalname).toLowerCase() === ".epub";
    if (!ok) {
      cb(new Error("unsupported_file_type"));
      return;
    }
    cb(null, true);
  },
});

function unlinkQuiet(p: string | undefined) {
  if (!p) return;
  try {
    fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

export const uploadsRouter = Router();

uploadsRouter.post(
  "/uploads",
  uploadRateLimit,
  withRestoredRequestAuth(upload.single("file")),
  async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      sendError(res, 400, "no_file", "Expected multipart field \"file\"");
      return;
    }
    const head = Buffer.alloc(16);
    const fd = fs.openSync(file.path, "r");
    let n = 0;
    try {
      n = fs.readSync(fd, head, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
    const buf = head.subarray(0, n);
    const imageMime = sniffImageMime(buf);
    const looksEpub =
      sniffEpubZip(buf) &&
      (file.mimetype === EPUB_MIME ||
        file.mimetype === "application/zip" ||
        path.extname(file.originalname).toLowerCase() === ".epub" ||
        path.extname(file.filename).toLowerCase() === ".epub");

    let mimeType: string;
    let maxBytes: number;
    if (imageMime) {
      mimeType = imageMime;
      maxBytes = MAX_IMAGE_BYTES;
    } else if (looksEpub) {
      mimeType = EPUB_MIME;
      maxBytes = MAX_EPUB_BYTES;
      // Ensure stored name ends with .epub
      if (!file.filename.toLowerCase().endsWith(".epub")) {
        const nextName = `${path.basename(file.filename, path.extname(file.filename))}.epub`;
        const nextPath = path.join(path.dirname(file.path), nextName);
        fs.renameSync(file.path, nextPath);
        file.path = nextPath;
        file.filename = nextName;
      }
    } else {
      unlinkQuiet(file.path);
      sendError(res, 400, "unsupported_file_type", "Only jpeg, png, gif, webp, or epub allowed");
      return;
    }

    if (file.size > maxBytes) {
      unlinkQuiet(file.path);
      sendError(
        res,
        400,
        "file_too_large",
        mimeType === EPUB_MIME
          ? `EPUB exceeds ${MAX_EPUB_BYTES} bytes`
          : `Image exceeds ${MAX_IMAGE_BYTES} bytes`,
      );
      return;
    }

    const ownerId = await getCurrentUserId(db);
    const [row] = await db
      .insert(schema.uploads)
      .values({
        storedName: file.filename,
        originalName: file.originalname,
        mimeType,
        sizeBytes: file.size,
        ownerId,
      })
      .returning();

    if (!row) {
      unlinkQuiet(file.path);
      sendError(res, 500, "insert_failed", "Could not record upload");
      return;
    }

    const url = `/api/v1/files/${encodeURIComponent(row.storedName)}`;
    res.status(201).json({
      data: {
        id: row.id,
        url,
        storedName: row.storedName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
      },
    });
  } catch (err) {
    unlinkQuiet(req.file?.path);
    if (err instanceof Error && err.message === "unsupported_file_type") {
      sendError(res, 400, "unsupported_file_type", "Only jpeg, png, gif, webp, or epub allowed");
      return;
    }
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      sendError(res, 400, "file_too_large", `File exceeds ${MULTER_MAX} bytes`);
      return;
    }
    handleRouteError(res, err);
  }
});

uploadsRouter.get("/files/:storedName", async (req, res) => {
  try {
    const storedName = path.basename(req.params.storedName ?? "");
    if (!storedName || storedName !== req.params.storedName) {
      sendError(res, 400, "invalid_name", "Invalid file name");
      return;
    }
    const [row] = await db.select().from(schema.uploads).where(eq(schema.uploads.storedName, storedName));
    if (!row) {
      sendError(res, 404, "not_found", "File not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessOwned(db, actorId, row.ownerId);
    const filePath = path.join(getUploadDir(), storedName);
    if (!fs.existsSync(filePath)) {
      sendError(res, 404, "not_found", "File missing on disk");
      return;
    }
    res.setHeader("Content-Type", row.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="${storedName.replace(/"/g, "")}"`);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(path.resolve(filePath));
  } catch (err) {
    handleRouteError(res, err);
  }
});
