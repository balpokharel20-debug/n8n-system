import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/db";
import { normalizeBusinessName, scoreLead, type GrowthLeadStatus, type ProspectRow } from "@/lib/web-aayo/domain";
import type { BusinessRecord, ContactRecord, GrowthLeadRecord, GrowthLeadView, ImportSummary } from "@/lib/web-aayo/types";

const prefix = "web_aayo_";

export function webAayoCollectionName(name: string) {
  return `${prefix}${name}`;
}

export async function ensureWebAayoSchema() {
  if (process.env.WEB_AAYO_SCHEMA_READY !== "true") {
    throw new Error("Web Aayo schema migration has not been applied. Run the backup-and-index migration, then set WEB_AAYO_SCHEMA_READY=true.");
  }
  await getDatabase();
}

function fingerprint(businessId: string, row: ProspectRow) {
  const stableSourceId = row.source_business_id.trim();
  const identity = stableSourceId
    ? `${row.source.toLocaleLowerCase("en")}\0${stableSourceId}`
    : `${normalizeBusinessName(row.name)}\0${row.location.toLocaleLowerCase("en")}\0${row.contact_channel ?? ""}\0${row.contact_identifier.toLocaleLowerCase("en")}`;
  return createHash("sha256").update(`${businessId}\0${identity}`).digest("hex");
}

function stableBusinessId(row: ProspectRow, normalizedName: string) {
  const identity = row.source_business_id
    ? `${row.source.toLocaleLowerCase("en")}\0${row.source_business_id}`
    : `${normalizedName}\0${row.category}\0${row.location.toLocaleLowerCase("en")}`;
  return `wa-${createHash("sha256").update(identity).digest("hex").slice(0, 40)}`;
}

function mongoErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? Number((error as { code?: unknown }).code)
    : undefined;
}

export async function importProspectRows(rows: ProspectRow[]): Promise<ImportSummary> {
  await ensureWebAayoSchema();
  const db = await getDatabase();
  const businesses = db.collection<BusinessRecord & { _id: string }>(webAayoCollectionName("businesses"));
  const leads = db.collection<GrowthLeadRecord & { _id: string }>(webAayoCollectionName("leads"));
  const contacts = db.collection<ContactRecord & { _id: string }>(webAayoCollectionName("contacts"));
  const summary: ImportSummary = {
    received: rows.length,
    imported: 0,
    duplicates: 0,
    businesses_created: 0,
    contacts_created: 0,
  };

  for (const row of rows) {
    const normalized_name = normalizeBusinessName(row.name);
    const existingBusiness = row.source_business_id
      ? await businesses.findOne({ source: row.source, source_business_id: row.source_business_id })
      : await businesses.findOne({ normalized_name, category: row.category, location: row.location });
    const businessId = existingBusiness?.id ?? stableBusinessId(row, normalized_name);
    const now = new Date();
    if (!existingBusiness) {
      const website = row.website
        ? (row.website.includes("://") ? row.website : `https://${row.website}`)
        : undefined;
      const sourceUrl = row.source_url
        ? (row.source_url.includes("://") ? row.source_url : `https://${row.source_url}`)
        : undefined;
      const document: BusinessRecord & { _id: string } = {
        _id: businessId,
        id: businessId,
        name: row.name,
        normalized_name,
        category: row.category,
        location: row.location,
        ...(website ? { website } : {}),
        source: row.source,
        ...(row.source_business_id ? { source_business_id: row.source_business_id } : {}),
        ...(sourceUrl ? { source_url: sourceUrl } : {}),
        source_retrieved_at: now,
        verified_facts: [],
        created_at: now,
        updated_at: now,
      };
      try {
        await businesses.insertOne(document);
        summary.businesses_created += 1;
      } catch (error) {
        if (mongoErrorCode(error) !== 11000) throw error;
        const racedBusiness = row.source_business_id
          ? await businesses.findOne({ source: row.source, source_business_id: row.source_business_id })
          : await businesses.findOne({ normalized_name, category: row.category, location: row.location });
        if (!racedBusiness) throw error;
      }
    }

    if (row.contact_identifier && row.contact_channel) {
      const contactId = randomUUID();
      const contact: ContactRecord & { _id: string } = {
        _id: contactId,
        id: contactId,
        business_id: businessId,
        channel: row.contact_channel,
        contact_identifier: row.contact_identifier,
        permission_status: row.permission_status,
        permission_source: row.permission_source,
        ...(row.permission_timestamp ? { permission_timestamp: new Date(row.permission_timestamp) } : {}),
        permission_purpose: row.permission_purpose,
        do_not_contact: row.do_not_contact,
        ...(row.suppression_reason ? { suppression_reason: row.suppression_reason } : {}),
        created_at: now,
        updated_at: now,
      };
      try {
        await contacts.insertOne(contact);
        summary.contacts_created += 1;
      } catch (error) {
        if (mongoErrorCode(error) !== 11000) throw error;
        // A repeated import must never erase an existing opt-out or consent record.
        if (row.do_not_contact) {
          await contacts.updateOne(
            { business_id: businessId, channel: row.contact_channel, contact_identifier: row.contact_identifier },
            { $set: { do_not_contact: true, suppression_reason: row.suppression_reason || "Imported suppression", updated_at: now } },
          );
        }
      }
    }

    const leadFingerprint = fingerprint(businessId, row);
    const score = scoreLead(row);
    const leadId = randomUUID();
    const lead: GrowthLeadRecord & { _id: string } = {
      _id: leadId,
      id: leadId,
      business_id: businessId,
      niche: row.niche || row.category,
      service_fit: {
        scores: {
          niche_fit: row.niche_fit,
          service_opportunity: row.service_opportunity,
          delivery_fit: row.delivery_fit,
          need_evidence: row.need_evidence,
          channel_fit: row.channel_fit,
        },
        notes: row.score_notes,
      },
      score: score.total,
      score_route: score.route,
      score_reasons: score.reasons,
      confidence: 0,
      research: null,
      status: score.route === "priority_review" ? "review_required" : "research_pending",
      owner: row.owner,
      import_fingerprint: leadFingerprint,
      created_at: now,
      updated_at: now,
    };
    try {
      await leads.insertOne(lead);
      summary.imported += 1;
    } catch (error) {
      if (mongoErrorCode(error) !== 11000) throw error;
      summary.duplicates += 1;
    }
  }

  return summary;
}

