import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSessionToken, methodNotAllowed, normalizeAdminPassword, setAdminCookie } from "../_shared";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    methodNotAllowed(res, ["POST"]);
    return;
  }

  const configuredPassword = normalizeAdminPassword(process.env.ADMIN_PASSWORD);
  if (!configuredPassword) {
    res.status(503).json({ error: "ADMIN_PASSWORD is not configured" });
    return;
  }

  if (normalizeAdminPassword(req.body?.password) !== configuredPassword) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  setAdminCookie(res, createSessionToken());
  res.status(200).json({ authenticated: true });
}
