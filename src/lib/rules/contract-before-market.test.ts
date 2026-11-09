import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTRACT_NEEDED, S63_URL, completeStageRefusal, contractRefusalParts } from "./contract-before-market";
import { getItem, itemsForStage } from "./nsw-sales";
import type { Property } from "@/lib/types";

const contract = { key: "b1", label: "Contract of sale prepared with prescribed documents" };
const approved = { key: "b3", label: "Vendor approved all marketing material" };

describe("the contract before the market (Adam, 5 Nov 2026)", () => {
  it("is Master's final wording, with section 63 linked", () => {
    assert.equal(CONTRACT_NEEDED, "Contract needed before the property goes on the market.");
    assert.equal(S63_URL, "https://legislation.nsw.gov.au/view/html/inforce/current/act-2002-066#sec.63");
  });

  it("splits a refusal for the page: the title, then any other cards", () => {
    assert.deepEqual(contractRefusalParts(CONTRACT_NEEDED), { also: null });
    assert.deepEqual(contractRefusalParts(`${CONTRACT_NEEDED} Also complete: X.`), { also: "Also complete: X." });
    assert.equal(contractRefusalParts("Complete these first: X."), null);
    assert.equal(contractRefusalParts(null), null);
  });

  it("refuses On market while the contract card isn't done", () => {
    assert.equal(completeStageRefusal({ stage: 1, incomplete: [contract] }), CONTRACT_NEEDED);
  });

  it("says the contract first, then the other cards", () => {
    assert.equal(
      completeStageRefusal({ stage: 1, incomplete: [contract, approved] }),
      `${CONTRACT_NEEDED} Also complete: Vendor approved all marketing material.`,
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
