import { test } from "node:test";
import assert from "node:assert/strict";
import { registerExpiryDates } from "@/lib/data/nav-counts";

// Which expiry dates light the Registers dot in the sidebar. The dot has to
// match the page it opens (check of 10 Oct 2026).

const staff = [
  { id: "lic", licence_expiry: "2027-01-01", archived_at: null },
  { id: "ag1", licence_expiry: "2026-10-05", archived_at: null },
  { id: "asst", licence_expiry: "2026-09-30", archived_at: null },
  { id: "gone", licence_expiry: "2026-01-01", archived_at: "2026-06-01T00:00:00Z" },
];
const agency = {
  pi_expiry: "2026-10-09",
  cyber_expiry: "2026-10-20",
  icare_expiry: null,
  corporation_licence_expiry: "2026-10-05",
};

test("an agent's dot counts their own licence only: not the office insurance, the corporation licence or their assistant's", () => {
  assert.deepEqual(registerExpiryDates(staff, agency, { id: "ag1", licenseeView: false }), ["2026-10-05"]);
});

test("an assistant's dot counts their own certificate only, not the agent they assist", () => {
  assert.deepEqual(registerExpiryDates(staff, agency, { id: "asst", licenseeView: false }), ["2026-09-30"]);
});

test("the licensee's dot counts everyone in the office, the corporation licence and the insurance", () => {
  assert.deepEqual(registerExpiryDates(staff, agency, { id: "lic", licenseeView: true }), [
    "2027-01-01",
    "2026-10-05",
    "2026-09-30",
    "2026-10-05",
    "2026-10-09",
    "2026-10-20",
    null,
  ]);
});

test("someone who has left never counts, even for the licensee", () => {
  const dates = registerExpiryDates(staff, null, { id: "lic", licenseeView: true });
  assert.ok(!dates.includes("2026-01-01"));
  assert.equal(dates.length, 3);
});
