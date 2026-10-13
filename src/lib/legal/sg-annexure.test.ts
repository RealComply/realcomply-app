import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allItemsInRuleset } from "@/lib/rules/nsw-sales";
import { buildSgAnnexurePdf } from "@/lib/pdf/sg-annexure";
import { pdfPageTexts, pdfText } from "@/lib/testing/pdf-text";
import {
  SG_ANNEXURE_NOTICE,
  SG_ANNEXURE_SCHEDULE_1_LINE,
  SG_ANNEXURE_SECTIONS_AFTER_SCHEDULES,
  SG_ANNEXURE_SECTIONS_BEFORE_SCHEDULES,
  SG_ANNEXURE_SUBTITLE,
  SG_ANNEXURE_TITLE,
  SG_ANNEXURE_VERSION,
  annexureDate,
  firstNameOf,
  scheduleOne,
} from "./sg-annexure";

// The SG annexure, client version (brief, 14 Oct 2026): its words, Schedule 1
// built from the checklist, and the PDF.

describe("the annexure's words", () => {
  it("is version 1.4, the version every adoption records", () => {
    assert.equal(SG_ANNEXURE_VERSION, "1.4");
  });

  it("carries the brief's yellow box word for word", () => {
    assert.equal(
      SG_ANNEXURE_NOTICE,
      "Provided by RealComply for the licensee in charge to consider and adopt. Not legal advice. The licensee should be satisfied it suits their agency and may seek their own advice before adopting it.",
    );
  });

  it("is the client version: no draft mark, no reviewer, no version line under the title", () => {
    const top = [SG_ANNEXURE_TITLE, SG_ANNEXURE_SUBTITLE, SG_ANNEXURE_NOTICE].join(" ");
    const all = JSON.stringify([SG_ANNEXURE_SECTIONS_BEFORE_SCHEDULES, SG_ANNEXURE_SECTIONS_AFTER_SCHEDULES]);
    for (const text of [top, all]) {
      assert.ok(!/draft for review/i.test(text));
      assert.ok(!/borg/i.test(text));
    }
    assert.ok(!/version/i.test(top));
  });

  it("numbers its clauses 1.1 to 5.8 with nothing missing", () => {
    const nums = [...SG_ANNEXURE_SECTIONS_BEFORE_SCHEDULES, ...SG_ANNEXURE_SECTIONS_AFTER_SCHEDULES].flatMap((s) =>
      s.clauses.map((c) => c.num),
    );
    assert.deepEqual(nums, [
      ...["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7"],
      ...["2.1", "2.2", "2.3", "2.4", "2.5", "2.6"],
      ...["3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7"],
      ...["4.1", "4.2", "4.3", "4.4"],
      ...["5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8"],
    ]);
  });
});

describe("Schedule 1, built from the checklist", () => {
  const groups = scheduleOne();
  const rows = groups.flatMap((g) => g.rows);

  it("lists every card in the checklist, once", () => {
    assert.equal(rows.length, allItemsInRuleset().length);
  });

  it("uses the stage headings of the approved PDF, in order", () => {
    assert.deepEqual(
      groups.map((g) => g.heading),
      ["Listing set-up", "Pre-market", "Campaign", "Offers and negotiation", "Exchange", "Settled"],
    );
  });

  it("never shows a retired card", () => {
    assert.ok(!rows.some((r) => /AML red flags escalated/i.test(r.record)));
  });

  it("picks up a card the moment the checklist has it", () => {
    assert.ok(rows.some((r) => r.record === "Tenant notice and permission for photos"));
    assert.equal(groups[0].rows[0].record, "Agency agreement signed; copy served within 48 hours");
  });

  it("writes em dashes as colons, as the approved PDF does", () => {
    for (const r of rows) assert.ok(!/[—–]/.test(r.record + r.provision), r.record);
    assert.ok(rows.some((r) => r.record === "Required notices on display: dummy bidding, collusive practices, successful bidders"));
  });
});

describe("dates and names", () => {
  it("prints dates in Sydney", () => {
    // 3pm UTC on 13 October is 2am on the 14th in Sydney.
    assert.equal(annexureDate(new Date("2026-10-13T15:00:00Z")), "14 October 2026");
  });

  it("takes the first name from the name typed", () => {
    assert.equal(firstNameOf("  Lee   Licensee "), "Lee");
    assert.equal(firstNameOf(""), "");
  });
});

describe("the annexure PDF", () => {
  const office = { agencyName: "Harbour Realty", licenceNumber: null, effectiveDate: null, logo: null };

  it("carries the RealComply footer and its page number on every page", async () => {
    const pages = await pdfPageTexts(await buildSgAnnexurePdf({ ...office, adoption: null }));
    assert.ok(pages.length >= 5, `${pages.length} pages`);
    pages.forEach((text, i) => {
      assert.ok(text.includes("RealComply Pty Ltd · ABN 61 700 934 792 · Not legal advice"), `page ${i + 1}`);
      assert.ok(text.includes(`Page ${i + 1} of ${pages.length}`), `page ${i + 1}`);
    });
  });

  it("the blank copy names the office and leaves the adoption to fill in", async () => {
    const text = pdfText(await buildSgAnnexurePdf({ ...office, adoption: null }));
    assert.ok(text.includes("Harbour Realty"));
    assert.ok(text.includes(SG_ANNEXURE_SCHEDULE_1_LINE));
    assert.ok(!text.includes("Adopted electronically through RealComply."));
  });

  it("the signed copy fills in the adoption: name, licence number, the email it went to, when, and the version", async () => {
    const text = pdfText(
      await buildSgAnnexurePdf({
        ...office,
        licenceNumber: "10012345",
        effectiveDate: "14 October 2026",
        adoption: {
          signedName: "Lee Licensee",
          licenceNumber: "10012345",
          sentTo: "getadamc3+licensee@gmail.com",
          signedAt: "2026-10-14T02:15:00Z",
          version: "1.4",
        },
      }),
    );
    for (const words of [
      "Adopted electronically through RealComply.",
      "Name typed: Lee Licensee",
      "Licence number given: 10012345",
      "Adoption request sent to: getadamc3+licensee@gmail.com",
      "Signed: 14 October 2026 at 1:15 pm (Sydney)",
      "Annexure version adopted: 1.4",
      "14 October 2026",
    ]) {
      assert.ok(text.includes(words), words);
    }
  });

  it("never fails on a name the font can't fully draw", async () => {
    const bytes = await buildSgAnnexurePdf({
      agencyName: "O’Brien & Søn 房地产",
      licenceNumber: "1",
      effectiveDate: "14 October 2026",
      logo: null,
      adoption: { signedName: "José O’Brien 李", licenceNumber: "1", sentTo: "x@example.invalid", signedAt: "2026-10-14T02:15:00Z", version: "1.4" },
    });
    assert.ok(bytes.length > 1000);
  });
});
