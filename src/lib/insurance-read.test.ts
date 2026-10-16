import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OTHER_INSURANCE_KINDS,
  addedMessage,
  couldNotReadState,
  decideInsuranceRead,
  describeHistory,
  notACertificateMessage,
  parseInsuranceRead,
  provenanceLine,
  recordTypedInsurance,
  removedCertificateState,
  sanitiseInsuranceRead,
  savedMessage,
  isOtherInsuranceKind,
  otherInsuranceTitle,
  wrongCoverMessage,
  type InsuranceDocumentRead,
} from "./insurance-read";
import { formatAuDate, formatAuTimestamp } from "@/lib/format-date";
import type { InsuranceHistoryRow } from "@/lib/types";

// Insurance certificates on the Insurance register (Trent's ask; mockup
// approved by Adam, 15 Oct 2026).

const AT = "2026-10-15T01:00:00.000Z";
const TODAY = new Date("2026-10-15T01:00:00.000Z");
const jo = "jo-id";
const names = { [jo]: "Jo Licensee (made up)" };

const clear: InsuranceDocumentRead = {
  documentIs: "certificate_of_currency",
  covers: ["professional_indemnity"],
  insurer: "Made-up Underwriting Pty Ltd",
  policyNumber: "PI-204418",
  expiry: "2027-06-30",
};
const decide = (read: InsuranceDocumentRead, policy: "pi" | "cyber" | "icare" = "pi") =>
  decideInsuranceRead({ read, policy, by: jo, at: AT, fileName: "coc.pdf", today: TODAY });

describe("reading a certificate", () => {
  it("keeps only what arrived clean", () => {
    const r = sanitiseInsuranceRead({
      documentIs: "policy_schedule",
      covers: ["cyber", "astrology", "cyber"],
      insurer: "  Made-up   Cyber Cover Ltd ",
      policyNumber: "CY-88120",
      expiryDate: "2027-02-30",
      unreadableFields: ["policyNumber"],
    });
    assert.deepEqual(r, {
      documentIs: "policy_schedule",
      covers: ["cyber"],
      insurer: "Made-up Cyber Cover Ltd",
      policyNumber: null,
      expiry: null,
    });
    assert.equal(sanitiseInsuranceRead({ documentIs: "invoice" }).documentIs, null);
    assert.equal(sanitiseInsuranceRead({ expiryDate: "2027-06-30", unreadableFields: ["expiryDate"] }).expiry, null);
  });

  it("saves a clear certificate straight to the policy, read from the certificate", () => {
    const d = decide(clear);
    assert.equal(d.kind, "save");
    if (d.kind !== "save") return;
    assert.deepEqual(d.values, { insurer: "Made-up Underwriting Pty Ltd", policyNumber: "PI-204418", expiry: "2027-06-30" });
    assert.deepEqual(d.state.missing, []);
    assert.equal(d.state.changeSource, "document_read");
    assert.equal(d.state.fields.expiry?.source, "document");
    assert.equal(d.expired, false);
  });

  it("asks for what it couldn't read, and carries nothing over from last year's", () => {
    const d = decide({ ...clear, expiry: null });
    assert.equal(d.kind, "save");
    if (d.kind !== "save") return;
    assert.equal(d.values.expiry, null);
    assert.deepEqual(d.state.missing, ["expiry"]);
  });

  it("saves an expiry already past, and says so", () => {
    const d = decide({ ...clear, expiry: "2026-06-30" });
    assert.ok(d.kind === "save" && d.expired);
  });

  it("refuses something that isn't a certificate or a schedule", () => {
    assert.deepEqual(decide({ ...clear, documentIs: "other" }), { kind: "not_a_certificate" });
  });

  it("refuses a certificate for a different cover", () => {
    assert.deepEqual(decide({ ...clear, covers: ["workers_compensation"] }), {
      kind: "wrong_cover",
      coverOnDocument: "workers compensation",
    });
    assert.equal(decide({ ...clear, covers: ["professional_indemnity"] }, "icare").kind, "wrong_cover");
  });

  it("takes a package policy that includes this cover, and one that doesn't say", () => {
    assert.equal(decide({ ...clear, covers: ["public_liability", "professional_indemnity"] }).kind, "save");
    assert.equal(decide({ ...clear, covers: [] }, "cyber").kind, "save");
    assert.equal(decide({ ...clear, covers: ["other"] }, "icare").kind, "save");
  });

  it("a certificate that couldn't be read at all stays attached and asks for everything", () => {
    const s = couldNotReadState(jo, AT, "blurry.jpg");
    assert.deepEqual(s.missing, ["insurer", "policyNumber", "expiry"]);
    assert.equal(s.lastRead?.status, "could_not_read");
    assert.equal(s.changeSource, "document_read");
  });
});

