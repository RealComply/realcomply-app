import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SOI_AREA_MISSING,
  SOI_COMPARABLE_INCOMPLETE,
  SOI_FEWER_MISSING,
  SOI_NOT_CHECKED,
  SOI_REPORTS,
  SOI_TOO_MANY,
  SOI_TYPES,
  SOI_TYPE_MISSING,
  linkStoppedBecause,
  reviseByLine,
  soiApplies,
  soiContentFrom,
  soiContentOf,
  soiDraft,
  soiRecordLines,
  soiReviseBy,
  soiTypeFrom,
  versionLine,
  type ListingSale,
  type SoiVersion,
} from "./soi";
import type { RevisionComparable } from "./revision-comparables";

const fixed = { address: "12 Harbour Street, Hornsby NSW 2077 (made up)", area: "metro" as const, preparedOn: "2027-02-12", preparedBy: "Ana Agent, Harbour Realty (made up)", espRevisionNo: 0 };
const row = (address: string, over: Record<string, unknown> = {}) => ({
  address,
  bedrooms: "3",
  bathrooms: "2",
  parking: "1",
  landSizeSqm: "650",
  floorAreaSqm: "",
  soldPrice: "$1,250,000",
  soldOn: "2027-01-10",
  reasons: "Same street, same layout.",
  ...over,
});
const form = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  propertyType: "house",
  comparables: JSON.stringify(rows),
  fewerReason: "",
  reports: ["building", "nonsense"],
  checked: "on",
  ...over,
});

describe("when the statement applies (Act Sch 1, transitional cl 3)", () => {
  it("covers an agreement signed from 8 February 2027, or none signed yet from that day", () => {
    const after = new Date("2027-03-01T01:00:00Z");
    assert.equal(soiApplies("2027-02-07", after), false, "signed the day before: never");
    assert.equal(soiApplies("2027-02-08", after), true);
    assert.equal(soiApplies(null, new Date("2027-02-07T12:59:59Z")), false, "11:59:59 pm on 7 February in Sydney");
    assert.equal(soiApplies(null, new Date("2027-02-07T13:00:00Z")), true, "midnight at the start of 8 February in Sydney");
  });

  it("is switched off before then, whatever date was typed (Master, 10 Nov 2026)", () => {
    assert.equal(soiApplies("2027-02-10", new Date("2026-11-10T01:00:00Z")), false);
    assert.equal(soiApplies(null, new Date("2026-11-10T01:00:00Z")), false);
    assert.equal(soiApplies("2027-02-10"), false, "today, in November 2026");
  });
});

describe("the approved form's lists", () => {
  it("has all 9 types and all 7 reports, in the form's words", () => {
    assert.deepEqual([...SOI_TYPES], ["house", "terrace house", "semi-detached", "duplex", "townhouse", "villa", "apartment", "unit", "vacant land"]);
    assert.equal(SOI_REPORTS.length, 7);
    assert.equal(SOI_REPORTS[4].label, "A strata information certificate under s184 of the Strata Schemes Management Act 2015");
    assert.equal(soiTypeFrom("Land"), "vacant land");
    assert.equal(soiTypeFrom("Unit"), "unit");
    assert.equal(soiTypeFrom(null), null);
  });
});

