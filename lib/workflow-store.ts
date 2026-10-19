import { ensureSchema, getDatabase, hasDatabase } from "@/lib/db";
import { readLocalData, updateLocalData, usesLocalPersistence } from "@/lib/local-store";
import type { Execution, StepResult, Workflow, WorkflowInput } from "@/lib/types";

function workflowFromDocument(document: Record<string, unknown> | null): Workflow | null {
  if (!document) return null;
  const { _id: _ignored, ...workflow } = document;
  return workflow as unknown as Workflow;
}

function executionFromDocument(document: Record<string, unknown>): Execution {
  const { _id: _ignored, ...execution } = document;
  return execution as unknown as Execution;
}

export async function listWorkflows(): Promise<Workflow[]> {
  if (!hasDatabase) {
    if (!usesLocalPersistence()) throw new Error("MongoDB is required outside local development.");
    const data = await readLocalData();
    return data.workflows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  await ensureSchema();
  const db = await getDatabase();
  const rows = await db.collection("workflows")
    .find({}, { projection: { _id: 0 } })
    .sort({ updatedAt: -1 })
    .toArray();
  return rows as unknown as Workflow[];
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  if (!hasDatabase) {
    if (!usesLocalPersistence()) throw new Error("MongoDB is required outside local development.");
    const data = await readLocalData();
    return data.workflows.find((item) => item.id === id) ?? null;
  }

  await ensureSchema();
  const db = await getDatabase();
  return workflowFromDocument(await db.collection<Workflow & { _id: string }>("workflows").findOne({ _id: id }));
}

export async function getWorkflowBySlug(slug: string): Promise<Workflow | null> {
  if (!hasDatabase) {
    if (!usesLocalPersistence()) throw new Error("MongoDB is required outside local development.");
    const data = await readLocalData();
    return data.workflows.find((item) => item.slug === slug) ?? null;
  }

  await ensureSchema();
  const db = await getDatabase();
  return workflowFromDocument(await db.collection("workflows").findOne({ slug }));
}

export async function saveWorkflow(
  input: WorkflowInput,
  id = crypto.randomUUID(),
): Promise<Workflow> {
  const now = new Date().toISOString();
  if (!hasDatabase) {
    if (!usesLocalPersistence()) throw new Error("MongoDB is required outside local development.");
    return updateLocalData((data) => {
      const existing = data.workflows.find((item) => item.id === id);
      const workflow: Workflow = {
        ...input,
        id,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      data.workflows = existing
        ? data.workflows.map((item) => (item.id === id ? workflow : item))
        : [workflow, ...data.workflows];
      return workflow;
    });
  }

  await ensureSchema();
  const db = await getDatabase();
  const collection = db.collection<Workflow & { _id: string }>("workflows");
  const existing = await collection.findOne({ _id: id });
  const workflow: Workflow = {
    ...input,
    id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await collection.updateOne(
    { _id: id },
    {
      $set: { ...input, id, updatedAt: now },
      $setOnInsert: { createdAt: workflow.createdAt },
    },
    { upsert: true },
  );
  return workflow;
}

export async function removeWorkflow(id: string) {
  if (!hasDatabase) {
    if (!usesLocalPersistence()) throw new Error("MongoDB is required outside local development.");
    return updateLocalData((data) => {
      const existing = data.workflows.some((item) => item.id === id);
      data.workflows = data.workflows.filter((item) => item.id !== id);
      data.executions = data.executions.filter((item) => item.workflowId !== id);
      return existing;
    });
  }

  await ensureSchema();
  const db = await getDatabase();
  await db.collection<{ _id: string; workflowId: string }>("executions").deleteMany({ workflowId: id });
  const result = await db.collection<{ _id: string }>("workflows").deleteOne({ _id: id });
  return result.deletedCount > 0;
}

export async function createExecution(
  workflow: Workflow,
  triggerType: Execution["triggerType"],
  input: unknown,
): Promise<Execution> {
  const execution: Execution = {
    id: crypto.randomUUID(),
    workflowId: workflow.id,
    workflowName: workflow.name,
    status: "running",
    triggerType,
    input,
    output: null,
    steps: [],
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  if (!hasDatabase) {
    if (!usesLocalPersistence()) throw new Error("MongoDB is required outside local development.");
    await updateLocalData((data) => {
      data.executions.unshift(execution);
      data.executions = data.executions.slice(0, 1000);
    });
    return execution;
  }

  await ensureSchema();
  const db = await getDatabase();
  await db.collection<Execution & { _id: string }>("executions").insertOne({ _id: execution.id, ...execution });
  return execution;
}

export async function finishExecution(
  id: string,
  status: "success" | "failed",
  output: unknown,
  steps: StepResult[],
  error: string | null,
) {
  const finishedAt = new Date().toISOString();
  if (!hasDatabase) {
    if (!usesLocalPersistence()) throw new Error("MongoDB is required outside local development.");
    await updateLocalData((data) => {
      data.executions = data.executions.map((item) =>
        item.id === id ? { ...item, status, output, steps, error, finishedAt } : item,
      );
    });
    return;
  }

  await ensureSchema();
  const db = await getDatabase();
  await db.collection<{ _id: string }>("executions").updateOne(
    { _id: id },
    { $set: { status, output, steps, error, finishedAt } },
  );
}

export async function listExecutions(limit = 30): Promise<Execution[]> {
  if (!hasDatabase) {
    if (!usesLocalPersistence()) throw new Error("MongoDB is required outside local development.");
    const data = await readLocalData();
    return data.executions
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  await ensureSchema();
  const db = await getDatabase();
  const rows = await db.collection("executions")
    .find({}, { projection: { _id: 0 } })
    .sort({ startedAt: -1 })
    .limit(limit)
    .toArray();
  return rows.map((row) => executionFromDocument(row));
}

export async function listScheduledWorkflows(): Promise<Workflow[]> {
  const workflows = await listWorkflows();
  return workflows.filter((item) => item.status === "active" && item.schedule);
}
