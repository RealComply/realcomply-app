// RealComply — NSW residential property management (PM) rules, first version.
//
// Brief: claude/RealComply-PM-build-brief-6-Oct.md (Parts A and B). Design source of
// truth: claude/RealComply-PM-design-decisions-6-Oct.md and its addendum; the
// legal checks behind the wording are in claude/RealComply-PM-legal-checks-6-Oct.md.
//
// CONTENT ONLY. Every title, help line and legal reference PM shows lives here
// and nowhere else, beside the sales rules (nsw-sales.ts), so another state is
// a content job. The engine that reads it (locking, counting, moves) is
// pm-engine.ts and knows nothing about NSW.
//
// Standing rules every item here has to fit (Adam, 4 to 6 Oct 2026):
//   1. Legal obligations only. No best-practice items, not even optional ones.
//   2. RealComply holds no PM documents. No upload, no attach. A tick records
//      who confirmed it and when; the record stays in the office's own system.
//   3. Never ask for something the office's own system already records.
//   4. The office names its records system once. Nothing is asked per item.
//   5. The items are locked. The office cannot edit, add, hide or reorder them.
//   6. Diligence support. The licensee decides. Never the word "compliant".
//
// ⚠️ REVERSALS, 6 Oct 2026. Do not quietly undo these.
//   1. PM holds at a stage like sales does. It was briefly "move on with items
//      open". Now a later stage is locked until every earlier stage is
//      complete (pm-engine.ts).
//   2. "File kept 3 years" is a note and a reminder, not a tick. It is not in
//      the Exit list below; see PM_RETENTION and the daily reminder job.
//   3. Fit to live in, Smoke alarms working, and Locks and security sit in
//      Stage 3, not Stage 1. Pool or spa certificate sits in Stage 2.
//   4. Bond lodged on time sits in Stage 3. It is not a clock.
//   5. Stage 4 has no clocks. Inspections, rent increases, statements,
//      repairs, breaches, water billing and the smoke alarm annual check are
//      all left to the office's own system.
//   6. A lighter pet recorder exists in Stage 2 (addendum): PM_PET_APPLICATION.
//
// Known gaps, deliberately not "fixed" by guessing: the help lines were checked
// against the Acts and Fair Trading's pages, not the Regulation text. A
// correction is a one-line change here.

export const PM_RULESET_VERSION = "nsw-pm-2026-10-06";

// ── Groups a property sits in ──────────────────────────────────────────────
// In the order of one tenancy. Re-leasing (Part B) starts a new tenancy back
// at For lease.
export const PM_GROUPS = [
  { key: "onboarding", label: "Onboarding" },
  { key: "for_lease", label: "For lease" },
  { key: "tenanted", label: "Tenanted" },
  { key: "tenant_vacating", label: "Tenant vacating" },
  { key: "vacant", label: "Vacant" },
  { key: "archived", label: "Archived" },
] as const;

export type PmGroup = (typeof PM_GROUPS)[number]["key"];

export function pmGroupLabel(group: PmGroup): string {
  return PM_GROUPS.find((g) => g.key === group)?.label ?? group;
}

export function isPmGroup(value: unknown): value is PmGroup {
  return PM_GROUPS.some((g) => g.key === value);
}

/** Position in the group order, so "has the property reached X" is a comparison. */
export function pmGroupOrder(group: PmGroup): number {
  return PM_GROUPS.findIndex((g) => g.key === group);
}

// ── Stages ─────────────────────────────────────────────────────────────────
export type PmStageNumber = 1 | 2 | 3 | 4 | 5;

export type PmItem = {
  key: string;
  title: string;
  help: string;
  reference: string;
  /** The N/A button is offered. Only on items that can truly not apply. */
  naAllowed?: boolean;
  /**
   * Exit items whose wording depends on who ended the tenancy and on what
   * ground (brief B1). See pmExitItem().
   */
  exitRole?: "notice" | "noticePeriod" | "statement" | "exclusion";
  /** Not a plain tick: answered through questions (water usage, brief B5). */
  kind?: "water";
};

