import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { ensureSchema, getDatabase, hasDatabase } from "@/lib/db";
import { usesLocalPersistence } from "@/lib/local-store";

export const SESSION_COOKIE = process.env.NODE_ENV === "production"
  ? "__Host-relay_session"
  : "relay_session";
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

type PasswordHash = { salt: Buffer; digest: Buffer };
type LocalAttempt = { windowStartedAt: number; failures: number; lockedUntil: number | null };
type AuthAttemptDocument = {
  _id: string;
  windowStartedAt?: Date;
  failures?: number;
  lockedUntil?: Date;
  expiresAt?: Date;
};
type AuthGlobal = typeof globalThis & { __relayLoginAttempts?: Map<string, LocalAttempt> };
const authGlobal = globalThis as AuthGlobal;
const localAttempts = authGlobal.__relayLoginAttempts ?? (authGlobal.__relayLoginAttempts = new Map());

function parsePasswordHash(): PasswordHash | null {
  const value = process.env.RELAY_ADMIN_PASSWORD_HASH;
  if (!value) return null;
  const [algorithm, saltText, digestText, extra] = value.split("$");
  if (algorithm !== "scrypt" || !saltText || !digestText || extra !== undefined) return null;
  const salt = Buffer.from(saltText, "base64url");
  const digest = Buffer.from(digestText, "base64url");
  if (salt.length !== 16 || digest.length !== SCRYPT_KEY_LENGTH) return null;
  return { salt, digest };
}

function sessionSecret() {
  const secret = process.env.RELAY_SESSION_SECRET;
  if (!secret) return null;
  const decoded = Buffer.from(secret, "base64url");
  return decoded.length >= 32 ? decoded : null;
}

function sessionSigningKey() {
  const secret = sessionSecret();
  const passwordHash = process.env.RELAY_ADMIN_PASSWORD_HASH;
  if (!secret || !parsePasswordHash() || !passwordHash) return null;
  return createHmac("sha256", secret).update(passwordHash).digest();
}

export function isAuthConfigured() {
  return Boolean(sessionSigningKey());
}

function scrypt(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 },
      (error, derived) => (error ? reject(error) : resolve(derived as Buffer)),
    );
  });
}

export async function verifyAdminPassword(password: string) {
  const stored = parsePasswordHash();
  if (!stored) return false;
  const derived = await scrypt(password, stored.salt);
  return timingSafeEqual(derived, stored.digest);
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createSessionToken() {
  const key = sessionSigningKey();
  if (!key) throw new Error("Admin password authentication is not configured.");
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = encode({
    sub: "admin",
    iat: issuedAt,
    exp: issuedAt + SESSION_MAX_AGE_SECONDS,
    nonce: randomBytes(16).toString("base64url"),
  });
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function isValidSession(token: string | undefined) {
  const key = sessionSigningKey();
  if (!key || !token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return false;

  const expected = createHmac("sha256", key).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: string;
      iat?: number;
      exp?: number;
      nonce?: string;
    };
    const now = Math.floor(Date.now() / 1000);
    return Boolean(
      claims.sub === "admin" &&
      typeof claims.iat === "number" &&
      typeof claims.exp === "number" &&
      claims.iat <= now + 60 &&
      claims.exp > now &&
      claims.exp - claims.iat <= SESSION_MAX_AGE_SECONDS &&
      typeof claims.nonce === "string",
    );
  } catch {
    return false;
  }
}

export function hasSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export function isAdmin(request: NextRequest) {
  if (!isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return false;
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true;
  return hasSameOrigin(request);
}

function safeStringEqual(actual: string | null, expected: string | undefined) {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isValidWebhook(request: NextRequest) {
  return safeStringEqual(request.headers.get("x-relay-secret"), process.env.RELAY_WEBHOOK_SECRET);
}

export function isMetaVerifyToken(value: string | null) {
  return safeStringEqual(value, process.env.META_VERIFY_TOKEN);
}

export function isValidMetaSignature(rawBody: string, signature: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return safeStringEqual(signature, expected);
}

export function isValidCron(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  return safeStringEqual(supplied, process.env.CRON_SECRET);
}

function clientAddress(request: NextRequest) {
  return request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
}

function loginKey(request: NextRequest) {
  const secret = sessionSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(clientAddress(request)).digest("hex");
}

export async function reserveLoginAttempt(request: NextRequest, now = Date.now()) {
  const key = loginKey(request);
  if (!key) throw new Error("Admin password authentication is not configured.");

  if (hasDatabase) {
    await ensureSchema();
    const db = await getDatabase();
    const collection = db.collection<AuthAttemptDocument>("auth_attempts");
    const attempt = await collection.findOne({ _id: key });
    const lockedUntil = attempt?.lockedUntil instanceof Date
      ? attempt.lockedUntil.getTime()
      : typeof attempt?.lockedUntil === "number"
        ? attempt.lockedUntil
        : 0;
    if (lockedUntil > now) return lockedUntil - now;

    const current = new Date(now);
    const cutoff = new Date(now - LOGIN_WINDOW_MS);
    const nextLock = new Date(now + LOGIN_LOCK_MS);
    await collection.updateOne(
      { _id: key },
      [
        {
          $set: {
            windowStartedAt: {
              $cond: [
                { $lte: [{ $ifNull: ["$windowStartedAt", new Date(0)] }, cutoff] },
                current,
                "$windowStartedAt",
              ],
            },
            failures: {
              $cond: [
                { $lte: [{ $ifNull: ["$windowStartedAt", new Date(0)] }, cutoff] },
                1,
                { $add: [{ $ifNull: ["$failures", 0] }, 1] },
              ],
            },
          },
        },
        {
          $set: {
            lockedUntil: {
              $cond: [{ $gte: ["$failures", LOGIN_MAX_FAILURES] }, nextLock, "$lockedUntil"],
            },
            expiresAt: new Date(now + 24 * 60 * 60 * 1000),
          },
        },
      ],
      { upsert: true },
    );
    const reserved = await collection.findOne({ _id: key });
    const count = Number(reserved?.failures ?? LOGIN_MAX_FAILURES + 1);
    const lockTime = reserved?.lockedUntil instanceof Date ? reserved.lockedUntil.getTime() : now + LOGIN_LOCK_MS;
    return count > LOGIN_MAX_FAILURES ? Math.max(1, lockTime - now) : 0;
  }

  if (!usesLocalPersistence()) throw new Error("MongoDB is required for secure login rate limiting.");
  const attempt = localAttempts.get(key);
  const expired = !attempt || now - attempt.windowStartedAt >= LOGIN_WINDOW_MS;
  if (!expired && attempt.lockedUntil && attempt.lockedUntil > now) return attempt.lockedUntil - now;
  const next: LocalAttempt = expired
    ? { windowStartedAt: now, failures: 1, lockedUntil: null }
    : { ...attempt, failures: attempt.failures + 1 };
  if (next.failures >= LOGIN_MAX_FAILURES) next.lockedUntil = now + LOGIN_LOCK_MS;
  localAttempts.set(key, next);
  return next.failures > LOGIN_MAX_FAILURES ? Math.max(1, (next.lockedUntil ?? now + LOGIN_LOCK_MS) - now) : 0;
}

export async function clearLoginFailures(request: NextRequest) {
  const key = loginKey(request);
  if (!key) return;
  if (hasDatabase) {
    const db = await getDatabase();
    await db.collection<AuthAttemptDocument>("auth_attempts").deleteOne({ _id: key });
  } else {
    localAttempts.delete(key);
  }
}
