import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { EJSON, MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI?.trim();
const databaseName = process.env.MONGODB_DB?.trim();
const apply = process.argv.includes("--apply");
const prefix = "web_aayo_";

if (!uri) {
  console.error("MONGODB_URI is not set. Use node --env-file=.env.local scripts/migrate-web-aayo.mjs.");
  process.exit(1);
}

const indexes = [
  ["businesses", { source: 1, source_business_id: 1 }, { unique: true, partialFilterExpression: { source_business_id: { $type: "string", $gt: "" } }, name: "wa_source_business_unique" }],
  ["businesses", { normalized_name: 1, category: 1, location: 1 }, { name: "wa_business_match" }],
  ["leads", { import_fingerprint: 1 }, { unique: true, partialFilterExpression: { import_fingerprint: { $type: "string", $gt: "" } }, name: "wa_lead_import_idempotency" }],
  ["leads", { status: 1, score: -1, created_at: -1 }, { name: "wa_lead_status_score_created" }],
  ["leads", { status: 1, next_action_at: 1 }, { name: "wa_due_followups" }],
  ["contacts", { business_id: 1, channel: 1, contact_identifier: 1 }, { unique: true, partialFilterExpression: { business_id: { $type: "string", $gt: "" }, channel: { $type: "string", $gt: "" }, contact_identifier: { $type: "string", $gt: "" } }, name: "wa_business_contact_unique" }],
  ["contacts", { do_not_contact: 1, permission_status: 1 }, { name: "wa_contact_suppression" }],
  ["conversations", { provider_event_id: 1 }, { unique: true, partialFilterExpression: { provider_event_id: { $type: "string", $gt: "" } }, name: "wa_provider_event_unique" }],
  ["conversations", { provider_message_id: 1 }, { unique: true, partialFilterExpression: { provider_message_id: { $type: "string", $gt: "" } }, name: "wa_provider_message_unique" }],
  ["outreach_jobs", { idempotency_key: 1 }, { unique: true, partialFilterExpression: { idempotency_key: { $type: "string", $gt: "" } }, name: "wa_outreach_idempotency" }],
  ["outreach_jobs", { status: 1, scheduled_at: 1 }, { name: "wa_outreach_queue" }],
  ["clients", { contract_status: 1, renewal_date: 1 }, { name: "wa_client_renewals" }],
  ["brand_profiles", { client_id: 1, updated_at: -1 }, { name: "wa_brand_profile_client" }],
  ["research_items", { source_url: 1, retrieved_at: -1 }, { name: "wa_research_source" }],
  ["content_items", { client_id: 1, status: 1, scheduled_at: 1 }, { name: "wa_content_calendar" }],
  ["tasks", { status: 1, due_at: 1, priority: -1 }, { name: "wa_task_due" }],
  ["metrics_daily", { date: 1 }, { name: "wa_metrics_date" }],
  ["workflow_events", { correlation_id: 1, created_at: -1 }, { name: "wa_workflow_correlation" }],
  ["import_limits", { expires_at: 1 }, { expireAfterSeconds: 0, name: "wa_import_rate_limit_ttl" }],
];

const uniqueKeys = [
  ["businesses", ["source", "source_business_id"], ["source_business_id"]],
  ["leads", ["import_fingerprint"], ["import_fingerprint"]],
  ["contacts", ["business_id", "channel", "contact_identifier"], ["business_id", "channel", "contact_identifier"]],
  ["conversations", ["provider_event_id"], ["provider_event_id"]],
  ["conversations", ["provider_message_id"], ["provider_message_id"]],
  ["outreach_jobs", ["idempotency_key"], ["idempotency_key"]],
];

async function duplicateCount(collection, fields, presentFields) {
  const match = Object.fromEntries(presentFields.map((field) => [field, { $type: "string", $gt: "" }]));
  const groupKey = Object.fromEntries(fields.map((field) => [field, `$${field}`]));
  const groups = await collection.aggregate([
    { $match: match },
    { $group: { _id: groupKey, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: "duplicate_groups" },
  ]).toArray();
  return groups[0]?.duplicate_groups ?? 0;
}

async function backupCollection(db, collectionName, backupDirectory) {
  const filePath = path.join(backupDirectory, `${collectionName}.jsonl`);
  const output = createWriteStream(filePath, { flags: "wx", mode: 0o600 });
  let count = 0;
  try {
    for await (const record of db.collection(collectionName).find({}).batchSize(500)) {
      if (!output.write(`${EJSON.stringify(record, { relaxed: false })}\n`)) await once(output, "drain");
      count += 1;
    }
  } catch (error) {
    output.destroy();
    throw error;
  }
  output.end();
  await once(output, "finish");
  return { collection: collectionName, records: count, file: filePath };
}

const client = new MongoClient(uri, {
  appName: "Web-Aayo-schema-migration",
  serverSelectionTimeoutMS: 8000,
  waitQueueTimeoutMS: 8000,
});

try {
  await client.connect();
  const db = client.db(databaseName || undefined);
  const existing = await db.listCollections({ name: { $regex: `^${prefix}` } }, { nameOnly: true }).toArray();
  const existingNames = new Set(existing.map((entry) => entry.name));
  const counts = [];
  for (const entry of existing) {
    counts.push({ collection: entry.name, records: await db.collection(entry.name).countDocuments() });
  }
  console.log(`Found ${existing.length} Web Aayo-namespaced collections. Document counts only; no record contents displayed.`);
  for (const item of counts) console.log(`${item.collection}: ${item.records} record(s)`);

  const duplicates = [];
  for (const [shortName, fields, presentFields] of uniqueKeys) {
    const fullName = `${prefix}${shortName}`;
    if (!existingNames.has(fullName)) continue;
    const count = await duplicateCount(db.collection(fullName), fields, presentFields);
    if (count) duplicates.push({ collection: fullName, indexFields: fields.join(","), duplicateGroups: count });
  }
  if (duplicates.length) {
    console.error("Unique-index preflight found duplicate groups. No backup or index changes were made; review and resolve them manually.");
    for (const item of duplicates) console.error(`${item.collection} [${item.indexFields}]: ${item.duplicateGroups} duplicate group(s)`);
    process.exitCode = 2;
  } else if (!apply) {
    console.log("Dry run only. No database writes were performed. Re-run with --apply to back up namespaced records and create indexes.");
  } else {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDirectory = path.resolve(".web-aayo-backups", timestamp);
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    const backup = [];
    for (const entry of existing) backup.push(await backupCollection(db, entry.name, backupDirectory));
    await writeFile(path.join(backupDirectory, "manifest.json"), JSON.stringify({ created_at: new Date().toISOString(), collections: backup }, null, 2), { flag: "wx", mode: 0o600 });
    console.log(`Backed up ${backup.length} existing namespaced collection(s) before index changes.`);
    for (const [shortName, keys, options] of indexes) {
      await db.collection(`${prefix}${shortName}`).createIndex(keys, options);
    }
    console.log(`Created or verified ${indexes.length} indexes. Set WEB_AAYO_SCHEMA_READY=true only after this completes successfully.`);
  }
} catch {
  console.error("Web Aayo migration did not complete. Check network/database permissions without sharing connection values.");
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}
