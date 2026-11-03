import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annexureLinkStatus,
  copiedLinkLine,
  copiesBeforeSigning,
  copyLinkHint,
  formatAuDateTime,
  nudgeText,
  openedLine,
  sentLine,
  signoffLinksToNudge,
  unopenedNudgeDue,
  type LinkDelivery,
  type SignoffLinkRow,
} from "@/lib/links/delivery";

// Email that gets through (Adam, 2 Nov 2026; 0107): Sent, Opened, and the
// nudge after 2 NSW business days unopened.

// Monday 2 November 2026, 10am in Sydney (AEDT, UTC+11).
const MON_10AM = "2026-11-01T23:00:00.000Z";
const link = (over: Partial<LinkDelivery> = {}): LinkDelivery => ({
  emailSentAt: MON_10AM,
  createdAt: MON_10AM,
  openedAt: null,
  doneAt: null,
  ...over,
});
const sydney = (local: string) => new Date(`${local}+11:00`);

test("sent, then opened with the date and time in Sydney", () => {
  assert.equal(sentLine(link()), "Sent 2 November 2026");
  assert.equal(openedLine(link()), "Not opened yet");
  assert.equal(openedLine(link({ openedAt: "2026-11-02T22:14:00.000Z" })), "Opened 3 November 2026, 9:14am");
  assert.equal(formatAuDateTime("2026-11-03T03:05:00.000Z"), "3 November 2026, 2:05pm");
});

test("signing counts as opening it, when no open was recorded first", () => {
  assert.equal(openedLine(link({ doneAt: "2026-11-03T01:00:00.000Z" })), "Opened 3 November 2026, 12:00pm");
  assert.equal(
    openedLine(link({ openedAt: "2026-11-02T22:00:00.000Z", doneAt: "2026-11-03T01:00:00.000Z" })),
    "Opened 3 November 2026, 9:00am",
    "the earlier of the two",
  );
});

test("a link that never went out says neither", () => {
  assert.equal(sentLine(link({ emailSentAt: null })), null);
  assert.equal(openedLine(link({ emailSentAt: null })), null);
  assert.equal(unopenedNudgeDue(link({ emailSentAt: null }), sydney("2026-11-20T09:00:00")), false);
});

test("the nudge: after 2 full NSW business days unopened", () => {
  // Sent Monday: Tuesday and Wednesday pass, the nudge shows from Thursday.
  assert.equal(unopenedNudgeDue(link(), sydney("2026-11-04T23:59:00")), false, "Wednesday");
  assert.equal(unopenedNudgeDue(link(), sydney("2026-11-05T00:01:00")), true, "Thursday");
  // Opened, or signed: no nudge.
  assert.equal(unopenedNudgeDue(link({ openedAt: "2026-11-02T00:00:00.000Z" }), sydney("2026-11-09T09:00:00")), false);
  assert.equal(unopenedNudgeDue(link({ doneAt: "2026-11-02T00:00:00.000Z" }), sydney("2026-11-09T09:00:00")), false);
  // Sent on a Friday: the weekend doesn't count, so Tuesday.
  const fri = link({ emailSentAt: "2026-11-05T23:00:00.000Z" });
  assert.equal(unopenedNudgeDue(fri, sydney("2026-11-10T08:00:00")), false, "Tuesday is the 2nd business day");
  assert.equal(unopenedNudgeDue(fri, sydney("2026-11-11T08:00:00")), true, "Wednesday");
  // Christmas: sent Thursday 24 Dec 2026; 25, 26 (Sat), 27 (Sun), 28 (additional day) aren't business days.
  const xmas = link({ emailSentAt: "2026-12-23T23:00:00.000Z" });
  assert.equal(unopenedNudgeDue(xmas, sydney("2026-12-30T08:00:00")), false, "29th and 30th are the two business days");
  assert.equal(unopenedNudgeDue(xmas, sydney("2026-12-31T08:00:00")), true);
});

test("the nudge in Adam's words; Copy link only on the file sign-off", () => {
  assert.equal(
    nudgeText("signoff", "Vic Srbinovski"),
    "Vic Srbinovski hasn't opened the sign-off link yet. Copy it and send it yourself, or ask them to check their quarantine.",
  );
  assert.equal(nudgeText("office_manager", "Vic"), "Vic hasn't opened the approval link yet. Ask them to check their quarantine.");
  assert.ok(!/Copy/.test(nudgeText("annexure", "Vic")), "no Copy link for the annexure");
  assert.equal(copyLinkHint("Vic"), "If Vic hasn't received it, copy the link and send it yourself.");
  for (const kind of ["signoff", "office_manager", "annexure"] as const) {
    assert.ok(!/—/.test(nudgeText(kind, "Vic")), "no em dashes");
  }
});

