import { NextRequest, NextResponse } from "next/server";
import { isAdmin, isAuthConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return NextResponse.json(
    { authenticated: isAdmin(request), configured: isAuthConfigured() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