describe("the statement as the form sends it (Reg s12H)", () => {
  it("keeps 3 comparable properties with their details, and only the reports on the form", () => {
    const parsed = soiContentFrom(form([row("1 A St"), row("2 B St"), row("3 C St", { landSizeSqm: "" })]), fixed);
    assert.ok("content" in parsed);
    if (!("content" in parsed)) return;
    assert.deepEqual(parsed.content.comparables[0], {
      address: "1 A St",
      bedrooms: 3,
      bathrooms: 2,
      parking: 1,
      landSizeSqm: 650,
      floorAreaSqm: null,
      soldPrice: 1250000,
      soldOn: "2027-01-10",
      reasons: "Same street, same layout.",
    });
    assert.equal(parsed.content.comparables[2].landSizeSqm, null, "land size only if known");
    assert.equal(parsed.content.fewerReason, null);
    assert.deepEqual(parsed.content.reports, ["building"]);
    assert.equal(parsed.content.address, fixed.address);
  });

  it("with 1 or 2, lists them in Section A and needs the Section B reason", () => {
    assert.deepEqual(soiContentFrom(form([row("1 A St")]), fixed), { error: SOI_FEWER_MISSING });
    const parsed = soiContentFrom(form([row("1 A St")], { fewerReason: " Only one sale within 2 km. " }), fixed);
    assert.ok("content" in parsed && parsed.content.comparables.length === 1 && parsed.content.fewerReason === "Only one sale within 2 km.");
    const none = soiContentFrom(form([], { fewerReason: "No sales in 12 months." }), fixed);
    assert.ok("content" in none && none.content.comparables.length === 0);
  });

  it("refuses what the form can't take", () => {
    assert.deepEqual(soiContentFrom(form([row("1 A St")], { propertyType: "castle" }), fixed), { error: SOI_TYPE_MISSING });
    assert.deepEqual(soiContentFrom(form([row("1 A St")]), { ...fixed, area: null }), { error: SOI_AREA_MISSING });
    assert.deepEqual(soiContentFrom(form([row("1 A St"), row("2"), row("3"), row("4")]), fixed), { error: SOI_TOO_MANY });
    for (const over of [{ bedrooms: "" }, { soldPrice: "lots" }, { soldOn: "2027-02-30" }, { reasons: " " }, { parking: "1.5" }]) {
      assert.deepEqual(
        soiContentFrom(form([row("1 A St", over), row("2 B St"), row("3 C St")]), fixed),
        { error: SOI_COMPARABLE_INCOMPLETE },
        JSON.stringify(over),
      );
    }
    assert.deepEqual(soiContentFrom(form([row("1 A St"), row("2 B St"), row("3 C St")], { checked: null }), fixed), { error: SOI_NOT_CHECKED });
  });

  it("reads back what a version kept", () => {
    const parsed = soiContentFrom(form([row("1 A St"), row("2 B St"), row("3 C St")]), fixed);
    assert.ok("content" in parsed);
    if (!("content" in parsed)) return;
    assert.deepEqual(soiContentOf(JSON.parse(JSON.stringify(parsed.content))), parsed.content);
    assert.equal(soiContentOf(null), null);
    assert.equal(soiContentOf({ address: "x" }), null);
  });
});

const sale = (address: string, over: Partial<ListingSale> = {}): ListingSale => ({
  address,
  salePrice: 1200000,
  saleDate: "2027-01-05T00:00:00Z",
  bedrooms: 3,
  bathrooms: 2,
  carSpaces: 1,
  landSizeSqm: 600,
  internalAreaSqm: null,
  mostComparable: false,
  mostComparableReason: null,
  ...over,
});
const rc = (address: string, over: Partial<RevisionComparable> = {}): RevisionComparable => ({
  address,
  soldOn: "2027-03-01",
  soldPrice: 1300000,
  distanceM: 500,
  most: true,
  mostReason: "Close by.",
  factors: [],
  notBeforeReason: null,
  ...over,
});

