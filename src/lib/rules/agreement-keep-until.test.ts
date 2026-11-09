import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  agreementEndedOn,
  agreementsDownloadLine,
  keepUntil,
  keepUntilLine,
  keepUntilLineFor,
  s8aApplies,
} from "./agreement-keep-until";
import type { PropertyItem } from "@/lib/types";

const before17 = new Date("2026-11-10T09:00:00+11:00");
const after17 = new Date("2026-11-20T09:00:00+11:00");
const none = { signedOn: null, lastAmendedOn: null, settledOn: null, withdrawnOn: null };

describe("keeping the agency agreement (Reg s8A, from 17 Nov 2026)", () => {
  it("covers agreements signed or amended from 17 November; no signing date yet counts from today", () => {
    assert.equal(s8aApplies({ signedOn: "2026-11-17", lastAmendedOn: null }, before17), true);
    assert.equal(s8aApplies({ signedOn: "2026-11-16", lastAmendedOn: null }, after17), false);
    assert.equal(s8aApplies({ signedOn: "2026-10-01", lastAmendedOn: "2026-11-18" }, after17), true, "an ESP revision amends it");
    assert.equal(s8aApplies({ signedOn: "2026-10-01", lastAmendedOn: "2026-11-10" }, after17), false);
    assert.equal(s8aApplies({ signedOn: null, lastAmendedOn: null }, before17), false);
    assert.equal(s8aApplies({ signedOn: null, lastAmendedOn: null }, after17), true);
  });

  it("the agreement ends at settlement or withdrawal; kept 3 years after", () => {
    assert.equal(agreementEndedOn({ settledOn: null, withdrawnOn: null }), null);
    assert.equal(agreementEndedOn({ settledOn: "2027-02-20", withdrawnOn: null }), "2027-02-20");
    assert.equal(agreementEndedOn({ settledOn: null, withdrawnOn: "2027-01-05" }), "2027-01-05");
    assert.equal(keepUntil("2027-02-20"), "2030-02-20");
    assert.equal(keepUntil("2028-02-29"), "2031-03-01", "29 February lands on 1 March");
  });

  it("the line on the card and in the record", () => {
    assert.equal(keepUntilLine({ ...none, signedOn: "2026-10-01" }, after17), null, "signed before 17 November, never amended");
    assert.equal(
      keepUntilLine({ ...none, signedOn: "2026-11-18" }, after17),
      "Keep until 3 years after the agreement ends, and for as long as it is in force (Reg s8A).",
    );
    assert.equal(
      keepUntilLine({ ...none, signedOn: "2026-11-18", settledOn: "2027-02-20" }, after17),
      "Keep until 20 February 2030, 3 years after the agreement ended (Reg s8A).",
    );
  });

  it("reads the cards: signing date, latest revision, settlement date, withdrawal", () => {
    const row = (extra: Partial<PropertyItem>) => extra as PropertyItem;
    assert.equal(
      keepUntilLineFor(
        { a3: row({ event_date: "2026-10-01" }), d3: row({ data: { noticeServedOn: "2026-11-25" } }), f5: row({ data: { settlementDate: "2027-03-01" } }) },
        null,
        after17,
      ),
      "Keep until 1 March 2030, 3 years after the agreement ended (Reg s8A).",
    );
    assert.equal(keepUntilLineFor({ a3: row({ event_date: "2026-11-19" }) }, "2027-01-05", after17), "Keep until 5 January 2030, 3 years after the agreement ended (Reg s8A).");
    assert.equal(keepUntilLineFor({ a3: row({ event_date: "2026-10-01" }) }, null, after17), null);
  });

  it("the download line when a subscription ends, from 17 November only, no dashes", () => {
    assert.equal(agreementsDownloadLine("2026-11-24", before17), null);
    const line = agreementsDownloadLine("2026-12-04", after17) ?? "";
    assert.match(line, /3 years after they end/);
    assert.match(line, /Download them before 4 December 2026/);
    assert.match(line, /s8A/);
    assert.doesNotMatch(line, /—/);
  });
});

describe("the emails after a subscription ends (Reg s8A)", () => {
  it("both say to download the agreements from 17 November, and neither before", async () => {
    const { endedEmail } = await import("@/lib/subscription-end/emails");
    const endedAt = new Date("2026-11-20T05:00:00Z"); // 4pm on 20 November in Sydney
    for (const kind of ["day0", "day7"] as const) {
      const after = endedEmail(kind, { agencyName: "Made Up Realty", endedAt, now: endedAt });
      assert.match(after.text, /Agency agreements signed or amended from 17 November 2026/, kind);
      assert.match(after.text, /Download them before 4 December 2026/, kind);
      const earlier = new Date("2026-11-10T05:00:00Z");
      const before = endedEmail(kind, { agencyName: "Made Up Realty", endedAt: earlier, now: earlier });
      assert.doesNotMatch(before.text, /Agency agreements signed or amended/, `${kind} before 17 November`);
    }
  });
});
