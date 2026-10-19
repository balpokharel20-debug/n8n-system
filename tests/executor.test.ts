import { describe, expect, it } from "vitest";
import { executeWorkflow } from "@/lib/executor";
import { starterWorkflow } from "@/lib/starter-workflow";
import type { Workflow } from "@/lib/types";

function workflow(): Workflow {
  return {
    ...starterWorkflow(),
    id: "test-workflow",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("workflow executor", () => {
  it("takes the qualified branch and preserves typed mappings", async () => {
    const result = await executeWorkflow(workflow(), "webhook", {
      name: "Maya",
      email: "maya@example.com",
      score: 82,
    });

    expect(result.status).toBe("success");
    expect(result.steps.map((step) => step.label)).toEqual([
      "Webhook received",
      "Shape lead data",
      "Qualified?",
      "Accept lead",
    ]);
    expect(result.output).toEqual({
      accepted: true,
      message: "Thanks Maya — we will be in touch.",
    });
  });

  it("takes the false condition branch", async () => {
    const result = await executeWorkflow(workflow(), "webhook", {
      name: "Sam",
      score: 20,
    });

    expect(result.status).toBe("success");
    expect(result.steps.at(-1)?.label).toBe("Keep nurturing");
    expect(result.output).toEqual({ accepted: false, message: "Lead saved for nurturing." });
  });
});
