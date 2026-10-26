import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accessFrom, worksAsAgentPlan } from "./access";
import { NAV_LINKS, visibleNavLink } from "./nav";

const licensee = { is_licensee_in_charge: true, is_assistant: false, archived_at: null };
const agent = { is_licensee_in_charge: false, is_assistant: false, archived_at: null };
const assistant = { is_licensee_in_charge: false, is_assistant: true, archived_at: null };

function menuFor(actsAsLicensee: boolean): string[] {
  return NAV_LINKS.filter((l) => visibleNavLink(l, { actsAsLicensee, pmEnabled: true })).map((l) => l.label);
}

describe("accessFrom", () => {
  it("the licensee in charge of an office has everything, complaints included", () => {
    assert.deepEqual(accessFrom(licensee, { plan: "office_1" }), {
      actsAsLicensee: true,
      officeLicensee: true,
      isAssistant: false,
      worksAsAgentPlan: false,
    });
  });

  it("an agent in an office is not the licensee", () => {
    const a = accessFrom(agent, { plan: "office_2" });
    assert.equal(a.actsAsLicensee, false);
    assert.equal(a.officeLicensee, false);
  });

  it("an agent on their own plan counts as the licensee, except for complaints", () => {
    const a = accessFrom(agent, { plan: "agent_1" });
    assert.equal(a.actsAsLicensee, true);
    assert.equal(a.officeLicensee, false);
    assert.equal(a.worksAsAgentPlan, true);
  });

  it("even a licensee in charge on an agent plan has no complaints register", () => {
    assert.equal(accessFrom(licensee, { plan: "agent_2" }).officeLicensee, false);
  });

  it("an archived person is nobody", () => {
    const a = accessFrom({ ...licensee, archived_at: "2026-10-01T00:00:00Z" }, { plan: "office_1" });
    assert.equal(a.actsAsLicensee, false);
    assert.equal(a.officeLicensee, false);
  });

  it("an assistant to an agent on their own plan is not the licensee", () => {
    const a = accessFrom(assistant, { plan: "agent_1" });
    assert.equal(a.actsAsLicensee, false);
    assert.equal(a.isAssistant, true);
  });

  it("an assistant is flagged as one", () => {
    assert.equal(accessFrom(assistant, { plan: "office_1" }).isAssistant, true);
    assert.equal(accessFrom(assistant, { plan: "office_1" }).actsAsLicensee, false);
  });
});

// An office plan run by someone who isn't the licensee in charge (Adam,
// 26 Oct 2026; 0092): exactly like an agent plan.
describe("an office whose licensee in charge isn't on RealComply", () => {
  const office = { plan: "office_1", licensee_not_on_realcomply: true };

  it("works as an agent plan", () => {
    assert.equal(worksAsAgentPlan(office), true);
    assert.equal(worksAsAgentPlan({ plan: "office_1", licensee_not_on_realcomply: false }), false);
    assert.equal(worksAsAgentPlan({ plan: "office_1" }), false);
    assert.equal(worksAsAgentPlan({ plan: "agent_1" }), true);
    assert.equal(worksAsAgentPlan(null), false);
  });

  it("the person who signed up counts as the licensee, as an agent on their own plan does", () => {
    const a = accessFrom(agent, office);
    assert.equal(a.actsAsLicensee, true);
    assert.equal(a.officeLicensee, false);
    assert.equal(a.worksAsAgentPlan, true);
  });

  it("an assistant there is not the licensee", () => {
    assert.equal(accessFrom(assistant, office).actsAsLicensee, false);
  });

  it("before 0092 has run (no column), an office plan is an office plan", () => {
    assert.equal(accessFrom(agent, { plan: "office_1", licensee_not_on_realcomply: undefined }).actsAsLicensee, false);
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
