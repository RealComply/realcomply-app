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
  created_at: string;
};

export type Agency = {
  id: string;
  name: string;
  pi_insurer: string | null;
  pi_policy_number: string | null;
  pi_expiry: string | null;
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
