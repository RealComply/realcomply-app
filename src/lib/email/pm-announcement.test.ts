import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PM_ANNOUNCEMENT,
  PM_ANNOUNCEMENT_OFFICES,
  PM_ANNOUNCEMENT_SUBJECT,
  PM_ANNOUNCEMENT_TEST_ADDRESS,
  announcementFirstName,
  pmAnnouncementDocument,
  pmAnnouncementList,
  pmAnnouncementTest,
  sendPmAnnouncement,
  type PmAnnouncementDeps,
} from "@/lib/email/pm-announcement";
import { renderEmailHtml, renderEmailText } from "@/lib/email/layout";
import { fakeSupabase } from "@/lib/testing/fake-supabase";
import type { SendEmailInput } from "@/lib/email/send";

type Row = Record<string, unknown>;
type Client = NonNullable<PmAnnouncementDeps["supabase"]>;

const office = (id: string, name: string, over: Row = {}): Row => ({
  id,
  name,
  pm_enabled: true,
  ended_at: null,
  ...over,
});

const licensee = (id: string, agencyId: string, name: string, over: Row = {}): Row => ({
  id,
  agency_id: agencyId,
  full_name: name,
  email: `${id}@example.com`,
  is_licensee_in_charge: true,
  archived_at: null,
  ...over,
});

/** All twelve offices of today, roughly: the five, and the ones it must never reach. */
function world(over: { agencies?: Row[]; profiles?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    agencies: over.agencies ?? [
      office("foster", "Foster Property Consultants PTY LTD"),
      office("lloyd", "Lloyd Property Agents"),
      office("yes", "Yes Property Agents"),
      office("oneagency", "One Agency Deborah Low Property"),
      office("nindra", "NindraRealty"),
      office("raine", "Raine & Horne Queanbeyan "),
      office("cass", "Cass Property"),
      office("comply", "Comply Real Estate"),
      office("sam", "Sam RE"),
      office("adamtest", "Adam's test agency"),
      office("madeup", "PM Test Office (made up)"),
      office("uralla", "Uralla Properties", { pm_enabled: false }),
    ],
    profiles: over.profiles ?? [
      licensee("glenn", "foster", "Glenn Foster"),
      licensee("trent", "lloyd", "Trent Lloyd"),
      licensee("tom", "yes", "tom"),
      licensee("deborah", "oneagency", "Deborah Low"),
      licensee("alex", "nindra", "Alex Nindra"),
      // An agent in one of the five: never sent to.
      licensee("agent", "foster", "Agent Person", { is_licensee_in_charge: false }),
      // The licensee of every office it must never reach.
      ...["raine", "cass", "comply", "sam", "adamtest", "madeup", "uralla"].map((a) => licensee(`lic-${a}`, a, "Other Licensee")),
    ],
    announcement_sends: [],
  };
  const sent: SendEmailInput[] = [];
  let ok = true;
  const deps: PmAnnouncementDeps = {
    supabase: fakeSupabase<Client>(tables),
    send: async (input) => {
      sent.push(input);
      return ok;
    },
    now: () => new Date("2026-10-22T00:30:00Z"),
  };
  return { tables, sent, deps, failSends: () => (ok = false) };
}

// ── The email ────────────────────────────────────────────────────────────────

test("the email: subject, greeting, office name, the four paragraphs, the button and the footer", () => {
  const text = renderEmailText(pmAnnouncementDocument("Glenn", "Foster Property Consultants PTY LTD"));
  assert.equal(PM_ANNOUNCEMENT_SUBJECT, "Property management is now in your RealComply account");
  assert.equal(
    text,
    [
      "Hi Glenn,",
      "",
      "Property management is now switched on for Foster Property Consultants PTY LTD. " +
        'You\'ll see "Property management" in the menu next time you open RealComply. ' +
        "It's included in your office plan at no extra cost.",
      "",
      "It takes each managed property through five stages, from management onboarding to the end of a tenancy, " +
        "with each obligation, its legal reference and a record of who ticked it and when. " +
        "RealComply doesn't hold your PM documents. Those stay in your own system.",
      "",
      "A good first step: at the top of the Property management page, note where your PM records are kept (for example PropertyMe). " +
        "Then add a property to see its checklist.",
      "",
      "It's new, so we'd welcome your feedback. Just reply to this email.",
      "",
      "Go to Property management: https://www.realcomply.com.au/dashboard/pm",
      "",
      "---",
      "Diligence support, not legal advice. The licensee remains responsible for decisions and sign-off.",
    ].join("\n"),
  );
});

