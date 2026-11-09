import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  METRO_COUNCILS,
  OTHER_NSW_COUNCILS,
  areaOf,
  councilAreaFrom,
  councilAreaRecordLines,
  councilAreaSource,
  councilAreaSummary,
  isCouncilArea,
  searchAreaLine,
} from "./council-area";

const BEFORE = new Date("2026-11-09T10:00:00+11:00");
const AFTER = new Date("2026-11-20T10:00:00+11:00");

describe("council areas (Reg s12A)", () => {
  it("has the Regulation's 36 metropolitan councils and the other 92 NSW councils, each once", () => {
    assert.equal(METRO_COUNCILS.length, 36);
    assert.equal(OTHER_NSW_COUNCILS.length, 92);
    const all = [...METRO_COUNCILS, ...OTHER_NSW_COUNCILS];
    assert.equal(new Set(all).size, 128);
    // No two names can be mistaken for each other once "Council", "City",
    // "Shire" and the like are taken off.
    assert.equal(new Set(all.map((c) => councilAreaFrom(c))).size, 128);
    for (const c of all) assert.ok(isCouncilArea(c), c);
  });

  it("names every metropolitan council the Regulation does", () => {
    // Reg s12A, word for word.
    const regulation =
      "Bayside, Blacktown City Council, Blue Mountains City Council, Burwood, Camden, Campbelltown City Council, " +
      "Canada Bay, Canterbury-Bankstown, Central Coast, City of Newcastle, City of Sydney, City of Wollongong, " +
      "Cumberland, Fairfield, Georges River, Hawkesbury City Council, Hornsby, Hunters Hill, Inner West, " +
      "Ku-ring-gai, Lane Cove, Liverpool City Council, Mosman, North Sydney, Northern Beaches, Council of the City " +
      "of Parramatta, Penrith City Council, Randwick City Council, Council of the City of Ryde, Strathfield, " +
      "Sutherland, the Hills Shire, Waverley, Willoughby City Council, Wollondilly and Woollahra";
    const named = regulation.replace(" and ", ", ").split(", ");
    assert.equal(named.length, 36);
    const read = named.map((n) => councilAreaFrom(n));
    assert.deepEqual(new Set(read), new Set(METRO_COUNCILS));
    for (const n of named) assert.equal(areaOf(councilAreaFrom(n)), "metro", n);
  });

  it("reads the council the way a planning certificate prints it", () => {
    assert.equal(councilAreaFrom("Hornsby Shire Council"), "Hornsby");
    assert.equal(councilAreaFrom("The Council of the Shire of Hornsby"), "Hornsby");
    assert.equal(councilAreaFrom("City of Parramatta Council"), "Parramatta");
    assert.equal(councilAreaFrom("The Hills Shire Council"), "The Hills");
    assert.equal(councilAreaFrom("Hunter’s Hill Council"), "Hunters Hill");
    assert.equal(councilAreaFrom("City of Canterbury Bankstown"), "Canterbury-Bankstown");
    assert.equal(councilAreaFrom("Sydney City Council"), "City of Sydney");
    assert.equal(councilAreaFrom("North Sydney Council"), "North Sydney");
    assert.equal(councilAreaFrom("Woollahra Municipal Council"), "Woollahra");
    assert.equal(councilAreaFrom("Mid Coast Council"), "MidCoast");
    assert.equal(councilAreaFrom("Mid-Western Regional Council"), "Mid-Western");
    assert.equal(councilAreaFrom("Liverpool Plains Shire Council"), "Liverpool Plains");
    assert.equal(councilAreaFrom("Liverpool City Council"), "Liverpool");
    assert.equal(councilAreaFrom("Uralla Shire Council"), "Uralla");
    assert.equal(councilAreaFrom("Queanbeyan-Palerang Regional Council"), "Queanbeyan-Palerang");
  });

  it("asks rather than guesses when the name isn't one of them", () => {
    assert.equal(councilAreaFrom(""), null);
    assert.equal(councilAreaFrom(null), null);
    assert.equal(councilAreaFrom("Hornsby Shire Council (ABN 20 706 996 972)"), null);
    assert.equal(councilAreaFrom("Department of Planning"), null);
    assert.equal(councilAreaFrom("Brisbane City Council"), null);
    assert.equal(areaOf("Brisbane"), null);
    assert.equal(areaOf(null), null);
    assert.equal(isCouncilArea("hornsby"), false, "only the name as listed is kept");
  });

  it("is metro or non-metro by the list", () => {
    assert.equal(areaOf("Central Coast"), "metro");
    assert.equal(areaOf("Newcastle"), "metro");
    assert.equal(areaOf("Wollongong"), "metro");
    assert.equal(areaOf("Lake Macquarie"), "non_metro");
    assert.equal(areaOf("Shellharbour"), "non_metro");
    assert.equal(areaOf("Uralla"), "non_metro");
    assert.equal(areaOf("Queanbeyan-Palerang"), "non_metro");
  });

  it("says where to look for comparable sales (Reg s12D)", () => {
    assert.equal(
      searchAreaLine("metro", AFTER),
      "Look for comparable sales within 2 km, sold in the last 6 months. If fewer than 3 of those are comparable, also look at sales within 2 km in the last 12 months (Reg s12D).",
    );
    assert.equal(searchAreaLine("non_metro", AFTER), "Look for comparable sales within 5 km, sold in the last 18 months (Reg s12D).");
    assert.equal(
      searchAreaLine("non_metro", BEFORE),
      "From 17 November 2026, look for comparable sales within 5 km, sold in the last 18 months (Reg s12D).",
    );
  });

  it("writes it for the record", () => {
    assert.equal(councilAreaSummary("Hornsby"), "Hornsby, a metropolitan area (Reg s12A).");
    assert.equal(councilAreaSummary("Uralla"), "Uralla, a non-metropolitan area (Reg s12A).");
    assert.equal(councilAreaSource("planning_certificate", "Ana Agent", "9 November 2026"), "Read from the planning certificate in the contract.");
    assert.equal(councilAreaSource("agent", "Ana Agent (made up)", "9 November 2026"), "Chosen by Ana Agent (made up) on 9 November 2026.");
    assert.deepEqual(
      councilAreaRecordLines({ council: "Hornsby", from: "planning_certificate", setByName: null, setOn: null }, AFTER),
      [
        "Council area: Hornsby, a metropolitan area (Reg s12A). Read from the planning certificate in the contract.",
        "Look for comparable sales within 2 km, sold in the last 6 months. If fewer than 3 of those are comparable, also look at sales within 2 km in the last 12 months (Reg s12D).",
      ],
    );
    assert.deepEqual(councilAreaRecordLines({ council: null, from: null, setByName: null, setOn: null }), ["Council area: not recorded."]);
  });
});
