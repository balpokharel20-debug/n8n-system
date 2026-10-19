import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI?.trim();
const databaseName = process.env.MONGODB_DB?.trim();
export const hasDatabase = Boolean(uri);

type MongoGlobal = typeof globalThis & {
  __relayMongoClientPromise?: Promise<MongoClient>;
  __relayMongoIndexesPromise?: Promise<void>;
};

const mongoGlobal = globalThis as MongoGlobal;

export async function getDatabase(): Promise<Db> {
  if (!uri) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI before using persistent storage.");
  }

  if (!mongoGlobal.__relayMongoClientPromise) {
    const client = new MongoClient(uri, {
      appName: "Relay",
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 10_000,
      waitQueueTimeoutMS: 5_000,
      serverSelectionTimeoutMS: 5_000,
    });
    mongoGlobal.__relayMongoClientPromise = client.connect().catch((error) => {
      mongoGlobal.__relayMongoClientPromise = undefined;
      throw error;
    });
  }

  const client = await mongoGlobal.__relayMongoClientPromise;
  return client.db(databaseName || undefined);
}

export async function ensureSchema() {
  if (!mongoGlobal.__relayMongoIndexesPromise) {
    mongoGlobal.__relayMongoIndexesPromise = (async () => {
      const db = await getDatabase();
      await Promise.all([
        db.collection("workflows").createIndex({ slug: 1 }, { unique: true }),
        db.collection("executions").createIndex({ startedAt: -1 }),
        db.collection("executions").createIndex({ workflowId: 1, startedAt: -1 }),
        db.collection("leads").createIndex({ externalId: 1 }, { unique: true }),
        db.collection("leads").createIndex({ status: 1, createdAt: -1 }),
        db.collection("auth_attempts").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      ]);
    })().catch((error) => {
      mongoGlobal.__relayMongoIndexesPromise = undefined;
      throw error;
    });
  }

  await mongoGlobal.__relayMongoIndexesPromise;
}