test("the email: no em dashes, never 'compliant', and the office name can't become markup", () => {
  const doc = pmAnnouncementDocument("Glenn", 'Made Up <a href="x">Realty</a>');
  const all = `${PM_ANNOUNCEMENT_SUBJECT}\n${renderEmailText(doc)}\n${renderEmailHtml(doc)}`;
  assert.doesNotMatch(all, /—/);
  assert.doesNotMatch(all, /\bcompliant\b/i);
  assert.doesNotMatch(renderEmailHtml(doc), /<a href="x">/);
  assert.match(renderEmailHtml(doc), /href="https:\/\/www\.realcomply\.com\.au\/dashboard\/pm"/);
});

test("first names: the first word; all lower case gets a capital; none is just 'Hi,'", () => {
  assert.equal(announcementFirstName("Glenn Foster"), "Glenn");
  assert.equal(announcementFirstName("tom"), "Tom");
  assert.equal(announcementFirstName("McKenzie Low"), "McKenzie");
  assert.equal(announcementFirstName("  "), null);
  assert.equal(announcementFirstName(null), null);
  assert.equal(renderEmailText(pmAnnouncementDocument(null, "X")).split("\n")[0], "Hi,");
});

// ── Who it goes to ───────────────────────────────────────────────────────────

test("the five named offices, and only those", () => {
  assert.deepEqual(
    [...PM_ANNOUNCEMENT_OFFICES],
    [
      "Foster Property Consultants PTY LTD",
      "Lloyd Property Agents",
      "Yes Property Agents",
      "One Agency Deborah Low Property",
      "NindraRealty",
    ],
  );
  for (const never of ["Raine & Horne Queanbeyan", "Cass Property", "Comply Real Estate", "Sam RE", "Adam's test agency"]) {
    assert.ok(!(PM_ANNOUNCEMENT_OFFICES as readonly string[]).includes(never), never);
  }
});

test("the list: each office's current licensee in charge, looked up now", async () => {
  const { deps } = world();
  const rows = await pmAnnouncementList(deps.supabase!);
  assert.deepEqual(
    rows.map((r) => [r.office, r.licenseeName, r.firstName, r.email, r.problem]),
    [
      ["Foster Property Consultants PTY LTD", "Glenn Foster", "Glenn", "glenn@example.com", null],
      ["Lloyd Property Agents", "Trent Lloyd", "Trent", "trent@example.com", null],
      ["Yes Property Agents", "tom", "Tom", "tom@example.com", null],
      ["One Agency Deborah Low Property", "Deborah Low", "Deborah", "deborah@example.com", null],
      ["NindraRealty", "Alex Nindra", "Alex", "alex@example.com", null],
    ],
  );
});

test("an archived licensee isn't current; no single current licensee, or no office, is a problem and doesn't send", async () => {
  const { tables, sent, deps } = world();
  // Lloyd's licensee archived; One Agency has two; NindraRealty renamed away.
  tables.profiles.find((p) => p.id === "trent")!.archived_at = "2026-10-01T00:00:00Z";
  tables.profiles.push(licensee("deb2", "oneagency", "Second Licensee"));
  tables.agencies.find((a) => a.id === "nindra")!.name = "Nindra Realty Group";
  // Yes Property Agents' subscription has ended.
  tables.agencies.find((a) => a.id === "yes")!.ended_at = "2026-10-20T00:00:00Z";

  const rows = await pmAnnouncementList(deps.supabase!);
  assert.deepEqual(
    rows.map((r) => r.problem),
    [
      null,
      "No current licensee in charge.",
      "Its subscription has ended.",
      "More than one current licensee in charge.",
      "No office with this name.",
    ],
  );
  const r = await sendPmAnnouncement(deps);
  assert.deepEqual(sent.map((m) => m.to), ["glenn@example.com"]);
  assert.equal(r.sent, 1);
  assert.equal(r.notSent, 4);
});

test("an office whose PM isn't on (a single agent plan) is a problem, not a send", async () => {
  const { tables, sent, deps } = world();
  tables.agencies.find((a) => a.id === "foster")!.pm_enabled = false;
  const r = await sendPmAnnouncement(deps);
  assert.equal(r.notSent, 1);
  assert.ok(!sent.some((m) => m.to === "glenn@example.com"));
});

// ── Sending ──────────────────────────────────────────────────────────────────

