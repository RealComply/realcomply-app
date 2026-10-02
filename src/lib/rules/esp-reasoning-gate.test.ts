import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MISSING_ON_MARKET,
  MISSING_REASONING,
  espReasoningComplete,
  espReasoningMissing,
  isRealReasoning,
  waitsForEspReasoning,
  heldForEspReasoning,
  withEffectiveEspStatus,
} from "./esp-reasoning-gate";
import { editedInWording } from "./esp-reasoning-adoption";

const REASONING = "Relied on 14 Smith St and 8 Jones Ave, both three bedroom on similar land.";
const NONE = { confirmedBy: "u1", confirmedAt: "2026-10-02T00:00:00Z" };

describe("isRealReasoning", () => {
  it("rejects empty, whitespace and placeholders", () => {
    for (const t of [undefined, null, "", "   \n ", "N/A", "n/a", "NA", "none", "TBC", "see attached", "x", "12345", "--"]) {
      assert.equal(isRealReasoning(t), false, String(t));
    }
  });
  it("accepts real text", () => {
    assert.equal(isRealReasoning(REASONING), true);
  });
});

describe("espReasoningMissing", () => {
  it("asks for both when the card is empty (the Summerhaze case)", () => {
    assert.deepEqual(espReasoningMissing({ data: {}, onMarketCount: 0, signedOff: false }), [
      MISSING_REASONING,
      MISSING_ON_MARKET,
    ]);
  });
  it("counts N/A as no reasoning", () => {
    const m = espReasoningMissing({ data: { note: "N/A", noneOnMarket: NONE }, onMarketCount: 0, signedOff: false });
    assert.deepEqual(m, [MISSING_REASONING]);
  });
  it("is satisfied by reasoning plus at least one listing", () => {
    assert.deepEqual(espReasoningMissing({ data: { note: REASONING }, onMarketCount: 1, signedOff: false }), []);
  });
  it("is satisfied by reasoning plus 'none on the market' confirmed", () => {
    assert.deepEqual(
      espReasoningMissing({ data: { note: REASONING, noneOnMarket: NONE }, onMarketCount: 0, signedOff: false }),
      [],
    );
  });
  it("still asks for on-market with reasoning but no listings and no confirmation", () => {
    assert.deepEqual(espReasoningMissing({ data: { note: REASONING }, onMarketCount: 0, signedOff: false }), [
      MISSING_ON_MARKET,
    ]);
  });
  it("does not count a legacy 'recorded elsewhere' tick on an unsigned file", () => {
    const m = espReasoningMissing({ data: { loggedElsewhere: true }, onMarketCount: 1, signedOff: false });
    assert.deepEqual(m, [MISSING_REASONING]);
  });
  it("keeps a legacy 'recorded elsewhere' tick on a signed-off file", () => {
    const m = espReasoningMissing({ data: { loggedElsewhere: true }, onMarketCount: 1, signedOff: true });
    assert.deepEqual(m, []);
  });
});

describe("espReasoningComplete", () => {
  it("needs the agent to have marked it done", () => {
    assert.equal(
      espReasoningComplete({ status: "open", data: { note: REASONING }, onMarketCount: 1, signedOff: false }),
      false,
    );
  });
  it("a done card with nothing in it is not complete", () => {
    assert.equal(espReasoningComplete({ status: "done", data: {}, onMarketCount: 0, signedOff: false }), false);
  });
  it("a signed-off file keeps what was signed", () => {
    assert.equal(espReasoningComplete({ status: "done", data: {}, onMarketCount: 0, signedOff: true }), true);
  });
});

describe("withEffectiveEspStatus", () => {
  it("reads an empty done card as open, leaving other cards alone", () => {
    const items = { a4c: { status: "done", data: {} }, a1: { status: "done", data: {} } };
    const out = withEffectiveEspStatus(items, { onMarketCount: 0 });
    assert.equal(out.a4c.status, "open");
    assert.equal(out.a1.status, "done");
    assert.equal(items.a4c.status, "done");
  });
  it("leaves it done once the licensee has signed", () => {
    const items = { a4c: { status: "done", data: {} }, sign_licensee: { status: "done", data: {} } };
    assert.equal(withEffectiveEspStatus(items, { onMarketCount: 0 }).a4c.status, "done");
  });
});

describe("waitsForEspReasoning", () => {
  it("holds later cards but not Listing set-up or the ESP card itself", () => {
    assert.equal(waitsForEspReasoning("a4c"), false);
    assert.equal(waitsForEspReasoning("a1"), false);
    assert.equal(waitsForEspReasoning("b1"), true);
    assert.equal(waitsForEspReasoning("not_a_card"), false);
  });
});

describe("edit first, as the server checks it", () => {
  it("treats the server's draft saved unchanged as not edited", () => {
    const draft = "My estimated selling price is $1,300,000 to $1,400,000.";
    assert.equal(editedInWording(draft, `  ${draft}\n`), false);
    assert.equal(editedInWording(draft, `${draft} I also weighed the larger block.`), true);
  });
});

describe("heldForEspReasoning", () => {
  it("holds a file past Listing set-up while the card is incomplete", () => {
    assert.equal(heldForEspReasoning({ stage: 2, testMode: false, espComplete: false }), true);
  });
  it("releases it once the card is complete", () => {
    assert.equal(heldForEspReasoning({ stage: 2, testMode: false, espComplete: true }), false);
  });
  it("never holds in test mode or at Listing set-up", () => {
    assert.equal(heldForEspReasoning({ stage: 3, testMode: true, espComplete: false }), false);
    assert.equal(heldForEspReasoning({ stage: 0, testMode: false, espComplete: false }), false);
  });
});
