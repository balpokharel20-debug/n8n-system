import { NextRequest, NextResponse } from "next/server";
import { isValidCron } from "@/lib/auth";
import { executeWorkflow } from "@/lib/executor";
import { listScheduledWorkflows } from "@/lib/workflow-store";
import { processLeadAutomations } from "@/lib/lead-automation";

export const runtime = "nodejs";
export const maxDuration = 60;

function isDue(schedule: string | null, now: Date) {
  if (schedule === "every-5-minutes") return true;
  if (schedule === "hourly") return now.getUTCMinutes() < 5;
  if (schedule === "daily") return now.getUTCHours() === 0 && now.getUTCMinutes() < 5;
  return false;
}

export async function GET(request: NextRequest) {
  if (!isValidCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const leadResults = await processLeadAutomations(now);
  const due = (await listScheduledWorkflows()).filter((workflow) => isDue(workflow.schedule, now));
  const results = [];

  for (const workflow of due.slice(0, 10)) {
    const execution = await executeWorkflow(workflow, "schedule", {
      scheduledAt: now.toISOString(),
    });
    results.push({ workflowId: workflow.id, executionId: execution.id, status: execution.status });
  }

  return NextResponse.json({ ok: true, checkedAt: now.toISOString(), leadResults, results });
}
