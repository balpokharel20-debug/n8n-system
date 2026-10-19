import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getWorkflow, removeWorkflow, saveWorkflow } from "@/lib/workflow-store";
import { workflowSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const workflow = await getWorkflow(id);
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  return NextResponse.json({ workflow });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!(await getWorkflow(id))) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const parsed = workflowSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid workflow payload." }, { status: 400 });
  }
  try {
    const workflow = await saveWorkflow(parsed.data, id);
    return NextResponse.json({ workflow });
  } catch (error) {
    if (/unique|duplicate/i.test(error instanceof Error ? error.message : "")) {
      return NextResponse.json({ error: "That webhook slug is already in use." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not update the workflow." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const removed = await removeWorkflow(id);
  return removed
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Workflow not found" }, { status: 404 });
}
