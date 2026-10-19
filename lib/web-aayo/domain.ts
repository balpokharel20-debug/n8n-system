import { z } from "zod";

export const leadStatuses = [
  "new",
  "research_pending",
  "qualified",
  "review_required",
  "outreach_pending",
  "contacted",
  "replied",
  "meeting_booked",
  "proposal_sent",
  "won",
  "lost",
  "nurture",
  "do_not_contact",
] as const;
export type GrowthLeadStatus = (typeof leadStatuses)[number];

export const contactChannels = ["whatsapp", "email", "phone", "website", "other"] as const;
export const permissionStatuses = ["unknown", "consented", "client_service"] as const;

export const prospectRowSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().max(120).default(""),
  location: z.string().trim().max(160).default(""),
  website: z.string().trim().max(500).default(""),
  source: z.string().trim().min(1).max(120),
  source_usage_permitted: z.boolean().default(false),
  source_business_id: z.string().trim().max(240).optional().default(""),
  source_url: z.string().trim().max(500).default(""),
  contact_channel: z.enum(contactChannels).optional(),
  contact_identifier: z.string().trim().max(320).default(""),
  permission_status: z.enum(permissionStatuses).default("unknown"),
  permission_source: z.string().trim().max(500).default(""),
  permission_timestamp: z.string().trim().max(64).default(""),
  permission_purpose: z.string().trim().max(300).default(""),
  do_not_contact: z.boolean().default(false),
  suppression_reason: z.string().trim().max(500).default(""),
  niche: z.string().trim().max(120).default(""),
  owner: z.string().trim().max(120).default(""),
  niche_fit: z.coerce.number().int().min(0).max(25).default(0),
  service_opportunity: z.coerce.number().int().min(0).max(25).default(0),
  delivery_fit: z.coerce.number().int().min(0).max(20).default(0),
  need_evidence: z.coerce.number().int().min(0).max(15).default(0),
  channel_fit: z.coerce.number().int().min(0).max(15).default(0),
  score_notes: z.string().trim().max(1000).default(""),
}).superRefine((row, context) => {
  for (const field of ["website", "source_url"] as const) {
    const value = row[field];
    if (!value) continue;
    try {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) {
        throw new Error("Invalid URL");
      }
    } catch {
      context.addIssue({ code: "custom", path: [field], message: `${field} must be a valid public HTTP or HTTPS URL.` });
    }
  }

  if (row.permission_status === "consented" && (!row.permission_source || !row.permission_timestamp)) {
    context.addIssue({
      code: "custom",
      path: ["permission_source"],
      message: "Consent requires a recorded source and timestamp.",
    });
  }
  if (!row.source_usage_permitted) {
    context.addIssue({
      code: "custom",
      path: ["source_usage_permitted"],
      message: "Confirm that the source permits this collection and intended business use.",
    });
  }
  if (row.permission_status === "consented" && !row.contact_identifier) {
    context.addIssue({
      code: "custom",
      path: ["contact_identifier"],
      message: "A consent record must identify the contact.",
    });
  }
  if (row.permission_timestamp && Number.isNaN(Date.parse(row.permission_timestamp))) {
    context.addIssue({ code: "custom", path: ["permission_timestamp"], message: "Use an ISO-compatible timestamp." });
  }
  if (row.contact_identifier && !row.contact_channel) {
    context.addIssue({
      code: "custom",
      path: ["contact_channel"],
      message: "Provide contact_channel when contact_identifier is present.",
    });
  }
});

export type ProspectRow = z.infer<typeof prospectRowSchema>;

export type LeadScore = {
  total: number;
  route: "priority_review" | "research_or_review" | "defer";
  reasons: string[];
};

export function normalizeBusinessName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function scoreLead(row: Pick<ProspectRow,
  "niche_fit" | "service_opportunity" | "delivery_fit" | "need_evidence" | "channel_fit" | "score_notes"
>): LeadScore {
  const values = [
    ["Manual niche-fit points", row.niche_fit, 25],
    ["Manual opportunity points", row.service_opportunity, 25],
    ["Manual delivery-fit points", row.delivery_fit, 20],
    ["Manual need-evidence points", row.need_evidence, 15],
    ["Manual channel-fit points", row.channel_fit, 15],
  ] as const;
  const total = values.reduce((sum, [, score]) => sum + score, 0);
  const reasons = ["Manual assessment only; evidence has not been independently verified.", ...values.map(([label, score, maximum]) => `${label}: ${score}/${maximum}`)];
  if (row.score_notes) reasons.push(`Unverified import note: ${row.score_notes}`);
  return {
    total,
    route: total >= 75 ? "priority_review" : total >= 50 ? "research_or_review" : "defer",
    reasons,
  };
}

export function isOutreachEligible(contact: {
  permission_status: string;
  do_not_contact: boolean;
  suppression_reason?: string;
}) {
  return contact.permission_status === "consented" && !contact.do_not_contact && !contact.suppression_reason;
}

const aliases: Record<string, keyof ProspectRow> = {
  business_name: "name",
  company: "name",
  business: "name",
  industry: "category",
  city: "location",
  source_id: "source_business_id",
  business_id: "source_business_id",
  contact: "contact_identifier",
  phone: "contact_identifier",
  email: "contact_identifier",
  channel: "contact_channel",
  consent_status: "permission_status",
  consent_source: "permission_source",
  consent_timestamp: "permission_timestamp",
  consent_purpose: "permission_purpose",
  source_permitted: "source_usage_permitted",
  permitted_use: "source_usage_permitted",
};

export function parseCsvRows(text: string, maximumRows = 1000): Array<Record<string, unknown>> {
  if (text.length > 1_000_000) throw new Error("CSV file is larger than the 1 MB import limit.");
  const grid: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      grid.push(row);
      row = [];
      field = "";
      if (grid.length > maximumRows + 1) throw new Error(`CSV exceeds the ${maximumRows}-row limit.`);
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    grid.push(row);
  }
  if (!grid.length) return [];
  if (grid.length - 1 > maximumRows) throw new Error(`CSV exceeds the ${maximumRows}-row limit.`);

  const sourceHeaders = grid[0].map((value) => value.trim().toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  const headers = sourceHeaders.map((key) => {
    return aliases[key] ?? key as keyof ProspectRow;
  });
  if (!headers.includes("name") || !headers.includes("source")) {
    throw new Error("CSV needs at least the columns name (or business_name) and source.");
  }

  return grid.slice(1).filter((values) => values.some((value) => value.trim())).map((values) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = values[index] ?? "";
      const sourceHeader = sourceHeaders[index];
      if (sourceHeader === "phone" && !(String(record.contact_channel ?? "")).trim()) record.contact_channel = "phone";
      if (sourceHeader === "email" && !(String(record.contact_channel ?? "")).trim()) record.contact_channel = "email";
    });
    if (record.do_not_contact !== undefined) record.do_not_contact = /^(1|true|yes|y)$/i.test(String(record.do_not_contact));
    if (record.source_usage_permitted !== undefined) record.source_usage_permitted = /^(1|true|yes|y|approved)$/i.test(String(record.source_usage_permitted));
    return record;
  });
}

export function validateProspectRows(rows: Array<Record<string, unknown>>) {
  const accepted: ProspectRow[] = [];
  const rejected: Array<{ row: number; errors: string[] }> = [];
  rows.forEach((row, index) => {
    const parsed = prospectRowSchema.safeParse(row);
    if (parsed.success) accepted.push(parsed.data);
    else rejected.push({ row: index + 2, errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) });
  });
  return { accepted, rejected };
}
