import { z } from "zod";

const nodeSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({
    label: z.string().min(1).max(120),
    kind: z.enum([
      "trigger.manual",
      "trigger.webhook",
      "trigger.schedule",
      "data.set",
      "logic.condition",
      "action.http",
      "integration.meta-lead",
      "crm.lead",
      "integration.sheets",
      "integration.telegram",
      "integration.followup",
      "output.response",
    ]),
    config: z.record(z.string(), z.unknown()),
  }).loose(),
}).loose();

const edgeSchema = z.object({
  id: z.string().min(1).max(100),
  source: z.string().min(1).max(100),
  target: z.string().min(1).max(100),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  animated: z.boolean().optional(),
}).loose();

export const workflowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens."),
  description: z.string().max(500).default(""),
  status: z.enum(["draft", "active", "paused"]),
  nodes: z.array(nodeSchema).max(50),
  edges: z.array(edgeSchema).max(100),
  schedule: z.enum(["every-5-minutes", "hourly", "daily"]).nullable(),
});
