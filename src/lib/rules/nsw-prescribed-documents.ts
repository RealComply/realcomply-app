// The s52A prescribed documents — the list that must be attached to a contract
// for sale of residential land in NSW before it is offered for sale.
//
// Source: Conveyancing (Sale of Land) Regulation 2022, Schedule 1, Part 1,
// prescribed for s52A(2)(a) of the Conveyancing Act 1919 by cl 4 of that
// Regulation. Verified against the current consolidation (15 Aug 2025 version)
// on 15 Aug 2026.
//
// WHY THIS IS ITS OWN FILE. It belongs to the rules layer, not the engine. The
// obligation to attach documents to a contract exists in every state; only the
// list changes. When the second state is built, this file gets a sibling and
// the extraction/UI code that consumes it does not move.
//
// WHY IT MATTERS THAT THIS IS COMPLETE-ISH RATHER THAN A ROUND THREE. Until
// now the app checked for "planning certificate, sewer diagram, title/plan",
// which quietly dropped Schedule 1 item 4 — the registered dealings that create
// easements, covenants and restrictions. Almost every title in Sydney carries
// at least one, and a missing s88B instrument is one of the more common reasons
// a purchaser gets a right to rescind under cl 21(1)(a). Leaving it off the
// list meant the check could pass on a contract that was genuinely deficient.
//
// WHAT IS DELIBERATELY NOT HERE:
//   - The swimming pool certificate (Sch 1 item 15). It has its own compliance
//     item (b2), with the strata/community exemption logic that item 15(2)
//     requires. Listing it in both places would have the agent answer it twice.
//   - Off-the-plan disclosure statements (Sch 1 Part 2, via cl 13). A different
//     obligation on a different kind of sale; if the product takes on off-the-plan
//     it wants its own item, not a row bolted onto this one.
//   - Community, precinct and neighbourhood schemes (Sch 1 items 10–13) and
//     building management statements (item 14). Real, but rare enough in the
//     target market that carrying them would add rows almost every file has to
//     read past. The catch-all note on the item tells the agent that a scheme
//     property may carry more.
//
// NOTHING HERE DECIDES ANYTHING. The list drives what the AI is asked to look
// for and what the agent is shown; whether the contract is actually compliant
// is the solicitor's call and the licensee's sign-off.

export type PrescribedDocKey =
  | "planning_certificate"
  | "sewerage_diagram"
  | "property_certificate"
  | "registrar_plan"
  | "strata_certificates"
  | "strata_plan"
  | "strata_by_laws"
  | "title_dealings"
  | "prescribed_notices";

export type PrescribedDoc = {
  key: PrescribedDocKey;
  /** Shown to the agent. Plain English first, statutory name second. */
  label: string;
  /** Where it comes from, shown as the small grey line under the label. */
  source: string;
  /** Which properties it applies to. */
  appliesWhen: "always" | "strata" | "not-strata";
  /**
   * What it looks like inside a contract PDF. Handed to the model so "did you
   * find it" is a recognition task against concrete cues rather than a guess
   * from the document's name.
   */
  hint: string;
  /**
   * Set where the Regulation itself makes the document conditional, so a
   * "not found" is genuinely inconclusive rather than a deficiency. Surfaced
   * to the agent as softer wording.
   */
  conditional?: string;
};

export const NSW_PRESCRIBED_DOCUMENTS: PrescribedDoc[] = [
  {
    key: "planning_certificate",
    label: "Planning certificate",
    source: "Sch 1 item 1 — s10.7(2) certificate from the council",
    appliesWhen: "always",
    hint: "A council-issued certificate headed 'Planning Certificate' citing s10.7 of the Environmental Planning and Assessment Act 1979, listing zoning and the matters in Sch 2 of the EPA Regulation.",
  },
  {
    key: "sewerage_diagram",
    label: "Sewerage diagram",
    source: "Sch 1 item 2 — from the sewerage authority",
    appliesWhen: "always",
    hint: "A line diagram of the property showing sewer mains and the point of connection, usually issued by Sydney Water or Hunter Water. Sometimes titled 'Sewerage Service Diagram' or 'Diagram of services'.",
    conditional:
      "Only required if the sewerage authority makes one available in the ordinary course. Unsewered land will not have one.",
  },
  {
    key: "property_certificate",
    label: "Property certificate (title search)",
    source: "Sch 1 item 3(a)",
    appliesWhen: "not-strata",
    hint: "A folio of the Register / title search showing the folio identifier, registered proprietor, and the second schedule of dealings.",
  },
  {
    key: "registrar_plan",
    label: "Plan of the land",
    source: "Sch 1 item 3(b) — deposited plan issued by the Registrar-General",
    appliesWhen: "not-strata",
    hint: "The deposited plan (DP) drawing showing the lot's boundaries and dimensions.",
  },
  {
    key: "strata_certificates",
    label: "Property certificates for the lot and the common property",
    source: "Sch 1 item 6(a)",
    appliesWhen: "strata",
    hint: "Two title searches: one for the strata lot, one for the common property (the CP folio).",
  },
  {
    key: "strata_plan",
    label: "Strata plan showing the lot",
    source: "Sch 1 item 6(b)",
    appliesWhen: "strata",
    hint: "The registered strata plan (SP) drawing — floor plan and location plan sheets.",
  },
  {
    key: "strata_by_laws",
    label: "By-laws in force for the scheme",
    source: "Sch 1 item 6(c)",
    appliesWhen: "strata",
    hint: "The scheme's by-laws, either the model by-laws adopted or a registered consolidation, often as a change-of-by-laws dealing.",
  },
  {
    key: "title_dealings",
    label: "Registered dealings creating easements, covenants or restrictions",
    source: "Sch 1 items 4 and 5 — plus any memoranda they refer to",
    appliesWhen: "always",
    hint: "Copies of the instruments listed in the title's second schedule: s88B instruments, transfers granting easements, restrictions on use, positive covenants, and any memorandum (e.g. a registered memorandum number) those instruments incorporate.",
    conditional:
      "Only the dealings actually shown on the title need attaching. A title with a clean second schedule has none to attach.",
  },
  {
    key: "prescribed_notices",
    label: "The three prescribed notices",
    source: "Sch 1 item 16 — vendors and purchasers, smoke alarms, loose-fill asbestos",
    appliesWhen: "always",
    hint: "Three warning blocks, usually printed on the contract's front pages: 'IMPORTANT NOTICE TO VENDORS AND PURCHASERS', 'WARNING—SMOKE ALARMS', and 'WARNING—LOOSE-FILL ASBESTOS INSULATION'.",
    conditional:
      "Satisfied by the notices being printed in the contract itself, which the standard form does (cl 6(2)).",
  },
];

/** The documents that apply to one property. */
export function prescribedDocumentsFor(opts: { isStrata?: boolean | null }): PrescribedDoc[] {
  const strata = Boolean(opts.isStrata);
  return NSW_PRESCRIBED_DOCUMENTS.filter((d) =>
    d.appliesWhen === "always" ? true : d.appliesWhen === "strata" ? strata : !strata,
  );
}

export function getPrescribedDoc(key: string): PrescribedDoc | undefined {
  return NSW_PRESCRIBED_DOCUMENTS.find((d) => d.key === key);
}

export const PRESCRIBED_DOC_KEYS: string[] = NSW_PRESCRIBED_DOCUMENTS.map((d) => d.key);
