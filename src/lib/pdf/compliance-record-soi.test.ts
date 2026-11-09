import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { buildComplianceRecordPdf } from "@/lib/pdf/compliance-record";
import { allItemsFor, allItemsInRuleset } from "@/lib/rules/nsw-sales";
import { soiRecordLines, type SoiVersion } from "@/lib/rules/soi";
import { pdfText } from "@/lib/testing/pdf-text";
import type { Property, PropertyItem } from "@/lib/types";

// The Statement of Information on the compliance record, the front of the
// audit pack (s72C; Reg s12I; 0121): every version, when it's due to be
// revised, and the link for online ads, under its card. Made-up data only.

const AT = new Date("2027-03-08T01:00:00Z");
const v = (versionNo: number, over: Partial<SoiVersion> = {}): SoiVersion => ({
  versionNo,
  source: "realcomply",
  pdfPath: `a/p/soi/${versionNo}.pdf`,
  fileName: null,
  content: null,
  espRevisionNo: versionNo - 1,
  preparedOn: "2027-02-12",
  preparedByName: "Ana Agent (made up)",
  createdAt: "2027-02-12T01:00:00Z",
  ...over,
});

async function recordText(lines: string[] | undefined) {
  const pdf = await buildComplianceRecordPdf({
    property: { id: "p1", address: "9 Made Up Parade, Sampleton", stage: 1, created_at: "2027-02-10" } as unknown as Property,
    agencyName: "Made Up Realty",
    agentName: "Ana Agent",
    logo: null,
    items: allItemsInRuleset().filter((i) => i.key === "soi" || i.key === "a4c"),
    byKey: {},
    espReasoning: null,
    comparables: [],
    signatures: { agent: null, licensee: null },
    rulesetVersion: "test",
    preparedFor: "test",
    generatedAt: AT,
    soiLines: lines,
  });
  return (await pdfText(pdf)).replace(/\s+/g, " ");
}

describe("the Statement of Information on the compliance record", () => {
  it("lists every version, when it's due, and the link", async () => {
    const text = await recordText(
      soiRecordLines({
        versions: [v(1), v(2, { source: "uploaded", fileName: "Our SOI.pdf", preparedOn: "2027-03-01" })],
        reviseBy: { revisionNo: 2, dueBy: "2027-03-09" },
        link: { token: "x", enabled: false, changedAt: "2027-03-02T01:00:00Z", changedByName: "Ana Agent (made up)" },
        now: AT,
      }),
    );
    assert.ok(text.includes("Statement of Information"));
    assert.ok(text.includes("Version 1, made in RealComply, prepared 12 February 2027 by Ana Agent (made up), for the agreement's ESP."), text);
    assert.ok(text.includes("Version 2, uploaded (Our SOI.pdf), prepared 1 March 2027 by Ana Agent (made up), for ESP revision 1."));
    assert.ok(text.includes("Revise the Statement of Information by 9 March 2027"));
    assert.ok(text.includes("Link for online ads: switched off on 2 March 2027 by Ana Agent (made up)."));
  });

  it("leaves the lines out of a record built without them", async () => {
    assert.ok(!(await recordText(undefined)).includes("Link for online ads"));
  });
});

describe("where the card shows (Act Sch 1, transitional cl 3)", () => {
  const property = { id: "p1", address: "9 Made Up Parade", stage: 0, property_type: "House" } as unknown as Property;
  const a3 = (date: string) => ({ a3: { item_key: "a3", status: "done", event_date: date } as unknown as PropertyItem });

  const shows = (items: Record<string, PropertyItem>) => allItemsFor(property, items).some((i) => i.key === "soi");

  it("nowhere before midnight Sydney on 8 February 2027 (Master, 10 Nov 2026)", () => {
    assert.ok(!shows(a3("2027-02-10")), "today, in November 2026: switched off");
    assert.ok(!shows({}));
  });

  it("with the switch on: an agreement from 8 February 2027, never one signed before, even with a statement on it", () => {
    mock.timers.enable({ apis: ["Date"], now: new Date("2027-03-01T01:00:00Z") });
    try {
      assert.ok(shows(a3("2027-02-08")));
      assert.ok(shows({}), "not signed yet");
      assert.ok(!shows(a3("2027-02-07")));
      assert.ok(!shows({ ...a3("2027-02-07"), soi: { item_key: "soi", status: "done" } as unknown as PropertyItem }));
    } finally {
      mock.timers.reset();
    }
  });
});
