// Shared app types, mirroring supabase/migrations/0001_init.sql.
// Keep these in sync with the schema by hand for now; once the schema
// stabilises, generate these with `supabase gen types typescript`.

// Plan and BillingStatus live in lib/billing/entitlement.ts rather than here,
// beside the ladder they belong to and the rules that read them. Imported so
// the Agency row below is typed by the same two unions the rest of billing
// uses, instead of a second copy that can drift.
import type { BillingStatus, Plan } from "@/lib/billing/entitlement";

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
  /**
   * RealComply staff, not agency staff. Cross-agency: may set an agency's plan
   * and status and comp an account. Granted in SQL only — see migration 0044.
   */
  is_platform_admin?: boolean;
  // An assistant prepares files for one or more agents and cannot sign them
  // (Adam, 20 Aug 2026). Deliberately a separate flag rather than a value of
  // some role enum: someone can be a licensee AND an agent already, and the
  // three answer different questions — whose listings are these, who may sign
  // off the agency's records, and who is working on someone else's behalf.
  //
  // is_agent is false for an assistant: it drives "whose listing is this"
  // throughout the app, and an assistant has none of their own.
  is_assistant: boolean;
  /**
   * Works in property management (0095): Property management first in their
   * menu. Still an agent, and can still list sales. Optional until 0095 is run.
   */
  is_property_manager?: boolean;
  licence_type: LicenceType | null;
  licence_number: string | null;
  licence_expiry: string | null;
  licence_document_path: string | null;
  licence_document_file_name: string | null;
  /** What the last read of the licence document found and where each value
   *  came from (0051). Parse with parseReadState in lib/licence-read.ts. */
  licence_read?: unknown;
  /** The single category of 0020, superseded by licence_categories (0073). Kept as it was; never read. */
  cpd_practice_category?: string | null;
  /**
   * Every type of licence or certificate the person holds, ticked on their
   * licence card (0073), as rules/nsw-cpd.ts names them. Optional only until
   * 0073 has run.
   */
  licence_categories?: string[];
  /** Set when the licensee removes someone who has left the office (0035).
   *  Archived, never deleted: their signatures, CPD records and the listings
   *  they ran are the compliance history, and the person leaving does not
   *  change what they did. current_agency_id() returns null for them, so every
   *  agency-scoped policy in the database fails closed at once. */
  archived_at: string | null;
  archived_by: string | null;
  created_at: string;
};

export type Agency = {
  id: string;
  /** The trading name: the name clients know the office by (0070). */
  name: string;
  /** The company that holds the corporation licence (0070). */
  licensed_entity_name?: string | null;
  /** 'licence' when read from the corporation licence, 'typed' otherwise. */
  licensed_entity_name_source?: "licence" | "typed" | null;
  /** In an agent on their own plan's annexure download link (0070). */
  annexure_download_token?: string | null;
  /** Agent acknowledgement and the annexure lock (0071). Off for offices made before it. */
  annexure_gate?: boolean;
  pi_insurer: string | null;
  pi_policy_number: string | null;
  pi_expiry: string | null;
  cyber_insurer: string | null;
  cyber_policy_number: string | null;
  cyber_expiry: string | null;
  // The corporation's own licence — the entity holds one in its own right,
  // separate from each person's Class 1/2 licence in profiles. See
  // 0015_corporation_licence.sql.
  website_url: string | null;
  corporation_licence_holder: string | null;
  corporation_licence_number: string | null;
  corporation_licence_expiry: string | null;
  /** The corporation licence as uploaded, and what reading it found (0051). */
  corporation_licence_document_path?: string | null;
  corporation_licence_document_file_name?: string | null;
  corporation_licence_read?: unknown;
  icare_insurer: string | null;
  icare_policy_number: string | null;
  icare_expiry: string | null;
  /** Each policy's certificate of currency or schedule on file, and what
   *  reading it found (0076; see lib/insurance-read.ts). */
  pi_document_path?: string | null;
  pi_document_file_name?: string | null;
  pi_read?: unknown;
  cyber_document_path?: string | null;
  cyber_document_file_name?: string | null;
  cyber_read?: unknown;
  icare_document_path?: string | null;
  icare_document_file_name?: string | null;
  icare_read?: unknown;
  gift_threshold: number;
  complaint_resolution_target_days: number;
  // The agency's position on AUSTRAC pre-commencement customers — see
  // 0018_aml_precommencement.sql and lib/rules/aml-precommencement.ts.
  // Off unless the licensee has turned it on.
  aml_precommencement_enabled: boolean;
  // Billing (0036, and 0040 for the agent tiers). The plan and status decide
  // what the agency may do; Stripe writes to them and never the other way
  // round, which is why they are ordinary columns here rather than something
  // looked up live. See lib/billing/entitlement.ts.
  plan: Plan;
  status: BillingStatus;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  comped_by: string | null;
  comped_reason: string | null;
  comped_until: string | null;
  // When the subscription ended (0054). Set by the database when status moves
  // to canceled, cleared on reactivation, never set for a protected agency.
  // See lib/subscription-end/.
  ended_at?: string | null;
  ended_notice_sent_at?: string | null;
  ended_reminder_sent_at?: string | null;
  legal_hold?: boolean;
  legal_hold_reason?: string | null;
  legal_hold_set_at?: string | null;
  created_at: string;
};

