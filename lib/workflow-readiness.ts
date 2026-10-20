import type { WorkflowInput } from "@/lib/types";

type Environment = Record<string, string | undefined>;

function configured(environment: Environment, names: string[]) {
  return names.every((name) => Boolean(environment[name]?.trim()));
}

function missingNames(environment: Environment, names: string[]) {
  return names.filter((name) => !environment[name]?.trim());
}

/** Return safe, human-readable blockers without ever returning configured secret values. */
export function getWorkflowActivationIssues(
  workflow: Pick<WorkflowInput, "nodes" | "schedule">,
  environment: Environment = process.env,
) {
  const issues = new Set<string>();
  const kinds = new Set(workflow.nodes.map((node) => node.data.kind));

  const requiredEnvReferences = new Set<string>();
  const inspectValue = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/{{\s*env\.([A-Z][A-Z0-9_]*)\s*}}/g)) {
        requiredEnvReferences.add(match[1]);
      }
    } else if (Array.isArray(value)) {
      value.forEach(inspectValue);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(inspectValue);
    }
  };
  workflow.nodes.forEach((node) => inspectValue(node.data.config));

  for (const name of requiredEnvReferences) {
    if (!configured(environment, [name])) {
      issues.add(`Configure ${name}, referenced by a workflow step.`);
    }
  }

  if (!workflow.nodes.length) issues.add("Add at least one workflow step before activation.");

  if (kinds.has("trigger.webhook")) {
    if (kinds.has("integration.meta-lead")) {
      for (const name of missingNames(environment, ["META_APP_SECRET", "META_VERIFY_TOKEN"])) {
        issues.add(`Configure ${name} for the Meta webhook.`);
      }
    } else if (!configured(environment, ["RELAY_WEBHOOK_SECRET"])) {
      issues.add("Configure RELAY_WEBHOOK_SECRET for the incoming webhook.");
    }
  }

  if (kinds.has("integration.meta-lead")) {
    for (const name of missingNames(environment, ["META_PAGE_ACCESS_TOKEN", "META_GRAPH_API_VERSION"])) {
      issues.add(`Configure ${name} for Meta Lead Ads lookup.`);
    }
  }

  if (kinds.has("crm.lead")) {
    for (const name of missingNames(environment, ["MONGODB_URI"])) {
      issues.add(`Configure ${name} so leads and workflow data persist.`);
    }
    for (const name of missingNames(environment, ["CRON_SECRET"])) {
      issues.add(`Configure ${name} for lead reminders and the daily call-list job.`);
    }
  }

  if (kinds.has("integration.sheets")) {
    for (const name of missingNames(environment, [
      "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      "GOOGLE_PRIVATE_KEY",
      "GOOGLE_SHEET_ID",
    ])) {
      issues.add(`Configure ${name} for Google Sheets.`);
    }
  }

  if (kinds.has("integration.telegram")) {
    for (const name of missingNames(environment, ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"])) {
      issues.add(`Configure ${name} for Telegram alerts.`);
    }
  }

  if (kinds.has("integration.followup")) {
    const whatsapp = ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "META_GRAPH_API_VERSION"];
    const sms = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"];
    if (!configured(environment, whatsapp) && !configured(environment, sms)) {
      issues.add(
        `Configure a complete follow-up channel: WhatsApp (${whatsapp.join(", ")}) or SMS (${sms.join(", ")}).`,
      );
    }
  }

  if (kinds.has("trigger.schedule") && !workflow.schedule) {
    issues.add("Choose a schedule frequency for the scheduled trigger.");
  }

  if (
    environment.VERCEL === "1" &&
    workflow.schedule &&
    workflow.schedule !== "daily"
  ) {
    issues.add(
      "The deployed Vercel Cron is configured for once daily. Update the Vercel plan and vercel.json before activating a faster schedule.",
    );
  }

  return [...issues];
}
