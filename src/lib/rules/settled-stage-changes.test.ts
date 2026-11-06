import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  F5_ADDED_AT,
  NOT_ON_THIS_FILE,
  ORDER_NOT_ATTACHED,
  ORDER_ON_AGENT_KEY,
  addedAfterSignOff,
  addedAfterSignOffLine,
  allItemsFor,
  getItem,
  itemsForStage,
} from "./nsw-sales";
import { holdsBack, stageHold } from "./stage-hold";
import { isAiReadItem } from "@/lib/documents/ai-read-items";
import type { Property, PropertyItem, PropertyStage } from "@/lib/types";

// Adam's OK, 6 Nov 2026 (Master's final layout). Final sale price and Record
// of price quotes given moved from Settled to Sold; a new Settled card, Order
// on the agent received, second after the purchaser AML result. Keys, rules
// and saved answers are unchanged, and nothing already done reopens.

const listing = (stage: PropertyStage, extra: Partial<Property> = {}) =>
  ({
    id: "p",
    agency_id: "a",
    stage,
    test_mode: false,
    agent_interest: false,
    sale_method: "private_treaty",
    ...extra,
  }) as unknown as Property;

const row = (key: string, extra: Partial<PropertyItem> = {}): PropertyItem => ({
  id: key,
  agency_id: "a",
  property_id: "p",
  item_key: key,
  status: "done",
  event_date: null,
  recorded_at: "2026-09-01T00:00:00.000Z",
  data: {},
  evidence_path: null,
  extracted_date: null,
  completed_by: "u",
  created_at: "2026-09-01T00:00:00.000Z",
  ...extra,
});

const signedOff = (signedAt: string) => row("sign_licensee", { data: { typedName: "Lic", signedAt } });
const keys = (stage: PropertyStage, items: Record<string, PropertyItem> = {}, ctx = {}) =>
  itemsForStage(stage, listing(5), items, ctx).map((i) => i.key);

/** Every required card in Listing set-up to Campaign, done, so only Sold and Settled are in question. */
const earlierDone = () =>
  Object.fromEntries(
    ([0, 1, 2, 3] as PropertyStage[]).flatMap((s) =>
      itemsForStage(s, listing(5), {})
        .filter((i) => i.requiredForStageCompletion)
        .map((i) => [i.key, row(i.key)]),
    ),
  );

/** Where the listing page works a file, with the hold exactly as the page builds it. */
const workedAt = (storedStage: PropertyStage, items: Record<string, PropertyItem>) =>
  stageHold({
    storedStage,
    testMode: false,
    signedOff: items.sign_licensee?.status === "done",
    incompleteRequired: (s) =>
      itemsForStage(s, listing(storedStage), items)
        .filter((i) => i.requiredForStageCompletion && holdsBack(i.key, s, storedStage) && items[i.key]?.status !== "done")
        .map((i) => i.label),
  });

describe("Sold and Settled, in Master's order", () => {
  it("Sold: Final sale price, Contract served, AML/KYC sent, Record of price quotes", () => {
    assert.deepEqual(keys(4), ["f0", "e1", "amp", "b5"]);
    assert.deepEqual(
      itemsForStage(4, listing(4), {}).map((i) => i.label),
      [
        "Final sale price",
        "Contract served within 2 business days of exchange",
        "AML/KYC check sent to purchaser",
        "Record of price quotes given",
      ],
    );
  });

  it("Sold keeps the material facts card in its place when a fact was disclosed", () => {
    const a7 = row("a7", { data: { materialFactDisclosed: true } });
    assert.deepEqual(keys(4, { a7 }), ["f0", "e1", "e2", "amp", "b5"]);
  });

  it("Settled: AML/KYC cleared, Order on the agent, Agent signature, Send to licensee, finalised file", () => {
    assert.deepEqual(keys(5), ["ampc", "f5", "sign_agent", "send_licensee", "f2"]);
    assert.deepEqual(
      itemsForStage(5, listing(5), {}).map((i) => i.label),
      [
        "Purchaser AML/KYC check returned and cleared",
        "Order on the agent received",
        "Agent signature",
        "Send to licensee",
        "Generate finalised compliance file",
      ],
    );
  });

  it("Settled has the Licensee signature in fourth place where the agent is the licensee", () => {
    assert.deepEqual(keys(5, {}, { agentIsLicensee: true }), ["ampc", "f5", "sign_agent", "sign_licensee", "f2"]);
  });

  it("the moved cards keep their keys and rules", () => {
    const f0 = getItem("f0")!;
    assert.equal(f0.stage, 4);
    assert.equal(f0.kind, "sale");
    assert.equal(f0.requiredForStageCompletion, true);
    const b5 = getItem("b5")!;
    assert.equal(b5.stage, 4);
    assert.equal(b5.requiredForStageCompletion, false);
    assert.equal(b5.noteLabel, "Where the record is kept");
  });

  it("Continue from Sold needs the Final sale price", () => {
    const required = itemsForStage(4, listing(4), {}).filter((i) => i.requiredForStageCompletion).map((i) => i.key);
    assert.deepEqual(required, ["f0", "e1", "amp"]);
  });
});