export type PmStage = {
  stage: PmStageNumber;
  title: string;
  /** The small line beside the title: how often the stage comes round. */
  cadence: string;
  /** 'property': done once per property (onboarding). 'tenancy': every tenancy. */
  scope: "property" | "tenancy";
  /** The stage has no count and no finish line of its own (Stage 4). */
  ongoing?: boolean;
  /** The group from which this stage can be worked. */
  opensIn: PmGroup;
  items: PmItem[];
};

export const PM_STAGES: PmStage[] = [
  {
    stage: 1,
    title: "Management onboarding",
    cadence: "once per property",
    scope: "property",
    opensIn: "onboarding",
    items: [
      {
        key: "mgmt_agreement",
        title: "Management agreement signed",
        help: "In writing, with the required terms and the limits of your authority",
        reference: "PSA Act s55; PSA Reg s9, Sch 2 s26, Sch 5, Sch 10",
      },
      {
        key: "mgmt_copy_served",
        title: "Agreement copy served on the landlord",
        help: "Within 48 hours of signing",
        reference: "PSA Act s55(1)(b)",
      },
      {
        key: "landlord_inspection_report",
        title: "Inspection report given to the landlord",
        help: "Condition of the property and any work still to be done",
        reference: "PSA Reg Sch 2 s19",
      },
      {
        key: "landlord_info_statement",
        title: "Landlord information statement",
        help: "Landlord has confirmed in writing they have read it",
        reference: "RTA s31A",
      },
    ],
  },
  {
    stage: 2,
    title: "Getting a tenant in",
    cadence: "every tenancy",
    scope: "tenancy",
    opensIn: "for_lease",
    items: [
      { key: "fixed_rent", title: "Advertised at a fixed rent", help: "No invitation to offer more", reference: "RTA s22A" },
      {
        key: "ad_pets",
        title: "Ad does not rule out pets",
        help: "A pet can only be refused in reply to a tenant's pet request, on a listed ground. Not in the ad",
        reference: "RTA s73H",
      },
      {
        key: "material_facts",
        title: "Material facts disclosed",
        help: "Nothing misleading, and no listed material fact hidden",
        reference: "RTA s26(1)",
      },
      {
        key: "pre_signing_disclosures",
        title: "Disclosures before signing",
        help: "Sale contract, mortgagee action, strata renewal. Strata by-laws given",
        reference: "RTA s26(2) to (3)",
      },
      {
        key: "inspections_accompanied",
        title: "Inspections accompanied",
        help: "Keys not handed over without written authority",
        reference: "PSA Reg Sch 2 s20",
      },
      {
        key: "no_applicant_fees",
        title: "No fees charged to applicants",
        help: "Only a holding fee, rent, bond and any registration fee",
        reference: "RTA s23",
      },
      {
        key: "holding_fee",
        title: "Holding fee handled correctly",
        help: "After approval, no more than 1 week of rent, receipt given",
        reference: "RTA s24",
        naAllowed: true,
      },
      {
        key: "tenancy_db_notice",
        title: "Tenancy database notice",
        help: "Written notice within 7 days if the applicant was listed",
        reference: "RTA s211",
        naAllowed: true,
      },
      {
        key: "standard_lease",
        title: "Lease on the standard form",
        help: "In writing, no prohibited terms",
        reference: "RTA ss14, 15, 19, 21",
      },
      {
        key: "tenant_info_statement",
        title: "Tenant information statement given",
        help: "Given before signing",
        reference: "RTA s26(4)",
      },
      {
        key: "landlord_agent_details",
        title: "Landlord and agent details given",
        help: "Names and contact details on the lease",
        reference: "RTA s27",
      },
      {
        key: "lease_copy",
        title: "Lease copy given to the tenant",
        help: "A copy at signing, then the fully signed copy",
        reference: "RTA s28",
      },
      // REVERSAL 3, 6 Oct 2026: moved here from Stage 1 after the legal check.
      // A copy is given when the tenancy agreement is signed.
      {
        key: "pool_certificate",
        title: "Pool or spa certificate",
        help: "Copy of a certificate issued in the last 3 years, given to the tenant at signing. Not needed in a strata scheme of more than 2 lots",
        reference: "RT Reg Sch 1 cl 45; Swimming Pools Act 1992",
        naAllowed: true,
      },
    ],
  },
  {
    stage: 3,
    title: "Money and move-in",
    cadence: "every tenancy",
    scope: "tenancy",
    opensIn: "for_lease",
    items: [
      // REVERSAL 3, 6 Oct 2026: these three moved here from Stage 1. They apply
      // at the start of every tenancy and cannot be confirmed while the
      // previous tenant is still in the property.
      { key: "fit_to_live", title: "Fit to live in", help: "Clean, and meets the 7 minimum standards", reference: "RTA s52" },
      { key: "smoke_alarms", title: "Smoke alarms working", help: "Working at the start of the tenancy", reference: "RTA s64A" },
      { key: "locks_security", title: "Locks and security", help: "Property is reasonably secure", reference: "RTA s70(1)" },
      {
        key: "condition_report",
        title: "Condition report given",
        help: "Completed before the lease was given for signing",
        reference: "RTA s29",
      },
      { key: "keys_given", title: "Keys given", help: "A set for every named tenant, for every lock", reference: "RTA s70(2) to (3)" },
      {
        key: "rent_payment_options",
        title: "Rent payment options offered",
        help: "Bank transfer and Centrepay, fee-free",
        reference: "RTA s35",
      },
      {
        key: "bond_limit",
        title: "Bond within the limit",
        help: "No more than 4 weeks of rent. Tenant invited to pay through Rental Bonds Online first",
        reference: "RTA s159",
      },
      // REVERSAL 4, 6 Oct 2026: stays here, not a Stage 4 clock. The bond is
      // paid before keys are released, nearly always straight to Rental Bonds
      // Online, so there is usually nothing for the agent to lodge.
      {
        key: "bond_lodged",
        title: "Bond lodged on time",
        help: "If you received the bond yourself: within 10 business days after the end of that month",
        reference: "RTA s162",
        naAllowed: true,
      },
      // Up to three questions, one at a time (brief B5). Asked again for each
      // new tenancy. Never the word "certificate": the law requires the
      // measures, not a certificate (legal checks, correction 3).
      {
        key: "water_usage",
        title: "Water usage",
        help: "Charged only if separately metered and the water efficiency measures are met",
        reference: "RTA s39(1)",
        kind: "water",
      },
    ],
  },
  {
    stage: 4,
    title: "Ongoing tenancy",
    cadence: "no finish line",
    scope: "tenancy",
    ongoing: true,
    opensIn: "tenanted",
    // REVERSAL 5, 6 Oct 2026: no clocks. Nothing to tick: the "When it
    // happens" rows and pet requests are records (PM_EVENT_RECORDS,
    // PM_PET_REQUEST), pressed as often as they happen.
    items: [],
  },
  {
    stage: 5,
    title: "Exit",
    cadence: "every tenancy",
    scope: "tenancy",
    opensIn: "tenant_vacating",
    // The first three and the last are worded for who ended the tenancy and
    // the ground (brief B1, pmExitItem below). The wording here is the
    // fallback for a tenancy recorded before that was asked. REVERSAL 2,
    // 6 Oct 2026: "File kept 3 years" is not here; it is a note and a reminder.
    items: [
      {
        key: "termination_ground",
        title: "Termination notice given to the tenant",
        help: "In writing and signed, on a listed ground, and genuine",
        reference: "RTA ss82, 84 to 87M",
        naAllowed: true,
        exitRole: "notice",
      },
      {
        key: "notice_period",
        title: "Correct notice period",
        help: "The minimum notice for that ground",
        reference: "RTA ss87C to 87M",
        naAllowed: true,
        exitRole: "noticePeriod",
      },
      {
        key: "termination_statement",
        title: "Termination statement and supporting documents given",
        help: "Given with the notice",
        reference: "RTA ss85, 86",
        naAllowed: true,
        exitRole: "statement",
      },
      {
        key: "dv_termination",
        title: "Domestic violence termination",
        help: "Co-tenants notified within 7 days",
        reference: "RTA Part 5 Div 3A",
        naAllowed: true,
      },
      {
        key: "final_inspection",
        title: "Final inspection",
        help: "With the tenant present where possible. Condition report completed",
        reference: "PSA Reg Sch 2 s24; RTA s29",
      },
      { key: "bond_claim", title: "Bond claim", help: "Through Rental Bonds Online", reference: "PSA Reg Sch 2 s25; RTA ss163, 165" },
      {
        key: "exit_survey",
        title: "End-of-tenancy survey",
        help: "In Rental Bonds Online within 14 days of the first bond claim",
        reference: "RTA s222A",
      },
      {
        key: "tenancy_db_listing",
        title: "Tenancy database listing",
        help: "Only if it qualified. Corrected within 7 days if wrong",
        reference: "RTA ss212 to 214",
        naAllowed: true,
      },
      {
        key: "reletting_exclusion",
        title: "Re-letting exclusion period",
        help: "Cannot be re-let for that period after the termination date, without Fair Trading approval",
        reference: "RTA ss87E to 87M",
        naAllowed: true,
        exitRole: "exclusion",
      },
    ],
  },
];

