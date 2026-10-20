import { describe, expect, it } from "vitest";
import { getWorkflowActivationIssues } from "@/lib/workflow-readiness";
import type { WorkflowInput } from "@/lib/types";

const workflow: Pick<WorkflowInput, "nodes" | "schedule"> = {
  schedule: null,
  nodes: [
    {
      id: "webhook",
      type: "workflow",
      position: { x: 0, y: 0 },
      data: { label: "Webhook", kind: "trigger.webhook", config: {} },
    },
    {
      id: "meta",
      type: "workflow",
      position: { x: 1, y: 1 },
      data: { label: "Meta", kind: "integration.meta-lead", config: {} },
    },
    {
      id: "save",
      type: "workflow",
      position: { x: 2, y: 2 },
      data: { label: "Save", kind: "crm.lead", config: {} },
    },
    {
      id: "followup",
      type: "workflow",
      position: { x: 3, y: 3 },
      data: { label: "Follow up", kind: "integration.followup", config: {} },
    },
  ],
};

describe("workflow activation readiness", () => {
  it("lists missing setup by variable name without needing any secret values", () => {
    const issues = getWorkflowActivationIssues(workflow, {});
    expect(issues.join(" ")).toContain("META_APP_SECRET");
    expect(issues.join(" ")).toContain("MONGODB_URI");
    expect(issues.join(" ")).toContain("CRON_SECRET");
    expect(issues.join(" ")).toContain("WhatsApp");
  });

  it("accepts a fully configured Meta lead capture workflow", () => {
    const issues = getWorkflowActivationIssues(workflow, {
      META_APP_SECRET: "configured",
      META_VERIFY_TOKEN: "configured",
      META_PAGE_ACCESS_TOKEN: "configured",
      META_GRAPH_API_VERSION: "v1.0",
      MONGODB_URI: "configured",
      CRON_SECRET: "configured",
      WHATSAPP_PHONE_NUMBER_ID: "configured",
      WHATSAPP_ACCESS_TOKEN: "configured",
    });
    expect(issues).toEqual([]);
  });

  it("requires Vercel schedules to match the checked-in daily cron", () => {
    const scheduled = { ...workflow, schedule: "hourly" as const };
    const issues = getWorkflowActivationIssues(scheduled, {
      VERCEL: "1",
      META_APP_SECRET: "configured",
      META_VERIFY_TOKEN: "configured",
      META_PAGE_ACCESS_TOKEN: "configured",
      META_GRAPH_API_VERSION: "v1.0",
      MONGODB_URI: "configured",
      CRON_SECRET: "configured",
      WHATSAPP_PHONE_NUMBER_ID: "configured",
      WHATSAPP_ACCESS_TOKEN: "configured",
    });
    expect(issues.join(" ")).toContain("once daily");
  });
});
