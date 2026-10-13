import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SendEmailInput } from "@/lib/email/send";
import { onNewOfficeTrialStarted } from "./new-office";

// What a new office gets when its trial starts (brief, 14 Oct 2026; Adam,
// 14 Oct 2026): the welcome with the annexure box for an early access office
// whose licensee signed up, and the short signing email to the licensee in
// every other case. Once, however many times Stripe calls. Never anything to
// the licensee of an agent on their own plan (CORRECTION, 14 Oct 2026).

type Row = Record<string, unknown>;

/** The Supabase calls new-office.ts and welcome.ts make, in memory. */
function fakeDb(tables: Record<string, Row[]>) {
  let n = 0;
  return {
    tables,
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let patch: Row | null = null;
      let inserted: Row | null = null;
      let insertError: { code: string; message: string } | null = null;
      let deleting = false;
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const result = () => {
        if (insertError) return { data: null, error: insertError };
        if (inserted) return { data: [{ ...inserted }], error: null };
        const hit = rows();
        if (deleting) {
          tables[table] = (tables[table] ?? []).filter((r) => !hit.includes(r));
          return { data: [], error: null };
        }
        if (patch) for (const r of hit) Object.assign(r, patch);
        return { data: hit.map((r) => ({ ...r })), error: null };
      };
      const builder = {
        select: () => builder,
        update: (p: Row) => ((patch = p), builder),
        delete: () => ((deleting = true), builder),
        insert: (row: Row) => {
          // 0067's one 'new_office' link per office.
          if (
            (table === "sg_annexure_links" &&
              row.purpose === "new_office" &&
              (tables[table] ?? []).some((r) => r.agency_id === row.agency_id && r.purpose === "new_office")) ||
            // 0069: one agent welcome per person.
            (table === "agent_welcome_emails" && (tables[table] ?? []).some((r) => r.profile_id === row.profile_id))
          ) {
            insertError = { code: "23505", message: "duplicate key value violates unique constraint" };
          } else {
            inserted = { id: `link${++n}`, token: `00000000-0000-0000-0000-00000000000${n}`, used_at: null, ...row };
            (tables[table] ??= []).push(inserted);
          }
          return builder;
        },
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
        is: (c: string, v: null) => (filters.push((r) => (r[c] ?? null) === v), builder),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), builder),
        not: (c: string) => (filters.push((r) => r[c] != null), builder),
        maybeSingle: async () => {
          const r = result();
          return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error };
        },
        then: (resolve: (v: unknown) => void) => resolve(result()),
      };
      return builder;
    },
  };
}

const ON = { EARLY_ACCESS_WELCOME_EMAIL: "on", NEXT_PUBLIC_SITE_URL: "https://www.realcomply.com.au" };
const OFF = { NEXT_PUBLIC_SITE_URL: "https://www.realcomply.com.au" };
const NOW = new Date("2026-10-14T01:00:00Z");

/** An office whose founder (u1) signed up with an early access invitation, or one sent personally. */
function office(opts: {
  founderIsLicensee: boolean;
  earlyAccess: boolean;
  personalInvite?: boolean;
  plan?: string;
  licenseeEmail?: string | null;
}) {
  return fakeDb({
    agencies: [
      {
        id: "ag1",
        name: "Harbour Realty",
        plan: opts.plan ?? "office_1",
        licensee_name: opts.founderIsLicensee ? null : "Lee Licensee",
        licensee_email: opts.founderIsLicensee ? null : opts.licenseeEmail === undefined ? "getadamc3+licensee@gmail.com" : opts.licenseeEmail,
        corporation_licence_number: null,
      },
    ],
    profiles: [
      {
        id: "u1",
        agency_id: "ag1",
        full_name: "Sam Founder",
        email: "getadamc3+founder@gmail.com",
        is_licensee_in_charge: opts.founderIsLicensee,
        is_assistant: false,
        licence_number: null,
        archived_at: null,
        created_at: "2026-10-14T00:00:00Z",
      },
    ],
    founder_invites: opts.earlyAccess
      ? [{ token: "tok1", agency_id: "ag1", accepted_at: "2026-10-14T00:00:00Z", accepted_by: "u1" }]
      : opts.personalInvite
        ? [
            {
              token: "tok2",
              agency_id: "ag1",
              accepted_at: "2026-10-14T00:00:00Z",
              accepted_by: "u1",
              email: "getadamc3+founder@gmail.com",
              first_name: "sam",
            },
          ]
        : [],
    early_access: opts.earlyAccess
      ? [{ id: "ea1", first_name: "sam", invited_token: "tok1", welcome_sent_at: null, unsubscribed_at: null }]
      : [],
    sg_annexure_adoptions: [],
    sg_annexure_links: [],
  });
}

