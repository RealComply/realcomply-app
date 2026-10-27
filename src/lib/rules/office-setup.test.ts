import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  groupCounts,
  officeSetupSteps,
  setupSummary,
  staffSetupSteps,
  type OfficeSetupInput,
  type SetupPerson,
  type SetupStep,
} from "./office-setup";

// "Set up your office" (Adam, 27 Oct 2026, with the agent's own plan
// addendum the same day). Every step ticks itself from what is in RealComply.

function person(id: string, over: Partial<SetupPerson> = {}): SetupPerson {
  return {
    id,
    full_name: id,
    email: `${id}@example.invalid`,
    is_agent: true,
    is_assistant: false,
    is_licensee_in_charge: false,
    licence_type: null,
    licence_document_path: null,
    licence_expiry: null,
    licence_categories: [],
    archived_at: null,
    ...over,
  };
}

const lee = person("lee", { full_name: "Lee Licensee", is_licensee_in_charge: true });

/** A brand-new office: only its licensee, nothing set up. */
function fresh(over: Partial<OfficeSetupInput> = {}): OfficeSetupInput {
  return {
    kind: "office",
    viewer: { id: "lee", isOfficeManager: false },
    agency: {
      name: "Made Up Realty",
      licensee_name: null,
      licensee_email: null,
      website_url: null,
      logo_path: null,
      corporation_licence_number: null,
      corporation_licence_expiry: null,
      pi_expiry: null,
      icare_expiry: null,
      pm_enabled: false,
      pm_records_system: null,
    },
    people: [lee],
    annexureDone: false,
    teamInvites: 0,
    sgManualVersions: 0,
    sgSigners: null,
    approvedPlanIds: [],
    trustAccounts: 0,
    listings: 0,
    marks: [],
    nameOf: (id) => (id === "lee" ? "Lee Licensee" : id === "max" ? "Max Manager" : "someone"),
    cpdYearLabel: "2026–27",
    licenseeName: "Lee Licensee",
    ...over,
  };
}

const done = (lic = "lic/lee.pdf", types = ["residential_sales"]) => ({
  licence_document_path: lic,
  licence_expiry: "2027-12-08",
  licence_categories: types,
});

/** Everything set up: the licensee, two agents and an assistant with no licence. */
function complete(over: Partial<OfficeSetupInput> = {}): OfficeSetupInput {
  const people = [
    person("lee", { full_name: "Lee Licensee", is_licensee_in_charge: true, ...done() }),
    person("ana", done("lic/ana.pdf")),
    person("ben", done("lic/ben.pdf")),
    person("asa", { is_assistant: true, is_agent: false }),
  ];
  return fresh({
    agency: {
      name: "Made Up Realty",
      licensee_name: "Lee Licensee",
      licensee_email: "getadamc3+lee@gmail.com",
      website_url: "https://example.com/buy",
      logo_path: "agency/logo.png",
      corporation_licence_number: "10012345",
      corporation_licence_expiry: "2028-03-14",
      pi_expiry: "2027-06-30",
      icare_expiry: "2027-06-30",
      pm_enabled: false,
      pm_records_system: null,
    },
    people,
    annexureDone: true,
    teamInvites: 3,
    sgManualVersions: 1,
    sgSigners: people.map((p) => ({ signerId: p.id, signed: true })),
    approvedPlanIds: people.map((p) => p.id),
    trustAccounts: 1,
    listings: 2,
    ...over,
  });
}

const step = (steps: SetupStep[], key: string) => {
  const s = steps.find((x) => x.key === key);
  assert.ok(s, `no step ${key}`);
  return s;
};

