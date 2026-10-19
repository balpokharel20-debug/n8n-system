import type { Edge, Node } from "@xyflow/react";

export type NodeKind =
  | "trigger.manual"
  | "trigger.webhook"
  | "trigger.schedule"
  | "data.set"
  | "logic.condition"
  | "action.http"
  | "integration.meta-lead"
  | "crm.lead"
  | "integration.sheets"
  | "integration.telegram"
  | "integration.followup"
  | "output.response";

export type NodeConfig = Record<string, unknown>;

export type WorkflowNodeData = {
  label: string;
  kind: NodeKind;
  config: NodeConfig;
  [key: string]: unknown;
};

export type WorkflowNode = Node<WorkflowNodeData>;
export type WorkflowEdge = Edge;

export type WorkflowStatus = "draft" | "active" | "paused";

export type Workflow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: WorkflowStatus;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  schedule: "every-5-minutes" | "hourly" | "daily" | null;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionStatus = "running" | "success" | "failed";

export type StepResult = {
  nodeId: string;
  label: string;
  kind: NodeKind;
  status: "success" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string;
  output?: unknown;
  error?: string;
};

export type Execution = {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: ExecutionStatus;
  triggerType: "manual" | "webhook" | "schedule";
  input: unknown;
  output: unknown;
  steps: StepResult[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type WorkflowInput = Pick<
  Workflow,
  "name" | "slug" | "description" | "status" | "nodes" | "edges" | "schedule"
>;

export type LeadStatus = "New" | "Called" | "Qualified" | "Enrolled" | "Closed";

export type Lead = {
  id: string;
  externalId: string;
  name: string;
  phone: string;
  course: string;
  source: string;
  status: LeadStatus;
  reminderStage: 0 | 1 | 2;
  createdAt: string;
  updatedAt: string;
};
