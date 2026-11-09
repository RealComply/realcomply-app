import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countsByGroup,
  grouped,
  heldBackLine,
  monthName,
  nextMonth,
  packEmailLine,
  packEmailSubject,
  packHeading,
  packMonthFor,
  preparedLine,
  signButton,
  signedInPackLine,
  signedSummary,
  signsLine,
  type WaitingItem,
} from "@/lib/licensee-signoff/model";

// The monthly licensee sign-off pack (Adam, 3 Nov 2026; 0109): its months and words.

test("the pack being prepared: last month, unless it has gone", () => {
  assert.equal(packMonthFor("2026-11-02", new Set()), "2026-10-01");
  assert.equal(packMonthFor("2026-11-02", new Set(["2026-10-01"])), "2026-11-01");
  assert.equal(packMonthFor("2027-01-03", new Set()), "2026-12-01", "across the year");
  assert.equal(nextMonth("2026-12-01"), "2027-01-01");
  assert.equal(monthName("2026-10-01"), "October");
});

test("the words, as in the approved mockup", () => {
  assert.equal(packHeading("2026-10-01"), "Licensee sign-off: October pack");
  assert.equal(
    preparedLine("2026-10-01", "Priya Nandakumar", { name: "Mel Carter", officeManager: true }),
    "Everything waiting for Priya Nandakumar's signature. Prepared by Mel Carter, office manager. Anything that comes in after you send goes into November's pack.",
  );
  assert.equal(packEmailSubject("2026-10-01", 41), "Your October sign-off pack: 41 items");
  assert.equal(
    packEmailLine({
      senderName: "Mel",
      month: "2026-10-01",
      officeName: "Example Realty",
      counts: { sales: 36, pm: 0, trust: 2, office: 3 },
      flagged: 2,
    }),
    "Mel has sent you October's sign-off pack for Example Realty: 36 sales files, 2 trust items and 3 office items. 2 items are flagged for a closer look.",
  );
  assert.equal(signsLine(40, "Priya Nandakumar", "2 Nov 2026"), "Signs 40 items as Priya Nandakumar, 2 Nov 2026.");
  assert.equal(signButton(1), "Sign 1 item");
  assert.equal(
    signedSummary("2026-10-01", 40, "Priya Nandakumar", "2 Nov 2026", 1),
    "October pack signed. 40 items signed by Priya Nandakumar on 2 Nov 2026. 1 held back.",
  );
  assert.equal(
    heldBackLine({ officeManagerName: "Mel", licenseeName: "Priya", month: "2026-10-01" }),
    "Back with Mel, with Priya's note. Goes into November's pack.",
  );
  assert.equal(signedInPackLine("Priya Nandakumar", "2 Nov 2026", "2026-10-01"), "Signed by Priya Nandakumar, 2 Nov 2026, in the October pack");
  for (const s of [packEmailSubject("2026-10-01", 2), preparedLine("2026-10-01", "Lee", { name: "Mel", officeManager: false })]) {
    assert.ok(!s.includes("—"), "no em dash");
  }
});

test("flagged first in each group, then oldest first; every group present", () => {
  const item = (over: Partial<WaitingItem>): WaitingItem => ({
    type: "sales_file", id: "x", group: "sales", title: "t", details: "", flagged: false, flagText: null, href: "", at: "2026-10-05", ...over,
  });
  const items = [
    item({ id: "late", at: "2026-10-20" }),
    item({ id: "early", at: "2026-10-01" }),
    item({ id: "flag", at: "2026-10-30", flagged: true }),
    item({ id: "gift", group: "office", type: "gift", flagged: true }),
  ];
  const g = grouped(items);
  assert.deepEqual(g.map((x) => x.group), ["sales", "pm", "trust", "office"]);
  assert.deepEqual(g[0].items.map((i) => i.id), ["flag", "early", "late"]);
  assert.equal(g[1].items.length, 0, "property management: nothing waiting");
  assert.deepEqual(countsByGroup(items), { sales: 3, pm: 0, trust: 0, office: 1 });
});
