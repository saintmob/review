import crypto from "node:crypto";
import path from "node:path";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getStorage } from "firebase-admin/storage";
import { getAdminDb, methodNotAllowed, resolveExistingStorageBucketName } from "../_shared.js";

type CoverUploadResponse = {
  ok?: boolean;
  publicUrl: string;
  objectKey: string;
  fileName: string;
};

function normalizeFileName(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || fallback;
}

function parseDataUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

function buildCoverObjectKey(fileName: string, workIndex: number) {
  const ext = path.extname(fileName) || ".jpg";
  return `student-covers/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${workIndex}-${crypto.randomUUID()}${ext}`;
}

async function uploadCoverImageToStorage(input: { fileName: string; dataUrl: string; workIndex: number }) {
  const parsed = parseDataUrl(input.dataUrl);
  if (!parsed) {
    throw new Error("Invalid cover image data");
  }

  const bucketName = await resolveExistingStorageBucketName();
  if (!bucketName) {
    throw new Error("Firebase storage bucket does not exist");
  }
  const bucket = getStorage().bucket(bucketName);
  const objectKey = buildCoverObjectKey(input.fileName, input.workIndex);
  const token = crypto.randomUUID();
  const file = bucket.file(objectKey);

  await file.save(parsed.buffer, {
    resumable: false,
    metadata: {
      contentType: parsed.contentType,
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  return {
    objectKey,
    fileName: input.fileName,
    publicUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectKey)}?alt=media&token=${token}`,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    methodNotAllowed(res, ["POST"]);
    return;
  }

  try {
    const fileName = normalizeFileName(req.body?.fileName, "cover.jpg");
    const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
    const workIndex = Number.isFinite(Number(req.body?.workIndex)) ? Number(req.body.workIndex) : 1;
    const parsed = parseDataUrl(dataUrl);

    if (!parsed || !parsed.contentType.startsWith("image/")) {
      res.status(400).json({ error: "Only image data URLs can be uploaded" });
      return;
    }

    const db = getAdminDb();
    if (!db) {
      res.status(503).json({ error: "Firebase Admin is not configured" });
      return;
    }

    const payload = await uploadCoverImageToStorage({ fileName, dataUrl, workIndex });
    res.status(200).json({ ok: true, ...payload } satisfies CoverUploadResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法上传封面图片";
    res.status(502).json({ error: message });
  }
}
