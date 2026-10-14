import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LICENCE_CATEGORY_GROUPS, cleanLicenceCategories, licenceSummary } from "./nsw-cpd";

// More than one type of licence (Adam, 14 Oct 2026: "select which class of
// license they hold... Keep it simple"). Trent Lloyd holds three.

describe("Licence types", () => {
  it("lists every type, grouped as Fair Trading groups them", () => {
    assert.deepEqual(
      LICENCE_CATEGORY_GROUPS.map((g) => g.title),
      ["Real estate", "Other categories"],
    );
    assert.equal(LICENCE_CATEGORY_GROUPS.flatMap((g) => g.categories).length, 8);
  });

  it("keeps known types only, once each, in the standard order", () => {
    assert.deepEqual(cleanLicenceCategories(["stock_and_station", "astrology", "residential_sales", "residential_sales"]), [
      "residential_sales",
      "stock_and_station",
    ]);
    assert.deepEqual(cleanLicenceCategories(null), []);
  });

  it("names the class and every type held, for the cards", () => {
    assert.equal(
      licenceSummary({ licence_type: "class_1", licence_categories: ["stock_and_station", "residential_sales", "business_broking"] }),
      "Class 1 licence · Residential sales · Business broking · Stock and station",
    );
    assert.equal(licenceSummary({ licence_type: "class_2", licence_categories: [] }), "Class 2 licence");
    assert.equal(licenceSummary({ licence_type: null }), "No licence on file");
  });
});
