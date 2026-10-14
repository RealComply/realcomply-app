import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CPD_RULESET_2026_27 as R, cpdRulesetFor, cpdTopicKeys } from "@/lib/rules/nsw-cpd";
import {
  categoriesFromLicenceRead,
  cleanTopicKeys,
  cpdOutstanding,
  cpdPlanFor,
  cpdProgress,
  cpdRequirementWords,
  cpdSummary,
  notCoveredFor,
  rulesetForCertificate,
  sharedLabel,
  topicsFromTitle,
  withCategoryCovered,
  type CpdCertificate,
} from "./cpd-plan";

// CPD with more than one category of practice (brief of 14 Oct 2026, mockup
// approved). The 2026-27 ruleset as briefed, and what each person's card says.

const trent = { licence_type: "class_1" as const, cpd_categories: ["stock_and_station", "residential_sales", "business_broking"] };

let n = 0;
const cert = (topics: string[] | null, extra: Partial<CpdCertificate> = {}): CpdCertificate => ({
  id: `c${++n}`,
  activity_name: "Made-up course",
  provider: "Made-up Training",
  hours: 2,
  completed_date: "2026-09-01",
  topics,
  topics_not_covered: [],
  ...extra,
});

describe("The 2026-27 ruleset", () => {
  it("is dated and versioned, with its source", () => {
    assert.equal(R.cpdYear, "2026-27");
    assert.equal(R.checkedOn, "2026-10-14");
    assert.match(R.sourceUrl, /^https:\/\/www\.nsw\.gov\.au\/.*continuing-professional-development$/);
    assert.equal(cpdRulesetFor("2026-07-01"), R);
    assert.equal(cpdRulesetFor("2027-07-01"), null, "never carries last year's rules forward");
  });

  it("has each category's hours as briefed", () => {
    assert.deepEqual(R.hours, {
      residential_sales: 7,
      residential_property_management: 7,
      buyers_agent: 7,
      commercial: 7,
      business_broking: 7,
      onsite_short_term_rpm: 4,
      strata: 6,
      stock_and_station: 7,
    });
  });

  it("has each category's compulsory topics as briefed", () => {
    const of = (c: string) => R.topics.filter((t) => (t.categories as string[]).includes(c)).map((t) => t.title);
    assert.deepEqual(of("residential_sales"), [
      "Auction laws and practice",
      "Contracts",
      "Rules of Conduct refresher",
      "Supervision Guidelines and AML CTF in agency practice",
    ]);
    assert.deepEqual(of("residential_property_management"), [
      "Repairs, maintenance and habitability",
      "Residential tenancy, revisit reforms plus common mistakes",
      "Domestic and Family Violence",
    ]);
    assert.deepEqual(of("buyers_agent"), [
      "Auction laws and practice",
      "Contracts",
      "Supervision Guidelines and AML CTF in agency practice",
      "Marketing services, scope of practice and licensing obligations",
    ]);
    assert.deepEqual(of("commercial"), [
      "Rules of Conduct refresher",
      "Supervision Guidelines and AML CTF in agency practice",
      "Fire safety regulations",
      "GST in commercial property transactions",
    ]);
    assert.deepEqual(of("business_broking"), [
      "Supervision Guidelines and AML CTF in agency practice",
      "Establishing and managing relationships and negotiation skills",
      "Ethical practice for business brokers",
    ]);
    assert.deepEqual(of("onsite_short_term_rpm"), [
      "Conflict resolution and complaint management",
      "Establishing and managing relationships",
      "Regulatory change in strata",
    ]);
    assert.deepEqual(of("strata"), ["Regulatory change in strata", "Repairs and maintenance", "Roles, authority and risk"]);
    assert.deepEqual(of("stock_and_station"), [
      "Auction laws and practice",
      "Contracts",
      "Supervision Guidelines and AML CTF in agency practice",
      "Safety risk management",
    ]);
    assert.equal(R.topics.find((t) => t.key === "domestic_family_violence")?.note, "At least 4 hours.");
  });

  it("has one forum a year for Class 1, at least 5 hours, and AUSTRAC for the briefed areas", () => {
    assert.equal(R.class1.forum.minHours, 5);
    assert.equal(R.class1.forum.note, "One forum a year, even with more than one licence.");
    assert.deepEqual([...R.class1.austrac.categories].sort(), [
      "business_broking",
      "buyers_agent",
      "commercial",
      "residential_sales",
      "stock_and_station",
    ]);
    assert.equal(new Set(cpdTopicKeys(R)).size, cpdTopicKeys(R).length, "every key once");
  });
});

