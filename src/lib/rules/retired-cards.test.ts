import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { C2_C3_RETIRED_AT, X2_RETIRED_AT, allItemsFor, allItemsInRuleset, getItem, itemsForStage } from "./nsw-sales";
import { scheduleOne } from "@/lib/legal/sg-annexure";
import type { Property, PropertyItem } from "@/lib/types";

// REVERSAL 15 Oct 2026 (Adam): c2 and c3 left the On market stage for the Did
// you know page. Open listings stop asking for them; files already signed off
// keep showing them exactly as they were; saved answers are never hidden from
// their file.

const listing = (stage: Property["stage"]) =>
  ({ id: "p", agency_id: "a", stage, test_mode: false, agent_interest: false, sale_method: "private_treaty" }) as unknown as Property;

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
const keysOn = (stage: Property["stage"], items: Record<string, PropertyItem>) =>
  itemsForStage(2, listing(stage), items).map((i) => i.key);

describe("the two retired On market cards", () => {
  it("are not on a new listing's On market stage, so nothing waits on them", () => {
    const keys = keysOn(2, {});
    assert.ok(!keys.includes("c2") && !keys.includes("c3"), keys.join(","));
    const required = itemsForStage(2, listing(2), {}).filter((i) => i.requiredForStageCompletion).map((i) => i.key);
    assert.deepEqual(required.sort(), ["c0", "c1"]);
  });

  it("are not on an open listing that already ticked them, and the answers stay put", () => {
    const items = { c2: row("c2"), c3: row("c3") };
    assert.deepEqual(keysOn(3, items).filter((k) => k === "c2" || k === "c3"), []);
    assert.equal(items.c2.status, "done");
  });

  it("stay on a file signed off before they retired, ticked or not, as it was", () => {
    const before = { sign_licensee: signedOff("2026-10-01T02:00:00.000Z") };
    assert.deepEqual(keysOn(5, before).filter((k) => k === "c2" || k === "c3"), ["c2", "c3"]);
    const withAnswers = { ...before, c2: row("c2"), c3: row("c3") };
    assert.deepEqual(keysOn(5, withAnswers).filter((k) => k === "c2" || k === "c3"), ["c2", "c3"]);
  });

  it("are left off a file signed off after they retired, unless it holds an answer for one", () => {
    const after = { sign_licensee: signedOff("2026-11-01T02:00:00.000Z") };
    assert.deepEqual(keysOn(5, after).filter((k) => k === "c2" || k === "c3"), []);
    assert.deepEqual(keysOn(5, { ...after, c2: row("c2") }).filter((k) => k === "c2" || k === "c3"), ["c2"]);
  });

  it("go by the signing time, not the row's", () => {
    // Signed after retirement on a sign-off row created earlier.
    const items = { sign_licensee: { ...signedOff("2026-11-01T02:00:00.000Z"), recorded_at: "2026-09-01T00:00:00.000Z" } };
    assert.deepEqual(keysOn(5, items).filter((k) => k === "c2"), []);
    assert.ok(Date.parse(C2_C3_RETIRED_AT) < Date.parse("2026-11-01T00:00:00.000Z"));
  });

  it("are out of the SG annexure's Schedule 1 and the platform's list, but still known by key", () => {
    const listed = allItemsInRuleset().map((i) => i.key);
    assert.ok(!listed.includes("c2") && !listed.includes("c3"));
    const records = scheduleOne().flatMap((g) => g.rows.map((r) => r.record));
    assert.ok(!records.includes("Advertising identifies the licensed agent/agency"));
    assert.ok(!records.includes("Marketing reflects the agreement"));
    // Old send-backs and files still find their labels.
    assert.equal(getItem("c2")?.label, "Advertising identifies the licensed agent/agency");
    assert.equal(getItem("c3")?.label, "Marketing reflects the agreement");
  });

  it("print on a whole signed file in their place on the On market stage", () => {
    const items = allItemsFor(listing(5), { sign_licensee: signedOff("2026-10-01T02:00:00.000Z") }).map((i) => i.key);
    const c1 = items.indexOf("c1");
    assert.deepEqual(items.slice(c1, c1 + 3), ["c1", "c2", "c3"]);
  });
});

// REVERSAL 30 Oct 2026 (Adam): x2, "Conditions of sale prepared for display",
// left the Pre-market stage of an auction file, on the same terms as c2 and c3.
const auction = (stage: Property["stage"]) => ({ ...listing(stage), sale_method: "auction" }) as Property;
const preMarket = (property: Property, items: Record<string, PropertyItem>) =>
  itemsForStage(1, property, items).map((i) => i.key);
const signedBefore = () => ({ sign_licensee: signedOff("2026-10-28T02:00:00.000Z") });
const signedAfter = () => ({ sign_licensee: signedOff("2026-11-02T02:00:00.000Z") });

describe("the retired Pre-market auction card", () => {
  it("is not on an auction listing's Pre-market stage, so nothing waits on it", () => {
    const keys = preMarket(auction(1), {});
    assert.ok(keys.includes("x1") && !keys.includes("x2"), keys.join(","));
    const required = itemsForStage(1, auction(1), {}).filter((i) => i.requiredForStageCompletion).map((i) => i.key);
    assert.ok(required.includes("x1") && !required.includes("x2"), required.join(","));
  });

  it("is not on an open listing that already ticked it, and the answer stays put", () => {
    const items = { x2: row("x2") };
    assert.ok(!preMarket(auction(5), items).includes("x2"));
    assert.equal(items.x2.status, "done");
  });

  it("stays on an auction file signed off before it retired, ticked or not, as it was", () => {
    assert.ok(preMarket(auction(5), signedBefore()).includes("x2"));
    assert.ok(preMarket(auction(5), { ...signedBefore(), x2: row("x2") }).includes("x2"));
  });

  it("is left off a file signed off after it retired, unless the file holds an answer for it", () => {
    assert.ok(!preMarket(auction(5), signedAfter()).includes("x2"));
    assert.ok(preMarket(auction(5), { ...signedAfter(), x2: row("x2") }).includes("x2"));
  });

  it("is never on a file that was not an auction, signed off or not", () => {
    assert.ok(!preMarket(listing(5), signedBefore()).includes("x2"));
  });

  it("still marks the campaign as an auction where it was answered: a pass-in keeps its auction cards", () => {
    const keys = preMarket(listing(2), { x2: row("x2") });
    assert.ok(keys.includes("x1") && !keys.includes("x2"), keys.join(","));
  });

  it("is out of the SG annexure's Schedule 1 and the platform's list, but still known by key", () => {
    assert.ok(!allItemsInRuleset().some((i) => i.key === "x2"));
    const records = scheduleOne().flatMap((g) => g.rows.map((r) => r.record));
    assert.ok(!records.includes("Conditions of sale prepared for display"));
    // The day's own card stays.
    assert.ok(records.includes("Conditions of sale on display"));
    assert.equal(getItem("x2")?.label, "Conditions of sale prepared for display");
  });

  it("prints on a whole signed file in its place, after the auctioneer", () => {
    const items = allItemsFor(auction(5), signedBefore()).map((i) => i.key);
    assert.equal(items[items.indexOf("x1") + 1], "x2");
  });

  it("retires from midnight at the start of 30 Oct 2026, Sydney time, the day Adam asked", () => {
    const sydney = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(X2_RETIRED_AT));
    assert.equal(sydney, "30/10/2026, 00:00");
  });
});