describe("Order on the agent received", () => {
  const f5 = getItem(ORDER_ON_AGENT_KEY)!;

  it("asks for the date received and the order, both required, and is required to complete Settled", () => {
    assert.equal(f5.key, "f5");
    assert.equal(f5.stage, 5);
    assert.equal(f5.requiresDate, true);
    assert.equal(f5.dateLabel, "Date received");
    assert.equal(f5.evidenceRequired, true);
    assert.equal(f5.requiredForStageCompletion, true);
    assert.equal(f5.hideEvidence, undefined);
    assert.equal(ORDER_NOT_ATTACHED, "Upload the order on the agent before marking this done.");
  });

  it("has the help text word for word", () => {
    assert.equal(
      f5.description,
      "The order on the agent from the vendor's solicitor or conveyancer, authorising release of the deposit.",
    );
  });

  it("is stored, not read, so its upload has no Accepted files line", () => {
    assert.equal(isAiReadItem(ORDER_ON_AGENT_KEY), false);
  });

  it("is a to-do on a file in Sold or Settled that isn't signed off", () => {
    for (const stage of [4, 5] as PropertyStage[]) {
      const card = itemsForStage(5, listing(stage), {}).find((i) => i.key === "f5")!;
      assert.equal(card.notOnThisFile, undefined);
      assert.equal(card.requiredForStageCompletion, true);
    }
  });

  it("is a to-do on a file signed off once it was added", () => {
    const items = { sign_licensee: signedOff("2026-11-08T01:00:00.000Z") };
    const card = allItemsFor(listing(5), items).find((i) => i.key === "f5")!;
    assert.equal(card.notOnThisFile, undefined);
  });
});

describe("a file signed off before the order on the agent card was added", () => {
  const before = { sign_licensee: signedOff("2026-11-01T02:00:00.000Z") };

  it("shows it as Not on this file, counted toward nothing", () => {
    const card = itemsForStage(5, listing(5), before).find((i) => i.key === "f5")!;
    assert.equal(card.notOnThisFile, true);
    assert.equal(card.requiredForStageCompletion, false);
    assert.equal(NOT_ON_THIS_FILE, "Not on this file");
    assert.equal(addedAfterSignOffLine(F5_ADDED_AT), "This card was added on 7 November 2026, after this file was signed off.");
  });

  it("still shows whatever was saved on the card, as saved", () => {
    const withAnswer = { ...before, f5: row("f5") };
    assert.equal(addedAfterSignOff(getItem("f5")!, withAnswer), false);
  });

  it("isn't reopened or held: it stays at Settled with every stage complete", () => {
    const done = Object.fromEntries(
      ["f0", "e1", "amp", "b5", "ampc", "sign_agent", "send_licensee", "f2"].map((k) => [k, row(k)]),
    );
    const items: Record<string, PropertyItem> = { ...earlierDone(), ...done, ...before };
    assert.deepEqual(workedAt(5, items), { stage: 5, waitingOn: [] });
    const settledLeft = itemsForStage(5, listing(5), items).filter(
      (i) => i.requiredForStageCompletion && items[i.key]?.status !== "done",
    );
    assert.deepEqual(settledLeft, []);
  });

  it("a card with no added date is never Not on this file", () => {
    assert.equal(addedAfterSignOff(getItem("ampc")!, before), false);
  });
});

describe("a file already in Settled without a final sale price", () => {
  it("isn't held back at Sold for it, as before the move", () => {
    const items = { ...earlierDone(), e1: row("e1"), amp: row("amp") };
    assert.equal(holdsBack("f0", 4, 5), false);
    assert.deepEqual(workedAt(5, items), { stage: 5, waitingOn: [] });
  });

  it("is still held at Sold by another Sold card, as before", () => {
    const items = { ...earlierDone(), amp: row("amp") };
    assert.deepEqual(workedAt(5, items), { stage: 4, waitingOn: ["Contract served within 2 business days of exchange"] });
  });

  it("a file in Sold still needs it before Settled", () => {
    assert.equal(holdsBack("f0", 4, 4), true);
    assert.equal(holdsBack("e1", 4, 5), true);
  });
});

