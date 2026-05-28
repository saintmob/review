import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchMediaAsBuffer, isAllowedMediaProxyTarget } from "./_shared.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
  if (!rawUrl || !isAllowedMediaProxyTarget(rawUrl)) {
    res.status(400).json({ error: "Invalid media url" });
    return;
  }

  try {
    const payload = await fetchMediaAsBuffer(rawUrl);
    res.status(200);
    res.setHeader("Content-Type", payload.contentType);
    res.setHeader("Content-Length", payload.contentLength);
    res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
    res.setHeader("Accept-Ranges", "none");
    res.send(payload.buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法加载视频";
    res.status(502).json({ error: message });
  }
}
