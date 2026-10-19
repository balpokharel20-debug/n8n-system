import { ensureSchema, getDatabase, hasDatabase } from "@/lib/db";
import { readLocalData, updateLocalData, usesLocalFallback } from "@/lib/local-store";
import type { Lead, LeadStatus } from "@/lib/types";

type LeadInput = Pick<Lead, "externalId" | "name" | "phone" | "course" | "source">;

function leadFromDocument(document: Record<string, unknown> | null): Lead | null {
  if (!document) return null;
  const { _id: _ignored, ...lead } = document;
  return lead as unknown as Lead;
}

function requireLocalPersistence() {
  if (!usesLocalFallback()) throw new Error("MongoDB is required outside local development.");
}

export async function upsertLead(input: LeadInput): Promise<Lead> {
  const now = new Date().toISOString();
  if (!hasDatabase) {
    requireLocalPersistence();
    return updateLocalData((data) => {
      const existing = data.leads.find((lead) => lead.externalId === input.externalId);
      const lead: Lead = existing
        ? { ...existing, ...input, updatedAt: now }
        : {
            ...input,
            id: crypto.randomUUID(),
            status: "New",
            reminderStage: 0,
            createdAt: now,
            updatedAt: now,
          };
      data.leads = existing
        ? data.leads.map((item) => (item.id === lead.id ? lead : item))
        : [lead, ...data.leads];
      return lead;
    });
  }

  await ensureSchema();
  const db = await getDatabase();
  const collection = db.collection<Lead & { _id: string }>("leads");
  const id = crypto.randomUUID();
  const update = {
    $set: { ...input, updatedAt: now },
    $setOnInsert: {
      _id: id,
      id,
      status: "New" as LeadStatus,
      reminderStage: 0 as const,
      createdAt: now,
    },
  };
  try {
    await collection.updateOne({ externalId: input.externalId }, update, { upsert: true });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    await collection.updateOne({ externalId: input.externalId }, { $set: { ...input, updatedAt: now } });
  }
  const lead = leadFromDocument(await collection.findOne({ externalId: input.externalId }));
  if (!lead) throw new Error("The lead could not be read after saving.");
  return lead;
}

export async function listLeads(limit = 100): Promise<Lead[]> {
  if (!hasDatabase) {
    requireLocalPersistence();
    const data = await readLocalData();
    return data.leads.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  await ensureSchema();
  const db = await getDatabase();
  const rows = await db.collection("leads")
    .find({}, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return rows as unknown as Lead[];
}

export async function updateLeadStatus(id: string, status: LeadStatus): Promise<Lead | null> {
  const updatedAt = new Date().toISOString();
  if (!hasDatabase) {
    requireLocalPersistence();
    return updateLocalData((data) => {
      const existing = data.leads.find((lead) => lead.id === id);
      if (!existing) return null;
      const lead = { ...existing, status, updatedAt };
      data.leads = data.leads.map((item) => (item.id === id ? lead : item));
      return lead;
    });
  }

  await ensureSchema();
  const db = await getDatabase();
  const collection = db.collection<Lead & { _id: string }>("leads");
  await collection.updateOne({ _id: id }, { $set: { status, updatedAt } });
  return leadFromDocument(await collection.findOne({ _id: id }));
}

export async function listDueLeadReminders(now = new Date(), limit = 20): Promise<Lead[]> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  if (!hasDatabase) {
    requireLocalPersistence();
    const data = await readLocalData();
    return data.leads
      .filter(
        (lead) =>
          lead.status === "New" &&
          ((lead.reminderStage === 0 && lead.createdAt <= dayAgo) ||
            (lead.reminderStage === 1 && lead.createdAt <= threeDaysAgo)),
      )
      .slice(0, limit);
  }

  await ensureSchema();
  const db = await getDatabase();
  const rows = await db.collection("leads")
    .find({
      status: "New",
      $or: [
        { reminderStage: 0, createdAt: { $lte: dayAgo } },
        { reminderStage: 1, createdAt: { $lte: threeDaysAgo } },
      ],
    }, { projection: { _id: 0 } })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();
  return rows as unknown as Lead[];
}

export async function markReminderSent(id: string, stage: 1 | 2) {
  const updatedAt = new Date().toISOString();
  if (!hasDatabase) {
    requireLocalPersistence();
    await updateLocalData((data) => {
      data.leads = data.leads.map((lead) =>
        lead.id === id && lead.status === "New"
          ? { ...lead, reminderStage: stage, updatedAt }
          : lead,
      );
    });
    return;
  }

  await ensureSchema();
  const db = await getDatabase();
  await db.collection<Lead & { _id: string }>("leads").updateOne(
    { _id: id, status: "New" },
    { $set: { reminderStage: stage, updatedAt } },
  );
}

export async function getSystemState(key: string) {
  if (!hasDatabase) {
    requireLocalPersistence();
    const data = await readLocalData();
    return data.systemState[key] ?? null;
  }

  await ensureSchema();
  const db = await getDatabase();
  const row = await db.collection<{ _id: string; value: string }>("system_state").findOne({ _id: key });
  return row ? String(row.value) : null;
}

export async function setSystemState(key: string, value: string) {
  if (!hasDatabase) {
    requireLocalPersistence();
    await updateLocalData((data) => {
      data.systemState[key] = value;
    });
    return;
  }

  await ensureSchema();
  const db = await getDatabase();
  await db.collection<{ _id: string; value: string }>("system_state").updateOne(
    { _id: key },
    { $set: { value, updatedAt: new Date().toISOString() } },
    { upsert: true },
  );
}