describe("changes by hand", () => {
  it("marks what was typed, by whom, and stops asking for it", () => {
    const d = decide({ ...clear, expiry: null });
    if (d.kind !== "save") throw new Error("expected save");
    const s = recordTypedInsurance(d.state, d.values, { ...d.values, expiry: "2027-06-30" }, jo, AT);
    assert.deepEqual(s.missing, []);
    assert.equal(s.fields.expiry?.source, "typed");
    assert.equal(s.fields.insurer?.source, "document");
    assert.equal(s.changeSource, "typed");
  });

  it("taking the certificate off keeps the details and says how", () => {
    const d = decide(clear);
    if (d.kind !== "save") throw new Error("expected save");
    const s = removedCertificateState(d.state);
    assert.equal(s.lastRead, null);
    assert.equal(s.changeSource, "document_removed");
    assert.equal(s.fields.insurer?.source, "document");
  });

  it("reads a stored state defensively", () => {
    assert.equal(parseInsuranceRead(null), null);
    assert.equal(parseInsuranceRead("x"), null);
    const s = parseInsuranceRead({ missing: ["expiry", "colour"], changeSource: "hacked", lastRead: { status: "weird" } });
    assert.deepEqual(s, { lastRead: null, missing: ["expiry"], fields: {}, changeSource: "typed" });
  });
});

describe("what the card says", () => {
  it("a renewal: the expiry moved, and the previous certificate is kept", () => {
    const d = decide(clear);
    if (d.kind !== "save") throw new Error("expected save");
    assert.equal(
      savedMessage({
        state: d.state, expired: false, beforeExpiry: "2026-06-30", afterExpiry: "2027-06-30",
        replacedCertificate: true, formatDate: formatAuDate,
      }),
      "Read from the certificate and saved. The expiry moved from 30 June 2026 to 30 June 2027. The previous certificate is kept in the history.",
    );
  });

  it("a first upload with a gap asks for it", () => {
    const d = decide({ ...clear, expiry: null });
    if (d.kind !== "save") throw new Error("expected save");
    assert.equal(
      savedMessage({
        state: d.state, expired: false, beforeExpiry: null, afterExpiry: null, replacedCertificate: false, formatDate: formatAuDate,
      }),
      "Read from the certificate and saved what was clear. Couldn't read the expiry date. Please add it below.",
    );
  });

  it("refusals say nothing was saved, and whether the file went", () => {
    assert.equal(
      notACertificateMessage(false),
      "This doesn't look like a certificate of currency or a policy schedule. Nothing was saved, and the file was removed.",
    );
    assert.equal(
      wrongCoverMessage("pi", "workers compensation", false),
      "This looks like workers compensation cover, not professional indemnity. Nothing was saved, and the file was removed.",
    );
    assert.match(notACertificateMessage(true), /still stored, though not on this policy\.$/);
  });

  it("says where each detail came from", () => {
    const d = decide(clear);
    if (d.kind !== "save") throw new Error("expected save");
    assert.equal(
      provenanceLine(d.state, "certificate-of-currency-2026-27.pdf", names, formatAuTimestamp),
      "Insurer, policy number and expiry read from certificate-of-currency-2026-27.pdf on 15 October 2026. Use Edit to change anything that's wrong.",
    );
    const partial = decide({ ...clear, expiry: null });
    if (partial.kind !== "save") throw new Error("expected save");
    assert.equal(
      provenanceLine(partial.state, "cyber-policy-schedule.pdf", names, formatAuTimestamp),
      "Insurer and policy number read from cyber-policy-schedule.pdf on 15 October 2026.",
    );
    const typed = recordTypedInsurance(partial.state, partial.values, { ...partial.values, expiry: "2027-06-30" }, jo, AT);
    assert.equal(
      provenanceLine(typed, "cyber-policy-schedule.pdf", names, formatAuTimestamp),
      "Insurer and policy number read from cyber-policy-schedule.pdf on 15 October 2026. Expiry date typed by Jo Licensee (made up) on 15 October 2026. Use Edit to change anything that's wrong.",
    );
  });
});

