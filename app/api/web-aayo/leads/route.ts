import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { leadStatuses } from "@/lib/web-aayo/domain";
import { listGrowthLeads } from "@/lib/web-aayo/store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const status = params.get("status") ?? "";
  if (status && !leadStatuses.includes(status as (typeof leadStatuses)[number])) {
    return NextResponse.json({ error: "Invalid lead status." }, { status: 400 });
  }
  const page = Number(params.get("page") ?? 1);
  const limit = Number(params.get("limit") ?? 25);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ error: "Invalid pagination parameters." }, { status: 400 });
  }
  try {
    const result = await listGrowthLeads({ page, limit, status, query: params.get("q") ?? "" });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Web Aayo storage is unavailable. Check MongoDB configuration and connectivity." }, { status: 503 });
  }
}
