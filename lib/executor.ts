import { createExecution, finishExecution } from "@/lib/workflow-store";
import { upsertLead } from "@/lib/lead-store";
import {
  appendLeadToSheet,
  leadAlertText,
  normalizeMetaLead,
  sendLeadFollowup,
  sendTelegram,
} from "@/lib/integrations";
import type {
  Execution,
  Lead,
  StepResult,
  Workflow,
  WorkflowEdge,
  WorkflowNode,
} from "@/lib/types";

type RunContext = {
  input: unknown;
  previous: unknown;
  trigger: { type: Execution["triggerType"]; receivedAt: string };
  steps: Record<string, unknown>;
};

function readPath(source: unknown, path: string): unknown {
  if (!path) return source;
  return path.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

function renderString(template: string, context: RunContext): unknown {
  const exact = template.match(/^\s*{{\s*([^}]+)\s*}}\s*$/);
  if (exact) {
    const expression = exact[1].trim();
    if (expression.startsWith("env.")) {
      return process.env[expression.slice(4)] ?? "";
    }
    return readPath(context, expression);
  }

  return template.replace(/{{\s*([^}]+)\s*}}/g, (_, raw: string) => {
    const expression = raw.trim();
    const value = expression.startsWith("env.")
      ? process.env[expression.slice(4)]
      : readPath(context, expression);
    if (value === null || value === undefined) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

function renderValue(value: unknown, context: RunContext): unknown {
  if (typeof value === "string") return renderString(value, context);
  if (Array.isArray(value)) return value.map((item) => renderValue(item, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderValue(item, context)]),
    );
  }
  return value;
}

function assertSafeUrl(raw: string) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("HTTP nodes only support http:// and https:// URLs.");
  }
  const host = url.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isPrivate) throw new Error("Requests to local or private network addresses are blocked.");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compare(left: unknown, operator: unknown, right: unknown) {
  switch (operator) {
    case "eq":
      return String(left) === String(right);
    case "neq":
      return String(left) !== String(right);
    case "contains":
      return String(left ?? "").includes(String(right ?? ""));
    case "exists":
      return left !== undefined && left !== null && left !== "";
    case "gt":
      return Number(left) > Number(right);
    case "gte":
      return Number(left) >= Number(right);
    case "lt":
      return Number(left) < Number(right);
    case "lte":
      return Number(left) <= Number(right);
    default:
      throw new Error(`Unsupported condition operator: ${String(operator)}`);
  }
}