export function pmStage(stage: PmStageNumber): PmStage {
  const found = PM_STAGES.find((s) => s.stage === stage);
  if (!found) throw new Error(`No PM stage ${stage}`);
  return found;
}

/** The stage an item belongs to, or null for a key that is not in the rules. */
export function pmItemStage(itemKey: string): PmStage | null {
  return PM_STAGES.find((s) => s.items.some((i) => i.key === itemKey)) ?? null;
}

export function pmItem(itemKey: string): PmItem | null {
  for (const s of PM_STAGES) {
    const found = s.items.find((i) => i.key === itemKey);
    if (found) return found;
  }
  return null;
}

// ── How a property comes to RealComply ─────────────────────────────────────
// "Before RealComply" stages are greyed, cannot be ticked, and count as
// complete for locking. RealComply never records them as done. From the next
// tenancy on, an existing property runs like any other: a new tenancy has no
// "Before RealComply" stages.
export const PM_ORIGINS = [
  {
    key: "new",
    label: "New management",
    startsIn: "onboarding",
    hasOnboarding: true,
    beforeStages: [] as PmStageNumber[],
  },
  {
    key: "existing_tenanted",
    label: "Existing, tenanted",
    startsIn: "tenanted",
    hasOnboarding: false,
    beforeStages: [2, 3] as PmStageNumber[],
  },
  {
    key: "existing_vacant",
    label: "Existing, vacant",
    startsIn: "vacant",
    hasOnboarding: false,
    beforeStages: [2, 3, 5] as PmStageNumber[],
  },
] as const satisfies readonly {
  key: string;
  label: string;
  startsIn: PmGroup;
  hasOnboarding: boolean;
  beforeStages: PmStageNumber[];
}[];

