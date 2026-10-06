// RealComply — NSW residential property management (PM) rules, first version.
//
// Brief: claude/RealComply-PM-build-brief-6-Oct.md (Part A). Design source of
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
//      the Exit list below (the note and reminder come in Part B).
//   3. Fit to live in, Smoke alarms working, and Locks and security sit in
//      Stage 3, not Stage 1. Pool or spa certificate sits in Stage 2.
//   4. Bond lodged on time sits in Stage 3. It is not a clock.
//   5. Stage 4 has no clocks. Inspections, rent increases, statements,
//      repairs, breaches, water billing and the smoke alarm annual check are
//      all left to the office's own system.
//   6. A lighter pet recorder exists in Stage 2 (addendum). Part B.
//
// Known gaps, deliberately not "fixed" by guessing: the help lines were checked
// against the Acts and Fair Trading's pages, not the Regulation text. A
// correction is a one-line change here.

export const PM_RULESET_VERSION = "nsw-pm-2026-10-06";

// ── Groups a property sits in ──────────────────────────────────────────────
// In order: a property only ever moves forward through these in Part A.
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
      // "Water usage" (RTA s39(1)) belongs here. It is three questions asked one
      // at a time, which is Part B. Left out of Part A on purpose (brief A8).
    ],
  },
  {
    stage: 4,
    title: "Ongoing tenancy",
    cadence: "no finish line",
    scope: "tenancy",
    ongoing: true,
    opensIn: "tenanted",
    // REVERSAL 5, 6 Oct 2026: no clocks. The "When it happens" rows and pet
    // requests come in Part B.
    items: [],
  },
  {
    stage: 5,
    title: "Exit",
    cadence: "every tenancy",
    scope: "tenancy",
    opensIn: "tenant_vacating",
    // Plain ticks in Part A. The wording for each termination ground comes in
    // Part B. REVERSAL 2, 6 Oct 2026: "File kept 3 years" is not here; it is a
    // note and a reminder.
    items: [
      {
        key: "termination_ground",
        title: "Termination on a listed ground",
        help: "In writing, on a listed ground, and genuine",
        reference: "RTA ss82, 84 to 87M",
        naAllowed: true,
      },
      {
        key: "notice_period",
        title: "Correct notice period",
        help: "The minimum notice for that ground",
        reference: "RTA ss87C to 87M",
        naAllowed: true,
      },
      {
        key: "termination_statement",
        title: "Termination statement and supporting documents",
        help: "Given with the notice",
        reference: "RTA s85",
        naAllowed: true,
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
        help: "Date recorded if the ground carries one",
        reference: "RTA s87",
        naAllowed: true,
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
// tenancy on, an existing property runs like any other (Part B).
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

// ── Moving between groups (the simple Part A version, brief A9) ────────────
export type PmMove = {
  from: PmGroup;
  to: PmGroup;
  label: string;
  /** The date this move asks for, and where it is stored on the tenancy. Null: confirm only. */
  date: { label: string; field: "move_in_date" | "vacate_date" | "move_out_date" } | null;
  /** Stages that must be complete before the button works. */
  needs: PmStageNumber[];
};

export const PM_MOVES: PmMove[] = [
  { from: "onboarding", to: "for_lease", label: "Put up for lease", date: null, needs: [1] },
  {
    from: "for_lease",
    to: "tenanted",
    label: "Tenant has moved in",
    date: { label: "Move-in date", field: "move_in_date" },
    needs: [2, 3],
  },
  {
    from: "tenanted",
    to: "tenant_vacating",
    label: "Tenant is vacating",
    date: { label: "Vacate date", field: "vacate_date" },
    needs: [],
  },
  // Not gated on Exit. The final inspection, bond claim and survey happen
  // around and after move-out, so the Exit stage stays open in Vacant.
  {
    from: "tenant_vacating",
    to: "vacant",
    label: "Tenant has moved out",
    date: { label: "Move-out date", field: "move_out_date" },
    needs: [],
  },
];

export function pmMoveFrom(group: PmGroup): PmMove | null {
  return PM_MOVES.find((m) => m.from === group) ?? null;
}

// ── Wording used on screen ─────────────────────────────────────────────────
export const PM_COPY = {
  beforeRealComply: "Before RealComply",
  beforeRealComplyBody:
    "This happened before the property came to RealComply. RealComply does not record it as done.",
  ongoingBeforeMoveIn: "Starts when the tenant moves in",
  /** {system} is the office's records system, or a fallback when it is not named yet. */
  ongoingBody: (system: string) =>
    `Nothing to tick here. Inspections, rent increases, statements and repairs are kept in ${system}.`,
  recordsFallback: "your own system",
} as const;
