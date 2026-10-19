import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { listWorkflows, saveWorkflow } from "@/lib/workflow-store";
import { workflowSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ workflows: await listWorkflows() });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = workflowSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid workflow payload." }, { status: 400 });
  }
  try {
    const input = parsed.data;
    const workflow = await saveWorkflow(input);
    return NextResponse.json({ workflow }, { status: 201 });
  } catch (error) {
    if (/unique|duplicate/i.test(error instanceof Error ? error.message : "")) {
      return NextResponse.json({ error: "That webhook slug is already in use." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not save the workflow." }, { status: 500 });
  }
}
