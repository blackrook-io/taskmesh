import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router } from "express";
import multer from "multer";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { sniffImageMime } from "../../lib/imageMagic.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { getUploadDir } from "../../lib/paths.js";
import { uploadRateLimit } from "../../middleware/rateLimits.js";
import { getCurrentUserId } from "../../services/users.js";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 5 * 1024 * 1024);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, getUploadDir());
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext) ? ext : "";
    cb(null, `${randomUUID()}${safeExt || ".bin"}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error("unsupported_file_type"));
      return;
    }
    cb(null, true);
  },
});

export const uploadsRouter = Router();

uploadsRouter.post("/uploads", uploadRateLimit, upload.single("file"), async (req, res) => {
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
    const sniffed = sniffImageMime(head.subarray(0, n));
    if (!sniffed) {
      fs.unlinkSync(file.path);
      sendError(res, 400, "unsupported_file_type", "Only jpeg, png, gif, webp allowed");
      return;
    }
    const mimeType = sniffed;

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
      fs.unlinkSync(file.path);
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
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
    }
    if (err instanceof Error && err.message === "unsupported_file_type") {
      sendError(res, 400, "unsupported_file_type", "Only jpeg, png, gif, webp allowed");
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
    const filePath = path.join(getUploadDir(), storedName);
    if (!fs.existsSync(filePath)) {
      sendError(res, 404, "not_found", "File missing on disk");
      return;
    }
    res.setHeader("Content-Type", row.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="${storedName.replace(/"/g, "")}"`);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(path.resolve(filePath));
  } catch (err) {
    handleRouteError(res, err);
  }
});