describe("the office list", () => {
  it("a brand-new office: 0 of 14, in the brief's order, office profile first", () => {
    const steps = officeSetupSteps(fresh());
    assert.deepEqual(
      steps.map((s) => s.key),
      [
        "office_profile", "annexure", "team_invited",
        "corporation_licence", "licensee_licence", "pi", "icare", "team_licences",
        "sg_manual", "sg_signed", "training_plans",
        "licence_types", "trust_account",
        "first_listing",
      ],
    );
    const sum = setupSummary(steps);
    assert.deepEqual([sum.done, sum.total, sum.allDone], [0, 14, false]);
    assert.equal(sum.next?.key, "office_profile");
    assert.equal(step(steps, "office_profile").line, "Still to add: licensee's name, licensee's email, website, logo");
  });

  it("everything set up: all 14 done, no next step", () => {
    const sum = setupSummary(officeSetupSteps(complete()));
    assert.deepEqual([sum.done, sum.total, sum.allDone, sum.next], [14, 14, true, null]);
  });

  it("part way: the next step is the first not done, in order", () => {
    const input = complete({ agency: { ...complete().agency, pi_expiry: null }, trustAccounts: 0 });
    const sum = setupSummary(officeSetupSteps(input));
    assert.equal(sum.next?.key, "pi");
    assert.deepEqual([sum.done, sum.total], [12, 14]);
  });

  it("PM on: one more step, where the PM records are kept", () => {
    const steps = officeSetupSteps(complete({ agency: { ...complete().agency, pm_enabled: true } }));
    assert.equal(steps.at(-1)?.key, "pm_records");
    assert.equal(setupSummary(steps).total, 15);
    assert.equal(setupSummary(steps).next?.key, "pm_records");
    const set = officeSetupSteps(complete({ agency: { ...complete().agency, pm_enabled: true, pm_records_system: "PropertyMe" } }));
    assert.equal(setupSummary(set).allDone, true);
    assert.equal(step(set, "pm_records").line, "PropertyMe");
  });

  it("\"Doesn't apply\" counts as done and says who and when", () => {
    const steps = officeSetupSteps(
      fresh({ marks: [{ step: "icare", marked_by: "lee", marked_at: "2026-10-27T01:00:00Z" }] }),
    );
    const icare = step(steps, "icare");
    assert.equal(icare.done, true);
    assert.deepEqual(icare.notApplicable, { byName: "Lee Licensee", at: "2026-10-27T01:00:00Z" });
    assert.equal(setupSummary(steps).done, 1);
    // Offered on the four steps that may not apply, and only while not done.
    const offered = officeSetupSteps(fresh()).filter((s) => s.notApplicableLabel).map((s) => s.key);
    assert.deepEqual(offered, ["team_invited", "corporation_licence", "icare", "trust_account"]);
    assert.equal(step(officeSetupSteps(complete()), "trust_account").notApplicableLabel, null);
  });

  it("a one-person office: \"Doesn't apply (just me)\" also completes team licences", () => {
    const steps = officeSetupSteps(
      fresh({ marks: [{ step: "team_invited", marked_by: "lee", marked_at: "2026-10-27T01:00:00Z" }] }),
    );
    assert.equal(step(steps, "team_invited").notApplicableLabel, "Doesn't apply (just me)");
    assert.equal(step(steps, "team_invited").done, true);
    assert.equal(step(steps, "team_licences").done, true);
    assert.equal(step(steps, "team_licences").line, "No one else has joined yet");
  });

  it("team licences: N of N people, leaving out an assistant with no licence type", () => {
    const input = complete();
    input.people = input.people.map((p) => (p.id === "ben" ? { ...p, licence_document_path: null } : p));
    const t = step(officeSetupSteps(input), "team_licences");
    assert.deepEqual(t.progress, { done: 1, total: 2 });
    assert.equal(t.done, false);
    assert.equal(t.line, "1 of 2 people done");
    // An assistant who does hold a certificate is counted.
    input.people.push(person("cat", { is_assistant: true, is_agent: false, licence_type: "certificate_of_registration" }));
    assert.deepEqual(step(officeSetupSteps(input), "team_licences").progress, { done: 1, total: 3 });
  });

  it("someone who has left isn't counted anywhere", () => {
    const input = complete();
    input.people.push(person("old", { archived_at: "2026-09-01T00:00:00Z" }));
    assert.equal(setupSummary(officeSetupSteps(input)).allDone, true);
  });

  it("the licensee not on RealComply: their licence step is left out", () => {
    const input = complete();
    input.people = input.people.filter((p) => p.id !== "lee");
    const steps = officeSetupSteps({ ...input, viewer: { id: "ana", isOfficeManager: true } });
    assert.equal(steps.some((s) => s.key === "licensee_licence"), false);
    assert.equal(setupSummary(steps).total, 13);
  });

  it("SG Manual signatures: none before there is a manual, then N of N people", () => {
    const none = step(officeSetupSteps(fresh()), "sg_signed");
    assert.equal(none.done, false);
    assert.equal(none.line, "Upload the SG Manual first");
    const input = complete();
    input.sgSigners = [
      { signerId: "lee", signed: true },
      { signerId: "ana", signed: true },
      { signerId: "ben", signed: false },
      // "asa" was never asked: counted as not signed.
    ];
    const s = step(officeSetupSteps(input), "sg_signed");
    assert.deepEqual(s.progress, { done: 2, total: 4 });
    assert.equal(s.done, false);
  });

  it("training plans: one approved plan per person for the CPD year", () => {
    const input = complete({ approvedPlanIds: ["lee", "ana", "ben"] });
    const t = step(officeSetupSteps(input), "training_plans");
    assert.equal(t.title, "Training plan for 2026–27");
    assert.deepEqual(t.progress, { done: 3, total: 4 });
    assert.equal(t.done, false);
  });

  it("licence types: the people CPD applies to, each with a type ticked", () => {
    const input = complete();
    input.people = input.people.map((p) => (p.id === "ana" ? { ...p, licence_categories: [] } : p));
    const t = step(officeSetupSteps(input), "licence_types");
    // Lee, Ana and Ben; the assistant with no licence type isn't asked.
    assert.deepEqual(t.progress, { done: 2, total: 3 });
  });

  it("team invited: an invite sent, or someone already in the office", () => {
    assert.equal(step(officeSetupSteps(fresh({ teamInvites: 1 })), "team_invited").done, true);
    assert.equal(step(officeSetupSteps(fresh({ teamInvites: 1 })), "team_licences").done, true);
    assert.equal(step(officeSetupSteps(fresh({ people: [lee, person("ana")] })), "team_invited").done, true);
  });

  it("office profile: an office manager is told when only the licensee can add what's missing", () => {
    const om = { id: "max", isOfficeManager: true };
    const base = complete().agency;
    const logoOnly = step(officeSetupSteps(complete({ viewer: om, agency: { ...base, logo_path: null } })), "office_profile");
    assert.equal(logoOnly.waitingOn, null);
    const emailOnly = step(officeSetupSteps(complete({ viewer: om, agency: { ...base, licensee_email: null } })), "office_profile");
    assert.equal(emailOnly.waitingOn, "Only Lee Licensee can add these.");
    // The licensee is never told to wait.
    assert.equal(step(officeSetupSteps(complete({ agency: { ...base, licensee_email: null } })), "office_profile").waitingOn, null);
  });

  it("the annexure: Review and sign for the licensee; an office manager is told only the licensee can", () => {
    const forLee = step(officeSetupSteps(fresh()), "annexure");
    assert.equal(forLee.annexureForm, true);
    assert.equal(forLee.waitingOn, null);
    const forMax = step(officeSetupSteps(fresh({ viewer: { id: "max", isOfficeManager: true } })), "annexure");
    assert.equal(forMax.waitingOn, "Only Lee Licensee can adopt the annexure.");
  });

  it("groups: the full list's headers count their own steps", () => {
    const input = complete({ agency: { ...complete().agency, pi_expiry: null } });
    const groups = groupCounts(officeSetupSteps(input));
    assert.deepEqual(
      groups.map((g) => [g.label, g.done, g.total]),
      [
        ["Your office", 3, 3],
        ["Licences and insurance", 4, 5],
        ["Supervision and training", 3, 3],
        ["CPD and trust", 2, 2],
        ["Your first files", 1, 1],
      ],
    );
  });
});