export type PmOrigin = (typeof PM_ORIGINS)[number]["key"];

export function pmOrigin(origin: PmOrigin) {
  return PM_ORIGINS.find((o) => o.key === origin)!;
}

export function isPmOrigin(value: unknown): value is PmOrigin {
  return PM_ORIGINS.some((o) => o.key === value);
}

// ── Who ended the tenancy, and the ground (brief B1) ───────────────────────
export const PM_ENDED_BY = [
  { key: "tenant", label: "Tenant" },
  { key: "landlord", label: "Landlord" },
] as const;

export type PmEndedBy = (typeof PM_ENDED_BY)[number]["key"];

export function isPmEndedBy(value: unknown): value is PmEndedBy {
  return PM_ENDED_BY.some((e) => e.key === value);
}

export type PmTerminationGround = {
  key: string;
  label: string;
  /** "Minimum notice: [notice]". */
  notice: string;
  /** "The termination information statement, plus [documents]". Null: none named. */
  documents: string | null;
  /** "Cannot be re-let for [exclusion] ...". Null: none (the item is N/A). "depends": the agent checks. */
  exclusion: string | null | "depends";
  reference: string;
};

// From the brief's table (B1) and the legal checks of 6 Oct 2026. "Sold" and
// "to be offered for sale" are two grounds, not one (legal checks, correction 1).
export const PM_TERMINATION_GROUNDS = [
  {
    key: "owner_moving_in",
    label: "Owner/family member moving in",
    notice: "90 days, or 60 if the fixed term is 6 months or less",
    documents: "the landlord's signed statement, and the family member's if they are the one moving in",
    exclusion: "6 months",
    reference: "RTA s87M",
  },
  {
    key: "sold_vacant_possession",
    label: "Property sold, contract needs vacant possession",
    notice: "30 days",
    documents: "a copy of the contract for sale, or a statement from the solicitor or conveyancer",
    exclusion: null,
    reference: "RTA s87D",
  },
  {
    key: "offered_for_sale",
    label: "Property to be offered for sale",
    notice: "90 days, or 60 if the fixed term is 6 months or less",
    documents: "the proposed contract for sale or the selling agency agreement",
    exclusion: "6 months",
    reference: "RTA s87E",
  },
  {
    key: "renovation",
    label: "Renovation",
    notice: "90 days, or 60 if the fixed term is 6 months or less",
    documents: "the landlord's signed statement on the works and why the property must be vacant",
    exclusion: "4 weeks",
    reference: "RTA s87F",
  },
  {
    key: "breach",
    label: "Tenant breach or arrears",
    notice: "14 days",
    documents: null,
    exclusion: null,
    reference: "RTA s87C",
  },
  {
    key: "other_ground",
    label: "Another listed ground",
    notice: "the minimum for that ground",
    documents: "the documents that ground requires",
    exclusion: "depends",
    reference: "RTA ss87C to 87M",
  },
] as const satisfies readonly PmTerminationGround[];

