import type { VercelRequest, VercelResponse } from "@vercel/node";
import { callUploadApi, jsonError, MAX_UPLOAD_BYTES, normalizeString } from "./_shared.js";

type InitResponse = {
  uploadId: string;
  objectKey: string;
  uploadUrl: string;
  publicUrl: string;
  expiresAt?: string;
};

function isSupportedUploadContentType(contentType: string) {
  return contentType.startsWith("video/") || contentType.startsWith("image/");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    jsonError(res, 405, "Method not allowed");
    return;
  }

  try {
    const filename = normalizeString(req.body?.filename) || `reflection-${Date.now()}.webm`;
    const contentType = normalizeString(req.body?.contentType) || "video/webm";
    const externalUserId = normalizeString(req.body?.externalUserId) || "anonymous";
    const sizeBytes = Number(req.body?.sizeBytes || 0);

    if (!isSupportedUploadContentType(contentType)) {
      jsonError(res, 400, "Only image/* or video/* files can be uploaded");
      return;
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) {
      jsonError(res, 400, "文件体积无效或超过上限");
      return;
    }

    const payload = await callUploadApi<InitResponse>("/api/uploads/init", {
      filename,
      contentType,
      sizeBytes,
      externalUserId,
      durationMs: Number.isFinite(Number(req.body?.durationMs)) ? Number(req.body.durationMs) : undefined,
      width: Number.isFinite(Number(req.body?.width)) ? Number(req.body.width) : undefined,
      height: Number.isFinite(Number(req.body?.height)) ? Number(req.body.height) : undefined,
      metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : undefined,
    });

    res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法初始化文件上传";
    const status = message.includes("VAD_UPLOAD_API_KEY") ? 503 : 502;
    jsonError(res, status, message);
  }
}
