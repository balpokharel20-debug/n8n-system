import { NextRequest, NextResponse } from "next/server";
import {
  clearLoginFailures,
  createSessionToken,
  hasSameOrigin,
  isAuthConfigured,
  reserveLoginAttempt,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  verifyAdminPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return json({ error: "Request origin was rejected." }, 403);
  if (!isAuthConfigured()) return json({ error: "Admin password authentication is not configured." }, 503);

  const body = await request.json().catch(() => null);
  const password = body && typeof body === "object" ? (body as Record<string, unknown>).password : null;
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) {
    return json({ error: "Enter a valid passphrase." }, 400);
  }

  try {
    const remainingLockMs = await reserveLoginAttempt(request);
    if (remainingLockMs > 0) {
      const response = json({ error: "Too many attempts. Try again later." }, 429);
      response.headers.set("Retry-After", String(Math.ceil(remainingLockMs / 1000)));
      return response;
    }

    if (!(await verifyAdminPassword(password))) {
      return json({ error: "The passphrase is incorrect." }, 401);
    }

    await clearLoginFailures(request);
    const response = json({ ok: true });
    response.cookies.set(SESSION_COOKIE, createSessionToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
      priority: "high",
    });
    return response;
  } catch {
    return json({ error: "Authentication storage is unavailable. Check the MongoDB connection." }, 503);
  }
}
