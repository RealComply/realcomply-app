import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SendEmailInput } from "@/lib/email/send";
import { sendEarlyAccessWelcome } from "./welcome";

// A small in-memory stand-in for the Supabase query builder: just the calls
// welcome.ts makes (select, update, eq, is, in, not-is-null, maybeSingle).
type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  return {
    tables,
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let patch: Row | null = null;
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const builder = {
        select: () => builder,
        update: (p: Row) => ((patch = p), builder),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
        is: (c: string, v: null) => (filters.push((r) => (r[c] ?? null) === v), builder),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), builder),
        not: (c: string) => (filters.push((r) => r[c] != null), builder),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => void) => {
          const hit = rows();
          if (patch) for (const r of hit) Object.assign(r, patch);
          resolve({ data: hit.map((r) => ({ ...r })), error: null });
        },
      };
      return builder;
    },
  };
}

const ON = { EARLY_ACCESS_WELCOME_EMAIL: "on" };

function world() {
  return fakeDb({
    founder_invites: [{ token: "tok1", agency_id: "ag1", accepted_at: "2026-10-11T00:00:00Z", accepted_by: "u1" }],
    early_access: [
      { id: "ea1", first_name: "sam", invited_token: "tok1", welcome_sent_at: null, unsubscribed_at: null },
    ],
    profiles: [{ id: "u1", email: "getadamc3+signup@gmail.com" }],
  });
}

function recorder(ok = true) {
  const sent: SendEmailInput[] = [];
  return { sent, send: async (i: SendEmailInput) => (sent.push(i), ok) };
}

describe("early access welcome", () => {
  it("sends nothing while switched off", async () => {
    const db = world();
    const r = recorder();
    assert.equal(await sendEarlyAccessWelcome(db, "ag1", { send: r.send, env: {} }), "switched_off");
    assert.equal(r.sent.length, 0);
    assert.equal(db.tables.early_access[0].welcome_sent_at, null);
  });

  it("when on, sends once to the sign-up address with the admin copy, and never again", async () => {
    const db = world();
    const r = recorder();
    assert.equal(await sendEarlyAccessWelcome(db, "ag1", { send: r.send, env: ON }), "sent");
    assert.equal(await sendEarlyAccessWelcome(db, "ag1", { send: r.send, env: ON }), "already_sent");
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].to, "getadamc3+signup@gmail.com");
    assert.equal(r.sent[0].bcc, "admin@realcomply.com.au");
    assert.equal(r.sent[0].subject, "Welcome to RealComply, Sam");
    assert.notEqual(db.tables.early_access[0].welcome_sent_at, null);
  });

  it("ignores an office that did not come from the early access list", async () => {
    const db = world();
    db.tables.early_access = [];
    const r = recorder();
    assert.equal(await sendEarlyAccessWelcome(db, "ag1", { send: r.send, env: ON }), "not_early_access");
    assert.equal(await sendEarlyAccessWelcome(db, "other-agency", { send: r.send, env: ON }), "not_early_access");
    assert.equal(r.sent.length, 0);
  });

  it("does not send to someone who has unsubscribed", async () => {
    const db = world();
    db.tables.early_access[0].unsubscribed_at = "2026-10-11T00:00:00Z";
    const r = recorder();
    await sendEarlyAccessWelcome(db, "ag1", { send: r.send, env: ON });
    assert.equal(r.sent.length, 0);
  });

  it("a failed send is undone, so it is not recorded as sent", async () => {
    const db = world();
    const r = recorder(false);
    assert.equal(await sendEarlyAccessWelcome(db, "ag1", { send: r.send, env: ON }), "failed");
    assert.equal(db.tables.early_access[0].welcome_sent_at, null);
  });
});
