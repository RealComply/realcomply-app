import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accessFrom } from "./access";
import { NAV_LINKS, visibleNavLink } from "./nav";

const licensee = { is_licensee_in_charge: true, is_assistant: false, archived_at: null };
const agent = { is_licensee_in_charge: false, is_assistant: false, archived_at: null };
const assistant = { is_licensee_in_charge: false, is_assistant: true, archived_at: null };

function menuFor(actsAsLicensee: boolean): string[] {
  return NAV_LINKS.filter((l) => visibleNavLink(l, { actsAsLicensee, pmEnabled: true })).map((l) => l.label);
}

describe("accessFrom", () => {
  it("the licensee in charge of an office has everything, complaints included", () => {
    assert.deepEqual(accessFrom(licensee, "office_1"), {
      actsAsLicensee: true,
      officeLicensee: true,
      isAssistant: false,
      isAgentPlan: false,
      runsOffice: true,
      isOfficeManager: false,
    });
  });

  it("an agent in an office is not the licensee", () => {
    const a = accessFrom(agent, "office_2");
    assert.equal(a.actsAsLicensee, false);
    assert.equal(a.officeLicensee, false);
  });

  it("an agent on their own plan counts as the licensee, except for complaints", () => {
    const a = accessFrom(agent, "agent_1");
    assert.equal(a.actsAsLicensee, true);
    assert.equal(a.officeLicensee, false);
    assert.equal(a.isAgentPlan, true);
  });

  it("even a licensee in charge on an agent plan has no complaints register", () => {
    assert.equal(accessFrom(licensee, "agent_2").officeLicensee, false);
  });

  it("an archived person is nobody", () => {
    const a = accessFrom({ ...licensee, archived_at: "2026-10-01T00:00:00Z" }, "office_1");
    assert.equal(a.actsAsLicensee, false);
    assert.equal(a.officeLicensee, false);
  });

  it("an assistant to an agent on their own plan is not the licensee", () => {
    const a = accessFrom(assistant, "agent_1");
    assert.equal(a.actsAsLicensee, false);
    assert.equal(a.isAssistant, true);
  });

  it("an assistant is flagged as one", () => {
    assert.equal(accessFrom(assistant, "office_1").isAssistant, true);
    assert.equal(accessFrom(assistant, "office_1").actsAsLicensee, false);
  });
});

describe("an office manager (0093)", () => {
  const agent = { is_licensee_in_charge: false, is_assistant: false };

  it("runs the office side, but is not the licensee", () => {
    const a = accessFrom(agent, "office_1", true);
    assert.equal(a.runsOffice, true);
    assert.equal(a.isOfficeManager, true);
    assert.equal(a.actsAsLicensee, false);
    assert.equal(a.officeLicensee, false);
  });

  it("is nothing without the licensee's approval", () => {
    const a = accessFrom(agent, "office_1");
    assert.equal(a.runsOffice, false);
    assert.equal(a.isOfficeManager, false);
  });

  it("is never one on an agent plan, or once removed from the office", () => {
    assert.equal(accessFrom({ ...agent, is_assistant: true }, "agent_1", true).isOfficeManager, false);
    assert.equal(accessFrom({ ...agent, archived_at: "2026-10-26T00:00:00Z" }, "office_1", true).runsOffice, false);
  });

  it("the licensee still runs the office, office manager or not", () => {
    assert.equal(accessFrom({ is_licensee_in_charge: true, is_assistant: false }, "office_1").runsOffice, true);
  });

  it("gets the licensee's menu, without Office overview", () => {
    const menu = NAV_LINKS.filter((l) =>
      visibleNavLink(l, { actsAsLicensee: false, runsOffice: true, pmEnabled: true }),
    ).map((l) => l.label);
    const licensee = NAV_LINKS.filter((l) => visibleNavLink(l, { actsAsLicensee: true, pmEnabled: true })).map(
      (l) => l.label,
    );
    assert.deepEqual(menu, licensee.filter((label) => label !== "Office overview"));
    for (const label of ["Team", "Registers", "Trust accounts", "SG Manual", "Billing", "Training", "CPD"]) {
      assert.ok(menu.includes(label), label);
    }
  });
});

describe("visibleNavLink", () => {
  it("an agent or assistant gets their own work only", () => {
    assert.deepEqual(menuFor(false), [
      "Home",
      "Listings",
      "Property management",
      "Registers",
      "Training",
      "CPD",
      "Sign-offs",
      "SG Manual",
      "Getting started",
      "Did you know?",
    ]);
  });

  it("everyone gets Did you know?, directly below Getting started (15 Oct 2026)", () => {
    for (const viewer of [
      { actsAsLicensee: true, pmEnabled: false },
      { actsAsLicensee: false, pmEnabled: false },
      { actsAsLicensee: false, pmEnabled: true, isAccountHolder: true },
    ]) {
      const menu = NAV_LINKS.filter((l) => visibleNavLink(l, viewer)).map((l) => l.label);
      assert.equal(menu[menu.indexOf("Getting started") + 1], "Did you know?", JSON.stringify(viewer));
    }
  });

  it("the licensee keeps the whole menu, Billing included", () => {
    const menu = menuFor(true);
    for (const label of ["Office overview", "Trust accounts", "Team", "Billing", "Getting started", "Did you know?"]) {
      assert.ok(menu.includes(label), label);
    }
    assert.equal(menu.length, NAV_LINKS.length);
  });

  it("the account holder who is not the licensee gets Billing, and nothing else of the licensee's", () => {
    const menu = NAV_LINKS.filter((l) =>
      visibleNavLink(l, { actsAsLicensee: false, pmEnabled: true, isAccountHolder: true }),
    ).map((l) => l.label);
    // Billing sits in Agency, above the Help group, so compare as sets.
    assert.deepEqual([...menu].sort(), [...menuFor(false), "Billing"].sort());
  });

  it("an agent who is not the account holder does not get Billing", () => {
    const billing = NAV_LINKS.find((l) => l.label === "Billing")!;
    assert.equal(visibleNavLink(billing, { actsAsLicensee: false, pmEnabled: true, isAccountHolder: false }), false);
  });

  it("property management only shows where it is switched on", () => {
    const pm = NAV_LINKS.find((l) => l.label === "Property management")!;
    assert.equal(visibleNavLink(pm, { actsAsLicensee: true, pmEnabled: false }), false);
  });
});
