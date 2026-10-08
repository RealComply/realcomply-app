import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listingAlertDocument } from "./listing-price-alert";
import { renderEmailText } from "./layout";

const base = {
  agentName: "Sam Lee",
  address: "24/1 Citrus Avenue, Hornsby",
  url: "https://cassproperty.com.au/property/24-1-citrus-avenue-hornsby",
  propertyId: "97c74454-1826-4896-9691-ca4bc3979b5d",
};

describe("listingAlertDocument", () => {
  it("names each red flag as a risk row with its explanation", () => {
    const doc = listingAlertDocument({
      ...base,
      flags: [
        { kind: "below_esp", text: "Advertised price starts at $700,000, below the ESP of $750,000 on this file (s73(1))." },
        { kind: "no_price", text: "No price is shown on the listing page. Add the price guide to the ad." },
      ],
    });

    const rows = doc.sections.find((s) => s.kind === "rows");
    assert.ok(rows && rows.kind === "rows");
    assert.deepEqual(
      rows.rows.map((r) => [r.title, r.tone]),
      [
        ["Advertised below the ESP", "risk"],
        ["No price showing", "risk"],
      ],
    );
    assert.equal(doc.title, "Hi Sam,");
  });

  it("links to the listing and says which page was checked", () => {
    const text = renderEmailText(
      listingAlertDocument({ ...base, flags: [{ kind: "no_price", text: "No price is shown." }] }),
    );
    assert.match(text, /\/dashboard\/97c74454-1826-4896-9691-ca4bc3979b5d/);
    assert.match(text, /Page checked: https:\/\/cassproperty\.com\.au\/property\/24-1-citrus-avenue-hornsby/);
  });
});
