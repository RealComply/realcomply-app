import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addedLine,
  complaintFileDisplayName,
  complaintFilesFor,
  fileSizeLabel,
  filesOfDeletedComplaints,
  removedLine,
} from "@/lib/complaint-files";
import { buildComplaintFilePath, complaintFolder, isInFolder } from "@/lib/storage/evidence";
import { complaintFolderNames, zipPathFor } from "@/lib/subscription-end/records";
import { buildComplianceRecordPdf, type ComplianceRecordInput } from "@/lib/pdf/compliance-record";
import { pdfText } from "@/lib/testing/pdf-text";
import type { ComplaintFile, Property } from "@/lib/types";

// Files on a complaint (0101, Adam 30 Oct 2026). Made-up offices, people and
// files throughout.

const OFFICE = "11111111-1111-4111-8111-111111111111";
const C1 = "22222222-2222-4222-8222-222222222222";
const C2 = "33333333-3333-4333-8333-333333333333";
const LEE = "44444444-4444-4444-8444-444444444444";

const file = (over: Partial<ComplaintFile>): ComplaintFile => ({
  id: "f",
  agency_id: OFFICE,
  complaint_id: C1,
  file_path: `${OFFICE}/_complaints/${C1}/1-a.pdf`,
  file_name: "a.pdf",
  size_bytes: 1024,
  added_by: LEE,
  added_at: "2026-10-30T03:14:00Z",
  removed_at: null,
  removed_by: null,
  ...over,
});

describe("a complaint's files", () => {
  it("splits what is on it now from what was removed, oldest first, and only its own", () => {
    const files = [
      file({ id: "late", added_at: "2026-10-30T05:00:00Z" }),
      file({ id: "gone", added_at: "2026-10-30T04:00:00Z", removed_at: "2026-10-30T06:00:00Z", removed_by: LEE }),
      file({ id: "early", added_at: "2026-10-30T01:00:00Z" }),
      file({ id: "other", complaint_id: C2 }),
      file({ id: "orphan", complaint_id: null, removed_at: "2026-10-30T07:00:00Z", removed_by: LEE }),
    ];
    const { current, removed } = complaintFilesFor(C1, files);
    assert.deepEqual(current.map((f) => f.id), ["early", "late"]);
    assert.deepEqual(removed.map((f) => f.id), ["gone"]);
    assert.deepEqual(filesOfDeletedComplaints(files).map((f) => f.id), ["orphan"]);
  });

  it("says who added and removed each, and when, in Sydney time", () => {
    const names = { [LEE]: "Lee Licensee" };
    const f = file({ removed_at: "2026-10-30T03:20:00Z", removed_by: LEE });
    assert.equal(addedLine(f, names), "Added 30 Oct 2026, 2:14 pm by Lee Licensee");
    assert.equal(removedLine(f, names), "Removed 30 Oct 2026, 2:20 pm by Lee Licensee");
    assert.equal(removedLine(file({}), names), "");
    assert.equal(addedLine(file({ added_by: null }), names), "Added 30 Oct 2026, 2:14 pm by someone no longer in the office");
  });

  it("keeps the chosen name on one line, within 300 characters, extension kept", () => {
    assert.equal(complaintFileDisplayName("  complaint\n email.eml "), "complaint email.eml");
    assert.equal(complaintFileDisplayName("   "), "file");
    const long = complaintFileDisplayName(`${"x".repeat(400)}.pdf`);
    assert.equal(long.length, 300);
    assert.ok(long.endsWith("….pdf"));
  });

  it("gives a size a person can read", () => {
    assert.equal(fileSizeLabel(null), "");
    assert.equal(fileSizeLabel(512), "512 B");
    assert.equal(fileSizeLabel(2048), "2 KB");
    assert.equal(fileSizeLabel(4.3 * 1024 * 1024), "4.3 MB");
    assert.equal(fileSizeLabel(150 * 1024 * 1024), "150 MB");
  });
});

