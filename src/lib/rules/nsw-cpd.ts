// NSW licence types and CPD: what the app keeps, and why it is so little.
//
// HISTORY
// -------
// 18 Aug 2026: the flat 7 hours for every licence holder was replaced by
// hours per category of practice, one category per person (0020), and the
// app showed "x/7 hrs" against it.
//
// 14 Oct 2026: Trent Lloyd holds residential sales, business broking and
// stock and station. With one category his CPD looked like a third of what he
// has to do. Adam: "We want an agent to be able to select which class of
// license they hold. And then when it comes to CPD points for the year, they
// simply tick whether or not they have completed what's relevant and then
// have the option of uploading their CPD certificate from whichever trainer
// they used. That's it. Keep it simple."
//
// So a person ticks their class and every type of licence they hold
// (profiles.licence_categories, 0073), and the CPD for the year is the tick
// (cpd_year_signoffs, 0023) with the certificate if they want to attach it.
// RealComply no longer states hours or topics: Fair Trading republishes them
// every year, they differ by licence type, and the licensee knows them.
// REMOVED 14 Oct 2026: CORE_HOURS, cpdRequirementFor, CpdRequirement and the
// notes that went with them.

import type { LicenceType } from "@/lib/types";

/** Every type of licence or certificate a person can tick (profiles.licence_categories, 0073). */
export type LicenceCategory =
  | "residential_sales"
  | "residential_property_management"
  | "buyers_agent"
  | "commercial"
  | "business_broking"
  | "onsite_short_term_rpm"
  | "strata"
  | "stock_and_station";

export const LICENCE_CATEGORY_LABELS: Record<LicenceCategory, string> = {
  residential_sales: "Residential sales",
  residential_property_management: "Residential property management",
  buyers_agent: "Buyers agent",
  commercial: "Commercial",
  business_broking: "Business broking",
  onsite_short_term_rpm: "Onsite (short-term) residential property management",
  strata: "Strata management",
  stock_and_station: "Stock and station",
};

/** Grouped the way Fair Trading groups them, in this order everywhere. */
export const LICENCE_CATEGORY_GROUPS: ReadonlyArray<{ title: string; categories: readonly LicenceCategory[] }> = [
  {
    title: "Real estate",
    categories: [
      "residential_sales",
      "residential_property_management",
      "buyers_agent",
      "commercial",
      "business_broking",
      "onsite_short_term_rpm",
    ],
  },
  { title: "Other categories", categories: ["strata", "stock_and_station"] },
];

const ALL: readonly LicenceCategory[] = LICENCE_CATEGORY_GROUPS.flatMap((g) => g.categories);

/** A person's ticks, cleaned: known types only, once each, in the standard order. */
export function cleanLicenceCategories(values: unknown): LicenceCategory[] {
  const given = Array.isArray(values) ? values : [];
  return ALL.filter((c) => given.includes(c));
}

export const LICENCE_LABELS: Record<LicenceType, string> = {
  class_1: "Class 1 licence",
  class_2: "Class 2 licence",
  certificate_of_registration: "Certificate of registration (assistant agent)",
};

/** "Class 1 licence · Residential sales · Business broking", for a card's subtitle. */
export function licenceSummary(person: { licence_type: LicenceType | null; licence_categories?: string[] | null }): string {
  const parts = [
    person.licence_type ? LICENCE_LABELS[person.licence_type] : "No licence on file",
    ...cleanLicenceCategories(person.licence_categories).map((c) => LICENCE_CATEGORY_LABELS[c]),
  ];
  return parts.join(" · ");
}
