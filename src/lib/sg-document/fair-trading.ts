// What Fair Trading's Supervision Guidelines ask of an office's operational
// procedures (NSW Fair Trading, Supervision Guidelines, Property and Stock
// Agents Act 2002, in force commencing 1 July 2024). Read from Fair Trading's
// own document in Adam's Drive (NSW Fair Trading folder), 10 Nov 2026.
//
// 2.1.3 Requirements: "Operational procedures prepared and maintained in
// accordance with Supervision Requirement 2 must: a. exist separately from the
// Supervision Guidelines and identify the agency business or group of agency
// businesses to which they apply, b. identify the licensee in charge with
// responsibility for the procedures, and c. identify the laws that are
// relevant to the conduct of the agency business (or businesses) that are
// covered by the procedures, by considering the following Acts and
// Regulations/subordinate instruments made under those Acts, at a minimum".

/**
 * 2.1.2 Guidance, word for word, for the annual review (part 4; Master, 10
 * Nov 2026: "Quote 2.1.2 word for word from Fair Trading's Supervision
 * Guidelines in Drive"). Three paragraphs, then the four critical areas.
 */
export const SG_2_1_2 = {
  source: "NSW Fair Trading, Supervision Guidelines, 2.1.2",
  paragraphs: [
    "Supervision Requirement 2 is a requirement to establish procedures designed to ensure that the provisions of the Act and any other laws relevant to the conduct of that business are complied with.",
    "A failure to prepare and maintain operational procedures for this purpose is an offence.",
    "Operational procedures should be reviewed and appropriately revised at least every 12 months to ensure they remain current and emerging risks are addressed. In drafting their operational procedures, licensees in charge should identify key risks to non-compliance with laws applicable to the business, in four critical areas:",
  ],
  areas: ["financial", "licensing", "qualifications, education and training", "professional conduct within the business"],
} as const;

/**
 * The 22 Acts in 2.1.3(c), named as Fair Trading names them, each with the
 * words that find it in a document. Matched without the year, so "Privacy
 * Act" counts for "Privacy Act 1988 (Commonwealth)".
 */
export const SG_2_1_3_ACTS: ReadonlyArray<{ name: string; match: string[] }> = [
  { name: "Property and Stock Agents Act 2002", match: ["property and stock agents act"] },
  { name: "Strata Schemes Management Act 2015", match: ["strata schemes management act"] },
  { name: "Strata Schemes Development Act 2015", match: ["strata schemes development act"] },
  { name: "Community Land Management Act 2021", match: ["community land management act"] },
  { name: "Community Land Development Act 2021", match: ["community land development act"] },
  { name: "Residential Tenancies Act 2010", match: ["residential tenancies act"] },
  { name: "Conveyancing Act 1919", match: ["conveyancing act"] },
  { name: "Real Property Act 1900", match: ["real property act"] },
  { name: "Retail Leases Act 1994", match: ["retail leases act"] },
  { name: "Swimming Pools Act 1992", match: ["swimming pools act"] },
  { name: "Electronic Transactions Act 2000", match: ["electronic transactions act"] },
  { name: "Uncollected Goods Act 1995", match: ["uncollected goods act"] },
  { name: "Work Health and Safety Act 2011", match: ["work health and safety act"] },
  { name: "Environmental Planning and Assessment Act 1979", match: ["environmental planning and assessment act"] },
  { name: "Design and Building Practitioners Act 2020", match: ["design and building practitioners act"] },
  {
    name: "Australian Consumer Law, under the Competition and Consumer Act 2010 (Commonwealth)",
    match: ["australian consumer law", "competition and consumer act"],
  },
  { name: "Fair Trading Act 1987", match: ["fair trading act"] },
  { name: "Anti-Discrimination Act 1977", match: ["anti discrimination act"] },
  { name: "Privacy Act 1988 (Commonwealth)", match: ["privacy act"] },
  { name: "Prevention of Cruelty to Animals Act 1979", match: ["prevention of cruelty to animals act"] },
  { name: "Biosecurity Act 2015 (NSW and Commonwealth)", match: ["biosecurity act"] },
  {
    name: "Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Commonwealth)",
    match: ["anti money laundering and counter terrorism financing act", "aml ctf act"],
  },
];

/** The three kinds of document in the mockup (Adam, 6 Nov 2026): exactly one is picked. */
export const SG_DOC_TYPES = {
  sg_and_procedures: "Supervision guidelines and procedures manual",
  sg: "Supervision guidelines",
  procedures: "Procedures manual",
} as const;

export type SgDocType = keyof typeof SG_DOC_TYPES;

export function isSgDocType(v: unknown): v is SgDocType {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SG_DOC_TYPES, v);
}