export type PmGroundKey = (typeof PM_TERMINATION_GROUNDS)[number]["key"];

export function isPmGround(value: unknown): value is PmGroundKey {
  return PM_TERMINATION_GROUNDS.some((g) => g.key === value);
}

export function pmGround(key: PmGroundKey): PmTerminationGround {
  return PM_TERMINATION_GROUNDS.find((g) => g.key === key)!;
}

/** An Exit item as it reads for this tenancy. `auto`: marked N/A by RealComply, with the reason. */
export type PmResolvedItem = PmItem & { auto: { note: string } | null };

/**
 * The wording of an Exit item once RealComply knows who ended the tenancy and
 * on what ground (brief B1). The tenant ending it: the three termination items
 * and the exclusion period are N/A, noted as "Tenant ended it". The landlord:
 * worded for the ground, with no N/A, except the exclusion where the ground
 * carries none. Nothing known yet (a tenancy from before this was asked): the
 * fallback wording, with N/A offered as before.
 */
export function pmExitItem(
  item: PmItem,
  endedBy: PmEndedBy | null,
  groundKey: PmGroundKey | null,
): PmResolvedItem {
  if (!item.exitRole || !endedBy) return { ...item, auto: null };
  if (endedBy === "tenant") return { ...item, auto: { note: PM_COPY.tenantEndedIt } };
  if (!groundKey) return { ...item, auto: null };
  const g = pmGround(groundKey);
  switch (item.exitRole) {
    case "notice":
      return { ...item, help: `In writing and signed, on the ground: ${g.label}`, naAllowed: false, auto: null };
    case "noticePeriod":
      return { ...item, help: `Minimum notice: ${g.notice}`, reference: g.reference, naAllowed: false, auto: null };
    case "statement":
      return {
        ...item,
        help: g.documents
          ? `The termination information statement, plus ${g.documents}`
          : "The termination information statement",
        naAllowed: false,
        auto: null,
      };
    case "exclusion":
      if (g.exclusion === null) return { ...item, auto: { note: PM_COPY.noExclusion } };
      if (g.exclusion === "depends") {
        return {
          ...item,
          help: "Cannot be re-let for the period that ground carries, if any, after the termination date, without Fair Trading approval",
          naAllowed: true,
          auto: null,
        };
      }
      return {
        ...item,
        help: `Cannot be re-let for ${g.exclusion} after the termination date, without Fair Trading approval`,
        reference: g.reference,
        naAllowed: false,
        auto: null,
      };
  }
}