async function runNode(node: WorkflowNode, context: RunContext) {
  const config = node.data.config;

  switch (node.data.kind) {
    case "trigger.manual":
    case "trigger.webhook":
    case "trigger.schedule":
      return context.input;

    case "data.set":
      return renderValue(asRecord(config.fields), context);

    case "logic.condition": {
      const left = readPath(context, String(config.field ?? "previous"));
      const right = renderValue(config.value, context);
      const branch = compare(left, config.operator, right);
      return { value: context.previous, __relayBranch: String(branch) };
    }

    case "action.http": {
      const url = String(renderValue(config.url, context) ?? "");
      assertSafeUrl(url);
      const method = String(config.method ?? "GET").toUpperCase();
      const renderedHeaders = asRecord(renderValue(config.headers ?? {}, context));
      const headers = Object.fromEntries(
        Object.entries(renderedHeaders).map(([key, value]) => [key, String(value)]),
      );
      const body = ["GET", "HEAD"].includes(method)
        ? undefined
        : JSON.stringify(renderValue(config.body ?? context.previous, context));
      if (body && !headers["content-type"] && !headers["Content-Type"]) {
        headers["content-type"] = "application/json";
      }

      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(20_000),
      });
      const contentType = response.headers.get("content-type") ?? "";
      const responseBody = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${JSON.stringify(responseBody).slice(0, 500)}`);
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
      };
    }

    case "integration.meta-lead":
      return normalizeMetaLead(
        context.previous,
        String(config.courseField ?? "course"),
      );

    case "crm.lead": {
      const value = asRecord(context.previous);
      const phone = String(value.phone ?? "").trim();
      if (!phone) throw new Error("The lead cannot be saved without a phone number.");
      return upsertLead({
        externalId: String(value.externalId ?? crypto.randomUUID()),
        name: String(value.name ?? "Unknown lead"),
        phone,
        course: String(value.course ?? "Not specified"),
        source: String(value.source ?? "Workflow"),
      });
    }

    case "integration.sheets": {
      const lead = context.previous as Lead;
      await appendLeadToSheet(lead, String(config.tab ?? "Leads"));
      return { ...lead, sheet: { appended: true } };
    }

    case "integration.telegram": {
      const lead = context.previous as Lead;
      const configured = renderValue(config.message, context);
      const message = configured ? String(configured) : leadAlertText(lead);
      await sendTelegram(message);
      return { ...lead, telegram: { alerted: true } };
    }

    case "integration.followup": {
      const lead = context.previous as Lead;
      const template = String(config.template ?? process.env.WHATSAPP_WELCOME_TEMPLATE ?? "lead_welcome");
      const language = String(config.language ?? "en_US");
      const sms = String(
        renderValue(
          config.sms ?? "Hi {{previous.name}}, thanks for your interest in {{previous.course}}. Our admissions team will contact you shortly.",
          context,
        ),
      );
      const result = await sendLeadFollowup(lead, { template, language, sms });
      return { ...lead, followup: { sent: true, channel: result.channel } };
    }

    case "output.response":
      return renderValue(config.body ?? context.previous, context);
  }
}

function selectStartingNodes(workflow: Workflow, triggerType: Execution["triggerType"]) {
  const expectedKind = `trigger.${triggerType}`;
  const matching = workflow.nodes.filter((node) => node.data.kind === expectedKind);
  if (matching.length) return matching;

  const targets = new Set(workflow.edges.map((edge) => edge.target));
  return workflow.nodes.filter((node) => !targets.has(node.id));
}

function nextEdges(node: WorkflowNode, edges: WorkflowEdge[], output: unknown) {
  const outgoing = edges.filter((edge) => edge.source === node.id);
  if (node.data.kind !== "logic.condition") return outgoing;
  const branch = asRecord(output).__relayBranch;
  return outgoing.filter((edge) => !edge.sourceHandle || edge.sourceHandle === branch);
}

export async function executeWorkflow(
  workflow: Workflow,
  triggerType: Execution["triggerType"],
  input: unknown,
): Promise<Execution> {
  if (workflow.nodes.length === 0) throw new Error("This workflow has no nodes.");
  if (workflow.nodes.length > 50) throw new Error("A workflow can contain at most 50 nodes.");

  const execution = await createExecution(workflow, triggerType, input);
  const steps: StepResult[] = [];
  const outputs: Record<string, unknown> = {};
  const context: RunContext = {
    input,
    previous: input,
    trigger: { type: triggerType, receivedAt: new Date().toISOString() },
    steps: outputs,
  };
  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const queue = [...selectStartingNodes(workflow, triggerType)];
  const visited = new Set<string>();
  let finalOutput: unknown = input;

  try {
    while (queue.length) {
      const node = queue.shift()!;
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      const startedAt = new Date().toISOString();

      try {
        const rawOutput = await runNode(node, context);
        const output =
          node.data.kind === "logic.condition"
            ? asRecord(rawOutput).value
            : rawOutput;
        outputs[node.id] = output;
        context.previous = output;
        finalOutput = output;
        steps.push({
          nodeId: node.id,
          label: node.data.label,
          kind: node.data.kind,
          status: "success",
          startedAt,
          finishedAt: new Date().toISOString(),
          output,
        });

        for (const edge of nextEdges(node, workflow.edges, rawOutput)) {
          const target = nodeById.get(edge.target);
          if (target) queue.push(target);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown step error";
        steps.push({
          nodeId: node.id,
          label: node.data.label,
          kind: node.data.kind,
          status: "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          error: message,
        });
        throw error;
      }
    }

    await finishExecution(execution.id, "success", finalOutput, steps, null);
    return {
      ...execution,
      status: "success",
      output: finalOutput,
      steps,
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow execution failed";
    await finishExecution(execution.id, "failed", null, steps, message);
    return {
      ...execution,
      status: "failed",
      output: null,
      steps,
      error: message,
      finishedAt: new Date().toISOString(),
    };
  }
}
