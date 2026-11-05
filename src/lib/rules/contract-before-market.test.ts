import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTRACT_BEFORE_MARKET, completeStageRefusal } from "./contract-before-market";
import { getItem, itemsForStage } from "./nsw-sales";
import type { Property } from "@/lib/types";

const contract = { key: "b1", label: "Contract of sale prepared with prescribed documents" };
const approved = { key: "b3", label: "Vendor approved all marketing material" };

describe("the contract before the market (Adam, 5 Nov 2026)", () => {
  it("is the brief's message, word for word", () => {
    assert.equal(
      CONTRACT_BEFORE_MARKET,
      "Upload the contract before the property goes on the market. In NSW a property can't be offered for sale until the contract is available for inspection.",
    );
  });

  it("refuses On market while the contract card isn't done", () => {
    assert.equal(completeStageRefusal({ stage: 1, incomplete: [contract] }), CONTRACT_BEFORE_MARKET);
  });

  it("says the contract first, then the other cards", () => {
    assert.equal(
      completeStageRefusal({ stage: 1, incomplete: [contract, approved] }),
      `${CONTRACT_BEFORE_MARKET} Also complete: Vendor approved all marketing material.`,
    );
  });

  it("lets Pre-market finish once the contract card is done", () => {
    assert.equal(completeStageRefusal({ stage: 1, incomplete: [] }), null);
  });

  it("says the other cards as before when the contract card is done", () => {
    assert.equal(
      completeStageRefusal({ stage: 1, incomplete: [approved] }),
      "Complete these first: Vendor approved all marketing material.",
    );
  });

  it("leaves every other stage as it was", () => {
    assert.equal(completeStageRefusal({ stage: 0, incomplete: [] }), null);
    assert.equal(
      completeStageRefusal({ stage: 2, incomplete: [{ key: "c0", label: "Listing launch date" }] }),
      "Complete these first: Listing launch date.",
    );
  });

  it("keeps the contract card in Pre-market, required, after the date it was received", () => {
    const listing = { id: "p", stage: 1, test_mode: false, sale_method: "private_treaty" } as unknown as Property;
    const keys = itemsForStage(1, listing, {}).map((i) => i.key);
    assert.deepEqual(keys.slice(0, 2), ["b1a", "b1"]);
    assert.equal(getItem("b1")?.requiredForStageCompletion, true);
    assert.equal(getItem("b1")?.stage, 1);
  });
});