describe("an agent's own plan (addendum, 27 Oct 2026)", () => {
  const gus = person("gus", { full_name: "Gus Contractor" });
  const own = (over: Partial<OfficeSetupInput> = {}) =>
    fresh({ kind: "agent_plan", viewer: { id: "gus", isOfficeManager: false }, people: [gus], licenseeName: "Vic Licensee", ...over });

  it("the office-style list, in the addendum's order, with no team steps", () => {
    const steps = officeSetupSteps(own());
    assert.deepEqual(
      steps.map((s) => s.key),
      [
        "office_profile", "annexure",
        "own_licence", "pi", "corporation_licence", "icare",
        "sg_manual", "own_training_plan",
        "licence_types", "trust_account",
        "first_listing",
      ],
    );
    assert.equal(step(steps, "annexure").href, "/dashboard/getting-started");
    assert.equal(step(steps, "annexure").annexureForm, false);
    assert.equal(step(steps, "pi").line, "Your own policy, or a certificate showing the agency's policy covers you");
  });

  it("\"Doesn't apply\" on corporation licence, workers compensation, SG Manual and trust", () => {
    const steps = officeSetupSteps(own());
    assert.deepEqual(
      steps.filter((s) => s.notApplicableLabel).map((s) => [s.key, s.notApplicableLabel]),
      [
        ["corporation_licence", "Doesn't apply"],
        ["icare", "Doesn't apply"],
        ["sg_manual", "Doesn't apply"],
        ["trust_account", "My deposits go into the agency's trust account"],
      ],
    );
  });

  it("all done, with those four marked", () => {
    const at = "2026-10-27T01:00:00Z";
    const steps = officeSetupSteps(
      own({
        agency: { ...complete().agency },
        people: [{ ...gus, ...done("lic/gus.pdf") }],
        annexureDone: true,
        approvedPlanIds: ["gus"],
        listings: 1,
        marks: ["corporation_licence", "icare", "sg_manual", "trust_account"].map((s) => ({ step: s, marked_by: "gus", marked_at: at })),
      }),
    );
    const sum = setupSummary(steps);
    assert.deepEqual([sum.done, sum.total, sum.allDone], [11, 11, true]);
  });
});

