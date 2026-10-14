// NSW continuing professional development requirements: the rules layer.
//
// THE THING THAT MAKES THIS DIFFERENT FROM EVERY OTHER RULE WE HOLD
// -----------------------------------------------------------------
// CPD is not in the Regulation. The Property and Stock Agents Regulation 2022
// contains no CPD provisions at all. The whole requirement hangs off s 20(2)
// of the Act, which makes it a standing licence condition to comply with
// whatever "the Secretary issues and notifies from time to time" (max penalty
// 100 penalty units).
//
// So the ruleset is an ADMINISTRATIVE INSTRUMENT republished annually on an
// unversioned web page. It changes without any legislative amendment, without
// a commencement date, and without anything we could subscribe to. Two
// consequences, both load-bearing:
//   1. Each year's rules are held here as their own dated, versioned ruleset:
//      the CPD year, the source page, the date it was checked and the date it
//      must be re-checked by. Screens never hold a number or a topic; they ask
//      this file for the year they are showing.
//   2. A year we hold no ruleset for returns null, and the product says so.
//      It never carries last year's figures forward.
//
// HISTORY
// -------
// 18 Aug 2026: the flat 7 hours for every licence holder was replaced by hours
// per category of practice, with one category per person (0020).
// 14 Oct 2026 (Adam's brief; mockup approved): a person ticks every category
// and area they work in (0073), and each category brings its own minimum
// hours and compulsory topics. Trent Lloyd holds residential sales, business
// broking and stock and station; with one category his CPD showed a third of
// what he has to do. Residential property management is now published.
//
// REVERSAL, 14 Oct 2026. The 18 Aug note said a Class 1 holder owes "an
// accredited Fair Trading forum for each category they hold". Fair Trading's
// page, checked 14 Oct 2026, says a Class 1 holder attends ONE accredited
// forum a year (at least 5 hours), even with more than one licence. The
// ruleset below says one; nothing in the app counts forums per category.

import type { LicenceType } from "@/lib/types";

/** Every category of practice and real estate area a person can tick (profiles.cpd_categories, 0073). */
export type PracticeCategory =
  | "residential_sales"
  | "residential_property_management"
  | "buyers_agent"
  | "commercial"
  | "business_broking"
  | "onsite_short_term_rpm"
  | "strata"
  | "stock_and_station";

