import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { initializeApp, applicationDefault, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import "dotenv/config";
import { resolveExistingStorageBucketName } from "./api/_shared.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLAN_DOC_PATH = ["showPlans", "ensemble-flow"] as const;
const SESSION_COOKIE = "show_plan_admin";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const REFLECTIONS_COLLECTION = process.env.FIREBASE_REFLECTIONS_COLLECTION || "courseReflections";
const MAX_REFLECTION_UPLOAD_BYTES = process.env.MAX_REFLECTION_UPLOAD_BYTES || `${250 * 1024 * 1024}`;
const UPLOAD_API_BASE = (process.env.VAD_UPLOAD_API_BASE || "https://vad-video-upload-api.saintmob.workers.dev").replace(/\/+$/, "");

function isSupportedUploadContentType(contentType: string) {
  return contentType.startsWith("video/") || contentType.startsWith("image/");
}

function normalizeAdminPassword(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];
  const pair = quotePairs.find(([open, close]) => trimmed.startsWith(open) && trimmed.endsWith(close));
  return pair ? trimmed.slice(pair[0].length, -pair[1].length).trim() : trimmed;
}

function getSessionSecret() {
  return process.env.SESSION_SECRET || "local-dev-session-secret";
}

function signSession(value: string) {
  return crypto.createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function createSessionToken() {
  const payload = JSON.stringify({
    role: "admin",
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  });
  const value = Buffer.from(payload).toString("base64url");
  return `${value}.${signSession(value)}`;
}

function parseCookies(cookieHeader: string | undefined) {
  return Object.fromEntries(
    (cookieHeader ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator === -1) return [part, ""];
        return [decodeURIComponent(part.slice(0, separator)), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
}

function isValidSessionToken(token: string | undefined) {
  if (!token) return false;
  const [value, signature] = token.split(".");
  if (!value || !signature || signSession(value) !== signature) return false;

  try {
    const payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return payload.role === "admin" && typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function setAdminCookie(res: express.Response, token: string) {
  const secure =
    process.env.FORCE_SECURE_COOKIE === "true" ||
    (process.env.NODE_ENV === "production" && process.env.APP_URL?.startsWith("https://"));
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: SESSION_MAX_AGE_SECONDS * 1000,
    path: "/",
  });
}

function clearAdminCookie(res: express.Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  if (!isValidSessionToken(cookies[SESSION_COOKIE])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  const decoded = raw.trim().startsWith("{")
    ? raw.trim()
    : Buffer.from(raw.trim(), "base64").toString("utf8").trim();
  const serviceAccount = JSON.parse(extractJsonObject(decoded));
  if (typeof serviceAccount.private_key === "string") {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  }

  return serviceAccount;
}

function extractJsonObject(value: string) {
  try {
    JSON.parse(value);
    return value;
  } catch {
    const start = value.indexOf("{");
    if (start === -1) return value;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const char = value[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = inString;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) return value.slice(start, index + 1);
      }
    }
    return value;
  }
}

function getStorageBucketName(projectId?: string, serviceAccount?: { storage_bucket?: string }) {
  const configured =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET ||
    serviceAccount?.storage_bucket ||
    "";
  if (configured.trim()) return configured.trim();
  return projectId ? `${projectId}.firebasestorage.app` : "";
}

function getAdminDb(): Firestore | null {
  try {
    if (!getApps().length) {
      const serviceAccount = parseServiceAccount();
      const projectId =
        process.env.FIREBASE_PROJECT_ID ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        serviceAccount?.project_id;
      const storageBucket = getStorageBucketName(projectId, serviceAccount);
      if (!serviceAccount && !projectId) {
        return null;
      }
      initializeApp({
        credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
        projectId,
        storageBucket: storageBucket || undefined,
      });
    }

    const databaseId = process.env.FIREBASE_DATABASE_ID || process.env.VITE_FIREBASE_DATABASE_ID;
    return databaseId ? getFirestore(databaseId) : getFirestore();
  } catch (error) {
    console.warn("Firebase Admin is not configured; API persistence is unavailable.", error);
    return null;
  }
}

async function readPlan() {
  const db = getAdminDb();
  if (!db) return null;
  const snapshot = await db.collection(PLAN_DOC_PATH[0]).doc(PLAN_DOC_PATH[1]).get();
  return snapshot.exists ? snapshot.data() : null;
}

function serializeReflection(id: string, data: DocumentData) {
  return {
    id,
    name: String(data.name || ""),
    note: String(data.note || ""),
    audioUrl: String(data.audioUrl || ""),
    mediaType: String(data.mediaType || ""),
    uploadId: String(data.uploadId || ""),
    objectKey: String(data.objectKey || ""),
    sizeBytes: Number(data.sizeBytes || 0),
    timestamp: String(data.timestamp || new Date(0).toISOString()),
  };
}

function sendSaveError(res: express.Response, reason: string, message: string, status = 200) {
  res.status(status).json({
    ok: false,
    reason,
    error: message,
  });
}

function getUploadApiKey() {
  return typeof process.env.VAD_UPLOAD_API_KEY === "string" ? process.env.VAD_UPLOAD_API_KEY.trim() : "";
}

async function callUploadApi(pathname: string, body: unknown) {
  const apiKey = getUploadApiKey();
  if (!apiKey) {
    throw new Error("VAD_UPLOAD_API_KEY is not configured");
  }

  const response = await fetch(`${UPLOAD_API_BASE}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text.slice(0, 240) };
  }

  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `Upload API failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

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

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  app.use(express.json({ limit: "10mb" }));

  // API health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", env: process.env.NODE_ENV });
  });

  app.get("/api/admin/session", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    res.json({ authenticated: isValidSessionToken(cookies[SESSION_COOKIE]) });
  });

  app.post("/api/admin/login", (req, res) => {
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
    res.json({ authenticated: true });
  });

  app.post("/api/admin/logout", (req, res) => {
    clearAdminCookie(res);
    res.json({ authenticated: false });
  });

  app.get("/api/plan", async (req, res) => {
    try {
      const plan = await readPlan();
      res.json({ plan });
    } catch (error) {
      console.error("Failed to read plan", error);
      res.status(500).json({ error: "Failed to read plan" });
    }
  });

  app.put("/api/plan", requireAdmin, async (req, res) => {
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
          schemaVersion: req.body.schemaVersion || "ensemble-field-manual-v5",
        },
        { merge: true },
      );
      const plan = await readPlan();
      res.json({ plan });
    } catch (error) {
      console.error("Failed to save plan", error);
      res.status(500).json({ error: "Failed to save plan" });
    }
  });

  app.post("/api/uploads/init", async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    try {
      const contentType = typeof req.body?.contentType === "string" ? req.body.contentType.trim() : "video/webm";
      const filename = typeof req.body?.filename === "string" ? req.body.filename.trim() : `reflection-${Date.now()}.webm`;
      const externalUserId = typeof req.body?.externalUserId === "string" ? req.body.externalUserId.trim() : "anonymous";
      const sizeBytes = Number(req.body?.sizeBytes || 0);

      if (!isSupportedUploadContentType(contentType)) {
        res.status(400).json({ error: "Only image/* or video/* files can be uploaded" });
        return;
      }
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > Number(MAX_REFLECTION_UPLOAD_BYTES)) {
        res.status(400).json({ error: "文件体积无效或超过上限" });
        return;
      }

      const payload = await callUploadApi("/api/uploads/init", {
        filename,
        contentType,
        sizeBytes,
        externalUserId: externalUserId || "anonymous",
        durationMs: Number.isFinite(Number(req.body?.durationMs)) ? Number(req.body.durationMs) : undefined,
        width: Number.isFinite(Number(req.body?.width)) ? Number(req.body.width) : undefined,
        height: Number.isFinite(Number(req.body?.height)) ? Number(req.body.height) : undefined,
        metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : undefined,
      });

      res.json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法初始化文件上传";
      const statusCode = message.includes("VAD_UPLOAD_API_KEY") ? 503 : 502;
      res.status(statusCode).json({ error: message });
    }
  });

  app.post("/api/uploads/complete", async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    try {
      const uploadId = typeof req.body?.uploadId === "string" ? req.body.uploadId.trim() : "";
      if (!uploadId) {
        res.status(400).json({ error: "Missing uploadId" });
        return;
      }

      const payload = await callUploadApi("/api/uploads/complete", { uploadId });
      res.json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法确认视频上传";
      const statusCode = message.includes("VAD_UPLOAD_API_KEY") ? 503 : 502;
      res.status(statusCode).json({ error: message });
    }
  });

  app.post("/api/uploads/cover", async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");

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
      res.json({ ok: true, ...payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法上传封面图片";
      res.status(502).json({ error: message });
    }
  });

  app.get("/api/reflections", async (req, res) => {
    const db = getAdminDb();
    if (!db) {
      res.json({ reflections: [], warning: "Firebase Admin is not configured" });
      return;
    }

    try {
      const snapshot = await db.collection(REFLECTIONS_COLLECTION).orderBy("timestamp", "desc").limit(120).get();
      res.json({ reflections: snapshot.docs.map((doc) => serializeReflection(doc.id, doc.data())) });
    } catch (error) {
      console.error("Failed to list reflections", error);
      res.json({
        reflections: [],
        warning: error instanceof Error ? error.message : "无法读取课程总结",
      });
    }
  });

  app.post("/api/reflections", async (req, res) => {
    const db = getAdminDb();
    if (!db) {
      sendSaveError(
        res,
        "firebase-not-configured",
        "Firebase Admin is not configured. 请检查 FIREBASE_SERVICE_ACCOUNT_JSON、FIREBASE_PROJECT_ID 和 FIREBASE_DATABASE_ID。",
      );
      return;
    }

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    const audioUrl = typeof req.body?.audioUrl === "string" ? req.body.audioUrl.trim() : "";
    const mediaType = typeof req.body?.mediaType === "string" ? req.body.mediaType.trim() : "application/octet-stream";
    const uploadId = typeof req.body?.uploadId === "string" ? req.body.uploadId.trim() : "";
    const objectKey = typeof req.body?.objectKey === "string" ? req.body.objectKey.trim() : "";
    const sizeBytes = Number(req.body?.sizeBytes || 0);

    if (!name) {
      sendSaveError(res, "validation", "请输入学生姓名");
      return;
    }
    if (!audioUrl || !/^https:\/\/.+/i.test(audioUrl)) {
      sendSaveError(res, "validation", "缺少有效的 audioUrl");
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      const ref = db.collection(REFLECTIONS_COLLECTION).doc();
      const reflection = {
        id: ref.id,
        name,
        note,
        audioUrl,
        mediaType,
        uploadId,
        objectKey,
        sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0,
        timestamp,
        createdAt: FieldValue.serverTimestamp(),
        requestId: crypto.randomUUID(),
      };
      await ref.set(reflection);
      res.status(201).json({ ok: true, reflection: serializeReflection(ref.id, reflection) });
    } catch (error) {
      console.error("Failed to create reflection", error);
      sendSaveError(res, "firestore-write-failed", error instanceof Error ? error.message : "Firestore 写入失败");
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve static files from dist
    // When running as dist/server.cjs, __dirname will be dist/
    // When running as server.ts in production (unlikely but possible), it would be root
    const distPath = path.resolve(__dirname, process.env.NODE_ENV === "production" ? "." : "dist");
    
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
