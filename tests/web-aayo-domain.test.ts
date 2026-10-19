import { describe, expect, it } from "vitest";
import {
  isOutreachEligible,
  normalizeBusinessName,
  parseCsvRows,
  scoreLead,
  validateProspectRows,
} from "@/lib/web-aayo/domain";

describe("Web Aayo prospect safety and import rules", () => {
  it("normalizes business names without confusing accents or punctuation", () => {
    expect(normalizeBusinessName("  Café—Momo & More  ")).toBe("cafe momo more");
  });

  it("scores only the supplied evidence fields and routes by the configured thresholds", () => {
    const score = scoreLead({
      niche_fit: 25,
      service_opportunity: 25,
      delivery_fit: 20,
      need_evidence: 15,
      channel_fit: 15,
      score_notes: "",
    });
    expect(score.total).toBe(100);
    expect(score.route).toBe("priority_review");
    expect(score.reasons).toHaveLength(6);
    expect(scoreLead({ niche_fit: 10, service_opportunity: 10, delivery_fit: 10, need_evidence: 10, channel_fit: 10, score_notes: "" }).route).toBe("research_or_review");
    expect(scoreLead({ niche_fit: 5, service_opportunity: 5, delivery_fit: 5, need_evidence: 5, channel_fit: 5, score_notes: "" }).route).toBe("defer");
  });

  it("blocks unknown permission and every suppressed contact", () => {
    expect(isOutreachEligible({ permission_status: "unknown", do_not_contact: false })).toBe(false);
    expect(isOutreachEligible({ permission_status: "consented", do_not_contact: true })).toBe(false);
    expect(isOutreachEligible({ permission_status: "consented", do_not_contact: false, suppression_reason: "complaint" })).toBe(false);
    expect(isOutreachEligible({ permission_status: "consented", do_not_contact: false })).toBe(true);
  });

  it("parses quoted CSV fields and normalizes common import headings", () => {
    const rows = parseCsvRows([
      "business_name,industry,city,source,source_usage_permitted,channel,contact,do_not_contact",
      '"A&B, Bakery",Food,Kathmandu,Manual,yes,phone,+9779800000000,yes',
    ].join("\n"));
    const result = validateProspectRows(rows);
    expect(result.rejected).toEqual([]);
    expect(result.accepted[0]).toMatchObject({
      name: "A&B, Bakery",
      category: "Food",
      location: "Kathmandu",
      source: "Manual",
      source_usage_permitted: true,
      contact_channel: "phone",
      contact_identifier: "+9779800000000",
      do_not_contact: true,
      permission_status: "unknown",
    });
  });

  it("requires consent evidence and explicit channel before a contact can be eligible", () => {
    const valid = {
      name: "Web Aayo Prospect",
      source: "Manual research",
      source_usage_permitted: true,
      contact_channel: "whatsapp",
      contact_identifier: "+9779800000000",
      permission_status: "consented",
      permission_source: "Website opt-in form",
      permission_timestamp: "2026-10-19T00:00:00.000Z",
    };
    expect(validateProspectRows([valid]).accepted).toHaveLength(1);
    expect(validateProspectRows([{ ...valid, permission_source: "" }]).rejected).toHaveLength(1);
    expect(validateProspectRows([{ ...valid, contact_channel: undefined }]).rejected).toHaveLength(1);
  });

  it("rejects source data unless permitted use is explicitly confirmed", () => {
    const result = validateProspectRows([{ name: "Unverified listing", source: "Directory" }]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0].errors.join(" ")).toContain("source_usage_permitted");
  });

  it("rejects malformed quoting and oversized row counts", () => {
    expect(() => parseCsvRows('name,source\n"Cafe,Manual')).toThrow("unclosed quoted field");
    expect(() => parseCsvRows("name,source\n" + Array.from({ length: 3 }, (_, index) => `Shop ${index},Manual`).join("\n"), 2)).toThrow("2-row limit");
  });
});
