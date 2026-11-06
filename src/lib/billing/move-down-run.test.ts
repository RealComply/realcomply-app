import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runMoveDown } from "./move-down-run";
import type { StripeRequest } from "./subscription-change";
import type { SendEmailInput } from "@/lib/email/send";
import { movedDownEmail } from "@/lib/email/plan-moved-down";

const now = new Date("2027-03-17T07:00:00.000Z");
const billing = Math.floor(new Date("2027-03-18T03:00:00.000Z").getTime() / 1000);
const started = Math.floor(new Date("2026-01-18T03:00:00.000Z").getTime() / 1000);

const sub = (id: string, lookup: string, over: Record<string, unknown> = {}) => ({
  id,
  status: "active",
  customer: `cus_${id}`,
  livemode: false,
  start_date: started,
  schedule: null,
  items: {
    data: [{ id: `si_${id}`, current_period_end: billing, price: { id: `price_${lookup}`, lookup_key: lookup } }],
  },
  ...over,
});

// A stand-in database: agencies by subscription, listing counts, and what was written.
function fakeService(
  agencies: Record<string, { id: string; name: string; status?: string; ended_at?: string | null }>,
  counts: Record<string, number>,
) {
  const writes: Array<{ table: string; op: string; value: unknown }> = [];
  const service = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => ((filters[col] = val), builder),
        maybeSingle: async () => {
          const a = agencies[String(filters.stripe_subscription_id)];
          return { data: a ? { status: "active", ended_at: null, ...a } : null, error: null };
        },
        update: (value: unknown) => {
          writes.push({ table, op: "update", value });
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
        insert: async (value: unknown) => (writes.push({ table, op: "insert", value }), { error: null }),
      };
      return builder;
    },
    rpc: async (_fn: string, args?: Record<string, unknown>) => ({
      data: counts[String(args?.p_agency_id)] ?? 0,
      error: null,
    }),
  };
  return { service, writes };
}

function fakeStripe(subs: unknown[]) {
  const calls: Array<{ method: string; path: string; params?: Record<string, string | undefined> }> = [];
  const request = (async (method: string, path: string, params?: Record<string, string | undefined>) => {
    calls.push({ method, path, params });
    if (path.startsWith("/subscriptions?")) return { data: subs, has_more: false };
    if (path.startsWith("/customers/")) return { email: "billing@example.invalid" };
    return { latest_invoice: null };
  }) as unknown as StripeRequest;
  return { calls, request };
}

const priceFor = async (plan: string, interval: string) => `price_${plan}_${interval}`;

describe("the daily move-down run (Adam, 6 Nov 2026)", () => {
  it("moves an office whose listings fit a cheaper plan, with no proration, and tells the customer and Adam", async () => {
    const stripe = fakeStripe([sub("a", "office_2_monthly")]);
    const db = fakeService({ a: { id: "ag_a", name: "Made Up Realty" } }, { ag_a: 47 });
    const sent: SendEmailInput[] = [];
    const run = await runMoveDown({
      service: db.service,
      request: stripe.request,
      priceFor,
      send: async (input) => (sent.push(input), true),
      now,
    });
    assert.deepEqual(run.moved, [
      { office: "Made Up Realty", from: "office_2", to: "office_1", interval: "monthly", listings: 47 },
    ]);
    assert.deepEqual(run.problems, []);
    const update = stripe.calls.find((c) => c.path === "/subscriptions/a");
    assert.equal(update?.params?.["items[0][price]"], "price_office_1_monthly");
    assert.equal(update?.params?.proration_behavior, "none");
    assert.equal(update?.params?.payment_behavior, undefined);
    assert.deepEqual(db.writes.find((w) => w.table === "agencies")?.value, { plan: "office_1" });
    const record = db.writes.find((w) => w.table === "plan_changes")?.value as Record<string, unknown>;
    assert.equal(record.amount_today_cents, 0);
    assert.equal(record.changed_by_name, "RealComply (automatic)");
    assert.deepEqual(
      sent.map((s) => [s.to, s.subject]),
      [
        ["billing@example.invalid", "Your RealComply plan is now Office 1"],
        ["admin@realcomply.com.au", "Plan change: Made Up Realty, Office 2 to Office 1"],
      ],
    );
  });

  it("a dry run lists who would move and changes nothing", async () => {
    const stripe = fakeStripe([sub("a", "office_2_monthly")]);
    const db = fakeService({ a: { id: "ag_a", name: "Made Up Realty" } }, { ag_a: 47 });
    const run = await runMoveDown({
      dryRun: true,
      service: db.service,
      request: stripe.request,
      priceFor,
      send: async () => true,
      now,
    });
    assert.equal(run.moved.length, 1);
    assert.equal(stripe.calls.filter((c) => c.method === "POST").length, 0);
    assert.equal(db.writes.length, 0);
  });

  it("leaves alone: the first year, a plan that fits, a free office, an ended office, and a billing date not due", async () => {
    const young = Math.floor(new Date("2026-06-18T03:00:00.000Z").getTime() / 1000);
    const later = Math.floor(new Date("2027-04-18T03:00:00.000Z").getTime() / 1000);
    const stripe = fakeStripe([
      sub("young", "office_2_monthly", { start_date: young }),
      sub("fits", "office_2_monthly"),
      sub("free", "office_2_monthly"),
      sub("ended", "office_2_monthly"),
      sub("later", "office_2_monthly", {
        items: {
          data: [{ id: "si_l", current_period_end: later, price: { id: "p", lookup_key: "office_2_monthly" } }],
        },
      }),
    ]);
    const db = fakeService(
      {
        young: { id: "ag_y", name: "Young" },
        fits: { id: "ag_f", name: "Fits" },
        free: { id: "ag_c", name: "Free", status: "comped" },
        ended: { id: "ag_e", name: "Ended", ended_at: "2027-03-01T00:00:00Z" },
        later: { id: "ag_l", name: "Later" },
      },
      { ag_y: 3, ag_f: 90, ag_c: 3, ag_e: 3, ag_l: 3 },
    );
    const run = await runMoveDown({
      service: db.service,
      request: stripe.request,
      priceFor,
      send: async () => true,
      now,
    });
    assert.deepEqual(run.moved, []);
    assert.equal(stripe.calls.filter((c) => c.method === "POST").length, 0);
    assert.equal(run.due, 1);
  });

  it("doesn't touch a subscription with a change already booked; tells Adam to check", async () => {
    const stripe = fakeStripe([sub("a", "office_2_monthly", { schedule: "sub_sched_1" })]);
    const db = fakeService({ a: { id: "ag_a", name: "Made Up Realty" } }, { ag_a: 10 });
    const run = await runMoveDown({
      service: db.service,
      request: stripe.request,
      priceFor,
      send: async () => true,
      now,
    });
    assert.deepEqual(run.moved, []);
    assert.match(run.problems[0], /a change is booked/);
  });
});

describe("the customer's email", () => {
  it("says what changed, from when, and that nothing else does", () => {
    const email = movedDownEmail({
      officeName: "Made Up Realty",
      fromPlan: "office_2",
      toPlan: "office_1",
      interval: "monthly",
      listingCount: 47,
      billingDate: "2027-03-18T03:00:00.000Z",
    });
    assert.equal(email.subject, "Your RealComply plan is now Office 1");
    assert.match(
      email.text,
      /Made Up Realty added 47 listings in the last 12 months, which fits Office 1\. So from 18 March 2027, your plan is Office 1 at \$249\.00 a month \(GST included\), instead of Office 2\./,
    );
    assert.match(email.text, /Nothing else changes\./);
  });
});
