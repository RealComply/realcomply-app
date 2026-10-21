import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PM_COPY,
  PM_EVENT_RECORDS,
  PM_PET_APPLICATION,
  PM_PET_GROUNDS,
  PM_PET_REQUEST,
  PM_STAGES,
  PM_TERMINATION_GROUNDS,
  PM_WATER_LEAK_LINE,
  pmExitItem,
  pmItem,
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
    assert.deepEqual(pmWaterResult({ metered: true, charged: true, evidence: true }), {
      state: "done",
      next: null,
      line:
        "Separately metered, tenant charged, and evidence of the water efficiency measures is on file. Taps and toilets checked for leaks at the start of this tenancy.",
    });
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
        ["Photos for advertising", "RTA ss55AA, 55A"],
        ["Landlord or agent details change", "RTA s27"],
      ],
    );
  });

  it("never says compliant", () => {
    const text = JSON.stringify([PM_STAGES, PM_TERMINATION_GROUNDS, PM_PET_GROUNDS, PM_PET_REQUEST, PM_PET_APPLICATION, PM_EVENT_RECORDS, PM_COPY, PM_WATER_LEAK_LINE]).toLowerCase();
    assert.equal(text.includes("compliant"), false);
  });
});

// The Regulation check of 21 Oct 2026 (Adam): every help line and reference
// it corrected, as it now reads. Text and references only.
describe("PM help text after the Regulation check (21 Oct 2026)", () => {
  const read = (key: string) => {
    const item = pmItem(key);
    assert.ok(item, key);
    return { help: item.help, reference: item.reference };
  };

  it("1. Pool or spa certificate", () => {
    assert.deepEqual(read("pool_certificate"), {
      help: "A valid certificate of compliance or occupation certificate (valid 3 years from issue), copy given to the tenant at signing. Not needed in a strata or community scheme of more than 2 lots",
      reference: "RT Reg Sch 1 cl 46; Swimming Pools Act 1992",
    });
  });

  it("2. Material facts disclosed", () => {
    assert.equal(read("material_facts").reference, "RTA s26(1); RT Reg cl 8");
  });

  it("3. Water usage: the Regulation, and the leak line only when the tenant is charged (Adam, 21 Oct)", () => {
    assert.equal(read("water_usage").reference, "RTA s39(1); RT Reg cl 10");
    assert.equal(PM_WATER_LEAK_LINE, "Taps and toilets checked for leaks at the start of this tenancy.");
    // Charged, and the third question answered Yes: the leak line.
    assert.ok(pmWaterResult({ metered: true, charged: true, evidence: true }).line!.endsWith(PM_WATER_LEAK_LINE));
    // Not metered, not charged, the third answered No, or not finished: no leak line.
    for (const a of [{ metered: false }, { metered: true, charged: false }, { metered: true, charged: true, evidence: false }]) {
      assert.equal(pmWaterResult(a).line!.includes("leaks"), false, JSON.stringify(a));
    }
    assert.equal(pmWaterResult({ metered: true }).line, null);
  });

  it("4. Rent payment options offered", () => {
    assert.deepEqual(read("rent_payment_options"), {
      help: "Bank transfer and Centrepay offered. No fee for paying by bank transfer",
      reference: "RTA s35; RT Reg Sch 1 cl 4",
    });
  });

  it("5 and 6. Pet grounds and pet references", () => {
    assert.equal(PM_PET_GROUNDS[0].label, "Too many animals at the property (4 or fewer is not too many)");
    assert.equal(PM_PET_REQUEST.reference, "RTA ss73D, 73F; RT Reg cl 22A");
    assert.equal(read("ad_pets").reference, "RTA s73H");
  });

  it("7. Domestic violence termination", () => {
    assert.deepEqual(read("dv_termination"), {
      help: "Co-tenants told in writing on the approved form, within 7 days after the termination date. Don't reveal the notice or evidence",
      reference: "RTA s105H",
    });
  });

  it("8. Photos for advertising", () => {
    const photos = PM_EVENT_RECORDS.find((r) => r.key === "advertising_photos")!;
    assert.equal(
      photos.help,
      "7 days' notice before taking them. Written consent before publishing, asked no more than 3 weeks before the first ad. No reply within 7 days means no",
    );
    assert.equal(photos.reference, "RTA ss55AA, 55A");
  });

  it("9. End-of-tenancy survey", () => {
    assert.deepEqual(read("exit_survey"), {
      help: "In Rental Bonds Online when the bond claim is made (or within 14 days of a tenant's claim you haven't agreed to)",
      reference: "RTA s222A; RT Reg cl 23L",
    });
  });

  it("10. Termination statement and supporting documents", () => {
    assert.equal(read("termination_statement").reference, "RTA ss85, 86; RT Reg cl 23A to 23I");
    // A ground with no clause of its own keeps the item's references.
    const statement = pmItem("termination_statement")!;
    assert.equal(pmExitItem(statement, "landlord", "offered_for_sale").reference, "RTA ss85, 86; RT Reg cl 23A to 23I");
  });

  it("11. Renovation ground: its documents and their clause", () => {
    const statement = pmExitItem(pmItem("termination_statement")!, "landlord", "renovation");
    assert.equal(
      statement.help,
      "The termination information statement, plus the landlord's signed statement on the works, why the property must be vacant, and the start date",
    );
    assert.equal(statement.reference, "RTA ss85, 86; RT Reg cl 23D");
    // The ground's own reference, for its notice period and exclusion, is unchanged.
    assert.equal(pmExitItem(pmItem("notice_period")!, "landlord", "renovation").reference, "RTA s87F");
  });

  it("no annual smoke alarm check (Adam, 21 Oct): smoke alarms stay a start-of-tenancy tick only", () => {
    const smoke = PM_STAGES.flatMap((s) => s.items).filter((i) => /smoke/i.test(i.title));
    assert.deepEqual(smoke.map((i) => [i.key, i.help]), [["smoke_alarms", "Working at the start of the tenancy"]]);
  });

  it("no help line ends in a full stop, like the rest", () => {
    for (const item of PM_STAGES.flatMap((s) => s.items)) assert.equal(item.help.endsWith("."), false, item.key);
  });
});
