import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, isAdminRequest, methodNotAllowed, PLAN_DOC_PATH, readPlan, STORAGE_KEY } from "./_shared";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    try {
      const plan = await readPlan();
      res.status(200).json({ plan });
    } catch (error) {
      console.error("Failed to read plan", error);
      res.status(500).json({ error: "Failed to read plan" });
    }
    return;
  }

  if (req.method === "PUT") {
    if (!isAdminRequest(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const db = getAdminDb();
    if (!db) {
      res.status(503).json({ error: "Firebase Admin is not configured" });
      return;
    }

    if (!req.body?.data || typeof req.body.data !== "object") {
      res.status(400).json({ error: "Request body must include data" });
      return;
    }

    try {
      const ref = db.collection(PLAN_DOC_PATH[0]).doc(PLAN_DOC_PATH[1]);
      await ref.set(
        {
          data: req.body.data,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: "shared-password-admin",
          title: "《合奏 Ensemble》流程安排",
          schemaVersion: req.body.schemaVersion || STORAGE_KEY,
        },
        { merge: true },
      );
      const plan = await readPlan();
      res.status(200).json({ plan });
    } catch (error) {
      console.error("Failed to save plan", error);
      res.status(500).json({ error: "Failed to save plan" });
    }
    return;
  }

  methodNotAllowed(res, ["GET", "PUT"]);
}