describe("Residential sales, business broking and stock and station, Class 1 (Trent)", () => {
  const plan = cpdPlanFor(trent, R);

  it("shows each category's minimum hours, and no combined total", () => {
    assert.equal(plan.kind, "hours");
    if (plan.kind !== "hours") return;
    assert.deepEqual(
      plan.minimums.map((m) => [m.label, m.hours]),
      [
        ["Residential sales", 7],
        ["Business broking", 7],
        ["Stock and station", 7],
      ],
    );
    assert.ok(!("totalHours" in plan));
    assert.equal(
      plan.sharedNote,
      "You'll likely do more than 7 hours in total. A shared topic only needs doing once if the course covers each category's learning outcomes. Check with your provider.",
    );
  });

  it("lists 7 topics once each, the 3 shared ones first and marked", () => {
    if (plan.kind !== "hours") return assert.fail();
    assert.deepEqual(
      plan.topics.map((t) => [t.title, t.categories.length, sharedLabel(t.categories.length)]),
      [
        ["Supervision Guidelines and AML CTF in agency practice", 3, "Counts for all three"],
        ["Auction laws and practice", 2, "Counts for both"],
        ["Contracts", 2, "Counts for both"],
        ["Rules of Conduct refresher", 1, null],
        ["Establishing and managing relationships and negotiation skills", 1, null],
        ["Ethical practice for business brokers", 1, null],
        ["Safety risk management", 1, null],
      ],
    );
  });

  it("has the forum line and the AUSTRAC line", () => {
    if (plan.kind !== "hours") return assert.fail();
    assert.deepEqual(
      plan.extras.map((e) => [e.title, e.note]),
      [
        ["Fair Trading accredited forum (at least 5 hours)", "One forum a year, even with more than one licence."],
        ["AUSTRAC: Smart real estate agent's guide to AML/CTF", "Separate from the forum. Keep the completion certificate."],
      ],
    );
  });

  it("counts 9 things to do: 7 topics, the forum and AUSTRAC", () => {
    const p = cpdProgress(plan, [], R)!;
    assert.equal(cpdSummary(plan, p), "0 of 9 done");
    assert.equal(cpdOutstanding(plan, p), true);
  });

  it("one certificate on a shared topic ticks it for each category", () => {
    const p = cpdProgress(plan, [cert(["supervision_aml"])], R)!;
    const t = p.topics[0];
    assert.equal(t.key, "supervision_aml");
    assert.deepEqual(
      t.byCategory.map((b) => [b.label, b.done]),
      [
        ["Residential sales", true],
        ["Business broking", true],
        ["Stock and station", true],
      ],
    );
    assert.equal(t.done, true);
    assert.equal(p.done, 1);
  });

  it("unticking one category leaves the topic to do for that category only", () => {
    const p = cpdProgress(plan, [cert(["supervision_aml"], { topics_not_covered: ["supervision_aml:business_broking"] })], R)!;
    const t = p.topics[0];
    assert.deepEqual(t.byCategory.map((b) => b.done), [true, false, true]);
    assert.equal(t.done, false);
    assert.equal(t.covered, true);
    assert.equal(p.done, 0);
  });

  it("a certificate with no provider or no date ticks nothing until it has them", () => {
    const p = cpdProgress(plan, [cert(["contracts"], { provider: null }), cert(["auction_laws"], { completed_date: null })], R)!;
    assert.equal(p.done, 0);
  });

  it("is done when everything is", () => {
    const all = ["supervision_aml", "auction_laws", "contracts", "rules_of_conduct", "relationships_negotiation", "business_broker_ethics", "safety_risk", "accredited_forum", "austrac_guide"];
    const p = cpdProgress(plan, [cert(all.slice(0, 5)), cert(all.slice(5))], R)!;
    assert.equal(cpdSummary(plan, p), "9 of 9 done");
    assert.equal(p.complete, true);
    assert.equal(cpdOutstanding(plan, p), false);
  });

  it("puts each category's minimum on the training plan, never a total", () => {
    const w = cpdRequirementWords(plan);
    assert.equal(w.hours, null);
    assert.match(w.note ?? "", /Residential sales 7 hours; Business broking 7 hours; Stock and station 7 hours/);
    assert.match(w.note ?? "", /accredited forum/);
  });
});