describe("the history", () => {
  const P = "ag/_insurance/pi/";
  const row = (id: string, at: string, source: InsuranceHistoryRow["source"], before: object, after: object): InsuranceHistoryRow => ({
    id, agency_id: "ag", policy_type: "pi", source, before, after, changed_by: jo, changed_at: at,
  });
  const lastYear = {
    insurer: "Made-up Underwriting Pty Ltd", policyNumber: "PI-204418", expiry: "2026-06-30",
    documentPath: `${P}1-coc-2025-26.pdf`, documentFileName: "coc-2025-26.pdf",
  };
  const thisYear = { ...lastYear, expiry: "2027-06-30", documentPath: `${P}2-coc-2026-27.pdf`, documentFileName: "coc-2026-27.pdf" };
  const rows = [
    row("1", "2025-07-01T01:00:00.000Z", "document_read", {}, lastYear),
    row("2", "2026-10-15T01:00:00.000Z", "document_read", lastYear, thisYear),
    row("3", "2026-10-15T02:00:00.000Z", "typed", thisYear, { ...thisYear, policyNumber: "PI-204419" }),
  ];
  const entries = describeHistory(rows, names, formatAuDate, formatAuTimestamp, TODAY);

  it("newest first", () => {
    assert.deepEqual(entries.map((e) => e.id), ["3", "2", "1"]);
  });

  it("a renewal keeps last year's certificate one click away, with the details it carried", () => {
    const renewal = entries.find((e) => e.id === "2")!;
    assert.equal(
      renewal.text,
      "Renewed certificate uploaded by Jo Licensee (made up) on 15 October 2026. The expiry moved from 30 June 2026 to 30 June 2027.",
    );
    assert.deepEqual(renewal.earlierCertificate, {
      path: `${P}1-coc-2025-26.pdf`,
      fileName: "coc-2025-26.pdf",
      details: "Made-up Underwriting Pty Ltd · PI-204418 · expired 30 June 2026",
    });
  });

  it("a first upload and a change by hand say what happened", () => {
    assert.equal(entries.find((e) => e.id === "1")!.text, "Certificate uploaded by Jo Licensee (made up) on 1 July 2025.");
    assert.equal(entries.find((e) => e.id === "1")!.earlierCertificate, null);
    assert.equal(
      entries.find((e) => e.id === "3")!.text,
      "Policy number changed by hand by Jo Licensee (made up) on 15 October 2026.",
    );
  });

  it("taking a certificate off names the one taken off", () => {
    const [off] = describeHistory(
      [row("4", "2026-10-16T01:00:00.000Z", "document_removed", thisYear, { ...thisYear, documentPath: null, documentFileName: null })],
      names, formatAuDate, formatAuTimestamp, TODAY,
    );
    assert.equal(off.text, "Certificate taken off by Jo Licensee (made up) on 16 October 2026.");
    assert.equal(off.earlierCertificate?.fileName, "coc-2026-27.pdf");
  });

  it("no em dashes in anything the card says", () => {
    const all = [
      ...entries.map((e) => e.text + (e.earlierCertificate?.details ?? "")),
      notACertificateMessage(true),
      wrongCoverMessage("icare", "cyber", true),
    ].join(" ");
    assert.ok(!all.includes("—"));
  });
});

