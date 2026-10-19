import { describe, expect, it } from "vitest";
import { normalizeMetaLead } from "@/lib/integrations";
import { listLeads, updateLeadStatus, upsertLead } from "@/lib/lead-store";

describe("lead capture pipeline", () => {
  it("normalizes direct click-to-message payloads without a Meta lookup", async () => {
    const lead = await normalizeMetaLead({
      id: "meta-test-1",
      full_name: "Sita Rai",
      phone_number: "+977 980-000-0000",
      course: "IELTS",
      source: "Instagram click-to-message",
    });

    expect(lead).toEqual({
      externalId: "meta-test-1",
      name: "Sita Rai",
      phone: "+9779800000000",
      course: "IELTS",
      source: "Instagram click-to-message",
    });
  });

  it("deduplicates external leads and lets admissions stop reminders by status", async () => {
    const externalId = `lead-${crypto.randomUUID()}`;
    const first = await upsertLead({
      externalId,
      name: "Aarav",
      phone: "+9779811111111",
      course: "PTE",
      source: "Meta",
    });
    const duplicate = await upsertLead({
      externalId,
      name: "Aarav Sharma",
      phone: "+9779811111111",
      course: "PTE",
      source: "Meta",
    });
    const called = await updateLeadStatus(first.id, "Called");

    expect(duplicate.id).toBe(first.id);
    expect(called?.status).toBe("Called");
    expect((await listLeads()).filter((lead) => lead.externalId === externalId)).toHaveLength(1);
  });
});