// ── Management has ended (brief B3) ────────────────────────────────────────
export const PM_MANAGEMENT_ENDED_REASONS = [
  { key: "owner_moving_in", label: "Owner/family member moving in" },
  { key: "sold", label: "Property sold" },
  { key: "renovation", label: "Renovation" },
  { key: "another_agent", label: "Moved to another agent" },
] as const;

export type PmManagementEndedReason = (typeof PM_MANAGEMENT_ENDED_REASONS)[number]["key"];

export function isPmManagementEndedReason(value: unknown): value is PmManagementEndedReason {
  return PM_MANAGEMENT_ENDED_REASONS.some((r) => r.key === value);
}

export function pmManagementEndedLabel(key: string): string {
  return PM_MANAGEMENT_ENDED_REASONS.find((r) => r.key === key)?.label ?? key;
}

// ── Keeping the file 3 years (brief B4) ────────────────────────────────────
// REVERSAL 2, 6 Oct 2026: a note and an email, never a tick. PSA Act s104(2):
// records kept at least 3 years. The same for every way a management ends,
// "Moved to another agent" included (s104(3) does not clearly release the
// outgoing agent; legal checks, still open 4).
export const PM_RETENTION_YEARS = 3;

/** The date the file may be kept until: 3 years after the move-out or end date. */
export function pmRetentionUntil(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  // A 29 February rolls to 1 March, which is never early.
  const out = new Date(Date.UTC(y + PM_RETENTION_YEARS, m - 1, d));
  return out.toISOString().slice(0, 10);
}

// ── Water usage, three questions (brief B5) ────────────────────────────────
export type PmWaterAnswers = { metered?: boolean; charged?: boolean; evidence?: boolean };

export const PM_WATER_QUESTIONS = [
  { key: "metered", text: "Is the property separately metered?" },
  { key: "charged", text: "Is the tenant being charged for water usage?" },
  { key: "evidence", text: "Is there evidence on file that the property meets the water efficiency measures?" },
] as const;

export type PmWaterQuestionKey = (typeof PM_WATER_QUESTIONS)[number]["key"];

export type PmWaterResult = {
  /** done: the item is finished. open: still to answer, or "No" to the third question. */
  state: "done" | "open";
  /** The next question to ask, or null when the answers so far finish it or leave it blocked. */
  next: PmWaterQuestionKey | null;
  /** The line shown under the item. Null while questions are still to answer. */
  line: string | null;
};

/** What the answers so far mean. The server checks them with this before saving. */
export function pmWaterResult(a: PmWaterAnswers): PmWaterResult {
  if (a.metered === undefined) return { state: "open", next: "metered", line: null };
  if (a.metered === false) return { state: "done", next: null, line: "Not separately metered. Water usage is not charged." };
  if (a.charged === undefined) return { state: "open", next: "charged", line: null };
  if (a.charged === false) return { state: "done", next: null, line: "Tenant is not charged for water usage." };
  if (a.evidence === undefined) return { state: "open", next: "evidence", line: null };
  if (a.evidence === true) {
    return { state: "done", next: null, line: "Separately metered, tenant charged, and evidence of the water efficiency measures is on file." };
  }
  return { state: "open", next: null, line: "Water cannot be charged until the property meets the water efficiency measures." };
}

/** Only the answers that were actually asked, in order. Anything after a finishing answer is dropped. */
export function pmWaterClean(raw: unknown): PmWaterAnswers | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: PmWaterAnswers = {};
  for (const q of PM_WATER_QUESTIONS) {
    const v = r[q.key];
    if (v === undefined) break;
    if (typeof v !== "boolean") return null;
    out[q.key] = v;
    if (pmWaterResult(out).next === null) break;
  }
  return out;
}

