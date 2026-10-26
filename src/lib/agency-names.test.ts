import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ENTITY_NAME_HINT,
  ENTITY_NAME_SIGNUP_HINT,
  TRADING_NAME_HINT,
  asksAboutEntityName,
  describeEntityNameChange,
  formalAgencyName,
  namesAsAt,
  sameEntityName,
  type NameChange,
} from "./agency-names";

// Trading name and licensed entity name (brief, 14 Oct 2026; 0070).

describe("comparing the licence holder with the licensed entity name", () => {
  test("loosely: case, punctuation, spacing and how Pty Ltd is spelt don't matter", () => {
    assert.ok(sameEntityName("Trent Lloyd Corporation Pty Ltd", "TRENT LLOYD CORPORATION PTY. LTD."));
    assert.ok(sameEntityName("Trent Lloyd Corporation Pty Ltd", "Trent  Lloyd Corporation Pty. Limited"));
    assert.ok(sameEntityName("Trent Lloyd Corporation Pty Ltd", "Trent Lloyd Corporation Proprietary Limited"));
    assert.ok(sameEntityName("Smith & Co Pty Ltd", "Smith and Co Pty Ltd"));
  });

  test("but a different company is different", () => {
    assert.ok(!sameEntityName("Trent Lloyd Corporation Pty Ltd", "Lloyd Property Agents"));
    assert.ok(!sameEntityName("Trent Lloyd Corporation Pty Ltd", "Lloyd Pty Ltd"));
    assert.ok(!sameEntityName("Trent Lloyd Corporation Pty Ltd", null));
    assert.ok(!sameEntityName("", ""));
  });

  test("the question is asked when the entity name is blank or different, never when it matches", () => {
    assert.equal(asksAboutEntityName("Trent Lloyd Corporation Pty Ltd", null), true, "blank");
    assert.equal(asksAboutEntityName("Trent Lloyd Corporation Pty Ltd", ""), true, "empty");
    assert.equal(asksAboutEntityName("Trent Lloyd Corporation Pty Ltd", "Harbour Holdings Pty Ltd"), true, "different");
    assert.equal(asksAboutEntityName("Trent Lloyd Corporation Pty Ltd", "trent lloyd corporation pty. limited"), false, "match");
    assert.equal(asksAboutEntityName(null, null), false, "no holder read: nothing to ask");
  });
});

describe("the Agency line on formal documents", () => {
  test("X trading as Y", () => {
    assert.equal(
      formalAgencyName({ tradingName: "Lloyd Property Agents", licensedEntityName: "Trent Lloyd Corporation Pty Ltd" }),
      "Trent Lloyd Corporation Pty Ltd trading as Lloyd Property Agents",
    );
  });

  test("no entity name, or the same name: the trading name alone, as before", () => {
    assert.equal(formalAgencyName({ tradingName: "Lloyd Property Agents", licensedEntityName: null }), "Lloyd Property Agents");
    assert.equal(formalAgencyName({ tradingName: "Lloyd Property Agents", licensedEntityName: "  " }), "Lloyd Property Agents");
    assert.equal(
      formalAgencyName({ tradingName: "Cass Property Pty Ltd", licensedEntityName: "Cass Property Pty. Limited" }),
      "Cass Property Pty Ltd",
    );
  });
});

describe("a finished audit file keeps the names it was finished under", () => {
  const today = { tradingName: "Lloyd Property Agents", licensedEntityName: "Trent Lloyd Corporation Pty Ltd" };
  const changes: NameChange[] = [
    { name_kind: "licensed_entity", old_name: null, new_name: "Trent Lloyd Corporation Pty Ltd", changed_at: "2026-10-15T01:00:00Z" },
    { name_kind: "trading", old_name: "Lloyd Agents", new_name: "Lloyd Property Agents", changed_at: "2026-11-01T01:00:00Z" },
  ];

  test("finished before the entity name was saved: the trading name of the day, alone", () => {
    const at = namesAsAt(today, changes, "2026-10-01T00:00:00Z");
    assert.deepEqual(at, { tradingName: "Lloyd Agents", licensedEntityName: null });
    assert.equal(formalAgencyName(at), "Lloyd Agents");
  });

  test("finished between the two changes", () => {
    assert.deepEqual(namesAsAt(today, changes, "2026-10-20T00:00:00Z"), {
      tradingName: "Lloyd Agents",
      licensedEntityName: "Trent Lloyd Corporation Pty Ltd",
    });
  });

  test("finished after every change, or with no time: today's names", () => {
    assert.deepEqual(namesAsAt(today, changes, "2026-12-01T00:00:00Z"), today);
    assert.deepEqual(namesAsAt(today, changes, null), today);
    assert.deepEqual(namesAsAt(today, [], "2026-01-01T00:00:00Z"), today);
  });
});

