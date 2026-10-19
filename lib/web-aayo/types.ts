import type { GrowthLeadStatus, ProspectRow } from "@/lib/web-aayo/domain";

export type BusinessRecord = {
  id: string;
  name: string;
  normalized_name: string;
  category: string;
  location: string;
  website?: string;
  source: string;
  source_business_id?: string;
  source_url?: string;
  source_retrieved_at: Date;
  verified_facts: Array<{ claim: string; source_url: string; checked_at: Date }>;
  created_at: Date;
  updated_at: Date;
};

export type ContactRecord = {
  id: string;
  business_id: string;
  channel: ProspectRow["contact_channel"];
  contact_identifier: string;
  permission_status: ProspectRow["permission_status"];
  permission_source: string;
  permission_timestamp?: Date;
  permission_purpose: string;
  do_not_contact: boolean;
  suppression_reason?: string;
  last_inbound_at?: Date;
  last_outbound_at?: Date;
  created_at: Date;
  updated_at: Date;
};

export type GrowthLeadRecord = {
  id: string;
  business_id: string;
  niche: string;
  service_fit: {
    scores: {
      niche_fit: number;
      service_opportunity: number;
      delivery_fit: number;
      need_evidence: number;
      channel_fit: number;
    };
    notes: string;
  };
  score: number;
  score_route: "priority_review" | "research_or_review" | "defer";
  score_reasons: string[];
  confidence: number;
  research: Record<string, unknown> | null;
  status: GrowthLeadStatus;
  owner: string;
  last_contact_at?: Date;
  next_action_at?: Date;
  import_fingerprint: string;
  created_at: Date;
  updated_at: Date;
};

export type GrowthLeadView = GrowthLeadRecord & {
  business: BusinessRecord | null;
  contacts: ContactRecord[];
};

export type ImportSummary = {
  received: number;
  imported: number;
  duplicates: number;
  businesses_created: number;
  contacts_created: number;
};
