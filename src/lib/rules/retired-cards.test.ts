import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { C2_C3_RETIRED_AT, allItemsFor, allItemsInRuleset, getItem, itemsForStage } from "./nsw-sales";
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