describe("Office profile", () => {
  test("the brief's labels and hints, word for word", () => {
    assert.equal(TRADING_NAME_HINT, "The name your clients know you by. Shown at the top of RealComply and in your emails.");
    assert.equal(ENTITY_NAME_HINT, "The company that holds the corporation licence.");
    assert.equal(ENTITY_NAME_SIGNUP_HINT, "The company on your corporation licence, if different from your trading name.");
  });

  test("says who last changed the entity name, how and when", () => {
    assert.equal(
      describeEntityNameChange("corporation_licence", "Trent Lloyd", "15 October 2026"),
      "Read from the corporation licence by Trent Lloyd, 15 October 2026.",
    );
    assert.equal(
      describeEntityNameChange("signing_page", "Trent Lloyd", "15 October 2026"),
      "Changed on the annexure signing page by Trent Lloyd, 15 October 2026.",
    );
    assert.equal(describeEntityNameChange("sign_up", null, "15 October 2026"), "Given at sign-up, 15 October 2026.");
    assert.equal(describeEntityNameChange("office_profile", "Jo", "1 May 2027"), "Changed by Jo, 1 May 2027.");
  });

  test("no em dashes in anything a reader sees", () => {
    const text = readFileSync(new URL("./agency-names.ts", import.meta.url), "utf8");
    const strings = text.match(/"[^"\n]*"|`[^`\n]*`/g) ?? [];
    assert.ok(strings.every((s) => !s.includes("—")));
  });
});

describe("the corporation licence upload", () => {
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

  test("is never refused on its name, and carries the change note", () => {
    const actions = src("./actions/licences.ts");
    assert.ok(
      actions.includes(
        "// CHANGE (Adam, 14 Oct 2026): was: corporation licence holder matched against the office name and refused on mismatch. Now: matched against the licensed entity name; a mismatch asks to update it, never refuses. Personal licences keep the strict name check.",
      ),
    );
    const corp = actions.slice(actions.indexOf("async function readCorporationLicence"), actions.indexOf("function withoutEntityCheck"));
    assert.ok(/subject: "corporation",\s*expectedNames: \[\],/.test(corp), "no names to refuse on");
    assert.ok(corp.includes("asksAboutEntityName(v.holderName, agency.licensed_entity_name)"));
  });

  test("a person's licence still checks the name strictly", () => {
    const actions = src("./actions/licences.ts");
    const person = actions.slice(actions.indexOf("async function readPersonLicence"), actions.indexOf("// ── The corporation licence"));
    assert.ok(person.includes("expectedNames: subject.full_name ? [subject.full_name] : []"));
  });
});

describe("sign-up, the signing page and Office profile fill the same record", () => {
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

  test("every sign-up path that sets up an office saves the licensed entity name, as given at sign-up", () => {
    assert.ok(/if \(!inviteToken && licensedEntityName\) \{\s*await saveSignupEntityName\(supabase, licensedEntityName\)/.test(src("./actions/auth.ts")));
    assert.ok(src("./actions/auth.ts").includes("licensed_entity_name: licensedEntityName,"), "rides in the metadata for the email confirmation path");
    assert.ok(src("./auth/complete-signup.ts").includes("await saveSignupEntityName(supabase, meta.licensed_entity_name)"));
    assert.ok(src("./data/current-profile.ts").includes("await saveSignupEntityName(supabase, meta.licensed_entity_name)"));
    assert.ok(src("./auth/signup-entity-name.ts").includes('p_via: "sign_up"'));
  });

  test("the sign-up form asks for it, optional, under the office name", () => {
    const form = src("../components/signup/SignupForm.tsx");
    assert.ok(form.indexOf('name="agencyName"') < form.indexOf('name="licensedEntityName"'));
    assert.ok(!/name="licensedEntityName"[\s\S]{0,80}required/.test(form));
    assert.ok(form.includes("{ENTITY_NAME_SIGNUP_HINT}"));
  });

  test("the signing page sends what is in the box, blank included", () => {
    const action = src("./actions/sg-annexure.ts");
    assert.ok(action.includes('...(entityOnPage ? { p_licensed_entity_name: entityName } : {})'));
    const form = src("../components/annexure/AdoptAnnexureForm.tsx");
    assert.ok(form.includes('name="licensedEntityName"') && !/name="licensedEntityName"[\s\S]{0,200}required/.test(form));
    assert.ok(form.includes("formalAgencyName({ tradingName: agencyName, licensedEntityName: entity })"));
  });

  test("Office profile edits both names: the licensee in charge, an agent on their own plan, or an office manager (0093)", () => {
    const action = src("./actions/office-profile.ts");
    assert.ok(action.includes("if (!access.runsOffice)"));
    assert.ok(action.includes('supabase.rpc("set_agency_trading_name"'));
    assert.ok(action.includes('p_via: "office_profile"'));
    const page = src("../app/dashboard/profile/page.tsx");
    assert.ok(/access\.runsOffice \? \([\s\S]*<OfficeDetailsForm[\s\S]*\) : \([\s\S]*<OfficeNamesReadOnly/.test(page));
    // The licensee's own details stay with the licensee.
    assert.ok(/access\.actsAsLicensee && \([\s\S]*<LicenseeEmailForm/.test(page));
  });

  test("the name history is in Download all records", () => {
    assert.ok(src("./subscription-end/records.ts").includes('{ table: "agency_name_changes", file: "Office name changes", order: "changed_at" }'));
  });
});
