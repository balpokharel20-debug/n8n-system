import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getLeadSummary } from "@/lib/web-aayo/store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getLeadSummary());
  } catch {
    return NextResponse.json({ error: "Web Aayo storage is unavailable. Check MongoDB configuration and connectivity." }, { status: 503 });
  }
}
