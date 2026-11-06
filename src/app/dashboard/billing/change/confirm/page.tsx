import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/data/current-profile";
import { mayChangePlan, planChangeContext } from "@/lib/data/plan-change";
import { PLANS, type Plan } from "@/lib/billing/entitlement";
import { priceIdFor, type Interval } from "@/lib/billing/stripe";
import { previewNow } from "@/lib/billing/subscription-change";
import {
  OFFICE_ACCESS_LINES,
  confirmButtonLabel,
  daysLeft,
  decideChange,
  isAgentToOffice,
  paySummaryRows,
  unavailableReason,
} from "@/lib/billing/plan-change";
import { PaySummary } from "@/components/billing/PlanChangeParts";
import { ConfirmPlanChangeForm } from "@/components/billing/ConfirmPlanChangeForm";
import { formatAuDate } from "@/lib/format-date";
import { RoofMark } from "@/components/RoofMark";

// Change plan, step 3 of the mockup (Adam, 6 Nov 2026): what they'll pay
// today and from when, Stripe's own figure; for an agent moving to an office
// plan, what it provides and who the licensee in charge is. Nothing is
// charged until the button is pressed, and the server asks Stripe again for
// the same moment before it charges.

const PLAN_KEYS = Object.keys(PLANS) as Plan[];

export default async function ConfirmPlanChangePage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; interval?: string }>;
}) {
  const { profile, access } = await requireAccess();
  const supabase = await createClient();
  if (!(await mayChangePlan(supabase, access))) notFound();
  const { plan: askedPlan, interval: askedInterval } = await searchParams;
  const interval: Interval = askedInterval === "annual" ? "annual" : "monthly";
  if (!askedPlan || !(PLAN_KEYS as string[]).includes(askedPlan))
    redirect(`/dashboard/billing/change?interval=${interval}`);
  const plan = askedPlan as Plan;

  const ctx = await planChangeContext(supabase, profile);
  const shell = (body: ReactNode, title = `Move to ${PLANS[plan].name}`) => (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-rc-ink">{title}</h1>
        <Link
          href={`/dashboard/billing/change?interval=${interval}`}
          className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep"
        >
          <RoofMark back />
          Change plan
        </Link>
      </div>
      {body}
    </main>
  );
  const blocked = (message: string) =>
    shell(<p className="mt-6 rounded-2xl border border-rc-border bg-white px-5 py-4 text-sm text-rc-ink">{message}</p>);

  if (ctx.state === "blocked") return blocked(ctx.message);
  const { sub } = ctx;
  const current = { plan: sub.plan, interval: sub.interval };
  const reason = unavailableReason({ current, interval, listingCount: ctx.listingCount }, plan);
  if (reason) return blocked(reason);
  const decision = decideChange({ from: current, to: { plan, interval }, trialing: sub.trialEnd !== null });
  if (decision.kind === "none") return blocked("That's your plan already.");

  const now = new Date();
  const prorationDate = Math.floor(now.getTime() / 1000);
  let todayCents = 0;
  if (decision.now && decision.prorate) {
    try {
      todayCents = await previewNow(sub, await priceIdFor(decision.now.plan, decision.now.interval), prorationDate);
    } catch (e) {
      console.error("plan change: preview failed", ctx.agency.id, e instanceof Error ? e.message : e);
      return blocked(
        "We couldn't get today's amount from Stripe just now. Try again in a minute. Nothing has been charged.",
      );
    }
  }

  const name = PLANS[plan].name;
  const periodEnd = formatAuDate(sub.periodEnd);
  const rows = paySummaryRows({
    decision,
    to: { plan, interval },
    current,
    todayCents,
    periodEnd,
    trialEnd: sub.trialEnd ? formatAuDate(sub.trialEnd) : null,
    daysLeft: daysLeft(sub.periodEnd, now),
  });

  const agentToOffice = isAgentToOffice(sub.plan, plan);
  const payerName = profile.full_name?.trim() || profile.email;
  const recorded = (ctx.agency.licensee_email ?? "").trim().toLowerCase();
  const recordedIsPayer = recorded !== "" && recorded === (profile.email ?? "").trim().toLowerCase();

  return shell(
    <>
      <div className="mt-6">
        <PaySummary
          rows={rows}
          note={
            decision.timing === "next_billing_date"
              ? `Includes GST. You stay on ${PLANS[sub.plan].name} until then.`
              : "Includes GST. Charged to the card on file."
          }
        />
      </div>

      <ConfirmPlanChangeForm
        hidden={{
          plan,
          interval,
          fromPlan: sub.plan,
          fromInterval: sub.interval,
          prorationDate: String(prorationDate),
          expectedTodayCents: String(todayCents),
        }}
        buttonLabel={confirmButtonLabel({
          timing: decision.timing,
          todayCents,
          planName: name,
          effectiveDate: periodEnd,
        })}
        agentToOffice={
          agentToOffice
            ? {
                payerName,
                accessLines: OFFICE_ACCESS_LINES,
                defaultName: recordedIsPayer ? "" : (ctx.agency.licensee_name ?? ""),
                defaultEmail: recordedIsPayer ? "" : recorded,
              }
            : null
        }
      />
    </>,
  );
}
