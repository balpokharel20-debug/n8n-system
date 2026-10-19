import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const baseUrl = (process.env.RELAY_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const headers = new Headers();
    if (process.env.CRON_SECRET) {
      headers.set("authorization", `Bearer ${process.env.CRON_SECRET}`);
    }
    const response = await fetch(`${baseUrl}/api/cron`, { headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${response.status} ${JSON.stringify(body)}`);
    }
    const reminderCount = body.leadResults?.length ?? 0;
    const workflowCount = body.results?.length ?? 0;
    if (reminderCount || workflowCount) {
      console.log(`[relay cron] ${new Date().toISOString()} processed ${reminderCount} lead task(s), ${workflowCount} scheduled workflow(s)`);
    }
  } catch (error) {
    console.error(`[relay cron] Could not reach ${baseUrl}/api/cron:`, error);
  } finally {
    running = false;
  }
}

console.log(`[relay cron] Checking ${baseUrl}/api/cron once per minute. Press Ctrl+C to stop.`);
await tick();
const timer = setInterval(() => void tick(), 60_000);

function stop() {
  clearInterval(timer);
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
