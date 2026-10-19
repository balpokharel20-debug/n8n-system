import { createHash } from "node:crypto";
import { getDatabase } from "@/lib/db";
import { ensureWebAayoSchema, webAayoCollectionName } from "@/lib/web-aayo/store";

const WINDOW_MS = 60_000;
const MAX_IMPORTS_PER_WINDOW = 10;

export async function reserveImportAttempt(identity: "admin" | "automation", now = Date.now()) {
  await ensureWebAayoSchema();
  const db = await getDatabase();
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const id = createHash("sha256").update(`${identity}:${windowStart}`).digest("hex");
  const collection = db.collection<{ _id: string; count: number; expires_at: Date }>(webAayoCollectionName("import_limits"));
  const record = await collection.findOneAndUpdate(
    { _id: id },
    {
      $inc: { count: 1 },
      $setOnInsert: { expires_at: new Date(windowStart + WINDOW_MS * 2) },
    },
    { upsert: true, returnDocument: "after" },
  );
  const count = record?.count ?? MAX_IMPORTS_PER_WINDOW + 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000));
  return {
    allowed: count <= MAX_IMPORTS_PER_WINDOW,
    remaining: Math.max(0, MAX_IMPORTS_PER_WINDOW - count),
    retryAfterSeconds,
  };
}
