import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { executeWorkflow } from "@/lib/executor";
import { getWorkflow } from "@/lib/workflow-store";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const workflow = await getWorkflow(id);
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

  let input: unknown = {};
  try {
    const body = await request.json();
    input = body.input ?? body;
  } catch {
    // Empty manual runs receive an empty object.
  }
  const execution = await executeWorkflow(workflow, "manual", input);
  return NextResponse.json({ execution }, { status: execution.status === "success" ? 200 : 422 });
}