describe("the finalised compliance file", () => {
  it("prints the moved cards under Sold, and Not on this file on a file signed off before the card", async () => {
    const { buildComplianceRecordPdf } = await import("@/lib/pdf/compliance-record");
    const { pdfText } = await import("@/lib/testing/pdf-text");
    const done = Object.fromEntries(
      ["f0", "e1", "amp", "b5", "ampc", "sign_agent", "send_licensee", "f2"].map((k) => [k, row(k)]),
    );
    const byKey = { ...earlierDone(), ...done, sign_licensee: signedOff("2026-11-01T02:00:00.000Z") };
    const p = { ...listing(5), address: "1 Example Street, Testville NSW 2000 (made up)", created_at: "2026-08-01" } as Property;
    const text = pdfText(
      await buildComplianceRecordPdf({
        property: p,
        agencyName: "Example Realty (made up)",
        agentName: "Alex Example",
        logo: null,
        items: allItemsFor(p, byKey),
        byKey,
        espReasoning: null,
        comparables: [],
        signatures: {
          agent: { typedName: "Alex Example", signedAt: "2026-11-01T01:00:00Z" },
          licensee: { typedName: "Lee Example", signedAt: "2026-11-01T02:00:00Z" },
        },
        rulesetVersion: "test",
        preparedFor: "test",
        generatedAt: new Date("2026-11-07T00:00:00Z"),
      }),
    ).replace(/\s+/g, " ");
    const at = (needle: string) => {
      const i = text.indexOf(needle);
      assert.ok(i >= 0, `missing: ${needle}`);
      return i;
    };
    const settledFirst = at("Purchaser AML/KYC check returned and cleared");
    assert.ok(at("Final sale price") < settledFirst);
    assert.ok(at("Record of price quotes given") < settledFirst);
    assert.ok(at("Order on the agent received") > settledFirst);
    at("not on this file");
    at("This card was added on 7 November 2026, after this file was signed off.");
  });
});

describe("the settlement date, on the order on the agent card (Adam, 6 Nov 2026)", () => {
  it("is read only as a real YYYY-MM-DD day", async () => {
    const { readSettlementDate, settlementDateOf } = await import("./nsw-sales");
    assert.equal(readSettlementDate("2026-10-30"), "2026-10-30");
    assert.equal(readSettlementDate(" 2026-10-30 "), "2026-10-30");
    assert.equal(readSettlementDate("2026-02-30"), null);
    assert.equal(readSettlementDate("30/10/2026"), null);
    assert.equal(readSettlementDate(""), null);
    assert.equal(readSettlementDate(null), null);
    assert.equal(settlementDateOf(row("f5", { data: { settlementDate: "2026-10-30" } })), "2026-10-30");
    assert.equal(settlementDateOf(row("f5")), null);
    assert.equal(settlementDateOf(undefined), null);
  });

  it("is needed to mark the card done, in plain words", async () => {
    const { SETTLEMENT_DATE_LABEL, SETTLEMENT_DATE_NEEDED } = await import("./nsw-sales");
    assert.equal(SETTLEMENT_DATE_LABEL, "Settlement date");
    assert.equal(SETTLEMENT_DATE_NEEDED, "Enter the settlement date before marking this done.");
  });

  it("prints on the finalised compliance file", async () => {
    const { buildComplianceRecordPdf } = await import("@/lib/pdf/compliance-record");
    const { pdfText } = await import("@/lib/testing/pdf-text");
    const done = Object.fromEntries(
      ["f0", "e1", "amp", "b5", "ampc", "sign_agent", "send_licensee", "f2"].map((k) => [k, row(k)]),
    );
    const byKey = {
      ...earlierDone(),
      ...done,
      f5: row("f5", { event_date: "2026-10-30", data: { settlementDate: "2026-10-30" } }),
      sign_licensee: signedOff("2026-11-08T02:00:00.000Z"),
    };
    const p = { ...listing(5), address: "1 Example Street, Testville NSW 2000 (made up)", created_at: "2026-08-01" } as Property;
    const text = pdfText(
      await buildComplianceRecordPdf({
        property: p,
        agencyName: "Example Realty (made up)",
        agentName: "Alex Example",
        logo: null,
        items: allItemsFor(p, byKey),
        byKey,
        espReasoning: null,
        comparables: [],
        signatures: {
          agent: { typedName: "Alex Example", signedAt: "2026-11-08T01:00:00Z" },
          licensee: { typedName: "Lee Example", signedAt: "2026-11-08T02:00:00Z" },
        },
        rulesetVersion: "test",
        preparedFor: "test",
        generatedAt: new Date("2026-11-08T03:00:00Z"),
      }),
    ).replace(/\s+/g, " ");
    const { formatAuDate } = await import("@/lib/format-date");
    assert.ok(text.includes(`Settlement date: ${formatAuDate("2026-10-30")}`));
  });
});
