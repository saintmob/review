import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { initializeApp, applicationDefault, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLAN_DOC_PATH = ["showPlans", "ensemble-flow"] as const;
const SESSION_COOKIE = "show_plan_admin";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

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
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");
  const serviceAccount = JSON.parse(decoded);
  if (typeof serviceAccount.private_key === "string") {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  }

  return serviceAccount;
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
      if (!serviceAccount && !projectId) {
        return null;
      }
      initializeApp({
        credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
        projectId,
      });
    }

    return getFirestore();
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

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  app.use(express.json({ limit: "2mb" }));

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
