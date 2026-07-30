import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import multer from "multer";

export const UPLOADS_ROOT = path.join(process.cwd(), "uploads");
export const CHAT_UPLOADS_DIR = path.join(UPLOADS_ROOT, "chat");
fs.mkdirSync(CHAT_UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CHAT_UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 20);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  },
});

/** 20MB cap covers voice notes and typical chat attachments without letting a single upload
 *  monopolize disk/bandwidth on this local-disk storage backend. */
export const chatUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});
