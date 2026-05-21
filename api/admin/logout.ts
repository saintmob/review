import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearAdminCookie, methodNotAllowed } from "../_shared";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    methodNotAllowed(res, ["POST"]);
    return;
  }

  clearAdminCookie(res);
  res.status(200).json({ authenticated: false });
}
