import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Execution, Lead, Workflow } from "@/lib/types";

export type LocalData = {
  version: 1;
  workflows: Workflow[];
  executions: Execution[];
  leads: Lead[];
  systemState: Record<string, string>;
};

const initialData = (): LocalData => ({
  version: 1,
  workflows: [],
  executions: [],
  leads: [],
  systemState: {},
});

const dataPath = path.join(process.cwd(), ".relay-data.json");
const queueGlobal = globalThis as typeof globalThis & { __relayLocalQueue?: Promise<void> };
const testGlobal = globalThis as typeof globalThis & {
  __relayTestData?: LocalData;
  __relayTestQueue?: Promise<void>;
};

export function usesLocalPersistence() {
  return process.env.NODE_ENV === "development" && !process.env.MONGODB_URI;
}

function usesTestPersistence() {
  return process.env.NODE_ENV === "test" && !process.env.MONGODB_URI;
}

export function usesLocalFallback() {
  return usesLocalPersistence() || usesTestPersistence();
}

function testData() {
  return testGlobal.__relayTestData ?? (testGlobal.__relayTestData = initialData());
}

async function readDisk(): Promise<LocalData> {
  try {
    const parsed = JSON.parse(await readFile(dataPath, "utf8")) as Partial<LocalData>;
    return {
      version: 1,
      workflows: Array.isArray(parsed.workflows) ? parsed.workflows : [],
      executions: Array.isArray(parsed.executions) ? parsed.executions : [],
      leads: Array.isArray(parsed.leads) ? parsed.leads : [],
      systemState:
        parsed.systemState && typeof parsed.systemState === "object"
          ? parsed.systemState
          : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return initialData();
    throw error;
  }
}

export async function readLocalData(): Promise<LocalData> {
  if (usesTestPersistence()) {
    await (testGlobal.__relayTestQueue ?? Promise.resolve());
    return testData();
  }
  await (queueGlobal.__relayLocalQueue ?? Promise.resolve());
  return readDisk();
}

export async function updateLocalData<T>(update: (data: LocalData) => T | Promise<T>): Promise<T> {
  if (usesTestPersistence()) {
    const previous = testGlobal.__relayTestQueue ?? Promise.resolve();
    const operation = previous.then(() => update(testData()));
    testGlobal.__relayTestQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  const previous = queueGlobal.__relayLocalQueue ?? Promise.resolve();
  const operation = previous.then(async () => {
    const data = await readDisk();
    const result = await update(data);
    const tempPath = `${dataPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, JSON.stringify(data, null, 2), { encoding: "utf8", flag: "wx" });
      await rename(tempPath, dataPath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
    return result;
  });

  queueGlobal.__relayLocalQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}
