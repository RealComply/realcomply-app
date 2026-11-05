import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePropertyDigests, stillReminded, ON_MARKET_STAGE } from "./property-digest";
import { itemsForStage } from "@/lib/rules/nsw-sales";
import type { Property, PropertyItem, PropertyStage } from "@/lib/types";

// The weekly digest stops reminding about a listing once its On market stage
// is complete (Adam, 5 Nov 2026). "Complete" is the listing page's own rule:
// the file is worked at a stage after On market (lib/rules/stage-hold.ts).

const listing = (stage: PropertyStage, extra: Partial<Property> = {}) =>
  ({
    id: `p${stage}`,
    agency_id: "a",
    created_by: "agent",
    address: `${stage} Made Up Street (made up)`,
    stage,
    test_mode: false,
    agent_interest: false,
    sale_method: "private_treaty",
    review_requested_at: null,
    ...extra,
  }) as unknown as Property;

const row = (key: string, extra: Partial<PropertyItem> = {}): PropertyItem => ({
  id: key,
  agency_id: "a",
  property_id: "p",
  item_key: key,
  status: "done",
  event_date: null,
  recorded_at: "2026-10-01T00:00:00.000Z",
  data: {},
  evidence_path: null,
  extracted_date: null,
  completed_by: "agent",
  created_at: "2026-10-01T00:00:00.000Z",
  ...extra,
});

/** Every card required to finish stages 0 to `upTo`, marked done. */
function finishedThrough(property: Property, upTo: number): Map<string, PropertyItem> {
  const rows = new Map<string, PropertyItem>();
  // Some cards only appear once others are recorded, so go round until nothing new turns up.
  for (let round = 0; round < 5; round++) {
    const before = rows.size;
    for (let s = 0; s <= upTo; s++) {
      for (const item of itemsForStage(s as PropertyStage, property, Object.fromEntries(rows))) {
        if (item.requiredForStageCompletion && !rows.has(item.key)) rows.set(item.key, row(item.key));
      }
    }
    if (rows.size === before) break;
  }
  return rows;
}

const digestOf = (property: Property, rows: Map<string, PropertyItem>, counts?: Map<string, number>) =>
  computePropertyDigests([property], new Map([[property.id, rows]]), new Set(), counts)[0];

describe("On market complete (Adam, 5 Nov 2026)", () => {
  it("is On market, stage 2", () => assert.equal(ON_MARKET_STAGE, 2));

  it("isn't complete while the listing is still On market or earlier", () => {
    for (const stage of [0, 1, 2] as PropertyStage[]) {
      const p = listing(stage);
      assert.equal(digestOf(p, finishedThrough(p, stage)).onMarketComplete, false, `stage ${stage}`);
    }
  });

  it("is complete once the listing has moved on to Campaign, Sold or Settled", () => {
    for (const stage of [3, 4, 5] as PropertyStage[]) {
      const p = listing(stage);
      assert.equal(digestOf(p, finishedThrough(p, stage - 1)).onMarketComplete, true, `stage ${stage}`);
    }
  });

  it("isn't complete when an earlier required card has been reopened (the file is held back)", () => {
    const p = listing(4);
    const rows = finishedThrough(p, 3);
    const reopened = [...rows.keys()].find((k) => itemsForStage(2, p, Object.fromEntries(rows)).some((i) => i.key === k && i.requiredForStageCompletion))!;
    rows.set(reopened, row(reopened, { status: "open" }));
    assert.equal(digestOf(p, rows).onMarketComplete, false);
  });

  it("counts the ESP reasoning card by its rule, as the listing page does", () => {
    const p = listing(3);
    const rows = finishedThrough(p, 2);
    // a4c stored as done with no reasoning: the listing page holds the file at Listing set-up.
    rows.set("a4c", row("a4c", { data: {} }));
    assert.equal(digestOf(p, rows, new Map()).onMarketComplete, false);
  });

  it("is complete for a file the licensee has signed off", () => {
    const p = listing(5);
    const rows = finishedThrough(p, 4);
    rows.set("sign_licensee", row("sign_licensee", { data: { typedName: "Lee", signedAt: "2026-10-20T00:00:00.000Z" } }));
    assert.equal(digestOf(p, rows).onMarketComplete, true);
  });
});

describe("what the weekly digest still reminds about", () => {
  it("leaves out a Settled listing waiting on the licensee's signature, and a flagged Campaign listing", () => {
    // The "Licensee signature" card is on files where the agent is the licensee in charge.
    const licenseeIds = new Set(["agent"]);
    const settled = listing(5);
    const settledRows = finishedThrough(settled, 4);
    const campaign = listing(3);
    const campaignRows = finishedThrough(campaign, 2);
    // A flag on a Campaign card. (A flag on a required card in an earlier
    // stage holds the file back there, so that one is still reminded: below.)
    const flaggedKey = itemsForStage(3, campaign, Object.fromEntries(campaignRows))[0].key;
    campaignRows.set(flaggedKey, row(flaggedKey, { status: "flagged" }));
    const onMarket = listing(2);
    const onMarketRows = new Map<string, PropertyItem>();

    const all = computePropertyDigests(
      [settled, campaign, onMarket],
      new Map([
        [settled.id, settledRows],
        [campaign.id, campaignRows],
        [onMarket.id, onMarketRows],
      ]),
      licenseeIds,
    );
    // Before: the Settled file waits on "Licensee signature".
    assert.ok(all[0].pendingSignoff.some((i) => i.key === "sign_licensee"));

    const kept = stillReminded(all).map((d) => d.property.id);
    assert.deepEqual(kept, [onMarket.id]);
  });

  it("keeps a listing past On market whose earlier required card is flagged, because the file is held back", () => {
    const p = listing(3);
    const rows = finishedThrough(p, 2);
    const required = itemsForStage(1, p, Object.fromEntries(rows)).find((i) => i.requiredForStageCompletion)!;
    rows.set(required.key, row(required.key, { status: "flagged" }));
    const kept = stillReminded(computePropertyDigests([p], new Map([[p.id, rows]]), new Set()));
    assert.deepEqual(kept.map((d) => d.flagged.map((i) => i.key)), [[required.key]]);
  });

  it("keeps a listing that hasn't finished On market exactly as it was", () => {
    const p = listing(2);
    const rows = new Map([["c0", row("c0", { status: "flagged" })]]);
    const [d] = stillReminded(computePropertyDigests([p], new Map([[p.id, rows]]), new Set()));
    assert.equal(d.property.id, p.id);
    assert.deepEqual(d.flagged.map((i) => i.key), ["c0"]);
  });
});