describe("Class 2, one category", () => {
  const plan = cpdPlanFor({ licence_type: "class_2", cpd_categories: ["residential_sales"] }, R);

  it("has one minimum, the four topics, no shared note and no Class 1 extras", () => {
    if (plan.kind !== "hours") return assert.fail();
    assert.equal(plan.minimums.length, 1);
    assert.equal(plan.sharedNote, null);
    assert.equal(plan.topics.length, 4);
    assert.ok(plan.topics.every((t) => sharedLabel(t.categories.length) === null));
    assert.deepEqual(plan.extras, []);
    assert.equal(cpdRequirementWords(plan).hours, 7);
    assert.equal(cpdSummary(plan, cpdProgress(plan, [], R)), "0 of 4 done");
  });
});

describe("Residential property management", () => {
  it("shows its 3 published topics and 7 hours, not 'not published'", () => {
    const plan = cpdPlanFor({ licence_type: "class_2", cpd_categories: ["residential_property_management"] }, R);
    if (plan.kind !== "hours") return assert.fail();
    assert.deepEqual(plan.minimums.map((m) => m.hours), [7]);
    assert.deepEqual(plan.topics.map((t) => t.title), [
      "Repairs, maintenance and habitability",
      "Residential tenancy, revisit reforms plus common mistakes",
      "Domestic and Family Violence",
    ]);
    assert.equal(plan.topics[2].note, "At least 4 hours.");
  });

  it("Class 1 property management only: the forum, but not AUSTRAC", () => {
    const plan = cpdPlanFor({ licence_type: "class_1", cpd_categories: ["residential_property_management"] }, R);
    if (plan.kind !== "hours") return assert.fail();
    assert.deepEqual(plan.extras.map((e) => e.key), ["accredited_forum"]);
  });
});

describe("Assistant agents", () => {
  it("owe 3 units, with carry-over noted, and keep records 4 years", () => {
    const plan = cpdPlanFor({ licence_type: "certificate_of_registration", cpd_categories: ["residential_sales"] }, R);
    assert.equal(plan.kind, "units");
    if (plan.kind !== "units") return;
    assert.equal(plan.units, 3);
    assert.match(plan.note, /Extra units carry over to next year/);
    assert.equal(plan.retentionYears, 4);
    const p = cpdProgress(plan, [cert(null, { hours: 1, category: "assistant_unit" })], R);
    assert.equal(cpdSummary(plan, p), "1 of 3 units");
  });

  it("owe 1 unit if they started 3 to 9 months before 30 June", () => {
    for (const started of ["2026-09-30", "2027-01-15", "2027-03-31"]) {
      const plan = cpdPlanFor({ licence_type: "certificate_of_registration", licence_started_on: started }, R);
      assert.equal(plan.kind === "units" && plan.units, 1, started);
    }
    const early = cpdPlanFor({ licence_type: "certificate_of_registration", licence_started_on: "2026-09-29" }, R);
    assert.equal(early.kind === "units" && early.units, 3);
  });

  it("are exempt if stock and station, livestock sales only", () => {
    const plan = cpdPlanFor(
      { licence_type: "certificate_of_registration", cpd_categories: ["stock_and_station"], cpd_livestock_only: true },
      R,
    );
    assert.equal(plan.kind, "exempt");
    if (plan.kind === "exempt") assert.match(plan.message, /livestock/);
    assert.equal(cpdOutstanding(plan, null), false);
    assert.equal(cpdSummary(plan, null), "Exempt this year");
  });

  it("livestock only means nothing on a licence", () => {
    const plan = cpdPlanFor({ ...trent, cpd_livestock_only: true }, R);
    assert.equal(plan.kind, "hours");
  });
});

describe("Part year", () => {
  it("a licence that started on 1 April 2027 is exempt for 2026-27, with the suspension caveat", () => {
    const plan = cpdPlanFor({ ...trent, licence_started_on: "2027-04-01" }, R);
    assert.equal(plan.kind, "exempt");
    if (plan.kind !== "exempt") return;
    assert.equal(
      plan.message,
      "No CPD for 2026-27: a licence that started on or after 1 April 2027 is exempt for the year, and this one started on 1 April 2027. This doesn't apply if it recommenced after a suspension with a CPD condition.",
    );
  });

  it("one that started the day before is not", () => {
    assert.equal(cpdPlanFor({ ...trent, licence_started_on: "2027-03-31" }, R).kind, "hours");
  });
});

