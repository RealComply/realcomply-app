import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStaffReminderEmail, staffReminderSubject } from "./staff-reminder";

// Builders only: nothing here sends an email.

const base = {
  recipientName: "Alex",
  senderName: "Sam Nguyen",
  senderRole: "office manager",
  officeName: "Harbour Street Realty",
  sgVersionLabel: "Version 3",
  appUrl: "https://www.realcomply.com.au",
};

describe("the staff reminder email", () => {
  it("says in the subject what is still to do", () => {
    assert.equal(
      staffReminderSubject({ ...base, kinds: ["sg_manual_sign", "sg_read"] }),
      "Please sign and read Harbour Street Realty's Supervision Guidelines",
    );
    assert.equal(
      staffReminderSubject({ ...base, kinds: ["sg_manual_sign"] }),
      "Please sign Harbour Street Realty's Supervision Guidelines Manual",
    );
    assert.equal(
      staffReminderSubject({ ...base, kinds: ["sg_read"] }),
      "Please read Harbour Street Realty's Supervision Guidelines",
    );
  });

  it("names who asked, lists each thing once, and links to where it's done", () => {
    const both = buildStaffReminderEmail({ ...base, kinds: ["sg_manual_sign", "sg_read"] });
    assert.ok(both.text.includes("Sam Nguyen, office manager at Harbour Street Realty, has asked you to:"));
    assert.ok(both.text.includes("Sign the Supervision Guidelines Manual"));
    assert.ok(both.text.includes("Version 3"));
    assert.ok(both.text.includes("then tick to confirm"));
    assert.ok(both.text.includes("https://www.realcomply.com.au/dashboard/sg-manual"));
    const read = buildStaffReminderEmail({ ...base, kinds: ["sg_read"] });
    assert.ok(read.text.includes("https://www.realcomply.com.au/dashboard/home"));
    assert.ok(!read.text.includes("Sign the Supervision Guidelines Manual"));
  });

  it("has a plain-text part and no em dashes outside the shared diligence line", () => {
    const { text, html } = buildStaffReminderEmail({ ...base, kinds: ["sg_read"] });
    assert.ok(text.length > 0 && html.length > 0);
    assert.ok(!text.split("RealComply provides diligence support")[0].includes("—"));
  });
});
