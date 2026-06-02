const ADMIN_CREDENTIAL_ID = 1;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const textEncoder = new TextEncoder();

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function derivePasswordHash(password, saltBase64, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: base64ToBytes(saltBase64),
      iterations,
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqualBytes(left, right) {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left[index] || 0) ^ (right[index] || 0);
  }
  return diff === 0;
}

function toIsoTimestamp(value) {
  return new Date(value).toISOString();
}

function getClientKey(request) {
  const forwardedFor = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
  const ip = forwardedFor.split(',')[0].trim();
  return ip || 'unknown';
}

function getBearerToken(request) {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export async function verifyAdminPassword(db, request, password) {
  const now = Date.now();
  const clientKey = getClientKey(request);
  const attempt = await db
    .prepare('SELECT failure_count, locked_until FROM admin_login_attempts WHERE id = ? LIMIT 1')
    .bind(clientKey)
    .first();

  if (attempt?.locked_until && Date.parse(attempt.locked_until) > now) {
    return {
      ok: false,
      status: 429,
      error: '登录尝试过多，请稍后再试。',
    };
  }

  const credential = await db
    .prepare('SELECT password_salt, password_hash, iterations FROM admin_credentials WHERE id = ? LIMIT 1')
    .bind(ADMIN_CREDENTIAL_ID)
    .first();

  if (!credential?.password_salt || !credential?.password_hash || !credential?.iterations) {
    return {
      ok: false,
      status: 503,
      error: '管理员密码尚未初始化。',
    };
  }

  const candidateHash = await derivePasswordHash(String(password || ''), credential.password_salt, Number(credential.iterations));
  const storedHash = base64ToBytes(String(credential.password_hash));
  const isValid = timingSafeEqualBytes(candidateHash, storedHash);

  if (!isValid) {
    const nextFailureCount = Number(attempt?.failure_count || 0) + 1;
    const lockedUntil = nextFailureCount >= MAX_FAILED_ATTEMPTS ? toIsoTimestamp(now + LOCKOUT_MS) : '';
    await db
      .prepare(
        `INSERT INTO admin_login_attempts (id, failure_count, locked_until, last_attempt_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           failure_count = excluded.failure_count,
           locked_until = excluded.locked_until,
           last_attempt_at = excluded.last_attempt_at,
           updated_at = excluded.updated_at`,
      )
      .bind(clientKey, nextFailureCount, lockedUntil, toIsoTimestamp(now), toIsoTimestamp(now))
      .run();

    return {
      ok: false,
      status: nextFailureCount >= MAX_FAILED_ATTEMPTS ? 429 : 401,
      error: nextFailureCount >= MAX_FAILED_ATTEMPTS ? '登录尝试过多，请稍后再试。' : '密码不正确。',
    };
  }

  await db.prepare('DELETE FROM admin_login_attempts WHERE id = ?').bind(clientKey).run();
  return { ok: true };
}

export async function createAdminSession(db) {
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = bytesToBase64Url(tokenBytes);
  const tokenHash = await sha256Base64Url(token);
  const now = Date.now();
  const expiresAt = toIsoTimestamp(now + SESSION_TTL_MS);

  await db
    .prepare('INSERT INTO admin_sessions (id, token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), tokenHash, toIsoTimestamp(now), expiresAt, toIsoTimestamp(now))
    .run();

  return { token, expiresAt };
}

export async function requireAdminSession(db, request) {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  const tokenHash = await sha256Base64Url(token);
  const session = await db
    .prepare('SELECT id, expires_at FROM admin_sessions WHERE token_hash = ? LIMIT 1')
    .bind(tokenHash)
    .first();

  if (!session?.id || !session?.expires_at || Date.parse(session.expires_at) <= Date.now()) {
    return null;
  }

  await db.prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), session.id).run();
  return session;
}

export async function revokeAdminSession(db, request) {
  const token = getBearerToken(request);
  if (!token) {
    return;
  }

  const tokenHash = await sha256Base64Url(token);
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).run();
}
