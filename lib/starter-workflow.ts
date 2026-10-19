import type { WorkflowInput } from "@/lib/types";

export function starterWorkflow(): WorkflowInput {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    name: "New lead intake",
    slug: `lead-intake-${suffix}`,
    description: "Validate an incoming lead and forward qualified submissions.",
    status: "draft",
    schedule: null,
    nodes: [
      {
        id: "trigger-1",
        type: "workflow",
        position: { x: 40, y: 180 },
        data: {
          label: "Webhook received",
          kind: "trigger.webhook",
          config: {},
        },
      },
      {
        id: "set-1",
        type: "workflow",
        position: { x: 330, y: 180 },
        data: {
          label: "Shape lead data",
          kind: "data.set",
          config: {
            fields: {
              name: "{{input.name}}",
              email: "{{input.email}}",
              score: "{{input.score}}",
            },
          },
        },
      },
      {
        id: "if-1",
        type: "workflow",
        position: { x: 620, y: 180 },
        data: {
          label: "Qualified?",
          kind: "logic.condition",
          config: { field: "previous.score", operator: "gte", value: "70" },
        },
      },
      {
        id: "response-1",
        type: "workflow",
        position: { x: 920, y: 95 },
        data: {
          label: "Accept lead",
          kind: "output.response",
          config: {
            body: { accepted: true, message: "Thanks {{previous.name}} — we will be in touch." },
          },
        },
      },
      {
        id: "response-2",
        type: "workflow",
        position: { x: 920, y: 285 },
        data: {
          label: "Keep nurturing",
          kind: "output.response",
          config: { body: { accepted: false, message: "Lead saved for nurturing." } },
        },
      },
    ],
    edges: [
      { id: "e1", source: "trigger-1", target: "set-1", animated: true },
      { id: "e2", source: "set-1", target: "if-1", animated: true },
      {
        id: "e3",
        source: "if-1",
        sourceHandle: "true",
        target: "response-1",
        animated: true,
      },
      {
        id: "e4",
        source: "if-1",
        sourceHandle: "false",
        target: "response-2",
        animated: true,
      },
    ],
  };
}
