import type { Lead } from "@/lib/types";

export type NormalizedLead = Pick<
  Lead,
  "externalId" | "name" | "phone" | "course" | "source"
>;

type MetaField = { name?: string; values?: unknown[] };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nested(source: unknown, path: Array<string | number>) {
  return path.reduce<unknown>((value, key) => {
    if (Array.isArray(value) && typeof key === "number") return value[key];
    if (value && typeof value === "object") return (value as Record<string, unknown>)[String(key)];
    return undefined;
  }, source);
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function cleanPhone(value: unknown) {
  return String(value ?? "").trim().replace(/[^+\d]/g, "");
}

function firstField(fields: MetaField[], names: string[]) {
  for (const name of names) {
    const field = fields.find((item) => item.name?.toLowerCase() === name.toLowerCase());
    const value = field?.values?.[0];
    if (value !== undefined && value !== null) return String(value);
  }
  return "";
}

export async function normalizeMetaLead(
  input: unknown,
  courseField = "course",
): Promise<NormalizedLead> {
  const direct = record(input);
  const directPhone = cleanPhone(direct.phone ?? direct.phone_number);
  if (directPhone) {
    return {
      externalId: String(direct.externalId ?? direct.external_id ?? direct.id ?? crypto.randomUUID()),
      name: String(direct.name ?? direct.full_name ?? "Unknown lead"),
      phone: directPhone,
      course: String(direct.course ?? direct.program ?? "Not specified"),
      source: String(direct.source ?? "Direct webhook"),
    };
  }

  const leadId =
    direct.leadgen_id ??
    nested(input, ["entry", 0, "changes", 0, "value", "leadgen_id"]);
  if (!leadId) {
    throw new Error("No leadgen_id or direct phone field was found in the webhook payload.");
  }

  const token = required("META_PAGE_ACCESS_TOKEN");
  const version = required("META_GRAPH_API_VERSION");
  const response = await fetch(
    `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(String(leadId))}?fields=id,created_time,ad_id,form_id,field_data`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Meta lead lookup failed (${response.status}): ${JSON.stringify(body).slice(0, 400)}`);
  }
  const fields = Array.isArray(body.field_data) ? (body.field_data as MetaField[]) : [];
  const phone = cleanPhone(firstField(fields, ["phone_number", "phone", "mobile_number"]));
  if (!phone) throw new Error("The Meta lead does not contain a phone number.");

  return {
    externalId: String(body.id ?? leadId),
    name: firstField(fields, ["full_name", "name", "first_name"]) || "Unknown lead",
    phone,
    course: firstField(fields, [courseField, "course", "program", "interested_course"]) || "Not specified",
    source: `Meta Instant Form${body.form_id ? ` · form ${String(body.form_id)}` : ""}`,
  };
}

function base64Url(value: string | Uint8Array) {
  const buffer = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
  return buffer.toString("base64url");
}

const tokenGlobal = globalThis as typeof globalThis & {
  __relayGoogleToken?: { value: string; expiresAt: number };
};

async function googleAccessToken() {
  const cached = tokenGlobal.__relayGoogleToken;
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

  const email = required("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = required("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const der = Buffer.from(
    privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ""),
    "base64",
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok || !body.access_token) {
    throw new Error(`Google authentication failed: ${JSON.stringify(body).slice(0, 400)}`);
  }
  const value = String(body.access_token);
  tokenGlobal.__relayGoogleToken = { value, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
  return value;
}

export async function appendLeadToSheet(lead: Lead, tab = "Leads") {
  const sheetId = required("GOOGLE_SHEET_ID");
  const accessToken = await googleAccessToken();
  const range = encodeURIComponent(`${tab}!A:H`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        values: [[
          lead.createdAt,
          lead.name,
          lead.phone,
          lead.course,
          lead.source,
          lead.status,
          lead.externalId,
          lead.id,
        ]],
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Google Sheets append failed (${response.status}): ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body;
}

export async function sendTelegram(text: string) {
  const botToken = required("TELEGRAM_BOT_TOKEN");
  const chatId = required("TELEGRAM_CHAT_ID");
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok || body.ok === false) {
    throw new Error(`Telegram alert failed (${response.status}): ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body;
}

function whatsappNumber(phone: string) {
  return phone.replace(/\D/g, "");
}

async function sendWhatsAppTemplate(lead: Lead, template: string, language: string) {
  const phoneId = required("WHATSAPP_PHONE_NUMBER_ID");
  const token = required("WHATSAPP_ACCESS_TOKEN");
  const version = required("META_GRAPH_API_VERSION");
  const response = await fetch(
    `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneId)}/messages`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: whatsappNumber(lead.phone),
        type: "template",
        template: {
          name: template,
          language: { code: language },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: lead.name || "Student" },
                { type: "text", text: lead.course || "your selected course" },
              ],
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`WhatsApp template failed (${response.status}): ${JSON.stringify(body).slice(0, 400)}`);
  }
  return { channel: "whatsapp", response: body };
}

async function sendTwilioSms(lead: Lead, message: string) {
  const sid = required("TWILIO_ACCOUNT_SID");
  const authToken = required("TWILIO_AUTH_TOKEN");
  const from = required("TWILIO_FROM_NUMBER");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: lead.phone, From: from, Body: message }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Twilio SMS failed (${response.status}): ${JSON.stringify(body).slice(0, 400)}`);
  }
  return { channel: "sms", response: body };
}

export async function sendLeadFollowup(
  lead: Lead,
  options: { template: string; language?: string; sms: string },
) {
  if (
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.META_GRAPH_API_VERSION
  ) {
    return sendWhatsAppTemplate(lead, options.template, options.language ?? "en_US");
  }
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
    return sendTwilioSms(lead, options.sms);
  }
  throw new Error(
    "No follow-up channel is configured. Add WhatsApp Cloud credentials or Twilio SMS credentials.",
  );
}

export function leadAlertText(lead: Lead) {
  return [
    "🚨 <b>New admissions lead</b>",
    `Name: <b>${escapeHtml(lead.name)}</b>`,
    `Phone: <code>${escapeHtml(lead.phone)}</code>`,
    `Course: ${escapeHtml(lead.course)}`,
    `Source: ${escapeHtml(lead.source)}`,
    `Status: ${lead.status}`,
  ].join("\n");
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
