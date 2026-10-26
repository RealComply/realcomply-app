import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inviteOptions, inviteRoleLabel, type InviteOptionsInput } from "./invite-options";

const licenseeView: InviteOptionsInput = {
  isLicensee: true,
  isOfficeManager: false,
  isAgentPlan: false,
  officeHasLicenseeLogin: true,
  pmEnabled: true,
  licenseeName: null,
  licenseeEmail: null,
};

const managerNoLogin: InviteOptionsInput = {
  isLicensee: false,
  isOfficeManager: true,
  isAgentPlan: false,
  officeHasLicenseeLogin: false,
  pmEnabled: true,
  licenseeName: "Jordan Blake",
  licenseeEmail: "jordan@example.invalid",
};

const available = (input: InviteOptionsInput) =>
  inviteOptions(input)
    .filter((o) => o.available)
    .map((o) => o.role);

describe("inviteOptions", () => {
  it("offers the licensee in charge everything but inviting a licensee in charge", () => {
    assert.deepEqual(available(licenseeView), ["agent", "assistant", "office_manager", "property_manager"]);
    const lic = inviteOptions(licenseeView).find((o) => o.role === "licensee_in_charge");
    assert.equal(lic?.available, false);
    assert.match(lic?.note ?? "", /Change licensee in charge in Office profile/);
  });

  it("lets an office manager invite the named licensee where the licensee isn't on RealComply", () => {
    assert.deepEqual(available(managerNoLogin), ["agent", "assistant", "licensee_in_charge", "property_manager"]);
    const lic = inviteOptions(managerNoLogin).find((o) => o.role === "licensee_in_charge");
    assert.equal(lic?.hint, "Jordan Blake, as in Office profile.");
    const om = inviteOptions(managerNoLogin).find((o) => o.role === "office_manager");
    assert.equal(om?.available, false);
    assert.match(om?.note ?? "", /Once Jordan Blake has joined/);
  });

  it("doesn't let an office manager invite a licensee who is already on RealComply", () => {
    const opts = inviteOptions({ ...managerNoLogin, officeHasLicenseeLogin: true });
    assert.equal(opts.find((o) => o.role === "licensee_in_charge")?.available, false);
    assert.equal(opts.find((o) => o.role === "office_manager")?.available, false);
  });

  it("can't invite a licensee in charge with no email in Office profile", () => {
    const lic = inviteOptions({ ...managerNoLogin, licenseeEmail: "  " }).find((o) => o.role === "licensee_in_charge");
    assert.equal(lic?.available, false);
    assert.match(lic?.note ?? "", /admin@realcomply\.com\.au/);
  });

  it("shows Property manager only where the plan includes property management", () => {
    assert.equal(
      inviteOptions({ ...licenseeView, pmEnabled: false }).some((o) => o.role === "property_manager"),
      false,
    );
  });

  it("offers only Agent and Assistant on an agent plan", () => {
    assert.deepEqual(
      inviteOptions({ ...licenseeView, isLicensee: false, isAgentPlan: true, pmEnabled: false }).map((o) => o.role),
      ["agent", "assistant"],
    );
  });

  it("never uses a dash in what it says", () => {
    for (const input of [licenseeView, managerNoLogin, { ...managerNoLogin, licenseeEmail: null }]) {
      for (const o of inviteOptions(input)) {
        assert.doesNotMatch(`${o.hint} ${o.note ?? ""}`, /[—–]/);
      }
    }
  });
});

describe("inviteRoleLabel", () => {
  it("names each role", () => {
    const base = { is_licensee_in_charge: false, is_assistant: false };
    assert.equal(inviteRoleLabel(base), "Agent");
    assert.equal(inviteRoleLabel({ ...base, is_assistant: true }), "Assistant");
    assert.equal(inviteRoleLabel({ ...base, is_licensee_in_charge: true }), "Licensee in charge");
    assert.equal(inviteRoleLabel({ ...base, is_office_manager: true }), "Office manager");
    assert.equal(inviteRoleLabel({ ...base, is_property_manager: true }), "Property manager");
  });
});