export async function listGrowthLeads(options: { page?: number; limit?: number; status?: string; query?: string } = {}) {
  await ensureWebAayoSchema();
  const db = await getDatabase();
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 25)));
  const match: Record<string, unknown> = {};
  if (options.status) match.status = options.status;
  const escapedQuery = options.query?.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pipeline: Record<string, unknown>[] = [
    { $lookup: { from: webAayoCollectionName("businesses"), localField: "business_id", foreignField: "_id", as: "business_rows" } },
    { $lookup: { from: webAayoCollectionName("contacts"), localField: "business_id", foreignField: "business_id", as: "contacts" } },
  ];
  if (escapedQuery) {
    pipeline.push({ $match: { $or: [
      { "business_rows.name": { $regex: escapedQuery, $options: "i" } },
      { "business_rows.category": { $regex: escapedQuery, $options: "i" } },
      { "business_rows.location": { $regex: escapedQuery, $options: "i" } },
      { niche: { $regex: escapedQuery, $options: "i" } },
    ] } });
  }
  if (Object.keys(match).length) pipeline.push({ $match: match });
  pipeline.push(
    { $sort: { created_at: -1, _id: 1 } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
    { $set: { business: { $arrayElemAt: ["$business_rows", 0] } } },
    { $unset: ["_id", "business_rows"] },
  );
  const items = await db.collection<GrowthLeadView & { _id: string }>(webAayoCollectionName("leads"))
    .aggregate<GrowthLeadView>(pipeline)
    .toArray();
  const countPipeline = pipeline.slice(0, escapedQuery ? 3 : 0);
  if (Object.keys(match).length) countPipeline.push({ $match: match });
  countPipeline.push({ $count: "total" });
  const [count] = await db.collection(webAayoCollectionName("leads")).aggregate<{ total: number }>(countPipeline).toArray();
  const total = count?.total ?? 0;
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}

export async function updateGrowthLeadStatus(id: string, status: GrowthLeadStatus) {
  await ensureWebAayoSchema();
  const db = await getDatabase();
  const now = new Date();
  const collection = db.collection<GrowthLeadRecord & { _id: string }>(webAayoCollectionName("leads"));
  const lead = await collection.findOneAndUpdate(
    { _id: id },
    { $set: { status, updated_at: now } },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  if (lead && status === "do_not_contact") {
    await db.collection<ContactRecord & { _id: string }>(webAayoCollectionName("contacts")).updateMany(
      { business_id: lead.business_id },
      { $set: { do_not_contact: true, suppression_reason: "Lead manually marked do_not_contact", updated_at: now } },
    );
  }
  return lead;
}

export async function getLeadSummary() {
  await ensureWebAayoSchema();
  const db = await getDatabase();
  const [counts, total, pendingApprovals, openTasks, activeClients] = await Promise.all([
    db.collection(webAayoCollectionName("leads")).aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    db.collection(webAayoCollectionName("leads")).countDocuments(),
    Promise.all([
      db.collection(webAayoCollectionName("outreach_jobs")).countDocuments({ status: "pending_approval" }),
      db.collection(webAayoCollectionName("content_items")).countDocuments({ status: "pending_approval" }),
    ]).then(([outreach, content]) => outreach + content),
    db.collection(webAayoCollectionName("tasks")).countDocuments({ status: { $nin: ["done", "cancelled"] } }),
    db.collection(webAayoCollectionName("clients")).countDocuments({ contract_status: "active" }),
  ]);
  return {
    total_leads: total,
    by_status: Object.fromEntries(counts.map(({ _id, count }) => [_id, count])),
    pending_approvals: pendingApprovals,
    open_tasks: openTasks,
    active_clients: activeClients,
    revenue: null,
    revenue_note: "Revenue stays blank until confirmed payment records are implemented.",
  };
}
