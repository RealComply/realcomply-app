import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficeManagerApprovedEmail,
  buildOfficeManagerRequestEmail,
  buildOfficeManagerWithdrawnEmail,
  LICENSEE_KEEPS,
  OFFICE_MANAGER_CAN,
} from "./office-manager";

// Builders only: nothing here sends an email.

const wording = "I authorise Sam Nguyen to manage Harbour Street Realty's RealComply account as office manager.";

describe("the office manager request email", () => {
  const email = buildOfficeManagerRequestEmail({
    personName: "Sam Nguyen",
    officeName: "Harbour Street Realty",
    wording,
    url: "https://www.realcomply.com.au/office-manager/00000000-0000-0000-0000-000000000000",
    expiresAt: "26 November 2026",
  });

  it("leads with the person and the office, and does not name RealComply in the subject", () => {
    assert.equal(email.subject, "Sam Nguyen has asked you to approve them as office manager for Harbour Street Realty");
    assert.ok(!email.subject.includes("RealComply"));
  });

  it("carries the wording word for word, both lists and the link, in both parts", () => {
    assert.ok(email.text.includes(wording));
    assert.ok(email.html.includes("I authorise Sam Nguyen to manage Harbour Street Realty"));
    for (const line of [...OFFICE_MANAGER_CAN, ...LICENSEE_KEEPS]) {
      assert.ok(email.text.includes(line), line);
      assert.ok(email.html.includes(line.split(" (")[0]), line);
    }
    assert.ok(email.text.includes("https://www.realcomply.com.au/office-manager/"));
    assert.ok(email.html.includes("https://www.realcomply.com.au/office-manager/"));
  });

  it("says what to do if it's not wanted, and when the link stops working", () => {
    assert.ok(email.text.includes("don't approve it"));
    assert.ok(email.text.includes("expires on 26 November 2026"));
  });

  it("has no em dashes in what the licensee reads, other than the shared diligence line", () => {
    const body = email.text.split("RealComply provides diligence support")[0];
    assert.ok(!body.includes("—"));
  });
});

describe("the confirmation and withdrawal emails", () => {
  it("records who approved, when and the wording, with the withdraw link", () => {
    const email = buildOfficeManagerApprovedEmail({
      personName: "Sam Nguyen",
      officeName: "Harbour Street Realty",
      approvedByName: "Jordan Blake",
      approvedAt: "27 October 2026, 9:14 am",
      wording,
      withdrawUrl: "https://www.realcomply.com.au/office-manager/withdraw/11111111-1111-1111-1111-111111111111",
    });
    assert.equal(email.subject, "You approved Sam Nguyen as office manager for Harbour Street Realty");
    for (const s of [wording, "Jordan Blake", "27 October 2026, 9:14 am", "/office-manager/withdraw/"]) {
      assert.ok(email.text.includes(s), s);
    }
  });

  it("tells the office manager who withdrew it and when", () => {
    const email = buildOfficeManagerWithdrawnEmail({
      personName: "Sam Nguyen",
      officeName: "Harbour Street Realty",
      withdrawnByName: "Jordan Blake",
      withdrawnAt: "3 November 2026 at 4:40 pm",
    });
    assert.equal(email.subject, "Jordan Blake has withdrawn your office manager approval");
    assert.ok(email.text.includes("3 November 2026 at 4:40 pm"));
  });
});
