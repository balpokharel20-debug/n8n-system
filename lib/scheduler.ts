import type { Workflow } from "@/lib/types";

export type CronCadence = "daily" | "hourly" | "five-minutes";

export function isScheduledWorkflowDue(
  schedule: Workflow["schedule"],
  now: Date,
  cadence: CronCadence,
) {
  if (!schedule) return false;

  if (schedule === "daily") {
    if (cadence === "daily") return true;
    return now.getUTCHours() === 0 && now.getUTCMinutes() === 0;
  }
  if (schedule === "hourly") {
    return cadence !== "daily" && now.getUTCMinutes() === 0;
  }
  if (schedule === "every-5-minutes") {
    return cadence === "five-minutes" && now.getUTCMinutes() % 5 === 0;
  }
  return false;
}

export function getCronCadence(): CronCadence {
  const configured = process.env.VERCEL_CRON_CADENCE;
  if (configured === "daily" || configured === "hourly" || configured === "five-minutes") {
    return configured;
  }
  // The checked-in Vercel Hobby config invokes this endpoint once daily.
  return process.env.VERCEL === "1" ? "daily" : "five-minutes";
}
