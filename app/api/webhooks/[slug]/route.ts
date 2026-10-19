import { NextRequest, NextResponse } from "next/server";
import { isMetaVerifyToken, isValidMetaSignature, isValidWebhook } from "@/lib/auth";
import { executeWorkflow } from "@/lib/executor";
import { getWorkflowBySlug } from "@/lib/workflow-store";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ slug: string }> };
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;

async function readBody(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new Error("Webhook request body is too large.");
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_WEBHOOK_BODY_BYTES) {
      await reader.cancel();
      throw new Error("Webhook request body is too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handle(request: NextRequest, context: RouteContext) {
  if (request.method === "GET" && request.nextUrl.searchParams.has("hub.challenge")) {
    const mode = request.nextUrl.searchParams.get("hub.mode");
    const verifyToken = request.nextUrl.searchParams.get("hub.verify_token");
    const challenge = request.nextUrl.searchParams.get("hub.challenge") ?? "";
    if (mode === "subscribe" && isMetaVerifyToken(verifyToken)) {
      return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
    }
    return NextResponse.json({ error: "Meta webhook verification failed" }, { status: 403 });
  }
  let rawBody = "";
  try {
    if (request.method !== "GET") rawBody = await readBody(request);
  } catch {
    return NextResponse.json({ error: "Webhook request body is too large." }, { status: 413 });
  }
  const validMetaSignature = isValidMetaSignature(
    rawBody,
    request.headers.get("x-hub-signature-256"),
  );
  if (!isValidWebhook(request) && !validMetaSignature) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }
  const { slug } = await context.params;
  const workflow = await getWorkflowBySlug(slug);
  if (!workflow || workflow.status !== "active") {
    return NextResponse.json({ error: "Active workflow not found" }, { status: 404 });
  }

  let input: unknown = Object.fromEntries(request.nextUrl.searchParams.entries());
  if (request.method !== "GET") {
    const contentType = request.headers.get("content-type") ?? "";
    try {
      input = contentType.includes("application/json")
        ? JSON.parse(rawBody)
        : Object.fromEntries(new URLSearchParams(rawBody).entries());
    } catch {
      return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
    }
  }

  const execution = await executeWorkflow(workflow, "webhook", input);
  return NextResponse.json(
    execution.status === "success"
      ? { ok: true, executionId: execution.id, data: execution.output }
      : { ok: false, executionId: execution.id, error: execution.error },
    { status: execution.status === "success" ? 200 : 422 },
  );
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
