import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LISTING_TABS,
  WITHDRAW_EXPLAINER,
  WITHDRAW_REASONS,
  WITHDRAW_WARNING,
  canOfferWithdraw,
  fileProgress,
  matchesAddress,
  readTab,
  reasonLabel,
  soldLeftLine,
  tabFor,
  withdrawalProblem,
  withdrawalRecordLines,
} from "./listing-tabs";
import { itemsForStage } from "./nsw-sales";
import type { Property, PropertyItem, PropertyStage } from "@/lib/types";

// Job B (mockup v6, Adam's OK; Master's brief, 5 Nov 2026). Made-up listings only.

const listing = (stage: PropertyStage) =>
  ({ id: "p", agency_id: "a", stage, test_mode: false, agent_interest: false, sale_method: "private_treaty" }) as unknown as Property;

const row = (key: string, extra: Partial<PropertyItem> = {}): PropertyItem => ({
  id: key,
  agency_id: "a",
  property_id: "p",
  item_key: key,
  status: "done",
  event_date: null,
  recorded_at: "2026-11-01T00:00:00.000Z",
  data: {},
  evidence_path: null,
  extracted_date: null,
  completed_by: "u",
  created_at: "2026-11-01T00:00:00.000Z",
  ...extra,
});

/** Every required card in the given stages, done. */
const done = (stages: PropertyStage[], extra: Record<string, PropertyItem> = {}) => ({
  ...Object.fromEntries(
    stages.flatMap((s) =>
      itemsForStage(s, listing(5), {})
        .filter((i) => i.requiredForStageCompletion)
        .map((i) => [i.key, row(i.key)]),
    ),
  ),
  ...extra,
});

describe("the four tabs", () => {
  it("are On the market, Sold, Settled and Withdrawn from sale, and open on On the market", () => {
    assert.deepEqual(
      LISTING_TABS.map((t) => t.label),
      ["On the market", "Sold", "Settled", "Withdrawn from sale"],
    );
    assert.equal(readTab(undefined), "market");
    assert.equal(readTab("nonsense"), "market");
    assert.equal(readTab("settled"), "settled");
    assert.equal(readTab(["withdrawn", "sold"]), "withdrawn");
  });

  it("puts a listing in Sold at exchange, and in Settled once every stage is complete and signed off", () => {
    for (const stage of [0, 1, 2, 3]) {
      assert.equal(tabFor({ storedStage: stage, withdrawn: false, allStagesComplete: false, signedOff: false }), "market");
    }
    assert.equal(tabFor({ storedStage: 4, withdrawn: false, allStagesComplete: false, signedOff: false }), "sold");
    assert.equal(tabFor({ storedStage: 5, withdrawn: false, allStagesComplete: true, signedOff: false }), "sold");
    assert.equal(tabFor({ storedStage: 5, withdrawn: false, allStagesComplete: false, signedOff: true }), "sold");
    assert.equal(tabFor({ storedStage: 5, withdrawn: false, allStagesComplete: true, signedOff: true }), "settled");
    assert.equal(tabFor({ storedStage: 2, withdrawn: true, allStagesComplete: false, signedOff: false }), "withdrawn");
  });
});

describe("what a Sold row says is left", () => {
  it("counts the cards still to do in every stage, and the sign-off on its own", () => {
    const items = done([0, 1, 2, 3], { e1: row("e1"), amp: row("amp") });
    const left = fileProgress(listing(5), items);
    // Final sale price (Sold); AML cleared, Order on the agent, Agent signature, Send to licensee (Settled).
    assert.equal(left.cardsLeft, 5);
    assert.equal(left.allStagesComplete, false);
    assert.equal(left.signedOff, false);
    assert.equal(soldLeftLine({ cards: left.cardsLeft, signOff: !left.signedOff }), "5 cards to do · Licensee sign-off to do");
  });

  it("says only the sign-off when every card is done", () => {
    const items = done([0, 1, 2, 3, 4, 5]);
    const left = fileProgress(listing(5), items);
    assert.equal(left.cardsLeft, 0);
    assert.equal(soldLeftLine({ cards: 0, signOff: true }), "Licensee sign-off to do");
    assert.equal(soldLeftLine({ cards: 1, signOff: false }), "1 card to do");
  });

  it("a signed-off file with every stage complete is Settled", () => {
    const items = done([0, 1, 2, 3, 4, 5], { sign_licensee: row("sign_licensee", { data: { signedAt: "2026-11-02T01:00:00Z" } }) });
    const p = fileProgress(listing(5), items);
    assert.equal(tabFor({ storedStage: 5, withdrawn: false, allStagesComplete: p.allStagesComplete, signedOff: p.signedOff }), "settled");
  });

  it("where the agent is the licensee, their signature counts as the sign-off, not as a card", () => {
    const items = done([0, 1, 2, 3, 4]);
    const p = fileProgress(listing(5), items, { agentIsLicensee: true });
    // AML cleared, Order on the agent, Agent signature: the Licensee signature isn't counted as a card.
    assert.equal(p.cardsLeft, 3);
    assert.equal(p.signedOff, false);
  });
});