test("send: five emails, one to each licensee, replies to admin@, recorded; nobody else", async () => {
  const { tables, sent, deps } = world();
  const r = await sendPmAnnouncement(deps);
  assert.deepEqual(
    { sent: r.sent, alreadySent: r.alreadySent, notSent: r.notSent, failed: r.failed },
    { sent: 5, alreadySent: 0, notSent: 0, failed: 0 },
  );
  assert.deepEqual(
    sent.map((m) => m.to),
    ["glenn@example.com", "trent@example.com", "tom@example.com", "deborah@example.com", "alex@example.com"],
  );
  for (const m of sent) {
    assert.equal(m.subject, PM_ANNOUNCEMENT_SUBJECT);
    assert.equal(m.replyTo, "admin@realcomply.com.au");
    assert.equal(m.fromName, "RealComply");
    assert.equal(m.bcc, undefined);
  }
  assert.match(sent[2].text, /^Hi Tom,\n\nProperty management is now switched on for Yes Property Agents\./);

  assert.deepEqual(
    tables.announcement_sends.map((s) => [s.announcement, s.agency_id, s.recipient, s.recipient_name, s.status, s.sent_at]),
    [
      [PM_ANNOUNCEMENT, "foster", "glenn@example.com", "Glenn Foster", "sent", "2026-10-22T00:30:00.000Z"],
      [PM_ANNOUNCEMENT, "lloyd", "trent@example.com", "Trent Lloyd", "sent", "2026-10-22T00:30:00.000Z"],
      [PM_ANNOUNCEMENT, "yes", "tom@example.com", "tom", "sent", "2026-10-22T00:30:00.000Z"],
      [PM_ANNOUNCEMENT, "oneagency", "deborah@example.com", "Deborah Low", "sent", "2026-10-22T00:30:00.000Z"],
      [PM_ANNOUNCEMENT, "nindra", "alex@example.com", "Alex Nindra", "sent", "2026-10-22T00:30:00.000Z"],
    ],
  );
});

test("a second run sends nothing", async () => {
  const { tables, sent, deps } = world();
  await sendPmAnnouncement(deps);
  const again = await sendPmAnnouncement(deps);
  assert.equal(sent.length, 5);
  assert.deepEqual(
    { sent: again.sent, alreadySent: again.alreadySent, notSent: again.notSent, failed: again.failed },
    { sent: 0, alreadySent: 5, notSent: 0, failed: 0 },
  );
  assert.equal(tables.announcement_sends.length, 5);
});

test("the record is written before the email goes; a refused write sends nothing", async () => {
  const { tables, sent, deps } = world();
  // The send checks the record is there when it runs.
  deps.send = async (input) => {
    assert.ok(tables.announcement_sends.some((s) => s.recipient === input.to && s.status === "sending"));
    sent.push(input);
    return true;
  };
  await sendPmAnnouncement(deps);
  assert.equal(sent.length, 5);

  // Another run got there first: the unique index refuses the write.
  const fresh = world();
  const refusing = {
    from: (table: string) => {
      const q = (fresh.deps.supabase as unknown as { from: (t: string) => Record<string, unknown> }).from(table);
      return table === "announcement_sends"
        ? { ...q, insert: () => Promise.resolve({ error: { message: "duplicate key value violates unique constraint" } }) }
        : q;
    },
  } as unknown as Client;
  const r = await sendPmAnnouncement({ ...fresh.deps, supabase: refusing });
  assert.equal(fresh.sent.length, 0);
  assert.equal(r.notSent, 5);
});

test("a refused email is recorded as failed and isn't retried by a second run", async () => {
  const { tables, sent, deps, failSends } = world();
  failSends();
  const r = await sendPmAnnouncement(deps);
  assert.equal(r.failed, 5);
  assert.ok(tables.announcement_sends.every((s) => s.status === "failed" && s.sent_at === null));
  const again = await sendPmAnnouncement(deps);
  assert.equal(again.alreadySent, 5);
  assert.equal(sent.length, 5);
});

test("no send record to check against (0090 not run): nothing sends", async () => {
  const { sent, deps } = world();
  const noTable = {
    from: (table: string) => {
      const q = (deps.supabase as unknown as { from: (t: string) => Record<string, unknown> }).from(table);
      if (table !== "announcement_sends") return q;
      const failing = {
        select: () => failing,
        eq: () => failing,
        then: <U>(resolve: (r: unknown) => U) =>
          Promise.resolve({ data: null, error: { message: "relation does not exist" } }).then(resolve),
      };
      return failing;
    },
  } as unknown as Client;
  const r = await sendPmAnnouncement({ ...deps, supabase: noTable });
  assert.equal(sent.length, 0);
  assert.equal(r.notSent, 5);
});

// ── The test ─────────────────────────────────────────────────────────────────

test("the test: as if for Foster, to the test address only, nothing recorded", async () => {
  const { tables, deps } = world();
  const t = await pmAnnouncementTest(deps.supabase!);
  assert.ok(!("error" in t));
  if ("error" in t) return;
  assert.equal(t.email.to, PM_ANNOUNCEMENT_TEST_ADDRESS);
  assert.equal(PM_ANNOUNCEMENT_TEST_ADDRESS, "getadamc3+pmannounce@gmail.com");
  assert.equal(t.email.subject, PM_ANNOUNCEMENT_SUBJECT);
  assert.equal(t.email.replyTo, "admin@realcomply.com.au");
  assert.match(t.email.text, /^Hi Glenn,\n\nProperty management is now switched on for Foster Property Consultants PTY LTD\./);
  assert.equal(tables.announcement_sends.length, 0);
});