test("the trail: only copies made before the signature, oldest first", () => {
  const copies = [
    { by: "Ben Agent", at: "2026-11-04T01:00:00.000Z" },
    { by: "Ana Agent", at: "2026-11-03T01:00:00.000Z" },
    { by: "Ana Agent", at: "2026-11-06T01:00:00.000Z" },
  ];
  assert.deepEqual(
    copiesBeforeSigning(copies, "2026-11-05T00:00:00.000Z").map((c) => c.by),
    ["Ana Agent", "Ben Agent"],
  );
  assert.deepEqual(copiesBeforeSigning(copies, null), [], "not signed: no trail on the record");
  assert.equal(
    copiedLinkLine(copies[1]),
    "Signed through a link Ana Agent copied on 3 November 2026 and sent outside RealComply's email.",
  );
});

test("Home: the newest live sign-off link on each listing, sent and unopened 2 business days on", () => {
  const row = (over: Partial<SignoffLinkRow>): SignoffLinkRow => ({
    id: "r",
    property_id: "p1",
    created_at: MON_10AM,
    email_sent_at: MON_10AM,
    opened_at: null,
    signed_at: null,
    expires_at: "2026-12-01T00:00:00.000Z",
    ...over,
  });
  const thursday = sydney("2026-11-05T09:00:00");
  const rows = [
    row({ id: "due" }),
    row({ id: "opened", property_id: "p2", opened_at: "2026-11-03T00:00:00.000Z" }),
    row({ id: "signed", property_id: "p3", signed_at: "2026-11-03T00:00:00.000Z" }),
    row({ id: "not sent", property_id: "p4", email_sent_at: null }),
    row({ id: "expired", property_id: "p5", expires_at: "2026-11-04T00:00:00.000Z" }),
    // An older link on p6, then a newer one sent on Wednesday: only the newer counts, and it isn't due.
    row({ id: "old", property_id: "p6", created_at: "2026-10-20T00:00:00.000Z", email_sent_at: "2026-10-20T00:00:00.000Z" }),
    row({ id: "new", property_id: "p6", created_at: "2026-11-03T23:00:00.000Z", email_sent_at: "2026-11-03T23:00:00.000Z" }),
  ];
  assert.deepEqual(signoffLinksToNudge(rows, thursday).map((r) => r.id), ["due"]);
  assert.deepEqual(signoffLinksToNudge(rows, sydney("2026-11-04T09:00:00")), [], "Wednesday: not yet");
});

test("Home: the annexure link while it waits on the licensee, with no Copy link", () => {
  const row = {
    sent_to: "getadamc3+lee@gmail.com",
    created_at: MON_10AM,
    email_sent_at: MON_10AM,
    opened_at: null,
    used_at: null,
    expires_at: "2026-12-01T00:00:00.000Z",
  };
  assert.deepEqual(annexureLinkStatus(row, "Lee Licensee", sydney("2026-11-03T09:00:00")), {
    licenseeName: "Lee Licensee",
    sentTo: "getadamc3+lee@gmail.com",
    sentLine: "Sent 2 November 2026",
    openedLine: "Not opened yet",
    nudge: null,
  });
  assert.equal(
    annexureLinkStatus(row, "Lee Licensee", sydney("2026-11-05T09:00:00"))?.nudge,
    "Lee Licensee hasn't opened the link to adopt the annexure yet. Ask them to check their quarantine.",
  );
  const opened = annexureLinkStatus({ ...row, opened_at: "2026-11-02T22:14:00.000Z" }, "Lee Licensee", sydney("2026-11-09T09:00:00"));
  assert.equal(opened?.openedLine, "Opened 3 November 2026, 9:14am");
  assert.equal(opened?.nudge, null);
  // Adopted, or expired: nothing to show.
  assert.equal(annexureLinkStatus({ ...row, used_at: "2026-11-03T00:00:00.000Z" }, "Lee", sydney("2026-11-09T09:00:00")), null);
  assert.equal(annexureLinkStatus(row, "Lee", sydney("2026-12-02T09:00:00")), null);
  assert.equal(annexureLinkStatus(null, "Lee"), null);
  // Sent before 0107: its creation stands in for the sent time; no name on file: the address.
  const old = annexureLinkStatus({ ...row, email_sent_at: null }, " ", sydney("2026-11-05T09:00:00"));
  assert.equal(old?.sentLine, "Sent 2 November 2026");
  assert.equal(old?.licenseeName, "getadamc3+lee@gmail.com");
});