describe("search on Settled and Withdrawn from sale", () => {
  it("matches any part of the address, any case, any spacing", () => {
    assert.equal(matchesAddress("48 Ocean Parade, Sampleton", "ocean"), true);
    assert.equal(matchesAddress("48 Ocean Parade, Sampleton", "48  ocean"), true);
    assert.equal(matchesAddress("48 Ocean Parade, Sampleton", "harbour"), false);
    assert.equal(matchesAddress("48 Ocean Parade, Sampleton", "  "), true);
  });
});

describe("Withdraw from market", () => {
  const today = "2026-11-06";

  it("offers the mockup's four reasons and words", () => {
    assert.deepEqual(
      WITHDRAW_REASONS.map((r) => r.label),
      ["Seller changed their mind", "Listed with another agency", "Agency agreement ended", "Other"],
    );
    assert.equal(
      WITHDRAW_EXPLAINER,
      "Use this when the property comes off the market without selling. The file is kept as it is, and it moves to Withdrawn from sale.",
    );
    assert.ok(WITHDRAW_WARNING.startsWith("the morning price check and reminders stop for this listing"));
    assert.equal(reasonLabel("listed_with_another_agency"), "Listed with another agency");
    assert.equal(reasonLabel("other", " Vendor renovating "), "Other: Vendor renovating");
  });

  it("needs a date that isn't in the future, a reason, and words for Other", () => {
    const ok = { withdrawnOn: "2026-11-05", reason: "seller_changed_mind", reasonOther: "", today };
    assert.equal(withdrawalProblem(ok), null);
    assert.equal(withdrawalProblem({ ...ok, withdrawnOn: "" }), "Enter the date it was withdrawn.");
    assert.equal(withdrawalProblem({ ...ok, withdrawnOn: "2026-11-07" }), "The date withdrawn can't be in the future.");
    assert.equal(withdrawalProblem({ ...ok, withdrawnOn: today }), null);
    assert.equal(withdrawalProblem({ ...ok, reason: "bored" }), "Choose a reason.");
    assert.equal(withdrawalProblem({ ...ok, reason: "other", reasonOther: "  " }), "Say why it was withdrawn.");
    assert.equal(withdrawalProblem({ ...ok, reason: "other", reasonOther: "Renovating first" }), null);
  });

  it("is offered before exchange only, and not twice", () => {
    assert.equal(canOfferWithdraw({ storedStage: 0, withdrawn: false }), true);
    assert.equal(canOfferWithdraw({ storedStage: 3, withdrawn: false }), true);
    assert.equal(canOfferWithdraw({ storedStage: 4, withdrawn: false }), false);
    assert.equal(canOfferWithdraw({ storedStage: 2, withdrawn: true }), false);
  });

  it("records each withdrawal and put-back with who and when, oldest first", () => {
    const names: Record<string, string> = { a: "Marcus Tran", l: "Lee Example" };
    const lines = withdrawalRecordLines(
      [
        {
          withdrawn_on: "2026-10-21",
          reason: "seller_changed_mind",
          reason_other: null,
          withdrawn_by: "a",
          put_back_by: "l",
          put_back_at: "2026-10-28T03:15:00Z",
        },
        { withdrawn_on: "2026-11-02", reason: "other", reason_other: "Renovating", withdrawn_by: "a", put_back_by: null, put_back_at: null },
      ],
      (id) => (id && names[id]) || "a team member",
    );
    assert.equal(lines.length, 3);
    assert.equal(lines[0], "Withdrawn on 21 October 2026 by Marcus Tran. Reason: Seller changed their mind.");
    assert.ok(lines[1].startsWith("Put back on the market on ") && lines[1].endsWith("(Sydney time) by Lee Example."));
    assert.equal(lines[2], "Withdrawn on 2 November 2026 by Marcus Tran. Reason: Other: Renovating.");
  });
});
