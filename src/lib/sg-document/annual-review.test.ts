import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REVIEW_REMINDER_DAYS,
  daysUntil,
  reviewCardShows,
  reviewDueTag,
  reviewFrom,
  reviewNoteProblem,
  reviewRecipients,
  reviewReminderDay,
  reviewWhenSaid,
  type ReviewPerson,
  type SgReview,
} from "@/lib/sg-document/annual-review";
import { changeLogRows, nextReviewDue } from "@/lib/sg-document/change-log";
import { SG_2_1_2 } from "@/lib/sg-document/fair-trading";
import { buildSgReviewEmail, sgReviewSubject } from "@/lib/email/sg-annual-review";
import { runSgReviewReminders, type SgReviewReminderDeps } from "@/lib/email/sg-review-reminders";
import type { SendEmailInput } from "@/lib/email/send";

// Supervision guidelines part 4 (Adam's mockup, signed off 6 Nov 2026,
// screen 7; Master, 10 Nov 2026; 0126). Made-up office and people.

describe("when the annual review reminders go (90, 60, 30, 14 and 7 days)", () => {
  it("counts whole days, Sydney's", () => {
    assert.equal(daysUntil("2027-08-14", "2027-07-15"), 30);
    assert.equal(daysUntil("2027-08-14", "2027-08-14"), 0);
    assert.equal(daysUntil("2027-08-14", "2027-08-17"), -3);
    // Across the change to daylight saving: still whole days.
    assert.equal(daysUntil("2027-10-04", "2027-10-02"), 2);
  });

  it("the most urgent step reached, once each", () => {
    assert.deepEqual([...REVIEW_REMINDER_DAYS], [90, 60, 30, 14, 7]);
    const due = "2027-08-14";
    const at = (days: number) => {
      const d = new Date(`${due}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - days);
      return reviewReminderDay(due, d.toISOString().slice(0, 10));
    };
    assert.equal(at(91), null);
    assert.equal(at(90), 90);
    assert.equal(at(61), 90);
    assert.equal(at(60), 60);
    assert.equal(at(31), 60);
    assert.equal(at(30), 30);
    assert.equal(at(14), 14);
    assert.equal(at(8), 14);
    assert.equal(at(7), 7);
    assert.equal(at(0), 7);
    assert.equal(at(-20), 7, "overdue: the 7-day step, which has gone already, so nothing more");
  });

  it("the card from 90 days before, until it's done; its tag", () => {
    assert.equal(reviewCardShows("2027-08-14", "2027-05-15"), false);
    assert.equal(reviewCardShows("2027-08-14", "2027-05-16"), true);
    assert.equal(reviewCardShows("2027-08-14", "2027-09-01"), true);
    assert.equal(reviewCardShows(null, "2027-09-01"), false);
    assert.equal(reviewDueTag(30), "Due in 30 days");
    assert.equal(reviewDueTag(1), "Due tomorrow");
    assert.equal(reviewDueTag(0), "Due today");
    assert.equal(reviewDueTag(-1), "Overdue by 1 day");
    assert.equal(reviewDueTag(-12), "Overdue by 12 days");
    assert.equal(reviewWhenSaid(30), "in 30 days");
    assert.equal(reviewWhenSaid(-2), "2 days ago");
  });
});

describe("Reviewed, no changes needed", () => {
  const review: SgReview = {
    id: "r1",
    documentId: "d1",
    note: "Reviewed with Marcus after the trust audit. No changes needed this year.",
    reviewedByName: "Marcus Tran",
    reviewedAs: "office_manager",
    reviewedAt: "2027-07-20T01:00:00Z",
  };

  it("moves the next review 12 months on", () => {
    assert.equal(nextReviewDue("2026-07-01T00:00:00Z", ["2026-08-13T15:00:00Z", review.reviewedAt]), "2028-07-20");
  });

  it("goes in the change log with its note", () => {
    const rows = changeLogRows([], [], [{ review, document: { docType: "sg_and_procedures", versionLabel: "v7.3" } }]);
    assert.deepEqual(
      rows.map((r) => [r.starts, r.ref, r.document, r.whatChanged, r.reason, r.approvedBy, r.staffSigned]),
      [
        [
          "20 Jul 2027",
          "Review",
          "SG and procedures manual v7.3",
          "Reviewed, no changes needed. Note: Reviewed with Marcus after the trust audit. No changes needed this year.",
          "Annual review",
          "Marcus Tran (office manager)",
          "Not needed",
        ],
      ],
    );
    const plain = changeLogRows([], [], [{ review: { ...review, note: null, reviewedAs: "licensee", reviewedByName: "Priya Nair" }, document: { docType: "sg", versionLabel: null } }]);
    assert.equal(plain[0].whatChanged, "Reviewed, no changes needed");
    assert.equal(plain[0].approvedBy, "Priya Nair");
  });

  it("reads a row back, and nothing that isn't one; the note's limit", () => {
    const r = reviewFrom({ id: "r", document_id: "d", note: "  ", reviewed_by_name: "Priya", reviewed_as: "licensee", reviewed_at: "2027-07-20T01:00:00Z" });
    assert.equal(r?.note, null);
    assert.equal(reviewFrom({ id: "r", document_id: "d", reviewed_as: "agent", reviewed_at: "2027-07-20T01:00:00Z" }), null);
    assert.equal(reviewNoteProblem("a".repeat(1000)), null);
    assert.equal(reviewNoteProblem("a".repeat(1001)), "Keep the note to 1,000 characters.");
  });
});

describe("who is reminded: the licensee in charge and every office manager", () => {
  const p = (id: string, over: Partial<ReviewPerson> = {}): ReviewPerson => ({
    id,
    full_name: `${id[0].toUpperCase()}${id.slice(1)} Person`,
    email: `${id}@example.invalid`,
    is_licensee_in_charge: false,
    is_assistant: false,
    archived_at: null,
    ...over,
  });
  const people = [
    p("lic", { is_licensee_in_charge: true }),
    p("om"),
    p("gone", { archived_at: "2027-01-01T00:00:00Z" }),
    p("old"),
    p("agent"),
    p("asst", { is_assistant: true }),
    p("nomail", { email: null, is_licensee_in_charge: true }),
  ];
  const officeManagers = [
    { profileId: "om", approvedAt: "2026-11-01T00:00:00Z", withdrawnAt: null },
    { profileId: "gone", approvedAt: "2026-11-01T00:00:00Z", withdrawnAt: null },
    { profileId: "old", approvedAt: "2026-10-01T00:00:00Z", withdrawnAt: "2026-10-20T00:00:00Z" },
  ];

  it("on an office plan: the licensee and approved office managers, nobody who left, no assistant or agent", () => {
    const out = reviewRecipients({ plan: "office_1", licenseeNotOnRealcomply: false, people, officeManagers, keepsAccess: [] });
    assert.deepEqual(
      out.map((r) => [r.id, r.role, r.email]),
      [
        ["lic", "licensee", "lic@example.invalid"],
        ["om", "office_manager", "om@example.invalid"],
      ],
    );
  });

  it("on an agent plan, or with the licensee not on RealComply: the agent, never an assistant", () => {
    const solo = [p("agent"), p("asst", { is_assistant: true })];
    assert.deepEqual(
      reviewRecipients({ plan: "agent_1", licenseeNotOnRealcomply: false, people: solo, officeManagers: [], keepsAccess: [] }).map((r) => r.id),
      ["agent"],
    );
    assert.deepEqual(
      reviewRecipients({ plan: "office_1", licenseeNotOnRealcomply: true, people: solo, officeManagers: [], keepsAccess: [] }).map((r) => r.id),
      ["agent"],
    );
    assert.deepEqual(
      reviewRecipients({ plan: "agent_1", licenseeNotOnRealcomply: false, people: solo, officeManagers: [{ profileId: "asst", approvedAt: null, withdrawnAt: null }], keepsAccess: [] }).map((r) => r.id),
      ["agent"],
      "no office manager on an agent plan",
    );
  });

  it("someone keeping the office side until the licensee approves (0115), until then only", () => {
    const office = [p("keeper"), p("agent")];
    const keepsAccess = [{ profileId: "keeper", startedAt: "2026-11-06T00:00:00Z" }];
    assert.deepEqual(
      reviewRecipients({ plan: "office_1", licenseeNotOnRealcomply: false, people: office, officeManagers: [], keepsAccess }).map((r) => [r.id, r.role]),
      [["keeper", "office_manager"]],
    );
    // A licensee in charge has joined: they're reminded, the keeper isn't.
    assert.deepEqual(
      reviewRecipients({ plan: "office_1", licenseeNotOnRealcomply: false, people: [...office, p("lic", { is_licensee_in_charge: true })], officeManagers: [], keepsAccess }).map((r) => r.id),
      ["lic"],
    );
    // Someone else was approved as office manager since: it ends.
    assert.deepEqual(
      reviewRecipients({
        plan: "office_1",
        licenseeNotOnRealcomply: false,
        people: office,
        officeManagers: [{ profileId: "agent", approvedAt: "2026-11-07T00:00:00Z", withdrawnAt: null }],
        keepsAccess,
      }).map((r) => r.id),
      ["agent"],
    );
  });
});

describe("the reminder email", () => {
  const input = { recipientName: "Priya Nair", officeName: "Harbour & Vale Realty (made up)", dueOn: "2027-08-14", days: 30, appUrl: "https://www.realcomply.com.au" };

  it("says when it's due, quotes 2.1.2 word for word, and links to the page", () => {
    const { subject, text, html } = buildSgReviewEmail(input);
    assert.equal(subject, "Annual review of your supervision guidelines: due 14 August 2027");
    assert.ok(
      text.includes(
        "Hi Priya, Harbour & Vale Realty (made up)'s supervision guidelines and operational procedures are due for review by 14 August 2027, in 30 days.",
      ),
    );
    for (const words of [...SG_2_1_2.paragraphs, ...SG_2_1_2.areas]) {
      assert.ok(text.includes(words), words);
      assert.ok(html.includes(words.replace(/&/g, "&amp;")), words);
    }
    assert.ok(text.includes("NSW Fair Trading, Supervision Guidelines, 2.1.2"));
    assert.ok(text.includes("Any of these moves the next review to 12 months from that day and stops these reminders."));
    assert.ok(text.includes("https://www.realcomply.com.au/dashboard/sg-manual"));
    assert.ok(text.includes("Sent to the licensee in charge and office managers of Harbour & Vale Realty (made up), 90, 60, 30, 14 and 7 days before the review is due."));
  });

  it("2.1.2 is Fair Trading's words exactly (Drive, read 10 Nov 2026)", () => {
    assert.equal(
      SG_2_1_2.paragraphs.join(" "),
      "Supervision Requirement 2 is a requirement to establish procedures designed to ensure that the provisions of the Act and any other laws relevant to the conduct of that business are complied with. " +
        "A failure to prepare and maintain operational procedures for this purpose is an offence. " +
        "Operational procedures should be reviewed and appropriately revised at least every 12 months to ensure they remain current and emerging risks are addressed. In drafting their operational procedures, licensees in charge should identify key risks to non-compliance with laws applicable to the business, in four critical areas:",
    );
    assert.deepEqual([...SG_2_1_2.areas], ["financial", "licensing", "qualifications, education and training", "professional conduct within the business"]);
  });

  it("overdue, and with no office name or first name", () => {
    assert.equal(sgReviewSubject({ dueOn: "2027-08-14", days: -3 }), "Annual review of your supervision guidelines: due 14 August 2027, now overdue");
    const { text } = buildSgReviewEmail({ ...input, recipientName: "", officeName: "", days: -3 });
    assert.ok(text.includes("Your office's supervision guidelines and operational procedures were due for review on 14 August 2027, 3 days ago."));
  });

  it("no em dashes outside the shared diligence line", () => {
    const { text, subject } = buildSgReviewEmail(input);
    assert.ok(!subject.includes("—"));
    assert.ok(!text.split("RealComply provides diligence support")[0].includes("—"));
  });
});

// ── The daily job, against an in-memory office ─────────────────────────────

type Row = Record<string, unknown>;

/** Just enough of the query builder for the job, with 0126's unique index. */
function fakeDb(tables: Record<string, Row[]>) {
  let n = 0;
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const query = {
      select: () => query,
      order: () => query,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), query),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), query),
      not: (c: string, _op: string, v: unknown) => (filters.push((r) => (r[c] ?? null) !== v), query),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: <U>(resolve: (r: { data: Row[]; error: null }) => U) => Promise.resolve({ data: rows(), error: null }).then(resolve),
      insert: (row: Row) => {
        const clash =
          table === "sg_review_reminders" &&
          (tables[table] ?? []).some((r) => ["agency_id", "profile_id", "due_on", "days_before"].every((k) => r[k] === row[k]));
        const saved = clash ? null : { id: `id${++n}`, ...row };
        if (saved) (tables[table] ??= []).push(saved);
        const result = { data: saved, error: clash ? { code: "23505", message: "duplicate" } : null };
        return { select: () => ({ single: () => Promise.resolve(result) }) };
      },
      update: (values: Row) => ({
        eq: (c: string, v: unknown) => {
          for (const r of tables[table] ?? []) if (r[c] === v) Object.assign(r, values);
          return Promise.resolve({ error: null });
        },
      }),
      delete: () => ({
        eq: (c: string, v: unknown) => {
          tables[table] = (tables[table] ?? []).filter((r) => r[c] !== v);
          return Promise.resolve({ error: null });
        },
      }),
    };
    return query;
  }
  return { from } as unknown as NonNullable<SgReviewReminderDeps["supabase"]>;
}

function office(over: { reviews?: Row[]; ended?: boolean; noLive?: boolean } = {}) {
  const tables: Record<string, Row[]> = {
    agencies: [
      { id: "o1", name: "Harbour Realty (made up)", plan: "office_1", licensee_not_on_realcomply: false, ended_at: over.ended ? "2027-07-01T00:00:00Z" : null, created_at: "2026-07-01T00:00:00Z" },
    ],
    profiles: [
      { id: "lic", agency_id: "o1", full_name: "Priya Nair", email: "getadamc3+sgr-lic@gmail.com", is_licensee_in_charge: true, is_assistant: false, archived_at: null },
      { id: "om", agency_id: "o1", full_name: "Marcus Tran", email: "getadamc3+sgr-om@gmail.com", is_licensee_in_charge: false, is_assistant: false, archived_at: null },
      { id: "ag", agency_id: "o1", full_name: "Dana Agent", email: "getadamc3+sgr-ag@gmail.com", is_licensee_in_charge: false, is_assistant: false, archived_at: null },
    ],
    office_managers: [{ agency_id: "o1", profile_id: "om", approved_at: "2026-11-01T00:00:00Z", withdrawn_at: null }],
    office_access_until_licensee: [],
    sg_documents: over.noLive ? [] : [{ id: "d1", agency_id: "o1", status: "live", saved_at: "2026-08-13T15:00:00Z" }],
    sg_amendments: [],
    sg_reviews: over.reviews ?? [],
    sg_review_reminders: [],
  };
  const sent: SendEmailInput[] = [];
  let ok = true;
  const deps: SgReviewReminderDeps = {
    supabase: fakeDb(tables),
    send: async (i) => {
      sent.push(i);
      return ok;
    },
  };
  return { tables, sent, deps, failSends: () => (ok = false), workSends: () => (ok = true) };
}

// The job runs at 22:10 UTC the evening before: the morning of the date in Sydney.
const morning = (iso: string) => {
  const d = new Date(`${iso}T22:10:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
};

describe("the daily job", () => {
  // The live document was saved 14 Aug 2026 (Sydney): due 14 Aug 2027.
  it("nothing before the 90-day step", async () => {
    const w = office();
    const r = await runSgReviewReminders(morning("2027-05-15"), w.deps);
    assert.deepEqual([r.today, r.offices, r.sent], ["2027-05-15", 1, 0]);
    assert.equal(w.tables.sg_review_reminders.length, 0);
  });

  it("at 90 days: the licensee and the office manager, once each, never the agent", async () => {
    const w = office();
    const r = await runSgReviewReminders(morning("2027-05-16"), w.deps);
    assert.equal(r.sent, 2);
    assert.deepEqual(w.sent.map((s) => s.to).sort(), ["getadamc3+sgr-lic@gmail.com", "getadamc3+sgr-om@gmail.com"]);
    assert.ok(w.sent.every((s) => s.subject === "Annual review of your supervision guidelines: due 14 August 2027"));
    assert.deepEqual(
      w.tables.sg_review_reminders.map((x) => [x.profile_id, x.due_on, x.days_before, Boolean(x.email_sent_at)]),
      [
        ["lic", "2027-08-14", 90, true],
        ["om", "2027-08-14", 90, true],
      ],
    );
    // The next morning, and a second run the same morning: nothing again.
    const again = await runSgReviewReminders(morning("2027-05-17"), w.deps);
    assert.deepEqual([again.sent, again.alreadySent], [0, 2]);
    // At 60 days, the next step.
    const sixty = await runSgReviewReminders(morning("2027-06-15"), w.deps);
    assert.equal(sixty.sent, 2);
  });

  it("an email that didn't go is tried again the next morning, and Adam is told (failed)", async () => {
    const w = office();
    w.failSends();
    const r = await runSgReviewReminders(morning("2027-07-15"), w.deps);
    assert.deepEqual([r.sent, r.failed], [0, 2]);
    assert.equal(w.tables.sg_review_reminders.length, 0);
    w.workSends();
    const next = await runSgReviewReminders(morning("2027-07-16"), w.deps);
    assert.equal(next.sent, 2);
    assert.ok(w.tables.sg_review_reminders.every((x) => x.days_before === 30));
  });

  it("Reviewed, no changes needed stops them: the review is 12 months on", async () => {
    const w = office({ reviews: [{ agency_id: "o1", document_id: "d1", reviewed_at: "2027-06-01T01:00:00Z" }] });
    const r = await runSgReviewReminders(morning("2027-07-15"), w.deps);
    assert.deepEqual([r.offices, r.sent], [1, 0]);
  });

  it("no live document, or an office that has ended: nothing", async () => {
    for (const w of [office({ noLive: true }), office({ ended: true })]) {
      const r = await runSgReviewReminders(morning("2027-07-15"), w.deps);
      assert.deepEqual([r.offices, r.sent], [0, 0]);
    }
  });
});