describe("a person's own card", () => {
  const ana = person("ana");

  it("an agent: read, licence types, their licence, sign the SG Manual", () => {
    const steps = staffSetupSteps({
      person: ana,
      officeAgent: true,
      adoptedVersion: "2026-10",
      confirmedVersions: ["2026-10"],
      sgManualExists: true,
      sgSigned: false,
    });
    assert.deepEqual(steps.map((s) => s.key), ["sg_read", "my_licence_types", "my_licence", "my_sg_signed"]);
    const sum = setupSummary(steps);
    assert.deepEqual([sum.done, sum.total], [1, 4]);
    assert.equal(sum.next?.key, "my_licence_types");
  });

  it("before the office adopts the annexure: the read step waits, and isn't counted", () => {
    const steps = staffSetupSteps({
      person: { ...ana, ...done("lic/ana.pdf") },
      officeAgent: true,
      adoptedVersion: null,
      confirmedVersions: [],
      sgManualExists: false,
      sgSigned: false,
    });
    const read = step(steps, "sg_read");
    assert.equal(read.counted, false);
    assert.equal(read.waitingOn, "Waiting for your licensee to adopt the annexure.");
    const sum = setupSummary(steps);
    assert.deepEqual([sum.done, sum.total, sum.allDone], [2, 2, true]);
  });

  it("an assistant with no licence: only what applies to them", () => {
    const asa = person("asa", { is_assistant: true, is_agent: false });
    const steps = staffSetupSteps({
      person: asa,
      officeAgent: false,
      adoptedVersion: "2026-10",
      confirmedVersions: [],
      sgManualExists: true,
      sgSigned: true,
    });
    assert.deepEqual(steps.map((s) => s.key), ["my_sg_signed"]);
    assert.equal(setupSummary(steps).allDone, true);
  });

  it("no SG Manual in the office: no signing step", () => {
    const steps = staffSetupSteps({
      person: ana,
      officeAgent: true,
      adoptedVersion: "2026-10",
      confirmedVersions: [],
      sgManualExists: false,
      sgSigned: false,
    });
    assert.equal(steps.some((s) => s.key === "my_sg_signed"), false);
  });
});
