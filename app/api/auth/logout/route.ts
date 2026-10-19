import { NextRequest, NextResponse } from "next/server";
import { hasSameOrigin, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin was rejected." }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    priority: "high",
  });
  return response;
}