describe("filling the form from the file", () => {
  const listing = [
    sale("1 A St", { mostComparable: true, mostComparableReason: "Same street." }),
    sale("2 B St", { mostComparable: true, mostComparableReason: "Same size." }),
    sale("9 Far Rd"),
  ];
  const register = { building: true, pest: true, strata: false };

  it("takes the listing's most comparable, with the report's details", () => {
    const d = soiDraft({ propertyType: "Townhouse", listing, firstEspFewerReason: "Only 2 nearby.", revisions: [], previous: null, register });
    assert.equal(d.propertyType, "townhouse");
    assert.deepEqual(d.comparables.map((c) => [c.address, c.bedrooms, c.parking, c.soldOn, c.reasons]), [
      ["1 A St", 3, 1, "2027-01-05", "Same street."],
      ["2 B St", 3, 1, "2027-01-05", "Same size."],
    ]);
    assert.equal(d.fewerReason, "Only 2 nearby.");
    assert.deepEqual(d.reports, ["building"], "only the exact match is ticked");
    assert.equal(d.reportHints.length, 1);
    assert.equal(d.espRevisionNo, 0);
  });

  it("takes the latest revision that kept its own, filling details from the listing where it can", () => {
    const d = soiDraft({
      propertyType: "House",
      listing,
      firstEspFewerReason: null,
      revisions: [
        { no: 1, comparables: [rc("1 A St"), rc("7 New St", { mostReason: "Sold last month." }), rc("8 Other St", { most: false })], comparablesFewerReason: "Only 2." },
        { no: 2 },
      ],
      previous: null,
      register: { building: false, pest: false, strata: false },
    });
    assert.deepEqual(d.comparables.map((c) => [c.address, c.bedrooms, c.soldPrice, c.reasons]), [
      ["1 A St", 3, 1300000, "Close by."],
      ["7 New St", null, 1300000, "Sold last month."],
    ]);
    assert.equal(d.fewerReason, "Only 2.");
    assert.equal(d.espRevisionNo, 2, "made for the latest ESP");
    assert.equal(d.from, "ESP revision 1");
  });

  it("carries the type and the reports over from the last statement made", () => {
    const parsed = soiContentFrom(form([row("1 A St"), row("2 B St"), row("3 C St")], { propertyType: "villa", reports: ["termite"] }), fixed);
    assert.ok("content" in parsed);
    if (!("content" in parsed)) return;
    const d = soiDraft({ propertyType: "House", listing, firstEspFewerReason: null, revisions: [], previous: parsed.content, register });
    assert.equal(d.propertyType, "villa");
    assert.deepEqual(d.reports, ["termite"]);
    assert.deepEqual(d.reportHints, []);
  });
});

describe("revising it (Reg s12I)", () => {
  const firstEsp = ["1 A St", "2 B St", "3 C St"];
  const same = [rc("1 A St"), rc("2 B St"), rc("3 C St"), rc("4 D St", { most: false })];
  const different = [rc("1 A St"), rc("2 B St"), rc("5 E St")];

  it("isn't due with no statement, or when the revision's properties are the same", () => {
    assert.equal(soiReviseBy({ versions: [], revisions: [{ no: 1, givenOn: "2027-03-01", recordedAt: "2027-03-01T01:00:00Z", comparables: different }], firstEsp }), null);
    assert.equal(
      soiReviseBy({ versions: [{ versionNo: 1, espRevisionNo: 0 }], revisions: [{ no: 1, givenOn: "2027-03-01", recordedAt: "2027-03-01T01:00:00Z", comparables: same }], firstEsp }),
      null,
    );
    assert.equal(
      soiReviseBy({ versions: [{ versionNo: 1, espRevisionNo: 0 }], revisions: [{ no: 1, givenOn: "2027-03-01", recordedAt: "2027-03-01T01:00:00Z" }], firstEsp }),
      null,
      "a revision that kept no comparable sales starts no clock",
    );
  });

  it("is due 2 NSW business days after a revision with different properties", () => {
    // Friday 5 March 2027: due Tuesday 9 March.
    assert.deepEqual(
      soiReviseBy({ versions: [{ versionNo: 1, espRevisionNo: 0 }], revisions: [{ no: 1, givenOn: "2027-03-05", recordedAt: "2027-03-05T01:00:00Z", comparables: different }], firstEsp }),
      { revisionNo: 1, revisedOn: "2027-03-05", dueBy: "2027-03-09" },
    );
    // Thursday 25 March 2027, before Good Friday and Easter Monday: Tuesday 30 is day 1, due Wednesday 31 March.
    assert.equal(
      soiReviseBy({ versions: [{ versionNo: 1, espRevisionNo: 0 }], revisions: [{ no: 1, givenOn: "2027-03-25", recordedAt: "2027-03-25T01:00:00Z", comparables: different }], firstEsp })?.dueBy,
      "2027-03-31",
    );
  });

  it("stops once a version is made for that revision, and compares with the ESP the latest version was made for", () => {
    const revisions = [
      { no: 1, givenOn: "2027-03-05", recordedAt: "2027-03-05T01:00:00Z", comparables: different },
      { no: 2, givenOn: "2027-04-01", recordedAt: "2027-04-01T01:00:00Z", comparables: [rc("1 A St"), rc("2 b st."), rc("5 E St")] },
    ];
    assert.equal(soiReviseBy({ versions: [{ versionNo: 1, espRevisionNo: 0 }, { versionNo: 2, espRevisionNo: 1 }], revisions, firstEsp }), null, "revision 2 has revision 1's properties");
    const due = soiReviseBy({ versions: [{ versionNo: 1, espRevisionNo: 0 }], revisions, firstEsp });
    assert.equal(due?.revisionNo, 1, "the earliest revision it missed");
  });

  it("says when, and when it's overdue", () => {
    const due = { revisionNo: 1, dueBy: "2027-03-09" };
    assert.equal(
      reviseByLine(due, new Date("2027-03-08T01:00:00Z")),
      "Revise the Statement of Information by 9 March 2027: ESP revision 1 took into account different comparable properties (Reg s12I).",
    );
    assert.match(reviseByLine(due, new Date("2027-03-10T01:00:00Z")), /^Overdue: .* due by 9 March 2027/);
  });
});

