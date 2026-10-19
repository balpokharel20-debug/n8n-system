import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { hasWebAayoAutomationToken } from "@/lib/web-aayo/auth";
import { reserveImportAttempt } from "@/lib/web-aayo/rate-limit";
import { parseCsvRows, validateProspectRows } from "@/lib/web-aayo/domain";
import { importProspectRows } from "@/lib/web-aayo/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 1_000_000;
const MAX_ROWS = 1000;

export async function POST(request: NextRequest) {
  const admin = isAdmin(request);
  const automation = !admin && hasWebAayoAutomationToken(request);
  if (!admin && !automation) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const rateLimit = await reserveImportAttempt(admin ? "admin" : "automation");
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: "Import rate limit reached. Try again in a minute." }, {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      });
    }
  } catch {
    return NextResponse.json({ error: "Web Aayo storage is unavailable. Check MongoDB configuration and migration status." }, { status: 503 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BYTES) return NextResponse.json({ error: "Import exceeds the 1 MB limit." }, { status: 413 });

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  let rows: Array<Record<string, unknown>>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "Import exceeds the 1 MB limit." }, { status: 413 });
    }
    if (contentType.includes("text/csv")) {
      rows = parseCsvRows(raw, MAX_ROWS);
    } else if (contentType.includes("application/json")) {
      const body = JSON.parse(raw);
      rows = Array.isArray(body) ? body : body?.rows;
      if (!Array.isArray(rows)) return NextResponse.json({ error: "Send a CSV file or a JSON object with a rows array." }, { status: 400 });
    } else {
      return NextResponse.json({ error: "Use text/csv or application/json." }, { status: 415 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not parse import.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (rows.length > MAX_ROWS) return NextResponse.json({ error: `Import exceeds the ${MAX_ROWS}-row limit.` }, { status: 413 });
  const validation = validateProspectRows(rows);
  if (!validation.accepted.length) {
    return NextResponse.json({
      error: "No valid rows were found. Required columns are name and source.",
      received: rows.length,
      rejected: validation.rejected,
    }, { status: 400 });
  }

  try {
    const summary = await importProspectRows(validation.accepted);
    summary.received = rows.length;
    const eventId = crypto.randomUUID();
    const db = await getDatabase();
    await db.collection<{
      _id: string;
      id: string;
      correlation_id: string;
      event_type: string;
      actor: string;
      received: number;
      imported: number;
      duplicates: number;
      rejected: number;
      created_at: Date;
    }>("web_aayo_workflow_events").insertOne({
      _id: eventId,
      id: eventId,
      correlation_id: eventId,
      event_type: "lead_import",
      actor: admin ? "admin" : "n8n",
      received: rows.length,
      imported: summary.imported,
      duplicates: summary.duplicates,
      rejected: validation.rejected.length,
      created_at: new Date(),
    });
    return NextResponse.json({ summary, rejected: validation.rejected }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Import could not be saved. Check MongoDB configuration and connectivity; retrying is safe." }, { status: 503 });
  }
}
