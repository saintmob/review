import crypto from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, applicationDefault, cert, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export const PLAN_DOC_PATH = ["showPlans", "ensemble-flow"] as const;
export const STORAGE_KEY = "ensemble-field-manual-v5";

const SESSION_COOKIE = "show_plan_admin";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

function getSessionSecret() {
  return process.env.SESSION_SECRET || "local-dev-session-secret";
}

function signSession(value: string) {
  return crypto.createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

export function createSessionToken() {
  const payload = JSON.stringify({
    role: "admin",
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  });
  const value = Buffer.from(payload).toString("base64url");
  return `${value}.${signSession(value)}`;
}

export function isValidSessionToken(token: string | undefined) {
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

export function isAdminRequest(req: VercelRequest) {
  return isValidSessionToken(req.cookies?.[SESSION_COOKIE]);
}

export function setAdminCookie(res: VercelResponse, token: string) {
  const secure =
    process.env.FORCE_SECURE_COOKIE === "true" ||
    Boolean(process.env.VERCEL) ||
    process.env.APP_URL?.startsWith("https://");
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearAdminCookie(res: VercelResponse) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
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

export function getAdminDb(): Firestore | null {
  try {
    if (!getApps().length) {
      const serviceAccount = parseServiceAccount();
      const projectId =
        process.env.FIREBASE_PROJECT_ID ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        serviceAccount?.project_id;
      if (!serviceAccount && !projectId) return null;

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

export async function readPlan() {
  const db = getAdminDb();
  if (!db) return null;
  const snapshot = await db.collection(PLAN_DOC_PATH[0]).doc(PLAN_DOC_PATH[1]).get();
  return snapshot.exists ? snapshot.data() : null;
}

export function methodNotAllowed(res: VercelResponse, methods: string[]) {
  res.setHeader("Allow", methods.join(", "));
  res.status(405).json({ error: "Method not allowed" });
}