// ── Records, pressed as often as they happen ───────────────────────────────
// Stage 4, "When it happens" (brief B6). Each press records the person and time.
export const PM_EVENT_RECORDS = [
  {
    key: "property_sold",
    title: "Property being sold",
    help: "Tenant told in writing when it is listed. After the sale, notice naming the purchaser",
    reference: "PSA Reg Sch 2 s23; RTA s76",
  },
  {
    key: "advertising_photos",
    title: "Photos for advertising",
    help: "7 days notice before taking them. Written consent before publishing",
    reference: "RTA ss55(2)(d1), 55A",
  },
  {
    key: "details_change",
    title: "Landlord or agent details change",
    help: "Tenant told within 14 days",
    reference: "RTA s27",
  },
] as const;

export type PmEventRecordKind = (typeof PM_EVENT_RECORDS)[number]["key"];

// The six grounds for refusing a pet, in plain words (RTA s73F). Used for a
// tenant's pet request and, as the cautious practice, for a pet on the
// application (addendum).
export const PM_PET_GROUNDS = [
  { key: "too_many", label: "Too many animals at the property" },
  { key: "unsuitable", label: "Property unsuitable: fencing, open space, or the animal could not be kept humanely" },
  { key: "damage_over_bond", label: "Likely damage would cost more than the bond to repair" },
  { key: "landlord_lives_there", label: "The landlord lives at the property" },
  { key: "against_rules", label: "Against a law, council order, strata by-law or community rule" },
  { key: "condition_refused", label: "Tenant did not agree to a reasonable condition" },
] as const;

export type PmPetGroundKey = (typeof PM_PET_GROUNDS)[number]["key"];

export function isPmPetGround(value: unknown): value is PmPetGroundKey {
  return PM_PET_GROUNDS.some((g) => g.key === value);
}

export function pmPetGroundLabel(key: string): string {
  return PM_PET_GROUNDS.find((g) => g.key === key)?.label ?? key;
}

// Stage 4, a signed tenant's pet request (brief B6).
export const PM_PET_REQUEST = {
  title: "Pet requests",
  help: "Reply in writing on the approved form within 21 days. Refuse only on a listed ground",
  reference: "RTA ss73D, 73F",
  replyDays: 21,
  outcomes: [
    { key: "consent", label: "Consent given" },
    { key: "consent_conditions", label: "Consent given with conditions" },
    { key: "refused", label: "Refused" },
  ],
  refusedKey: "refused",
} as const;

// Stage 2, a pet on the application (addendum, brief B7). Lighter on purpose:
// no 21-day deadline, no "response given", and no wording that says the law
// requires anything at this stage. Whether the six grounds bind at
// application stage is unconfirmed; using only them is the cautious practice.
export const PM_PET_APPLICATION = {
  title: "Pet on the application",
  help: "If an applicant asks about a pet, record what was agreed before signing",
  outcomes: [
    { key: "agreed", label: "Agreed before signing" },
    { key: "agreed_conditions", label: "Agreed with conditions" },
    { key: "declined", label: "Declined" },
  ],
  refusedKey: "declined",
} as const;

export type PmPetOutcome =
  | (typeof PM_PET_REQUEST.outcomes)[number]["key"]
  | (typeof PM_PET_APPLICATION.outcomes)[number]["key"];

export function pmPetOutcomeLabel(key: string): string {
  return (
    [...PM_PET_REQUEST.outcomes, ...PM_PET_APPLICATION.outcomes].find((o) => o.key === key)?.label ?? key
  );
}

/** The reply deadline for a pet request: 21 days after it was received. */
export function pmPetReplyBy(receivedIso: string): string {
  const [y, m, d] = receivedIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + PM_PET_REQUEST.replyDays)).toISOString().slice(0, 10);
}

