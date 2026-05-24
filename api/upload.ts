import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const MAX_UPLOAD_BYTES = Number(process.env.MAX_REFLECTION_UPLOAD_BYTES || 250 * 1024 * 1024);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const jsonResponse = await handleUpload({
      request: req,
      body: req.body as HandleUploadBody,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["audio/*", "video/*"],
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: true,
      }),
    });

    res.status(200).json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "上传失败";
    const statusCode = message.includes("BLOB_READ_WRITE_TOKEN") ? 503 : 400;
    res.status(statusCode).json({ error: message });
  }
}
