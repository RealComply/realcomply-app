import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CPD_SOURCE_LABEL, cpdRowSource, fillFromCertificate, planItemDocument } from "./cpd-one-place";

// CPD certificates live in one place only: the CPD record (Adam, 15 Oct 2026).

describe("where a CPD row's details came from", () => {
  const plan = new Set(["from-plan"]);
  it("a training session's row says so, with or without a certificate", () => {
    assert.equal(cpdRowSource({ id: "a", source_session_id: "s1", evidence_path: null }, plan), "session");
    assert.equal(cpdRowSource({ id: "a", source_session_id: "s1", evidence_path: "ag/_cpd/p/1.pdf" }, plan), "session");
  });
  it("a training plan's row says so", () => {
    assert.equal(cpdRowSource({ id: "from-plan", source_session_id: null, evidence_path: null }, plan), "plan");
  });
  it("only a row read off a certificate says 'Read from certificate'", () => {
    assert.equal(cpdRowSource({ id: "b", source_session_id: null, evidence_path: "ag/_cpd/p/2.pdf" }, plan), "certificate");
    assert.equal(cpdRowSource({ id: "c", source_session_id: null, evidence_path: null }, plan), "typed");
    assert.equal(CPD_SOURCE_LABEL.certificate, "Read from certificate");
    assert.equal(CPD_SOURCE_LABEL.session, "From training session");
  });
});

describe("a certificate on an existing row", () => {
  it("fills only what the row is missing", () => {
    assert.deepEqual(
      fillFromCertificate(
        { hours: null, completed_date: "2026-09-10", provider: null },
        { hours: 2, completed_date: "2026-09-11", provider: "Made-up Training" },
      ),
      { hours: 2, provider: "Made-up Training" },
    );
  });
  it("never replaces what the session or plan recorded", () => {
    assert.deepEqual(
      fillFromCertificate(
        { hours: 3, completed_date: "2026-09-10", provider: "Session Provider" },
        { hours: 2, completed_date: "2026-09-11", provider: "Other" },
      ),
      {},
    );
  });
  it("leaves a gap a gap when the certificate doesn't say", () => {
    assert.deepEqual(
      fillFromCertificate({ hours: null, completed_date: null, provider: null }, { hours: null, completed_date: null, provider: null }),
      {},
    );
  });
});

describe("a training plan item's document", () => {
  const records = { r1: { evidence_path: "ag/_cpd/p/1.pdf", evidence_file_name: "cert.pdf" }, r2: { evidence_path: null, evidence_file_name: null } };
  it("linked to a CPD record: that record's certificate, never its own", () => {
    assert.deepEqual(
      planItemDocument({ cpd_record_id: "r1", evidence_path: "ag/_cpd/p/training-plan/x.pdf", evidence_file_name: "x.pdf" }, records),
      { kind: "cpd_record", recordId: "r1", path: "ag/_cpd/p/1.pdf", fileName: "cert.pdf" },
    );
  });
  it("linked to a record with no certificate yet: points there, asks for nothing here", () => {
    assert.deepEqual(planItemDocument({ cpd_record_id: "r2", evidence_path: null, evidence_file_name: null }, records), {
      kind: "cpd_record",
      recordId: "r2",
      path: null,
      fileName: null,
    });
  });
  it("no CPD record (office training): its own document", () => {
    assert.deepEqual(
      planItemDocument({ cpd_record_id: null, evidence_path: "ag/_cpd/p/training-plan/x.pdf", evidence_file_name: "x.pdf" }, records),
      { kind: "own", path: "ag/_cpd/p/training-plan/x.pdf", fileName: "x.pdf" },
    );
  });
});