// ── Moving between groups (brief A9, B1 to B3) ─────────────────────────────
export type PmMove = {
  key: string;
  from: PmGroup;
  to: PmGroup;
  label: string;
  /**
   * What the move asks for. confirm: a Confirm button only. date: one date,
   * stored on the tenancy. vacating: the vacate date and who is ending it
   * (B1). managementEnded: the date and the reason (B3).
   */
  asks: "confirm" | "date" | "vacating" | "managementEnded";
  /** For a date: its label and where it is stored on the tenancy. */
  date: { label: string; field: "move_in_date" | "vacate_date" | "move_out_date" } | null;
  /** Stages that must be complete before the button works. */
  needs: PmStageNumber[];
  /** Starts a new tenancy for the next tenant (B2). The old one is kept, never overwritten. */
  newTenancy?: boolean;
  /** Shown as the main button. The others sit beside it, quieter. */
  primary?: boolean;
};

export const PM_MOVES: PmMove[] = [
  { key: "lease", from: "onboarding", to: "for_lease", label: "Put up for lease", asks: "confirm", date: null, needs: [1], primary: true },
  {
    key: "moved_in",
    from: "for_lease",
    to: "tenanted",
    label: "Tenant has moved in",
    asks: "date",
    date: { label: "Move-in date", field: "move_in_date" },
    needs: [2, 3],
    primary: true,
  },
  {
    key: "vacating",
    from: "tenanted",
    to: "tenant_vacating",
    label: "Tenant is vacating",
    asks: "vacating",
    date: { label: "Vacate date", field: "vacate_date" },
    needs: [],
    primary: true,
  },
  // Not gated on Exit. The final inspection, bond claim and survey happen
  // around and after move-out, so the Exit stage stays open in Vacant.
  {
    key: "moved_out",
    from: "tenant_vacating",
    to: "vacant",
    label: "Tenant has moved out",
    asks: "date",
    date: { label: "Move-out date", field: "move_out_date" },
    needs: [],
    primary: true,
  },
  // Offices often advertise before the old tenant has gone (Adam, 6 Oct). The
  // old tenant's Exit moves to its own section (brief B2). The brief asks for
  // nothing here; a Confirm step is kept because the move cannot be undone.
  { key: "lease_now", from: "tenant_vacating", to: "for_lease", label: "Put up for lease now", asks: "confirm", date: null, needs: [], newTenancy: true },
  { key: "lease_again", from: "vacant", to: "for_lease", label: "Put back up for lease", asks: "confirm", date: null, needs: [], newTenancy: true, primary: true },
  { key: "management_ended", from: "vacant", to: "archived", label: "Management has ended", asks: "managementEnded", date: null, needs: [] },
];

/** Every move offered from this group, the main one first. */
export function pmMovesFrom(group: PmGroup): PmMove[] {
  return PM_MOVES.filter((m) => m.from === group).sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));
}

export function pmMove(key: string): PmMove | null {
  return PM_MOVES.find((m) => m.key === key) ?? null;
}

// ── Wording used on screen ─────────────────────────────────────────────────
export const PM_COPY = {
  beforeRealComply: "Before RealComply",
  beforeRealComplyBody:
    "This happened before the property came to RealComply. RealComply does not record it as done.",
  ongoingBeforeMoveIn: "Starts when the tenant moves in",
  ongoingClosed: "This tenancy has ended. What was recorded is kept below.",
  /** {system} is the office's records system, or a fallback when it is not named yet. */
  ongoingBody: (system: string) =>
    `Nothing to tick here. Inspections, rent increases, statements and repairs are kept in ${system}.`,
  recordsFallback: "your own system",
  tenantEndedIt: "Tenant ended it",
  noExclusion: "No exclusion period for this ground",
  outgoingTitle: "Outgoing tenant: Exit",
  outgoingNotOut: "The outgoing tenant has to move out first.",
  /** The note under a move-out (brief B4). */
  retentionTenant: (until: string) => `Keep this tenant's file until ${until}. RealComply will email you a reminder then.`,
  retentionManagement: (until: string) =>
    `Keep this management's file until ${until}. RealComply will email you a reminder then.`,
  /** The reminder email's own words (brief B4). Never "can" or "should" be deleted. */
  retentionEmail: "The 3-year period for this file has passed. Whether to keep or destroy it is your decision.",
} as const;
