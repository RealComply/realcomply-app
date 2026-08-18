// NSW continuing professional development requirements — the rules layer.
//
// WHY THIS FILE EXISTS AT ALL (and why it isn't three constants)
// -------------------------------------------------------------
// Until 18 Aug 2026 the app applied a flat 7 hours to every Class 1 and
// Class 2 holder (see the old CPD_HOURS_REQUIRED_AGENT in lib/cpd-year.ts).
// That is wrong, and it was wrong on screen: every staff card showed a
// progress bar reading "x/7 hrs" for people whose actual requirement is 4, 6
// or 7 depending on what they practise, and for Class 1 holders whose
// requirement is their category's hours PLUS an accredited forum on top.
//
// Verified 18 Aug 2026 against NSW Fair Trading's published CPD requirements
// for the 2026–27 CPD year. Full research note, with sources and the list of
// things Fair Trading has NOT published, is in the project doc
// RealComply-NSW-CPD-requirements-2026-27.md.
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
// a commencement date, and without anything we could subscribe to. It already
// changed materially this year: commercial, business broking and stock &
// station went 5 → 7 hours, strata went from 4 hours + a TAFE module to 6,
// AML/CTF entered the compulsory syllabus alongside Tranche 2, and
// residential tenancy reforms dropped out.
//
// Two consequences, both load-bearing:
//   1. Everything here carries a checked-on date and a review-by date, and
//      the UI shows them. A number with no date is a liability.
//   2. Where Fair Trading has not published a figure, this file returns null
//      and the product says "Fair Trading hasn't published this yet." It must
//      never infer one. Training providers are currently restating last
//      year's figures — one tells Class 1 and 2 holders they can do 10 hours
//      online, which directly contradicts the delivery rule below.

import type { CpdPracticeCategory, LicenceType } from "@/lib/types";

export type { CpdPracticeCategory };

/** When this ruleset was last checked against Fair Trading, and by when it must be re-checked. */
export const CPD_RULESET = {
  cpdYear: "2026–27",
  checkedOn: "2026-08-18",
  // Fair Trading republishes ahead of the 1 July year start. Checking in May
  // gives time to update before anyone's plan is built on last year's numbers.
  reviewBy: "2027-05-01",
  source: "NSW Fair Trading — Continuing professional development requirements",
  sourceUrl:
    "https://www.nsw.gov.au/housing-and-construction/property-professionals/working-as-an-agent/continuing-professional-development",
} as const;

export const CPD_PRACTICE_CATEGORY_LABELS: Record<CpdPracticeCategory, string> = {
  residential_sales: "Residential sales / buyer's agent",
  commercial: "Commercial",
  business_broking: "Business broking",
  stock_and_station: "Stock & station",
  strata: "Strata management",
  onsite_short_term_rpm: "On-site short-term residential property management",
  residential_property_management: "Residential property management",
};

/**
 * Core hours per category for the 2026–27 year, or null where Fair Trading
 * has not published a figure.
 *
 * residential_property_management is null on purpose: Fair Trading's page
 * says the requirement is "currently being finalised". Showing a guess there
 * would be worse than showing nothing, because a property manager would
 * complete it and believe they were done.
 */
const CORE_HOURS: Record<CpdPracticeCategory, number | null> = {
  residential_sales: 7,
  commercial: 7,
  business_broking: 7,
  stock_and_station: 7,
  strata: 6,
  onsite_short_term_rpm: 4,
  residential_property_management: null,
};

/** Units of competency required of an assistant agent each CPD year. */
export const ASSISTANT_UNITS_REQUIRED = 3;

export type CpdRequirement = {
  /** Hours required, or null when the requirement is units or is unpublished. */
  coreHours: number | null;
  /** Units required instead of hours (certificate of registration holders). */
  units: number | null;
  /** Class 1 only — an accredited Fair Trading forum for each category held. */
  forumRequired: boolean;
  /**
   * Hours the forum carries. Null as at the checked-on date: Fair Trading
   * says only that "further detail regarding these accredited events will be
   * provided shortly." Providers quote 5 hours; that is the 2025–26 figure
   * and is not published for this year, so it is not used here.
   */
  forumHours: number | null;
  /** Plain-English notes about anything Fair Trading has not published. */
  unpublished: string[];
};

export function cpdRequirementFor(
  licenceType: LicenceType | null,
  category: CpdPracticeCategory | null,
): CpdRequirement {
  if (licenceType === "certificate_of_registration") {
    return {
      coreHours: null,
      units: ASSISTANT_UNITS_REQUIRED,
      forumRequired: false,
      forumHours: null,
      unpublished: [],
    };
  }

  // No licence type or no category recorded — we genuinely cannot say, and
  // saying "7" would be the same mistake this file exists to correct.
  if (!licenceType || !category) {
    return {
      coreHours: null,
      units: null,
      forumRequired: licenceType === "class_1",
      forumHours: null,
      unpublished: [
        !licenceType
          ? "No licence class recorded, so the CPD requirement can't be worked out."
          : "No category of practice recorded, so the CPD requirement can't be worked out. Fair Trading sets hours per category, not per licence class.",
      ],
    };
  }

  const coreHours = CORE_HOURS[category];
  const unpublished: string[] = [];

  if (coreHours === null) {
    unpublished.push(
      `Fair Trading hasn't published the ${CPD_PRACTICE_CATEGORY_LABELS[category].toLowerCase()} hours for ${CPD_RULESET.cpdYear} yet — its page says the requirement is being finalised.`,
    );
  }

  const forumRequired = licenceType === "class_1";
  if (forumRequired) {
    unpublished.push(
      "Class 1 holders must also attend a Fair Trading accredited forum for each category they hold, on top of the core hours. Fair Trading hasn't published how many hours the forum carries for this year.",
    );
  }

  return { coreHours, units: null, forumRequired, forumHours: null, unpublished };
}

/**
 * How CPD may be delivered. Face-to-face is NOT mandatory — a live
 * interactive webinar with assessment qualifies. Self-paced eLearning does
 * not satisfy the compulsory topics.
 *
 * Stated here because getting it wrong costs an agent real money: booking
 * self-paced online modules that don't count, then discovering it in June.
 */
export const CPD_DELIVERY_NOTE =
  "Compulsory topics must be delivered face-to-face or by live interactive webinar with assessment. Self-paced online modules don't satisfy them.";

/**
 * All published hours for 2026–27 are compulsory topics — Fair Trading has
 * not published an elective component this year. Worth stating, because the
 * REINSW training plan template has a Compulsory/Elective column and an agent
 * filling it in will ask.
 */
/**
 * What actually earns CPD. The single most misunderstood rule in this area,
 * and the one the app got wrong until 18 Aug 2026 — it used to credit any
 * training session an agent ticked as CPD-eligible.
 *
 * The test is the PROVIDER and the CONTENT, not the venue. Both directions of
 * that matter: an approved provider delivering an approved topic at your own
 * office DOES count, and your own internal session does NOT, wherever it is
 * held.
 */
export const CPD_PROVIDER_NOTE =
  "Only Fair Trading approved providers can deliver CPD. Your own internal training doesn't count — but an approved provider delivering at your office does, so the venue isn't the test.";

export const CPD_ELECTIVE_NOTE =
  "Fair Trading hasn't published an elective component for 2026–27 — the published hours are all compulsory topics.";

/** Evidence retention, which differs by credential and catches people out. */
export const CPD_RECORD_RETENTION_NOTE =
  "Keep CPD evidence for 3 years (Class 1 and Class 2). Certificate of registration holders keep each statement of attainment for 4 years.";