function recorder(ok = true) {
  const sent: SendEmailInput[] = [];
  return { sent, send: async (i: SendEmailInput) => (sent.push(i), ok) };
}

const links = (db: ReturnType<typeof fakeDb>) => db.tables.sg_annexure_links ?? [];

describe("a new office's annexure request", () => {
  it("early access, signed up by the licensee: the welcome carries the button, nothing else is sent", async () => {
    const db = office({ founderIsLicensee: true, earlyAccess: true });
    const r = recorder();
    const out = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
    assert.deepEqual(out, { welcome: "sent", annexure: "in_welcome" });
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].to, "getadamc3+founder@gmail.com");
    assert.ok(r.sent[0].html?.includes("Review and sign"));
    assert.ok(r.sent[0].html?.includes(`/annexure/${links(db)[0].token}`));
    assert.ok(r.sent[0].html?.includes("14 October 2026"));
    assert.equal(links(db).length, 1);
    assert.equal(links(db)[0].sent_to, "getadamc3+founder@gmail.com");
  });

  it("early access, signed up by someone else: the welcome says who it went to, and the licensee gets the link", async () => {
    const db = office({ founderIsLicensee: false, earlyAccess: true });
    const r = recorder();
    const out = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
    assert.deepEqual(out, { welcome: "sent", annexure: "emailed" });
    const [welcome, request] = r.sent;
    assert.equal(welcome.to, "getadamc3+founder@gmail.com");
    assert.ok(welcome.text.includes("We've sent the annexure to Lee Licensee to sign."));
    assert.ok(!welcome.html?.includes("Review and sign"));
    assert.equal(request.to, "getadamc3+licensee@gmail.com");
    assert.equal(request.bcc, "admin@realcomply.com.au");
    assert.ok(request.text.startsWith("Hi Lee,"));
    assert.ok(request.text.includes(`/annexure/${links(db)[0].token}`));
  });

  it("any other new office: the short signing email on its own", async () => {
    const db = office({ founderIsLicensee: true, earlyAccess: false });
    const r = recorder();
    const out = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
    assert.deepEqual(out, { welcome: "not_early_access", annexure: "emailed" });
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].to, "getadamc3+founder@gmail.com");
    assert.equal(r.sent[0].subject, "Adopt the RealComply annexure for Harbour Realty");
  });

  it("an early access office while the welcome is switched off still gets the signing email", async () => {
    const db = office({ founderIsLicensee: true, earlyAccess: true });
    const r = recorder();
    const out = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: OFF, now: NOW });
    assert.deepEqual(out, { welcome: "switched_off", annexure: "emailed" });
    assert.equal(r.sent.length, 1);
    assert.ok(r.sent[0].subject.startsWith("Adopt the RealComply annexure"));
  });

  describe("an agent on their own plan (CORRECTION, 14 Oct 2026: never their licensee)", () => {
    it("early access: the agent welcome, with the download link and one line, no signing, and nothing goes to the licensee", async () => {
      // The licensee they named at sign-up is on file, and still gets nothing.
      const db = office({ founderIsLicensee: false, earlyAccess: true, plan: "agent_1" });
      const r = recorder();
      const out = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
      assert.deepEqual(out, { welcome: "sent", annexure: "agent_plan" });
      assert.equal(r.sent.length, 1, "the welcome only");
      const [welcome] = r.sent;
      assert.equal(welcome.to, "getadamc3+founder@gmail.com");
      assert.equal(welcome.subject, "Welcome to RealComply, Sam");
      assert.equal(welcome.bcc, "admin@realcomply.com.au");
      assert.equal(welcome.replyTo, "admin@realcomply.com.au");
      // The agent welcome (brief, 14 Oct 2026), INSTEAD of the licensee welcome.
      assert.ok(welcome.text.includes("walks through RealComply from an agent's side"));
      assert.ok(welcome.html?.includes("https://www.realcomply.com.au/email-agent-video.png"));
      assert.ok(!welcome.text.includes("Your office is all set up"));
      assert.ok(!welcome.html?.includes("For licensees"));
      // Recorded once, and on the early access row for the staff page.
      assert.deepEqual(
        (db.tables.agent_welcome_emails ?? []).map((w) => [w.profile_id, w.kind]),
        [["u1", "own_plan"]],
      );
      assert.equal(db.tables.early_access[0].welcome_sent_at, NOW.toISOString());
      assert.ok(welcome.html?.includes("Download the annexure for your licensee"));
      assert.ok(welcome.html?.includes("https://www.realcomply.com.au/annexure/download"));
      assert.ok(welcome.text.includes("Please give this to your licensee in charge. It explains how RealComply fits within your agency's supervision system."));
      assert.ok(!welcome.html?.includes("Review and sign"));
      assert.ok(!welcome.text.includes("We've sent the annexure"));
      assert.equal(links(db).length, 0, "no signing link is made");
      assert.ok(!r.sent.some((m) => m.to === "getadamc3+licensee@gmail.com"));
    });

    it("invited personally: the same agent welcome and download, nothing to the licensee", async () => {
      const db = office({ founderIsLicensee: false, earlyAccess: false, personalInvite: true, plan: "agent_1" });
      const r = recorder();
      const out = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
      assert.deepEqual(out, { welcome: "sent", annexure: "agent_plan" });
      assert.equal(r.sent.length, 1);
      assert.equal(r.sent[0].to, "getadamc3+founder@gmail.com");
      assert.ok(r.sent[0].text.includes("from an agent's side"));
      assert.ok(r.sent[0].text.includes("Download the annexure for your licensee (PDF): https://www.realcomply.com.au/annexure/download"));
      assert.equal(links(db).length, 0);
      assert.equal((db.tables.agent_welcome_emails ?? []).length, 1);
    });

    it("once, however many times Stripe calls", async () => {
      const db = office({ founderIsLicensee: false, earlyAccess: false, personalInvite: true, plan: "agent_1" });
      const r = recorder();
      await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
      const again = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
      assert.equal(again.welcome, "already_sent");
      assert.equal(r.sent.length, 1);
    });

    it("a welcome that fails to send gives its claim back, so the next call sends it", async () => {
      const db = office({ founderIsLicensee: false, earlyAccess: true, plan: "agent_1" });
      const failing = recorder(false);
      const first = await onNewOfficeTrialStarted(db, "ag1", { send: failing.send, env: ON, now: NOW });
      assert.equal(first.welcome, "failed");
      assert.equal((db.tables.agent_welcome_emails ?? []).length, 0);
      assert.equal(db.tables.early_access[0].welcome_sent_at, null);
      const r = recorder();
      const second = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
      assert.equal(second.welcome, "sent");
      assert.equal(r.sent.length, 1);
    });

    it("switched off with the licensee welcome: nothing", async () => {
      const db = office({ founderIsLicensee: false, earlyAccess: true, plan: "agent_1" });
      const r = recorder();
      const out = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: OFF, now: NOW });
      assert.deepEqual(out, { welcome: "switched_off", annexure: "agent_plan" });
      assert.equal(r.sent.length, 0);
    });

    it("signed up without an invitation: nothing at all, to anyone", async () => {
      const db = office({ founderIsLicensee: false, earlyAccess: false, plan: "agent_1" });
      const r = recorder();
      const out = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
      assert.deepEqual(out, { welcome: "not_early_access", annexure: "agent_plan" });
      assert.equal(r.sent.length, 0);
      assert.equal(links(db).length, 0);
    });

    it("not counted as the licensee even when marked licensee in charge on their own account", async () => {
      const db = office({ founderIsLicensee: true, earlyAccess: false, plan: "agent_1" });
      const r = recorder();
      const out = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
      assert.equal(out.annexure, "agent_plan");
      assert.equal(r.sent.length, 0);
    });
  });

  it("goes once, however many times Stripe calls", async () => {
    const db = office({ founderIsLicensee: false, earlyAccess: true });
    const r = recorder();
    await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
    const again = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
    assert.deepEqual(again, { welcome: "already_sent", annexure: "already_requested" });
    assert.equal(r.sent.length, 2, "the welcome and the request, once each");
    assert.equal(links(db).length, 1);
  });

  it("a request that fails gives its claim back, so the next call sends it", async () => {
    const db = office({ founderIsLicensee: true, earlyAccess: false });
    const failing = recorder(false);
    const first = await onNewOfficeTrialStarted(db, "ag1", { send: failing.send, env: ON, now: NOW });
    assert.equal(first.annexure, "failed");
    assert.equal(links(db).length, 0);
    const r = recorder();
    const second = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
    assert.equal(second.annexure, "emailed");
    assert.equal(r.sent.length, 1);
  });

  it("asks nothing of an office that has already adopted", async () => {
    const db = office({ founderIsLicensee: true, earlyAccess: false });
    db.tables.sg_annexure_adoptions.push({ id: "ad1", agency_id: "ag1" });
    const r = recorder();
    const out = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
    assert.equal(out.annexure, "already_adopted");
    assert.equal(r.sent.length, 0);
  });

  it("sends nothing when no licensee email is on file", async () => {
    const db = office({ founderIsLicensee: false, earlyAccess: false, licenseeEmail: null });
    const r = recorder();
    const out = await onNewOfficeTrialStarted(db, "ag1", { send: r.send, env: ON, now: NOW });
    assert.equal(out.annexure, "no_licensee_email");
    assert.equal(r.sent.length, 0);
    assert.equal(links(db).length, 0);
  });
});