describe("When it can't be said", () => {
  it("no licence, or no category ticked, says so and counts as nothing outstanding", () => {
    const a = cpdPlanFor({ licence_type: null, cpd_categories: ["residential_sales"] }, R);
    const b = cpdPlanFor({ licence_type: "class_2", cpd_categories: [] }, R);
    assert.equal(a.kind, "unknown");
    assert.equal(b.kind, "unknown");
    assert.equal(cpdSummary(b, null), "No category of practice ticked");
    assert.equal(cpdOutstanding(b, null), false);
  });

  it("a year RealComply has no rules for says so", () => {
    const plan = cpdPlanFor(trent, cpdRulesetFor("2027-07-01"), "2027–28");
    assert.equal(plan.kind, "no_ruleset");
  });

  it("ignores anything that isn't a category", () => {
    const plan = cpdPlanFor({ licence_type: "class_2", cpd_categories: ["astrology", "strata"] }, R);
    if (plan.kind !== "hours") return assert.fail();
    assert.deepEqual(plan.categories, ["strata"]);
  });
});

describe("Reading the topic off a certificate's title", () => {
  it("finds whole topic titles, whatever the punctuation", () => {
    assert.deepEqual(topicsFromTitle("Supervision Guidelines and AML/CTF in Agency Practice (2 hrs)", R), ["supervision_aml"]);
    assert.deepEqual(topicsFromTitle("Contracts", R), ["contracts"]);
    assert.deepEqual(topicsFromTitle("Repairs, Maintenance & Habitability", R), ["repairs_habitability"]);
  });

  it("doesn't mistake a longer title for a shorter one, or a passing word for a topic", () => {
    assert.deepEqual(topicsFromTitle("Establishing and managing relationships and negotiation skills", R), ["relationships_negotiation"]);
    assert.deepEqual(topicsFromTitle("Commercial contracts law in practice", R), []);
    assert.deepEqual(topicsFromTitle("Office induction", R), []);
  });

  it("knows the forum and the AUSTRAC guide", () => {
    assert.deepEqual(topicsFromTitle("REINSW Accredited Forum 2026", R), ["accredited_forum"]);
    assert.deepEqual(topicsFromTitle("AUSTRAC Smart real estate agent's guide to AML/CTF", R), ["austrac_guide"]);
  });

  it("an older certificate with no topics stored is read from its title", () => {
    const plan = cpdPlanFor({ licence_type: "class_2", cpd_categories: ["residential_sales"] }, R);
    const p = cpdProgress(plan, [cert(null, { activity_name: "Auction laws and practice" })], R)!;
    assert.equal(p.topics.find((t) => t.key === "auction_laws")?.done, true);
    // ...but once topics are stored, they are what counts.
    const q = cpdProgress(plan, [cert([], { activity_name: "Auction laws and practice" })], R)!;
    assert.equal(q.done, 0);
  });
});

describe("Changing what a certificate counts for", () => {
  it("unticks and re-ticks one category of one topic", () => {
    const off = withCategoryCovered([], "supervision_aml", "business_broking", false);
    assert.deepEqual(off, ["supervision_aml:business_broking"]);
    assert.deepEqual(withCategoryCovered(off, "supervision_aml", "business_broking", true), []);
    assert.deepEqual(withCategoryCovered(off, "supervision_aml", "business_broking", false), off, "once only");
  });

  it("keeps only topics the year's rules know, and drops unticks for topics no longer covered", () => {
    assert.deepEqual(cleanTopicKeys(["contracts", "astrology", "contracts", 7, "austrac_guide"], R), ["contracts", "austrac_guide"]);
    assert.deepEqual(notCoveredFor(["contracts:residential_sales", "auction_laws:stock_and_station"], ["contracts"]), [
      "contracts:residential_sales",
    ]);
  });

  it("reads a certificate against the rules for the CPD year its date falls in", () => {
    assert.equal(rulesetForCertificate("2026-07-01"), R);
    assert.equal(rulesetForCertificate("2027-06-30"), R);
    assert.equal(rulesetForCertificate("2026-06-30"), null, "2025-26: not held");
    assert.equal(rulesetForCertificate(null, new Date("2026-10-14T00:00:00Z")), R, "undated: this year's");
  });
});

describe("Pre-filling from the licence read", () => {
  it("ticks the categories a licence names, but no real estate area, which it can't say", () => {
    assert.deepEqual(
      categoriesFromLicenceRead({ categories: ["real_estate", "stock_and_station", "business_agent", "strata_management"] }),
      ["business_broking", "strata", "stock_and_station"],
    );
    assert.deepEqual(categoriesFromLicenceRead({ categories: ["onsite_residential_property_manager"] }), ["onsite_short_term_rpm"]);
    assert.deepEqual(categoriesFromLicenceRead({ categories: ["real_estate"] }), []);
    assert.deepEqual(categoriesFromLicenceRead({}), []);
    assert.deepEqual(categoriesFromLicenceRead(null), []);
  });
});