// The three agency-level insurance policies tracked in the Insurance
// register — same insurer/policy-number/expiry shape, different legal
// grounding and column prefix on the `agencies` row.
export type InsurancePolicyType = "pi" | "cyber" | "icare";

// Other insurance an office adds under the three (0078, 16 Oct 2026).
// CHANGE (Adam, 16 Oct 2026): removed Motor vehicle and Office contents and
// business. Not Fair Trading requirements; CTP comes with car registration.
// Offices can still add them under Other.
export type OtherInsuranceKind = "public_liability" | "other";

/** One added policy (insurance_policies, 0078). Never deleted: removed_at takes it off the register. */
export type InsurancePolicy = {
  id: string;
  agency_id: string;
  kind: OtherInsuranceKind;
  /** The office's own name for it; always set for "other". */
  name: string | null;
  insurer: string | null;
  policy_number: string | null;
  expiry: string | null;
  document_path: string | null;
  document_file_name: string | null;
  read: unknown;
  created_by: string | null;
  created_at: string;
  removed_at: string | null;
  removed_by: string | null;
};

/** A policy as one history row holds it, before or after a change (0076). */
export type InsuranceSnapshot = {
  insurer: string | null;
  policyNumber: string | null;
  expiry: string | null;
  documentPath: string | null;
  documentFileName: string | null;
};

/** One change to a policy, written by the database (insurance_history, 0076). */
export type InsuranceHistoryRow = {
  id: string;
  agency_id: string;
  /** "other" for an added policy (0078), with its id in policy_id. */
  policy_type: InsurancePolicyType | "other";
  policy_id?: string | null;
  source: "document_read" | "typed" | "document_removed" | "policy_removed";
  before: Partial<InsuranceSnapshot>;
  after: Partial<InsuranceSnapshot>;
  changed_by: string | null;
  changed_at: string;
};

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

// Breach / corrective-actions register — Supervision Guidelines Req 3.
// See supabase/migrations/0012_breach_register.sql for the design note and
// the s89 (trust account overdrawn) notification clock that `notifiable` /
// `notified_date` exist to track.
export type BreachStatus = "open" | "action_taken" | "closed";
export type BreachSeverity = "minor" | "material" | "serious";
export type BreachCategory =
  | "pricing"
  | "agency_agreement"
  | "material_facts"
  | "trust_account"
  | "advertising"
  | "record_keeping"
  | "conduct"
  | "supervision"
  | "other";

// The words the Breach register shows for each category. Moved here from
// BreachesPanel (10 Oct 2026) so the printed export says "Trust account", not
// the stored key "trust_account": a "use client" file's constants can't be
// read by the server-rendered export page.
export const BREACH_CATEGORY_LABELS: Record<BreachCategory, string> = {
  pricing: "Pricing / underquoting",
  agency_agreement: "Agency agreement",
  material_facts: "Material facts",
  trust_account: "Trust account",
  advertising: "Advertising",
  record_keeping: "Record keeping",
  conduct: "Conduct",
  supervision: "Supervision",
  other: "Other",
};

