import crypto from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, applicationDefault, cert, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export const PLAN_DOC_PATH = ["showPlans", "ensemble-flow"] as const;
export const STORAGE_KEY = "ensemble-field-manual-v5";

const SESSION_COOKIE = "show_plan_admin";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export function normalizeAdminPassword(value: unknown) {
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
  if (!raw) {
    console.warn("⚠️ [FIREBASE DEBUG] FIREBASE_SERVICE_ACCOUNT_JSON 未配置");
    return null;
  }

  try {
    const decoded = raw.trim().startsWith("{")
      ? raw.trim()
      : Buffer.from(raw.trim(), "base64").toString("utf8").trim();
    const serviceAccount = JSON.parse(extractJsonObject(decoded));
    console.log("✅ [FIREBASE DEBUG] 成功解析 FIREBASE_SERVICE_ACCOUNT_JSON");
    console.log("   项目ID:", serviceAccount?.project_id);
    if (typeof serviceAccount.private_key === "string") {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
    return serviceAccount;
  } catch (error) {
    console.error("❌ [FIREBASE DEBUG] FIREBASE_SERVICE_ACCOUNT_JSON 解析失败:", error);
    return null;
  }
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
        if (depth === 0) {
          console.warn("⚠️ [FIREBASE DEBUG] FIREBASE_SERVICE_ACCOUNT_JSON 包含多余字符，已尝试提取第一个 JSON 对象");
          return value.slice(start, index + 1);
        }
      }
    }
    return value;
  }
}

export function getAdminDb(): Firestore | null {
  try {
    if (!getApps().length) {
      console.log("🔍 [FIREBASE DEBUG] 初始化 Firebase Admin...");
      const serviceAccount = parseServiceAccount();
      
      const projectId =
        process.env.FIREBASE_PROJECT_ID ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        serviceAccount?.project_id;
      
      console.log("   FIREBASE_PROJECT_ID:", process.env.FIREBASE_PROJECT_ID);
      console.log("   GOOGLE_CLOUD_PROJECT:", process.env.GOOGLE_CLOUD_PROJECT);
      console.log("   GCLOUD_PROJECT:", process.env.GCLOUD_PROJECT);
      console.log("   GCP_PROJECT:", process.env.GCP_PROJECT);
      console.log("   从 service account 获取的项目ID:", serviceAccount?.project_id);
      console.log("   最终使用的项目ID:", projectId);
      console.log("   serviceAccount 存在?", Boolean(serviceAccount));
      
      if (!serviceAccount && !projectId) {
        console.error("❌ [FIREBASE DEBUG] 无可用的 serviceAccount 且无 projectId");
        return null;
      }

      initializeApp({
        credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
        projectId,
      });
      console.log("✅ [FIREBASE DEBUG] Firebase Admin 初始化成功");
    } else {
      console.log("✅ [FIREBASE DEBUG] Firebase Admin 已初始化，复用现有实例");
    }

    return getFirestore();
  } catch (error) {
    console.error("❌ [FIREBASE DEBUG] Firebase Admin 初始化失败:", error);
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
