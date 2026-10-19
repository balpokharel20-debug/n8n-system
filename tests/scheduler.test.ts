import { describe, expect, it } from "vitest";
import { isScheduledWorkflowDue } from "@/lib/scheduler";

const utc = (hour: number, minute: number) => new Date(Date.UTC(2026, 0, 1, hour, minute));

describe("scheduled workflow cadence", () => {
  it("runs daily workflows on the Vercel Hobby daily invocation", () => {
    expect(isScheduledWorkflowDue("daily", utc(3, 15), "daily")).toBe(true);
  });

  it("does not pretend hourly or five-minute schedules run on Hobby", () => {
    expect(isScheduledWorkflowDue("hourly", utc(3, 15), "daily")).toBe(false);
    expect(isScheduledWorkflowDue("every-5-minutes", utc(3, 15), "daily")).toBe(false);
  });

  it("checks local five-minute schedules only on five-minute boundaries", () => {
    expect(isScheduledWorkflowDue("every-5-minutes", utc(9, 10), "five-minutes")).toBe(true);
    expect(isScheduledWorkflowDue("every-5-minutes", utc(9, 11), "five-minutes")).toBe(false);
  });

  it("checks local hourly and daily schedules at their UTC boundaries", () => {
    expect(isScheduledWorkflowDue("hourly", utc(9, 0), "five-minutes")).toBe(true);
    expect(isScheduledWorkflowDue("hourly", utc(9, 1), "five-minutes")).toBe(false);
    expect(isScheduledWorkflowDue("daily", utc(0, 0), "five-minutes")).toBe(true);
    expect(isScheduledWorkflowDue("daily", utc(3, 15), "five-minutes")).toBe(false);
  });
});