// One row per expiry reminder actually sent (licences, and since 0088
// insurance) — see 0019_licence_reminders.sql and 0088. Read-only from the app: the daily cron writes
// them through the service client, and the register displays the most recent
// one so the office can see the reminders are running.
// Annual training plan — Requirement 2.4 of the NSW Supervision Guidelines.
// One per person per CPD year. See 0020_training_plans.sql.
export type TrainingPlan = {
  id: string;
  agency_id: string;
  profile_id: string;
  cpd_year_start: string;
  valid_from: string | null;
  valid_to: string | null;
  consultation_date: string | null;
  identified_gaps: string | null;
  required_hours: number | null;
  required_units: number | null;
  requirement_note: string | null;
  staff_signed_name: string | null;
  staff_signed_at: string | null;
  principal_signed_name: string | null;
  principal_signed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TrainingPlanClassification = "compulsory" | "elective";
export type TrainingDeliveryType = "face_to_face" | "interactive_webinar" | "online_unit" | "other";

export type TrainingPlanItem = {
  id: string;
  agency_id: string;
  plan_id: string;
  program_name: string;
  classification: TrainingPlanClassification;
  delivery_type: TrainingDeliveryType | null;
  training_hours: number | null;
  provider: string | null;
  // True only for approved-provider CPD. Completing an item writes a CPD
  // record only when this is set — internal training lives on the plan but
  // never accrues CPD hours. See 0021_cpd_provider_gate.sql.
  counts_toward_cpd: boolean;
  gap_reason: string | null;
  due_date: string | null;
  completed_date: string | null;
  evidence_path: string | null;
  evidence_file_name: string | null;
  cpd_record_id: string | null;
  sort_order: number;
  created_at: string;
};

export type LicenceReminder = {
  id: string;
  agency_id: string;
  // "profile" and "corporation" are licences; since 0088 also
  // insurance_pi, insurance_cyber, insurance_icare and insurance_policy, and
  // any kind added later (lib/email/licence-reminders.ts, EXPIRY_SOURCES).
  subject_kind: string;
  profile_id: string | null;
  // 0088: which added policy (or other row) it was about. Absent before 0088.
  subject_id?: string | null;
  expiry_date: string;
  threshold_days: number;
  recipients: string[];
  sent_at: string;
};

// 0084_cpd_reminders.sql. One row per CPD deadline reminder sent. Read-only
// from the app: the daily job writes them through the service client.
export type CpdReminder = {
  id: string;
  agency_id: string;
  /** The person reminded, or for a summary the licensee it went to. */
  profile_id: string;
  kind: "person" | "summary";
  cpd_year_start: string;
  send_date: string;
  /** Who was on a summary's list. Empty for a person reminder. */
  outstanding: string[];
  recipients: string[];
  sent_at: string;
};

// 0090_announcement_sends.sql. One row per office per one-off announcement
// from the staff page. Service key only: no one signed in can read it.
export type AnnouncementSend = {
  id: string;
  announcement: string;
  agency_id: string;
  /** The licensee in charge it went to. */
  profile_id: string | null;
  office_name: string;
  recipient_name: string | null;
  recipient: string;
  status: "sending" | "sent" | "failed";
  created_at: string;
  sent_at: string | null;
};

export type Breach = {
  id: string;
  agency_id: string;
  identified_date: string;
  description: string;
  category: BreachCategory;
  severity: BreachSeverity;
  agent_id: string | null;
  property_id: string | null;
  corrective_action: string | null;
  corrective_action_date: string | null;
  notifiable: boolean;
  notified_date: string | null;
  status: BreachStatus;
  closed_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

// Document sign-offs — see supabase/migrations/0009_document_signoffs.sql
// for the full design note. 'other' exists so a one-off document can be
// published without inventing a new category.
// 'sg_annexure' is the signed copy of the SG annexure, filed by the server when
// the licensee adopts it (0067). Nobody signs it in the app.
export type SignoffCategory =
  | "sg_manual"
  | "trust_reconciliation"
  | "sg_annexure"
  // An agent's own plan (0071): their "Before you start" acknowledgement, and the
  // annexure their licensee in charge signed, as uploaded.
  | "agent_acknowledgement"
  | "sg_annexure_licensee_signed"
  | "other";

/** One adoption of the SG annexure (0067). Read by the licensee only. */
export type SgAnnexureAdoption = {
  id: string;
  agency_id: string;
  annexure_version: string;
  signed_name: string;
  licence_number: string;
  sent_to: string;
  signed_at: string;
  signoff_document_id: string | null;
};
/** An agent in an office confirming they read the adopted annexure and the SG (0069). */
export type SgReadConfirmation = {
  id: string;
  agency_id: string;
  confirmed_by: string | null;
  annexure_version: string;
  confirmed_at: string;
};
/** What an agent on their own plan confirmed on "Before you start" (0071). */
export type AgentAcknowledgement = {
  id: string;
  agency_id: string;
  profile_id: string | null;
  agent_licence_number: string;
  agency_name: string;
  licensee_name: string;
  licensee_licence_number: string;
  wording_version: string;
  /** The five boxes, in order, as shown. */
  wording: string[];
  typed_name: string;
  confirmed_at: string;
  signoff_document_id: string | null;
};

export type SignerScope = "all_staff" | "licensee_only";

export type SignoffDocument = {
  id: string;
  agency_id: string;
  category: SignoffCategory;
  title: string;
  period_label: string | null;
  /**
   * For a trust reconciliation, the first day of the month it covers. Null on
   * every other category, and null on rows written before 0031 whose free-text
   * label could not be parsed. What makes a missing month knowable.
   */
  period_month: string | null;
  /** For a trust reconciliation, which account it reconciles. Null elsewhere. */
  trust_account_id: string | null;
  file_path: string;
  file_name: string;
  /**
   * The uploaded document with a signature page appended, written when the
   * licensee signs. Null until then, and null where the upload could not be
   * opened as a PDF — in that case the signature is a standalone certificate
   * at this same path. Either way, the original at file_path is untouched.
   */
  signed_file_path: string | null;
  signed_file_name: string | null;
  notes: string | null;
  signer_scope: SignerScope;
  uploaded_by: string | null;
  created_at: string;
};

// The annual trust account audit — s111 (audit within 3 months of the period
// ending) and s112 (the period is the year ending 30 June) of the Property and
// Stock Agents Act 2002 (NSW). One row per audit period.
// One trust account the agency operates. s86 contemplates several — "a trust
// account (whether general or separate)" — and the usual split is sales and
// property management (Adam, 25 Aug 2026).
export type TrustAccount = {
  id: string;
  agency_id: string;
  name: string;
  /** Closed accounts are archived, never removed: their reconciliations are
   *  still records the agency has to keep. */
  archived_at: string | null;
  created_at: string;
  /** The day the account opened, when it opened part way through a year. Null
   *  means it was already open: every month and audit is owed. Optional until
   *  supabase/migrations/0060_check_fixes.sql has run. */
  opened_on?: string | null;
};

export type TrustAudit = {
  id: string;
  agency_id: string;
  /** Which account this audit covers. One audit per account per year
   *  (Adam, 25 Aug 2026: "annual audit is 1 per account"). */
  trust_account_id: string | null;
  /** 30 June of the audit year. */
  period_end: string;
  auditor_name: string | null;
  report_received_on: string | null;
  file_path: string | null;
  file_name: string | null;
  /** Who confirmed the audit was carried out, and when. Not a bare boolean —
   *  a tick with nobody's name against it is not a record of anything. */
  confirmed_by: string | null;
  confirmed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
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
  /** Null when the certificate does not state them (0051). Counts as nothing. */
  hours: number | null;
  /** Null when no date could be read (0051). Never defaulted to today. */
  completed_date: string | null;
  // The approved provider who delivered it — what makes the record count at
  // all. An entry with no provider can't be shown to qualify as CPD.
  // See 0022_cpd_provider_evidence.sql.
  provider: string | null;
  // The provider's record of completion, which Fair Trading requires the
  // agent to hold and keep (3 years; 4 for a statement of attainment).
  evidence_path: string | null;
  evidence_file_name: string | null;
  notes: string | null;
  source_session_id: string | null;
  created_by: string | null;
  created_at: string;
  // The name printed on the certificate, kept only when it wasn't the
  // person's name and someone answered "Yes, it's theirs" (0074, 15 Oct 2026).
  name_on_certificate?: string | null;
  name_confirmed_by?: string | null;
  name_confirmed_at?: string | null;
};

// Per person, per CPD year: the confirmation the year is done. The
// certificates are the evidence; this is the tick. No row = not confirmed.
// See 0023_cpd_year_signoff.sql.
export type CpdYearSignoff = {
  id: string;
  agency_id: string;
  profile_id: string;
  cpd_year_start: string;
  confirmed_by: string | null;
  confirmed_at: string;
  created_at: string;
};

export type TrainingSession = {
  id: string;
  agency_id: string;
  title: string;
  session_date: string;
  is_cpd_eligible: boolean;
  cpd_hours: number | null;
  // The Fair Trading approved provider who delivered it. No provider, no CPD
  // — an internal session records attendance and nothing else.
  cpd_provider: string | null;
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
  /** Invited as an assistant (0025). No role flag set means invited as an agent. */
  is_assistant: boolean;
  /** Invited as office manager, approved on the invite by the licensee in charge (0095). */
  is_office_manager?: boolean;
  /** The words the licensee ticked, and when (0095). */
  office_manager_wording?: string | null;
  office_manager_authorised_at?: string | null;
  /** Invited as a property manager (0095). */
  is_property_manager?: boolean;
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
  | 4 // Sold
  | 5; // Settled

// Stage 4 renamed from "Under offer" to "Sold" (Adam, 17 Aug 2026).
//
// The old name described the wrong moment. "Under offer" reads as an accepted
// offer — a deal that may still evaporate in cooling off or on finance — and
// the stage actually begins at exchange: e1, the 2-business-day contract
// service, is the first thing in it. Naming it "Sold" is what makes the
// purchaser AML check sit correctly, because a check run on a hopeful buyer
// who never exchanges is money spent and personal data held for nothing.
export const STAGE_LABELS: Record<PropertyStage, string> = {
  0: "Listing set-up",
  1: "Pre-market",
  2: "On market",
  3: "Campaign",
  4: "Sold",
  5: "Settled",
};

export type PropertyType = "House" | "Unit" | "Townhouse" | "Duplex" | "Land";

export type SaleMethod = "private_treaty" | "auction";

// Which agents an assistant supports. The row IS the grant — no row, no
// access. Only the licensee in charge can create or remove one.
export type AssistantAgent = {
  id: string;
  agency_id: string;
  assistant_id: string;
  agent_id: string;
  created_by: string | null;
  created_at: string;
};

// What the agent records at the fall of the hammer. The one structured
// answer on the auction-day sheet, and the input to everything downstream:
// sold moves the file on, passed_in keeps it on market and carries the
// highest bid into the pricing logic, withdrawn pauses it.
export type AuctionOutcomeKind = "sold" | "passed_in" | "withdrawn";

export type AuctionOutcomeData = {
  outcome?: AuctionOutcomeKind;
  price?: number | null;
  bidderNumber?: string | null;
  highestBid?: number | null;
  vendorBid?: boolean;
  reason?: string | null;
  phoneBidder?: boolean;
};

export type Property = {
  id: string;
  agency_id: string;
  created_by: string;
  address: string;
  property_type: PropertyType;
  is_strata: boolean | null;
  is_tenanted: boolean | null;
  has_pool: boolean | null;
  // Captured at listing set-up (0041). Every one optional — a file opened
  // before anyone has measured the block is a normal file, it just has less to
  // compare against. Internal area exists as a column for files that already
  // carry it, but nothing asks for it any more (Adam, 7 Sep 2026).
  bedrooms: number | null;
  bathrooms: number | null;
  car_spaces: number | null;
  land_size_sqm: number | null;
  agent_interest: boolean | null;
  // Public URL of the agency's own listing page, read by the daily
  // advertised-price check. See 0016_listing_url.sql.
  listing_url: string | null;
  // How the property is being sold. Everything auction-specific hangs off
  // this one field — see 0024_auction.sql and the x-series items in
  // rules/nsw-sales.ts. auction_date is nullable because a listing very often
  // goes to auction before the date is set; null means TBC, not missing.
  sale_method: SaleMethod;
  auction_date: string | null;
  auction_time: string | null;
  auction_venue: string | null;
  // Set when an assistant hands the file to the agent to review and sign.
  // NOT a sign-off — it records that the assistant finished their part and
  // asked the agent to look. Only the agent's signature attests to the file.
  review_requested_at: string | null;
  review_requested_by: string | null;
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
