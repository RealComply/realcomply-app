// Shared app types, mirroring supabase/migrations/0001_init.sql.
// Keep these in sync with the schema by hand for now; once the schema
// stabilises, generate these with `supabase gen types typescript`.

export type Profile = {
  id: string;
  agency_id: string;
  full_name: string | null;
  email: string;
  is_agent: boolean;
  is_licensee_in_charge: boolean;
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
