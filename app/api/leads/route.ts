import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { listLeads } from "@/lib/lead-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ leads: await listLeads() });
}
