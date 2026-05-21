import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAdminRequest, methodNotAllowed } from "../_shared";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    methodNotAllowed(res, ["GET"]);
    return;
  }

  res.status(200).json({ authenticated: isAdminRequest(req) });
}