describe("the versions and the link, in words", () => {
  const v1: SoiVersion = {
    versionNo: 1,
    source: "realcomply",
    pdfPath: "a/p/soi/1.pdf",
    fileName: null,
    content: null,
    espRevisionNo: 0,
    preparedOn: "2027-02-12",
    preparedByName: "Ana Agent",
    createdAt: "2027-02-12T01:00:00Z",
  };
  const v2: SoiVersion = { ...v1, versionNo: 2, source: "uploaded", fileName: "SOI.pdf", espRevisionNo: 1, preparedOn: "2027-03-08" };

  it("names each version", () => {
    assert.equal(versionLine(v1), "Version 1, made in RealComply, prepared 12 February 2027 by Ana Agent, for the agreement's ESP");
    assert.equal(versionLine(v2), "Version 2, uploaded (SOI.pdf), prepared 8 March 2027 by Ana Agent, for ESP revision 1");
  });

  it("writes the record's lines", () => {
    assert.deepEqual(
      soiRecordLines({
        versions: [v2, v1],
        reviseBy: null,
        link: { token: "x", enabled: true, changedAt: "2027-02-12T02:00:00Z", changedByName: "Ana Agent" },
      }),
      [
        "Version 1, made in RealComply, prepared 12 February 2027 by Ana Agent, for the agreement's ESP.",
        "Version 2, uploaded (SOI.pdf), prepared 8 March 2027 by Ana Agent, for ESP revision 1.",
        "Link for online ads: switched on on 12 February 2027 by Ana Agent.",
      ],
    );
  });

  it("says why the link isn't showing the statement", () => {
    const live = { enabled: true, hasVersion: true, withdrawn: false, storedStage: 2, signedOff: false };
    assert.equal(linkStoppedBecause(live), null);
    assert.match(linkStoppedBecause({ ...live, withdrawn: true }) ?? "", /withdrawn/);
    assert.match(linkStoppedBecause({ ...live, storedStage: 5 }) ?? "", /Settled/);
    assert.match(linkStoppedBecause({ ...live, enabled: false }) ?? "", /switched off/);
  });
});