// Other insurance an office adds under the three (0078; mockup approved by
// Adam, 16 Oct 2026). Read by the same rules.
describe("other insurance", () => {
  const pl: InsuranceDocumentRead = {
    documentIs: "certificate_of_currency",
    covers: ["public_liability"],
    insurer: "Made-up Liability Insurance Ltd",
    policyNumber: "PL-55120",
    expiry: "2026-11-01",
  };
  const decideOther = (read: InsuranceDocumentRead, policy: "public_liability" | "other") =>
    decideInsuranceRead({ read, policy, by: jo, at: AT, fileName: "pl-coc.pdf", today: TODAY });

  it("reads a public liability certificate onto a public liability policy", () => {
    const d = decideOther(pl, "public_liability");
    assert.equal(d.kind, "save");
    if (d.kind !== "save") return;
    assert.deepEqual(d.values, { insurer: "Made-up Liability Insurance Ltd", policyNumber: "PL-55120", expiry: "2026-11-01" });
    assert.equal(d.state.changeSource, "document_read");
  });

  it("refuses a certificate for a different cover, and says which", () => {
    const d = decideOther({ ...pl, covers: ["motor_vehicle"] }, "public_liability");
    assert.deepEqual(d, { kind: "wrong_cover", coverOnDocument: "motor vehicle" });
    assert.equal(
      wrongCoverMessage("public_liability", "motor vehicle", false),
      "This looks like motor vehicle cover, not public liability. Nothing was saved, and the file was removed.",
    );
  });

  it("takes a business package that includes public liability", () => {
    assert.equal(decideOther({ ...pl, covers: ["office_contents", "public_liability"] }, "public_liability").kind, "save");
  });

  it("a policy the office named has no cover to check against: a car or office contents go under Other", () => {
    assert.equal(decideOther({ ...pl, covers: ["professional_indemnity"] }, "other").kind, "save");
    assert.equal(decideOther({ ...pl, covers: ["motor_vehicle"] }, "other").kind, "save");
    assert.equal(decideOther({ ...pl, covers: ["office_contents"] }, "other").kind, "save");
  });

  it("still refuses something that isn't a certificate, named or not", () => {
    assert.equal(decideOther({ ...pl, documentIs: "other" }, "other").kind, "not_a_certificate");
  });

  it("the three fixed policies are unchanged: motor vehicle cover is not PI", () => {
    assert.equal(decide({ ...clear, covers: ["motor_vehicle"] }).kind, "wrong_cover");
  });

  it("offers two types only: Public liability and Other (CHANGE, Adam, 16 Oct 2026)", () => {
    assert.deepEqual(OTHER_INSURANCE_KINDS, ["public_liability", "other"]);
    assert.ok(isOtherInsuranceKind("public_liability"));
    assert.ok(isOtherInsuranceKind("other"));
    assert.ok(!isOtherInsuranceKind("motor_vehicle"));
    assert.ok(!isOtherInsuranceKind("office_contents"));
    assert.ok(!isOtherInsuranceKind("pi"));
    assert.ok(!isOtherInsuranceKind("toString"));
  });

  it("knows its titles", () => {
    assert.equal(otherInsuranceTitle("public_liability", null), "Public liability");
    assert.equal(otherInsuranceTitle("other", "  Management liability "), "Management liability");
  });

  it("says what was added, and where the gaps are asked for", () => {
    const d = decideOther({ ...pl, expiry: null }, "public_liability");
    if (d.kind !== "save") throw new Error("expected save");
    assert.equal(
      addedMessage({ title: "Public liability", state: d.state, expired: false }),
      "Public liability added. Read from the certificate and saved what was clear. Couldn't read the expiry date: please add it on its card.",
    );
    const full = decideOther(pl, "public_liability");
    if (full.kind !== "save") throw new Error("expected save");
    assert.equal(
      addedMessage({ title: "Public liability", state: full.state, expired: true }),
      "Public liability added. Read from the certificate and saved. The expiry date on it has already passed.",
    );
    assert.equal(
      addedMessage({ title: "Company car", state: couldNotReadState(jo, AT, "x.pdf"), expired: false }),
      "Company car added. The certificate couldn't be read, so the details need typing in on its card.",
    );
  });

  it("taking a policy off the register is in its history", () => {
    const [entry] = describeHistory(
      [{
        id: "9", agency_id: "ag", policy_type: "other", policy_id: "p1", source: "policy_removed",
        before: { insurer: "X" }, after: { insurer: "X" }, changed_by: jo, changed_at: "2026-10-16T01:00:00.000Z",
      }],
      names, formatAuDate, formatAuTimestamp, TODAY,
    );
    assert.equal(entry.text, "Taken off the register by Jo Licensee (made up) on 16 October 2026.");
    assert.equal(entry.earlierCertificate, null);
  });
});