describe("where a complaint's files are kept", () => {
  it("in that complaint's own folder in the office, with a storage-safe name", () => {
    const path = buildComplaintFilePath(OFFICE, C1, "Letter from K. Adams (made up).pdf");
    assert.ok(path.startsWith(`${OFFICE}/_complaints/${C1}/`), path);
    assert.ok(/\/\d+-Letter_from_K._Adams__made_up_.pdf$/.test(path), path);
    assert.ok(isInFolder(path, complaintFolder(OFFICE, C1)));
    assert.ok(!isInFolder(path, complaintFolder(OFFICE, C2)));
    assert.ok(!isInFolder(`${OFFICE}/_complaints/${C1}/../${C2}/x.pdf`, complaintFolder(OFFICE, C1)));
  });

  it("go into the records download under each complaint's date and who it was from", () => {
    const names = complaintFolderNames([
      { id: C2, received_date: "2026-10-12", complainant: "K. Adams, buyer" },
      { id: C1, received_date: "2026-10-12", complainant: "K. Adams, buyer" },
    ]);
    const folders = [names.get(C1), names.get(C2)].sort();
    assert.deepEqual(folders, ["2026-10-12 K. Adams, buyer", "2026-10-12 K. Adams, buyer (2)"]);
    const zip = zipPathFor(`${OFFICE}/_complaints/${C1}/1-a.pdf`, new Map(), new Map(), names);
    assert.equal(zip, `Documents/Complaints/${names.get(C1)}/1-a.pdf`);
    // One whose complaint has gone still lands under Complaints, by its id.
    const gone = "55555555-5555-4555-8555-555555555555";
    assert.equal(
      zipPathFor(`${OFFICE}/_complaints/${gone}/1-a.pdf`, new Map(), new Map(), names),
      `Documents/Complaints/${gone}/1-a.pdf`,
    );
  });
});

describe("complaints in the audit pack", () => {
  const input = (complaints: ComplianceRecordInput["complaints"]): ComplianceRecordInput => ({
    property: { id: "p1", address: "27 Example Avenue, Demoville NSW 2999", stage: 5, created_at: "2026-09-01" } as unknown as Property,
    agencyName: "Made-up Realty",
    agentName: "Ana Agent",
    logo: null,
    items: [],
    byKey: {},
    espReasoning: null,
    comparables: [],
    complaints,
    signatures: { agent: null, licensee: null },
    attachments: [],
    rulesetVersion: "test",
    preparedFor: "test",
    generatedAt: new Date("2026-10-30T00:00:00Z"),
  });

  it("lists each linked complaint with its files and every removal", async () => {
    const text = pdfText(
      await buildComplianceRecordPdf(
        input([
          {
            received: "12 October 2026",
            complainant: "K. Adams, buyer (made up)",
            nature: "Not told about the strata report",
            status: "Resolved 28 October 2026",
            files: ["complaint-email.eml · Added 30 Oct 2026, 2:14 pm by Lee Licensee"],
            removed: ["photo.jpg · Removed 30 Oct 2026, 2:20 pm by Lee Licensee"],
          },
        ]),
      ),
    );
    assert.ok(text.includes("Complaints about this listing"), text);
    assert.ok(text.includes("Received 12 October 2026 · K. Adams, buyer (made up) · Resolved 28 October 2026"));
    assert.ok(text.includes("File: complaint-email.eml · Added 30 Oct 2026, 2:14 pm by Lee Licensee"));
    assert.ok(text.includes("Removed file: photo.jpg · Removed 30 Oct 2026, 2:20 pm by Lee Licensee"));
  });

  it("prints nothing about complaints for a listing with none, or for someone who can't see them", async () => {
    const text = pdfText(await buildComplianceRecordPdf(input([])));
    assert.ok(!text.includes("Complaints about this listing"));
  });
});
