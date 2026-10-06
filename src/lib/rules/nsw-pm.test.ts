import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PM_COPY,
  PM_EVENT_RECORDS,
  PM_PET_APPLICATION,
  PM_PET_GROUNDS,
  PM_PET_REQUEST,
  PM_TERMINATION_GROUNDS,
  pmPetReplyBy,
  pmRetentionUntil,
  pmWaterClean,
  pmWaterResult,
} from "./nsw-pm";

describe("PM water usage questions (brief B5)", () => {
  it("asks the questions one at a time", () => {
    assert.equal(pmWaterResult({}).next, "metered");
    assert.equal(pmWaterResult({ metered: true }).next, "charged");
    assert.equal(pmWaterResult({ metered: true, charged: true }).next, "evidence");
  });

  it("No to the first or second question finishes the item", () => {
    assert.deepEqual(pmWaterResult({ metered: false }), {
      state: "done",
      next: null,
      line: "Not separately metered. Water usage is not charged.",
    });
    assert.deepEqual(pmWaterResult({ metered: true, charged: false }), {
      state: "done",
      next: null,
      line: "Tenant is not charged for water usage.",
    });
  });

  it("Yes to the third finishes it; No leaves it open with the blocking line", () => {
    assert.equal(pmWaterResult({ metered: true, charged: true, evidence: true }).state, "done");
    assert.deepEqual(pmWaterResult({ metered: true, charged: true, evidence: false }), {
      state: "open",
      next: null,
      line: "Water cannot be charged until the property meets the water efficiency measures.",
    });
  });

  it("keeps only answers that were asked, and refuses anything that is not yes or no", () => {
    assert.deepEqual(pmWaterClean({ metered: false, charged: true, evidence: true }), { metered: false });
    assert.deepEqual(pmWaterClean({ charged: true }), {});
    assert.equal(pmWaterClean({ metered: "yes" }), null);
    assert.equal(pmWaterClean(null), null);
  });

  it("never uses the word certificate", () => {
    const text = JSON.stringify([pmWaterResult({ metered: true, charged: true, evidence: false })]).toLowerCase();
    assert.equal(text.includes("certificate"), false);
  });
});

describe("PM retention (brief B4)", () => {
  it("keeps the file 3 years from the date entered", () => {
    assert.equal(pmRetentionUntil("2026-10-06"), "2029-10-06");
    assert.equal(pmRetentionUntil("2028-02-29"), "2031-03-01", "a 29 February rolls forward, never early");
  });

  it("the reminder never says the file can or should be deleted", () => {
    assert.equal(
      PM_COPY.retentionEmail,
      "The 3-year period for this file has passed. Whether to keep or destroy it is your decision.",
    );
    assert.equal(/delete|can be destroyed|should be destroyed|free to/i.test(PM_COPY.retentionEmail), false);
    assert.equal(
      PM_COPY.retentionTenant("6 Oct 2029"),
      "Keep this tenant's file until 6 Oct 2029. RealComply will email you a reminder then.",
    );
  });
});

describe("PM grounds and pets content", () => {
  it("has the six termination grounds from the brief, sold and offered for sale kept apart", () => {
    assert.deepEqual(
      PM_TERMINATION_GROUNDS.map((g) => g.label),
      [
        "Owner/family member moving in",
        "Property sold, contract needs vacant possession",
        "Property to be offered for sale",
        "Renovation",
        "Tenant breach or arrears",
        "Another listed ground",
      ],
    );
  });

  it("has the six pet grounds and the 21-day reply only on a tenant's request", () => {
    assert.equal(PM_PET_GROUNDS.length, 6);
    assert.equal(pmPetReplyBy("2026-10-06"), "2026-10-27");
    assert.equal(pmPetReplyBy("2026-12-20"), "2027-01-10");
    assert.equal(PM_PET_REQUEST.replyDays, 21);
    assert.equal("replyDays" in PM_PET_APPLICATION, false);
  });

  it("the application recorder never says the law requires anything", () => {
    const text = JSON.stringify(PM_PET_APPLICATION).toLowerCase();
    for (const word of ["require", "must", "law", "rta"]) assert.equal(text.includes(word), false, word);
  });

  it("the three When it happens rows match the brief", () => {
    assert.deepEqual(
      PM_EVENT_RECORDS.map((r) => [r.title, r.reference]),
      [
        ["Property being sold", "PSA Reg Sch 2 s23; RTA s76"],
        ["Photos for advertising", "RTA ss55(2)(d1), 55A"],
        ["Landlord or agent details change", "RTA s27"],
      ],
    );
  });

  it("never says compliant", () => {
    const text = JSON.stringify([PM_TERMINATION_GROUNDS, PM_PET_GROUNDS, PM_PET_REQUEST, PM_PET_APPLICATION, PM_EVENT_RECORDS, PM_COPY]).toLowerCase();
    assert.equal(text.includes("compliant"), false);
  });
});
