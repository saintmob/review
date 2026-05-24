import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { getAdminDb, methodNotAllowed } from "./_shared";

const REFLECTIONS_COLLECTION = process.env.FIREBASE_REFLECTIONS_COLLECTION || "courseReflections";

type ReflectionInput = {
  name?: unknown;
  note?: unknown;
  audioUrl?: unknown;
  mediaType?: unknown;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function serializeReflection(id: string, data: DocumentData) {
  return {
    id,
    name: String(data.name || ""),
    note: String(data.note || ""),
    audioUrl: String(data.audioUrl || ""),
    mediaType: String(data.mediaType || ""),
    timestamp: String(data.timestamp || new Date(0).toISOString()),
  };
}

async function listReflections(res: VercelResponse) {
  const db = getAdminDb();
  if (!db) {
    res.status(200).json({
      reflections: [],
      warning: "Firebase Admin is not configured",
    });
    return;
  }

  try {
    const snapshot = await db.collection(REFLECTIONS_COLLECTION).orderBy("timestamp", "desc").limit(120).get();
    res.status(200).json({
      reflections: snapshot.docs.map((doc) => serializeReflection(doc.id, doc.data())),
    });
  } catch (error) {
    console.error("Failed to list reflections", error);
    res.status(200).json({
      reflections: [],
      warning: error instanceof Error ? error.message : "无法读取课程总结",
    });
  }
}

async function createReflection(input: ReflectionInput, res: VercelResponse) {
  const db = getAdminDb();
  if (!db) {
    res.status(503).json({ error: "Firebase Admin is not configured" });
    return;
  }

  const name = normalizeString(input?.name);
  const note = normalizeString(input?.note);
  const audioUrl = normalizeString(input?.audioUrl);
  const mediaType = normalizeString(input?.mediaType) || "application/octet-stream";

  if (!name) {
    res.status(400).json({ error: "请输入学生姓名" });
    return;
  }
  if (!audioUrl || !/^https:\/\/.+/i.test(audioUrl)) {
    res.status(400).json({ error: "缺少有效的 audioUrl" });
    return;
  }
  if (!mediaType.startsWith("audio/") && !mediaType.startsWith("video/") && mediaType !== "application/octet-stream") {
    res.status(400).json({ error: "文件类型无效" });
    return;
  }

  const timestamp = new Date().toISOString();
  const ref = db.collection(REFLECTIONS_COLLECTION).doc();
  const reflection = {
    id: ref.id,
    name,
    note,
    audioUrl,
    mediaType,
    timestamp,
    createdAt: FieldValue.serverTimestamp(),
    requestId: crypto.randomUUID(),
  };

  await ref.set(reflection);
  res.status(201).json({ reflection: serializeReflection(ref.id, reflection) });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      await listReflections(res);
      return;
    }

    if (req.method === "POST") {
      await createReflection(req.body, res);
      return;
    }

    methodNotAllowed(res, ["GET", "POST"]);
  } catch (error) {
    console.error("Reflection API failed", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "服务器错误" });
  }
}
