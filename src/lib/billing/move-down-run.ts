import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail, type SendEmailInput } from "@/lib/email/send";
import { PLANS, type Plan } from "./entitlement";
import { priceIdFor, stripeRequest, type Interval } from "./stripe";
import { priceCents } from "./plan-change";
import { applyNow, subscriptionViewFrom, type StripeRequest } from "./subscription-change";
import { moveDownDue, moveDownFor } from "./move-down";
import { movedDownEmail } from "@/lib/email/plan-moved-down";
import { planChangeEmail, sendPlanChangeAlert } from "@/lib/email/plan-change-alert";

// The daily run that moves offices down (Adam, 6 Nov 2026; Terms cl 7.2).
// Every active subscription whose billing date falls in the next 26 hours,
// past its first 12 months, is looked at: if the last 12 months' listings fit
// a cheaper plan on the same ladder, Stripe's price changes now, with no
// proration, so the payment on the billing date is the cheaper one. No
// refunds. The office, the record (plan_changes), the customer and Adam all
// follow. ?dry_run=1 lists who would move and changes nothing.
//
// A billing date caught twice (the 26-hour window overlaps a day) finds the
// office already on the plan its listings fit, and nothing happens.

type Client = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

type RawList = { data?: unknown[]; has_more?: boolean };

export type MoveDownRun = {
  dryRun: boolean;
  /** Active subscriptions looked at. */
  looked: number;
  /** Of those, billing in the next 26 hours and past their first year. */
  due: number;
  moved: Array<{ office: string; from: Plan; to: Plan; interval: Interval; listings: number }>;
  problems: string[];
};

export async function runMoveDown(
  opts: {
    dryRun?: boolean;
    service?: Client;
    request?: StripeRequest;
    priceFor?: (plan: Plan, interval: Interval) => Promise<string>;
    send?: (input: SendEmailInput) => Promise<boolean>;
    now?: Date;
  } = {},
): Promise<MoveDownRun> {
  const service = opts.service ?? (createServiceClient() as unknown as Client);
  const request = opts.request ?? stripeRequest;
  const priceFor = opts.priceFor ?? priceIdFor;
  const send = opts.send ?? sendEmail;
  const now = opts.now ?? new Date();
  const run: MoveDownRun = { dryRun: Boolean(opts.dryRun), looked: 0, due: 0, moved: [], problems: [] };

  // Every active subscription, a page at a time. Trials are never moved: a
  // trial is in its first 12 months by definition.
  const subs: unknown[] = [];
  let after: string | null = null;
  for (let page = 0; page < 50; page++) {
    const query = new URLSearchParams({ status: "active", limit: "100" });
    if (after) query.set("starting_after", after);
    const list = await request<RawList>("GET", `/subscriptions?${query.toString()}`);
    const data = list.data ?? [];
    subs.push(...data);
    if (!list.has_more || data.length === 0) break;
    after = (data[data.length - 1] as { id: string }).id;
  }

  for (const raw of subs) {
    run.looked += 1;
    const sub = subscriptionViewFrom(raw as Parameters<typeof subscriptionViewFrom>[0], now);
    if (!sub) continue;
    if (moveDownDue({ periodEnd: sub.periodEnd, startedAt: sub.startedAt, now })) continue;

    const { data: agencyRow } = await service
      .from("agencies")
      .select("id, name, status, ended_at, stripe_subscription_id")
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle();
    const agency = agencyRow as { id: string; name: string; status: string | null; ended_at: string | null } | null;
    if (!agency || agency.status === "comped" || agency.ended_at) continue;
    run.due += 1;

    const { data: count, error: countError } = await service.rpc("agency_listing_count", { p_agency_id: agency.id });
    if (countError || typeof count !== "number") {
      run.problems.push(`${agency.name}: couldn't count its listings, so its plan was left as it is.`);
      continue;
    }
    const decision = moveDownFor({
      plan: sub.plan,
      listingCount: count,
      periodEnd: sub.periodEnd,
      startedAt: sub.startedAt,
      now,
    });
    if (decision.kind !== "move") continue;
    const to = decision.to;
    if (sub.scheduleId) {
      run.problems.push(
        `${agency.name}: its listings (${count}) fit ${PLANS[to].name}, but a change is booked for its billing date. Left as it is; check by hand.`,
      );
      continue;
    }
    if (run.dryRun) {
      run.moved.push({ office: agency.name, from: sub.plan, to, interval: sub.interval, listings: count });
      continue;
    }

    try {
      await applyNow(
        sub,
        await priceFor(to, sub.interval),
        { prorate: false, prorationDate: 0, agencyId: agency.id },
        request,
      );
    } catch (e) {
      console.error("move down: Stripe refused", agency.id, e instanceof Error ? e.message : e);
      run.problems.push(`${agency.name}: Stripe didn't take the move to ${PLANS[to].name}. Left as it is.`);
      continue;
    }
    run.moved.push({ office: agency.name, from: sub.plan, to, interval: sub.interval, listings: count });

    const problems: string[] = [];
    const { error: planError } = await service
      .from("agencies")
      .update({ plan: to })
      .eq("id", agency.id)
      .eq("stripe_subscription_id", sub.id);
    if (planError) problems.push("The office's plan wasn't written in the app; the Stripe webhook should write it.");

    const { error: rowError } = await service.from("plan_changes").insert({
      agency_id: agency.id,
      changed_by: null,
      changed_by_name: "RealComply (automatic)",
      from_plan: sub.plan,
      from_interval: sub.interval,
      to_plan: to,
      to_interval: sub.interval,
      takes_effect: "now",
      effective_at: sub.periodEnd,
      next_payment_at: sub.periodEnd,
      amount_today_cents: 0,
      ongoing_cents: priceCents(to, sub.interval),
      status: "done",
    });
    if (rowError) problems.push("The plan change record wasn't written.");

    // The customer: the billing email Stripe has for the office.
    let customerEmail: string | null = null;
    try {
      const customer = await request<{ email?: string | null }>(
        "GET",
        `/customers/${encodeURIComponent(sub.customer)}`,
      );
      customerEmail = customer.email?.trim() || null;
    } catch {
      customerEmail = null;
    }
    if (customerEmail) {
      const email = movedDownEmail({
        officeName: agency.name,
        fromPlan: sub.plan,
        toPlan: to,
        interval: sub.interval,
        listingCount: count,
        billingDate: sub.periodEnd,
      });
      const sent = await send({ to: customerEmail, ...email }).catch(() => false);
      if (!sent) problems.push(`The email to ${customerEmail} telling them didn't send.`);
    } else {
      problems.push("Stripe has no billing email for this office, so they weren't told.");
    }

    await sendPlanChangeAlert(
      planChangeEmail({
        officeName: agency.name,
        changedBy: `RealComply, automatically (${count} listings in the last 12 months)`,
        fromPlan: sub.plan,
        fromInterval: sub.interval,
        toPlan: to,
        toInterval: sub.interval,
        timing: "next_billing_date",
        effectiveAt: sub.periodEnd,
        amountTodayCents: 0,
        ongoingCents: priceCents(to, sub.interval),
        licensee: null,
        customer: sub.customer,
        livemode: sub.livemode,
        problem: problems.length ? problems.join(" ") : null,
        at: now.toISOString(),
      }),
      send,
    );
    for (const p of problems) run.problems.push(`${agency.name}: ${p}`);
  }
  return run;
}

/** What the monitoring counts as a problem. */
export function moveDownProblems(run: MoveDownRun): string[] {
  return run.problems;
}
