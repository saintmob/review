import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { isAllowedMediaProxyTarget, normalizeMediaContentType } from "./_shared.js";

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
    const upstream = await fetch(rawUrl, {
      method: "GET",
      redirect: "follow",
    });

    if (!upstream.ok && upstream.status !== 206) {
      throw new Error(`Media request failed with HTTP ${upstream.status}`);
    }
    if (!upstream.body) {
      throw new Error("Media response body is empty");
    }

    const upstreamContentType = upstream.headers.get("content-type");
    const contentType = upstreamContentType || normalizeMediaContentType(upstreamContentType) || "application/octet-stream";
    res.status(upstream.status);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
    res.setHeader("Accept-Ranges", "none");

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>).pipe(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法加载视频";
    res.status(502).json({ error: message });
  }
}