export const CPD_CATEGORY_LABELS: Record<PracticeCategory, string> = {
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
export const CPD_CATEGORY_GROUPS: ReadonlyArray<{ title: string; categories: readonly PracticeCategory[] }> = [
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

export const CPD_CATEGORIES: readonly PracticeCategory[] = CPD_CATEGORY_GROUPS.flatMap((g) => g.categories);

export function isCpdCategory(v: unknown): v is PracticeCategory {
  return typeof v === "string" && (CPD_CATEGORIES as readonly string[]).includes(v);
}

/** A person's ticks, cleaned: known categories only, once each, in the standard order. */
export function cleanCpdCategories(values: unknown): PracticeCategory[] {
  const given = Array.isArray(values) ? values : [];
  return CPD_CATEGORIES.filter((c) => given.includes(c));
}

export const LICENCE_LABELS: Record<LicenceType, string> = {
  class_1: "Class 1 licence",
  class_2: "Class 2 licence",
  certificate_of_registration: "Certificate of registration (assistant agent)",
};

/** The short form, for a card's subtitle: "Class 1 · Residential sales". */
export const LICENCE_SHORT_LABELS: Record<LicenceType, string> = {
  class_1: "Class 1",
  class_2: "Class 2",
  certificate_of_registration: "Assistant agent",
};

/** A compulsory topic, once, with every category it is compulsory for. */
export type CpdTopic = {
  /** Stored on cpd_records.topics (0073). Stable within the year's ruleset. */
  key: string;
  title: string;
  categories: readonly PracticeCategory[];
  /** Anything Fair Trading says about the topic itself, e.g. a minimum time. */
  note?: string;
};

export type CpdExtraKey = "accredited_forum" | "austrac_guide";

export type CpdRuleset = {
  /** "2026-27", the CPD year these rules are for. */
  cpdYear: string;
  /** Bumped whenever the rules here change within a year. */
  version: string;
  /** 1 July that starts the year, and 30 June that ends it. */
  yearStart: string;
  yearEnd: string;
  checkedOn: string;
  /** Fair Trading republishes ahead of 1 July; checking in May leaves time to update. */
  reviewBy: string;
  source: string;
  sourceUrl: string;
  /** Minimum hours per category. */
  hours: Record<PracticeCategory, number>;
  /** Each distinct compulsory topic once, in Fair Trading's order. */
  topics: readonly CpdTopic[];
  class1: {
    forum: { key: "accredited_forum"; title: string; minHours: number; note: string };
    austrac: { key: "austrac_guide"; title: string; note: string; categories: readonly PracticeCategory[] };
  };
  assistant: {
    units: number;
    /** Units owed by someone whose certificate started in the part-year window. */
    partYearUnits: number;
    /** Started on or after this date (and before exemptFrom): partYearUnits. "3 to 9 months before 30 June". */
    partYearFrom: string;
    note: string;
  };
  /** A licence or certificate that started on or after this date is exempt for the year. */
  exemptFrom: string;
  /** Years to keep the evidence. */
  retentionYears: { licence: number; certificate: number };
};

// ── 2026-27 ─────────────────────────────────────────────────────────────
//
// NSW Fair Trading, "Continuing Professional Development (CPD) requirements
// for property professionals", checked 14 Oct 2026. Hours and compulsory
// topics per category exactly as published, with each topic listed once and
// the categories it is compulsory for. A topic shared by two categories only
// needs doing once if the course covers each category's learning outcomes,
// which is the provider's to say: the card says so, and the person (or their
// licensee) can untick a category a course didn't cover.
const RS: PracticeCategory = "residential_sales";
const RPM: PracticeCategory = "residential_property_management";
const BA: PracticeCategory = "buyers_agent";
const COM: PracticeCategory = "commercial";
const BB: PracticeCategory = "business_broking";
const OS: PracticeCategory = "onsite_short_term_rpm";
const ST: PracticeCategory = "strata";
const SS: PracticeCategory = "stock_and_station";

export const CPD_RULESET_2026_27: CpdRuleset = {
  cpdYear: "2026-27",
  version: "2026-27.2",
  yearStart: "2026-07-01",
  yearEnd: "2027-06-30",
  checkedOn: "2026-10-14",
  reviewBy: "2027-05-01",
  source: "NSW Fair Trading, Continuing Professional Development (CPD) requirements for property professionals",
  sourceUrl:
    "https://www.nsw.gov.au/housing-and-construction/property-professionals/working-as-an-agent/continuing-professional-development",
  hours: {
    residential_sales: 7,
    residential_property_management: 7,
    buyers_agent: 7,
    commercial: 7,
    business_broking: 7,
    onsite_short_term_rpm: 4,
    strata: 6,
    stock_and_station: 7,
  },
  topics: [
    // Residential sales
    { key: "auction_laws", title: "Auction laws and practice", categories: [RS, BA, SS] },
    { key: "contracts", title: "Contracts", categories: [RS, BA, SS] },
    { key: "rules_of_conduct", title: "Rules of Conduct refresher", categories: [RS, COM] },
    { key: "supervision_aml", title: "Supervision Guidelines and AML CTF in agency practice", categories: [RS, BA, COM, BB, SS] },
    // Residential property management (published; replaces "not published yet")
    { key: "repairs_habitability", title: "Repairs, maintenance and habitability", categories: [RPM] },
    { key: "tenancy_reforms", title: "Residential tenancy, revisit reforms plus common mistakes", categories: [RPM] },
    { key: "domestic_family_violence", title: "Domestic and Family Violence", categories: [RPM], note: "At least 4 hours." },
    // Buyers agents
    { key: "buyers_marketing_scope", title: "Marketing services, scope of practice and licensing obligations", categories: [BA] },
    // Commercial
    { key: "fire_safety", title: "Fire safety regulations", categories: [COM] },
    { key: "commercial_gst", title: "GST in commercial property transactions", categories: [COM] },
    // Business broking
    { key: "relationships_negotiation", title: "Establishing and managing relationships and negotiation skills", categories: [BB] },
    { key: "business_broker_ethics", title: "Ethical practice for business brokers", categories: [BB] },
    // Onsite (short-term) residential property management
    { key: "conflict_complaints", title: "Conflict resolution and complaint management", categories: [OS] },
    { key: "managing_relationships", title: "Establishing and managing relationships", categories: [OS] },
    // Strata (and onsite)
    { key: "strata_regulatory_change", title: "Regulatory change in strata", categories: [OS, ST] },
    { key: "strata_repairs", title: "Repairs and maintenance", categories: [ST] },
    { key: "strata_roles_risk", title: "Roles, authority and risk", categories: [ST] },
    // Stock and station
    { key: "safety_risk", title: "Safety risk management", categories: [SS] },
  ],
  class1: {
    forum: {
      key: "accredited_forum",
      title: "Fair Trading accredited forum (at least 5 hours)",
      minHours: 5,
      // REVERSAL of the 18 Aug 2026 note ("one per category"). See the top of this file.
      note: "One forum a year, even with more than one licence.",
    },
    austrac: {
      key: "austrac_guide",
      title: "AUSTRAC: Smart real estate agent's guide to AML/CTF",
      note: "Separate from the forum. Keep the completion certificate.",
      categories: [RS, BA, COM, BB, SS],
    },
  },
  assistant: {
    units: 3,
    partYearUnits: 1,
    // 9 months before 30 June 2027. Started from here to 31 March 2027: 1 unit.
    partYearFrom: "2026-09-30",
    note: "Units from the Certificate IV in Real Estate Practice. Extra units carry over to next year.",
  },
  // Not if the licence or certificate recommenced after a suspension with a
  // CPD condition: the card says so, since RealComply doesn't hold suspensions.
  exemptFrom: "2027-04-01",
  retentionYears: { licence: 3, certificate: 4 },
};

const RULESETS: readonly CpdRuleset[] = [CPD_RULESET_2026_27];

/** The rules for the CPD year starting on yearStart (YYYY-07-01), or null if RealComply doesn't hold them. */
export function cpdRulesetFor(yearStart: string): CpdRuleset | null {
  return RULESETS.find((r) => r.yearStart === yearStart) ?? null;
}

/** Topic keys a certificate can carry for the year: the compulsory topics, the forum and the AUSTRAC guide. */
export function cpdTopicKeys(ruleset: CpdRuleset): string[] {
  return [...ruleset.topics.map((t) => t.key), ruleset.class1.forum.key, ruleset.class1.austrac.key];
}

/** The title a topic key stands for in the year's ruleset. */
export function cpdTopicTitle(ruleset: CpdRuleset, key: string): string | null {
  if (key === ruleset.class1.forum.key) return ruleset.class1.forum.title;
  if (key === ruleset.class1.austrac.key) return ruleset.class1.austrac.title;
  return ruleset.topics.find((t) => t.key === key)?.title ?? null;
}

/**
 * How CPD may be delivered. Face-to-face is NOT mandatory: a live
 * interactive webinar with assessment qualifies. Self-paced eLearning does
 * not satisfy the compulsory topics.
 */
export const CPD_DELIVERY_NOTE =
  "Compulsory topics must be delivered face-to-face or by live interactive webinar with assessment. Self-paced online modules don't satisfy them.";

/**
 * What actually earns CPD. The test is the PROVIDER and the CONTENT, not the
 * venue: an approved provider delivering an approved topic at your own office
 * DOES count, and your own internal session does NOT, wherever it is held.
 */
export const CPD_PROVIDER_NOTE =
  "Only Fair Trading approved providers can deliver CPD. Your own internal training doesn't count, but an approved provider delivering at your office does, so the venue isn't the test.";
