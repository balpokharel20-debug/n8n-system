import {
  getSystemState,
  listDueLeadReminders,
  listLeads,
  markReminderSent,
  setSystemState,
} from "@/lib/lead-store";
import { sendLeadFollowup, sendTelegram } from "@/lib/integrations";

function localParts(now: Date) {
  const timezone = process.env.BUSINESS_TIMEZONE ?? "Asia/Kathmandu";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export async function processLeadAutomations(now = new Date()) {
  const results: Array<Record<string, unknown>> = [];
  const due = await listDueLeadReminders(now);

  for (const lead of due) {
    const stage = lead.reminderStage === 0 ? 1 : 2;
    const template =
      stage === 1
        ? process.env.WHATSAPP_REMINDER_TEMPLATE_DAY_1 ?? "lead_followup_day_1"
        : process.env.WHATSAPP_REMINDER_TEMPLATE_DAY_3 ?? "lead_followup_day_3";
    const sms =
      stage === 1
        ? `Hi ${lead.name}, just checking whether you need help with ${lead.course}. Reply here or call our admissions team.`
        : `Hi ${lead.name}, we are still happy to help with ${lead.course}. Let us know if you would like a quick call.`;
    try {
      const sent = await sendLeadFollowup(lead, { template, sms });
      await markReminderSent(lead.id, stage);
      results.push({ leadId: lead.id, reminder: `day-${stage === 1 ? 1 : 3}`, status: "sent", channel: sent.channel });
    } catch (error) {
      results.push({
        leadId: lead.id,
        reminder: `day-${stage === 1 ? 1 : 3}`,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown reminder error",
      });
    }
  }

  const parts = localParts(now);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const digestHour = String(process.env.DAILY_DIGEST_HOUR ?? "9").padStart(2, "0");
  const shouldSendDigest = parts.hour === digestHour && Number(parts.minute) < 5;
  const digestKey = "uncalled-digest-date";
  if (shouldSendDigest && (await getSystemState(digestKey)) !== localDate) {
    const uncalled = (await listLeads(200)).filter((lead) => lead.status === "New");
    const lines = uncalled.slice(0, 30).map(
      (lead, index) => `${index + 1}. ${lead.name} · ${lead.phone} · ${lead.course}`,
    );
    const text = [
      `📞 <b>Uncalled leads · ${localDate}</b>`,
      uncalled.length ? `${uncalled.length} lead(s) still marked New:` : "No leads are waiting for a call.",
      ...lines,
      uncalled.length > 30 ? `…and ${uncalled.length - 30} more in Relay.` : "",
    ].filter(Boolean).join("\n");
    try {
      await sendTelegram(text);
      await setSystemState(digestKey, localDate);
      results.push({ digest: localDate, status: "sent", leads: uncalled.length });
    } catch (error) {
      results.push({
        digest: localDate,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown digest error",
      });
    }
  }

  return results;
}
