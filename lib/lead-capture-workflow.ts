import type { WorkflowInput } from "@/lib/types";

export function leadCaptureWorkflow(): WorkflowInput {
  const suffix = crypto.randomUUID().slice(0, 8);
  const node = (
    id: string,
    x: number,
    y: number,
    label: string,
    kind: WorkflowInput["nodes"][number]["data"]["kind"],
    config: Record<string, unknown>,
  ): WorkflowInput["nodes"][number] => ({
    id,
    type: "workflow",
    position: { x, y },
    data: { label, kind, config },
  });

  return {
    name: "Admissions lead follow-up",
    slug: `admissions-leads-${suffix}`,
    description:
      "Capture Meta leads, save them, alert admissions, send an instant reply, and schedule follow-ups.",
    status: "draft",
    schedule: null,
    nodes: [
      node("lead-webhook", 40, 210, "Meta lead received", "trigger.webhook", {}),
      node("meta-lookup", 310, 210, "Fetch lead details", "integration.meta-lead", {
        courseField: "course",
      }),
      node("lead-save", 580, 210, "Save as New lead", "crm.lead", {}),
      node("sheet-append", 850, 115, "Append to lead sheet", "integration.sheets", {
        tab: "Leads",
      }),
      node("telegram-alert", 1120, 115, "Alert admissions", "integration.telegram", {}),
      node("instant-reply", 850, 315, "Send instant reply", "integration.followup", {
        template: "lead_welcome",
        language: "en_US",
        sms: "Hi {{previous.name}}, thanks for your interest in {{previous.course}}. Our admissions team will call you shortly.",
      }),
      node("accepted", 1390, 210, "Confirm capture", "output.response", {
        body: {
          accepted: true,
          leadId: "{{previous.id}}",
          name: "{{previous.name}}",
          status: "New",
        },
      }),
    ],
    edges: [
      { id: "lead-e1", source: "lead-webhook", target: "meta-lookup", animated: true },
      { id: "lead-e2", source: "meta-lookup", target: "lead-save", animated: true },
      { id: "lead-e3", source: "lead-save", target: "sheet-append", animated: true },
      { id: "lead-e4", source: "sheet-append", target: "telegram-alert", animated: true },
      { id: "lead-e5", source: "lead-save", target: "instant-reply", animated: true },
      { id: "lead-e6", source: "telegram-alert", target: "accepted", animated: true },
      { id: "lead-e7", source: "instant-reply", target: "accepted", animated: true },
    ],
  };
}
