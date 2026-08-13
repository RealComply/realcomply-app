// Shared app types, mirroring supabase/migrations/0001_init.sql.
// Keep these in sync with the schema by hand for now; once the schema
// stabilises, generate these with `supabase gen types typescript`.

// 'class_1' / 'class_2' — real estate licence classes; 'certificate_of_registration'
// — the certificate an assistant agent holds instead (PSA Act licensing).
export type LicenceType = "class_1" | "class_2" | "certificate_of_registration";

export type Profile = {
  id: string;
  agency_id: string;
  full_name: string | null;
  email: string;
  is_agent: boolean;
  is_licensee_in_charge: boolean;
  licence_type: LicenceType | null;
  licence_number: string | null;
  licence_expiry: string | null;
  licence_document_path: string | null;
  licence_document_file_name: string | null;
  created_at: string;
};

export type Agency = {
  id: string;
  name: string;
  pi_insurer: string | null;
  pi_policy_number: string | null;
  pi_expiry: string | null;
  cyber_insurer: string | null;
  cyber_policy_number: string | null;
  cyber_expiry: string | null;
  icare_insurer: string | null;
  icare_policy_number: string | null;
  icare_expiry: string | null;
  gift_threshold: number;
  complaint_resolution_target_days: number;
  created_at: string;
};

// The three agency-level insurance policies tracked in the Insurance
// register — same insurer/policy-number/expiry shape, different legal
// grounding and column prefix on the `agencies` row.
export type InsurancePolicyType = "pi" | "cyber" | "icare";

export type GiftDirection = "received" | "given";
export type GiftStatus = "recorded" | "flagged" | "reviewed";

export type Gift = {
  id: string;
  agency_id: string;
  profile_id: string;
  gift_date: string;
  description: string;
  counterparty: string | null;
  value: number | null;
  direction: GiftDirection;
  status: GiftStatus;
  property_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type ComplaintStatus = "open" | "under_review" | "resolved";

export type Complaint = {
  id: string;
  agency_id: string;
  received_date: string;
  complainant: string;
  agent_id: string | null;
  property_id: string | null;
  nature: string;
  status: ComplaintStatus;
  resolved_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type SgManualVersion = {
  id: string;
  agency_id: string;
  version_label: string | null;
  file_path: string;
  file_name: string;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
};

// Document sign-offs — see supabase/migrations/0009_document_signoffs.sql
// for the full design note. 'other' exists so a one-off document can be
// published without inventing a new category.
export type SignoffCategory = "sg_manual" | "trust_reconciliation" | "other";
export type SignerScope = "all_staff" | "licensee_only";

export type SignoffDocument = {
  id: string;
  agency_id: string;
  category: SignoffCategory;
  title: string;
  period_label: string | null;
  file_path: string;
  file_name: string;
  notes: string | null;
  signer_scope: SignerScope;
  uploaded_by: string | null;
  created_at: string;
};

export type SignoffSignature = {
  id: string;
  document_id: string;
  agency_id: string;
  signer_id: string;
  typed_name: string | null;
  signed_at: string | null;
  created_at: string;
};

// Matches the CPD categories called out in the NSW obligation register:
// 'general' (the base 7hr/yr requirement), 'fair_trading_forum' and
// 'austrac_aml' (Class 1 agents only, on top of the 7 hours), and
// 'assistant_unit' (assistant agents, 3 units/yr from Cert IV — tracked as
// units, not hours, but stored in the same `hours` column for simplicity).
export type CpdCategory = "general" | "fair_trading_forum" | "austrac_aml" | "assistant_unit";

export type CpdRecord = {
  id: string;
  agency_id: string;
  profile_id: string;
  activity_name: string;
  category: CpdCategory;
  hours: number;
  completed_date: string;
  notes: string | null;
  source_session_id: string | null;
  created_by: string | null;
  created_at: string;
};

export type TrainingSession = {
  id: string;
  agency_id: string;
  title: string;
  session_date: string;
  is_cpd_eligible: boolean;
  cpd_hours: number | null;
  trainer_name: string | null;
  is_external: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type TrainingAttendance = {
  id: string;
  agency_id: string;
  session_id: string;
  profile_id: string;
  created_at: string;
};

export type InviteStatus = "pending" | "accepted" | "revoked";

export type AgencyInvite = {
  id: string;
  agency_id: string;
  email: string;
  full_name: string | null;
  is_licensee_in_charge: boolean;
  token: string;
  status: InviteStatus;
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
};

export type PropertyStage =
  | 0 // Listing set-up
  | 1 // Pre-market
  | 2 // On market
  | 3 // Campaign
  | 4 // Under offer
  | 5; // Settled

export const STAGE_LABELS: Record<PropertyStage, string> = {
  0: "Listing set-up",
  1: "Pre-market",
  2: "On market",
  3: "Campaign",
  4: "Under offer",
  5: "Settled",
};

export type PropertyType = "House" | "Unit" | "Townhouse" | "Duplex" | "Land";

export type Property = {
  id: string;
  agency_id: string;
  created_by: string;
  address: string;
  property_type: PropertyType;
  is_strata: boolean | null;
  is_tenanted: boolean | null;
  has_pool: boolean | null;
  agent_interest: boolean | null;
  stage: PropertyStage;
  test_mode: boolean;
  created_at: string;
  updated_at: string;
};

export type PropertyItemStatus = "open" | "done" | "flagged";

export type PropertyItem = {
  id: string;
  agency_id: string;
  property_id: string;
  item_key: string;
  status: PropertyItemStatus;
  event_date: string | null;
  recorded_at: string;
  data: Record<string, unknown>;
  evidence_path: string | null;
  extracted_date: string | null;
  completed_by: string | null;
  created_at: string;
};
