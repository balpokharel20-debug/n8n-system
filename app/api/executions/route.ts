import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { listExecutions } from "@/lib/workflow-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ executions: await listExecutions() });
}
