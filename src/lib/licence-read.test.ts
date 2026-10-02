import { test } from "node:test";
import assert from "node:assert/strict";
import {
  companyNameMatches,
  decideLicenceRead,
  personNameMatches,
  recordTypedChanges,
  sanitiseLicenceRead,
} from "@/lib/licence-read";

// What gets saved when a licence is read off an uploaded document.

const TODAY = new Date("2026-10-01T00:00:00Z");
const AT = "2026-10-01T03:00:00.000Z";

function decide(raw: unknown, opts: { subject?: "person" | "corporation"; names?: string[] } = {}) {
  return decideLicenceRead({
    read: sanitiseLicenceRead(raw),
    subject: opts.subject ?? "person",
    expectedNames: opts.names ?? ["Jane Smith"],
    previous: null,
    by: "lic",
    at: AT,
    fileName: "licence.pdf",
    today: TODAY,
  });
}

test("clear read: every field is saved and marked as read from the document", () => {
  const d = decide({
    documentIs: "licence",
    holderName: "SMITH, Jane Maree",
    licenceType: "class_2",
    licenceNumber: "20123456",
    expiryDate: "2027-08-14",
  });
  assert.equal(d.kind, "save");
  if (d.kind !== "save") return;
  assert.deepEqual(d.values, { holderName: null, licenceType: "class_2", licenceNumber: "20123456", expiry: "2027-08-14" });
  assert.deepEqual(d.state.missing, []);
  assert.equal(d.state.fields.expiry?.source, "document");
  assert.equal(d.state.lastRead?.status, "read");
  assert.equal(d.state.lastRead?.nameChecked, true);
  assert.equal(d.expired, false);
});

test("one unreadable field: it is left empty and asked for; the rest is saved", () => {
  const d = decide({
    documentIs: "licence",
    holderName: "Jane Smith",
    licenceType: "class_1",
    licenceNumber: "20123456",
    expiryDate: "2027-08-14",
    unreadableFields: ["expiryDate"],
  });
  assert.equal(d.kind, "save");
  if (d.kind !== "save") return;
  assert.equal(d.values.expiry, null);
  assert.equal(d.values.licenceNumber, "20123456");
  assert.deepEqual(d.state.missing, ["expiry"]);
});

test("a date that isn't a real date is treated as unreadable, never guessed", () => {
  for (const bad of ["2027-02-30", "14/08/2027", "August 2027", ""]) {
    const d = decide({ documentIs: "licence", holderName: "Jane Smith", expiryDate: bad });
    assert.equal(d.kind, "save");
    if (d.kind !== "save") continue;
    assert.equal(d.values.expiry, null, bad);
    assert.ok(d.state.missing.includes("expiry"), bad);
  }
});

test("name mismatch: nothing is saved and the state carries the warning", () => {
  const d = decide({
    documentIs: "licence",
    holderName: "Robert Chen",
    licenceType: "class_2",
    licenceNumber: "20999999",
    expiryDate: "2027-08-14",
  });
  assert.equal(d.kind, "name_mismatch");
  if (d.kind !== "name_mismatch") return;
  assert.equal(d.nameOnDocument, "Robert Chen");
  assert.equal(d.state.lastRead?.status, "name_mismatch");
  assert.deepEqual(d.state.fields, {});
});

test("expired date: saved and flagged as expired, not blocked", () => {
  const d = decide({ documentIs: "licence", holderName: "Jane Smith", licenceType: "class_2", licenceNumber: "1", expiryDate: "2026-09-30" });
  assert.equal(d.kind, "save");
  if (d.kind !== "save") return;
  assert.equal(d.values.expiry, "2026-09-30");
  assert.equal(d.expired, true);
});

test("not a licence: nothing saved", () => {
  const d = decide({ documentIs: "other", holderName: "Jane Smith", expiryDate: "2027-01-01" });
  assert.equal(d.kind, "not_a_licence");
});

test("corporation licence: holder, number and expiry are kept; the type is not", () => {
  const d = decide(
    {
      documentIs: "corporation_licence",
      holderName: "CASS PROPERTY PTY LTD",
      licenceType: "class_1",
      licenceNumber: "10087654",
      expiryDate: "2028-03-01",
    },
    { subject: "corporation", names: ["Cass Property"] },
  );
  assert.equal(d.kind, "save");
  if (d.kind !== "save") return;
  assert.deepEqual(d.values, { holderName: "CASS PROPERTY PTY LTD", licenceType: null, licenceNumber: "10087654", expiry: "2028-03-01" });
});

test("corporation licence in another company's name is refused", () => {
  const d = decide(
    { documentIs: "corporation_licence", holderName: "Harbour Realty Pty Ltd", licenceNumber: "1", expiryDate: "2028-03-01" },
    { subject: "corporation", names: ["Cass Property Pty Ltd", "Cass Property"] },
  );
  assert.equal(d.kind, "name_mismatch");
});

test("name matching tolerates order, case and middle names but not a different person", () => {
  assert.equal(personNameMatches("SMITH, Jane Maree", "Jane Smith"), true);
  assert.equal(personNameMatches("JANE O'BRIEN", "Jane O’Brien"), true);
  assert.equal(personNameMatches("Jane Smithers", "Jane Smith"), false);
  assert.equal(companyNameMatches("Cass Property Pty Ltd", "Cass Property"), true);
  assert.equal(companyNameMatches("Cass Properties Pty Ltd", "Harbour Realty"), false);
});

test("no name on the profile: the read is saved but marked as not name-checked", () => {
  const d = decide({ documentIs: "licence", holderName: "Jane Smith", expiryDate: "2027-01-01" }, { names: [] });
  assert.equal(d.kind, "save");
  assert.equal(d.state.lastRead?.nameChecked, false);
});

test("a typed correction is recorded as typed, by whom, and stops being asked for", () => {
  const d = decide({ documentIs: "licence", holderName: "Jane Smith", licenceType: "class_2", licenceNumber: "1", unreadableFields: ["expiryDate"] });
  assert.equal(d.kind, "save");
  if (d.kind !== "save") return;
  const before = { ...d.values };
  const after = { ...d.values, expiry: "2027-08-14" };
  const state = recordTypedChanges(d.state, "person", before, after, "jane", "2026-10-02T00:00:00.000Z");
  assert.deepEqual(state.missing, []);
  assert.deepEqual(state.fields.expiry, { source: "typed", by: "jane", at: "2026-10-02T00:00:00.000Z" });
  assert.equal(state.fields.licenceNumber?.source, "document");
});
