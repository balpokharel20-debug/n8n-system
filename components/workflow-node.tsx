"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Braces,
  Clock3,
  GitBranch,
  MousePointerClick,
  Radio,
  Send,
  Database,
  FileSpreadsheet,
  MessageCircle,
  MessagesSquare,
  UserRoundSearch,
  Webhook,
} from "lucide-react";
import type { WorkflowNode } from "@/lib/types";

const icons = {
  "trigger.manual": MousePointerClick,
  "trigger.webhook": Webhook,
  "trigger.schedule": Clock3,
  "data.set": Braces,
  "logic.condition": GitBranch,
  "action.http": Send,
  "integration.meta-lead": UserRoundSearch,
  "crm.lead": Database,
  "integration.sheets": FileSpreadsheet,
  "integration.telegram": MessagesSquare,
  "integration.followup": MessageCircle,
  "output.response": Radio,
};

const labels = {
  "trigger.manual": "Manual trigger",
  "trigger.webhook": "Webhook",
  "trigger.schedule": "Schedule",
  "data.set": "Transform",
  "logic.condition": "Condition",
  "action.http": "HTTP request",
  "integration.meta-lead": "Meta Lead Ads",
  "crm.lead": "Lead database",
  "integration.sheets": "Google Sheets",
  "integration.telegram": "Telegram",
  "integration.followup": "WhatsApp / SMS",
  "output.response": "Response",
};

export function WorkflowNodeCard({ data, selected }: NodeProps<WorkflowNode>) {
  const Icon = icons[data.kind];
  const isTrigger = data.kind.startsWith("trigger.");
  const isOutput = data.kind === "output.response";
  const isCondition = data.kind === "logic.condition";

  return (
    <div className={`flow-node flow-node--${data.kind.replace(".", "-")} ${selected ? "is-selected" : ""}`}>
      {!isTrigger && <Handle type="target" position={Position.Left} />}
      <div className="flow-node__icon"><Icon size={16} strokeWidth={2.1} /></div>
      <div className="flow-node__copy">
        <span>{labels[data.kind]}</span>
        <strong>{data.label}</strong>
      </div>
      <div className="flow-node__status" />
      {isCondition ? (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ top: "35%" }} />
          <span className="handle-label handle-label--true">YES</span>
          <Handle id="false" type="source" position={Position.Right} style={{ top: "70%" }} />
          <span className="handle-label handle-label--false">NO</span>
        </>
      ) : !isOutput ? (
        <Handle type="source" position={Position.Right} />
      ) : null}
    </div>
  );
}
