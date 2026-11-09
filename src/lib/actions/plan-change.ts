"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthContext } from "@/lib/actions/compliance";
import { PLANS, type Plan } from "@/lib/billing/entitlement";
import { priceIdFor, type Interval } from "@/lib/billing/stripe";
import { decideChange, isAgentToOffice, priceCents, unavailableReason } from "@/lib/billing/plan-change";
import {
  applyNow,
  bookedChange,
  declinedMessage,
  previewNow,
  releaseSchedule,
  scheduleNext,
} from "@/lib/billing/subscription-change";
import { mayChangePlan, planChangeContext } from "@/lib/data/plan-change";
import { keptPlanEmail, planChangeEmail, sendPlanChangeAlert } from "@/lib/email/plan-change-alert";
import { sendLicenseeConfirmation } from "@/lib/licensee-email/send";
import { createServiceClient } from "@/lib/supabase/service";
import { formatAuDate } from "@/lib/format-date";

// Changing plan on RealComply's own page (mockup signed off by Adam, 6 Nov
// 2026). Whoever pays. In this order, so a problem stops it before money
// moves:
//   1. Everything is checked: who's asking, that the plan can be had, that
//      Stripe still has what the page showed, and the licensee answer for an
//      agent moving to an office plan.
//   2. Stripe: the amount is previewed again for the same moment and must be
//      the amount shown, then the change is made (charged now), or booked
//      for the next billing date.
//   3. The app follows: the plan on the office (the webhook writes the same
//      again), the licensee answer, the confirm email to someone else.
//   4. The record (plan_changes), and Adam's email.
// Anything after Stripe that fails is logged and put in Adam's email: the
// change itself has gone through and must not be undone by a later hiccup.

export type PlanChangeState = { error: string | null };

const PLAN_KEYS = Object.keys(PLANS) as Plan[];
const isPlan = (v: string): v is Plan => (PLAN_KEYS as string[]).includes(v);
const isInterval = (v: string): v is Interval => v === "monthly" || v === "annual";

/** A preview older than this is asked for again: Stripe prorates to the second. */
const PREVIEW_GOOD_FOR_SECONDS = 30 * 60;

export async function confirmPlanChange(_prev: PlanChangeState, formData: FormData): Promise<PlanChangeState> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!(await mayChangePlan(supabase, access))) {
    return { error: "Only the person who pays for RealComply can change the plan." };
  }

  const toPlan = String(formData.get("plan") ?? "");
  const toInterval = String(formData.get("interval") ?? "");
  const fromPlan = String(formData.get("fromPlan") ?? "");
  const fromInterval = String(formData.get("fromInterval") ?? "");
  const prorationDate = Number(formData.get("prorationDate") ?? 0);
  const expectedToday = Number(formData.get("expectedTodayCents") ?? -1);
  if (!isPlan(toPlan) || !isInterval(toInterval)) return { error: "Choose a plan." };

  const ctx = await planChangeContext(supabase, profile);
  if (ctx.state !== "ready") return { error: ctx.message };
  const { agency, sub } = ctx;

  if (sub.plan !== fromPlan || sub.interval !== fromInterval) {
    return { error: "Your plan has changed since this page opened. Go back to Billing and start again." };
  }
  const current = { plan: sub.plan, interval: sub.interval };
  const reason = unavailableReason(
    {
      current,
      interval: toInterval,
      listingCount: ctx.listingCount,
    },
    toPlan,
  );
  if (reason) return { error: reason };

  const decision = decideChange({
    from: current,
    to: { plan: toPlan, interval: toInterval },
    trialing: sub.trialEnd !== null,
  });
  if (decision.kind === "none") return { error: "That's your plan already." };

  // The licensee in charge, for an agent moving to an office plan.
  const service = createServiceClient();
  const agentToOffice = isAgentToOffice(sub.plan, toPlan);
  const answer = String(formData.get("licensee") ?? "");
  const licenseeName = String(formData.get("licenseeName") ?? "").trim();
  const licenseeEmail = String(formData.get("licenseeEmail") ?? "")
    .trim()
    .toLowerCase();
  if (agentToOffice) {
    const { data: problem, error } = await service.rpc("plan_change_licensee_problem", {
      p_agency: agency.id,
      p_profile: profile.id,
      p_answer: answer,
      p_name: licenseeName,
      p_email: licenseeEmail,
    });
    if (error) {
      console.error("plan change: licensee check failed", agency.id, error.message);
      return { error: "Couldn't check the licensee's details. Try again in a minute. Nothing has been charged." };
    }
    if (typeof problem === "string" && problem) return { error: problem };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    decision.prorate &&
    (!Number.isFinite(prorationDate) ||
      nowSeconds - prorationDate > PREVIEW_GOOD_FOR_SECONDS ||
      prorationDate > nowSeconds + 60)
  ) {
    return { error: "This page has been open a while. Go back and open it again to see today's amount." };
  }

  // ── Stripe ────────────────────────────────────────────────────────────
  let invoiceId: string | null = null;
  let amountToday = 0;
  let scheduleId: string | null = null;
  const problems: string[] = [];
  let released = false;
  try {
    const nowPrice = decision.now ? await priceIdFor(decision.now.plan, decision.now.interval) : null;
    const nextPrice = decision.next ? await priceIdFor(decision.next.plan, decision.next.interval) : null;

    if (decision.now && nowPrice) {
      if (decision.prorate) {
        const preview = await previewNow(sub, nowPrice, prorationDate);
        if (preview !== expectedToday) {
          return {
            error: "Today's amount has changed. Go back and open the page again to see it. Nothing has been charged.",
          };
        }
      }
      // One booked change at a time: a change made now replaces it.
      if (sub.scheduleId) {
        await releaseSchedule(sub.scheduleId);
        released = true;
      }
      const applied = await applyNow(sub, nowPrice, { prorate: decision.prorate, prorationDate, agencyId: agency.id });
      invoiceId = applied.invoiceId;
      amountToday = applied.amountPaidCents;
    }
    if (decision.next && nextPrice) {
      const currentPrice = nowPrice ?? sub.priceId;
      try {
        scheduleId = await scheduleNext(
          { ...sub, scheduleId: released ? null : sub.scheduleId },
          currentPrice,
          nextPrice,
          decision.next.interval,
        );
      } catch (e) {
        if (!decision.now) throw e;
        // The plan changed now; only the monthly or yearly switch didn't book.
        console.error("plan change: couldn't book the switch", agency.id, e instanceof Error ? e.message : e);
        problems.push(
          "The plan changed now, but the switch to " +
            decision.next.interval +
            " from the next billing date didn't book.",
        );
      }
    }
  } catch (e) {
    const declined = declinedMessage(e);
    if (declined) return { error: declined };
    console.error("plan change: Stripe refused", agency.id, e instanceof Error ? e.message : e);
    return {
      error: released
        ? "Couldn't change your plan, and nothing has been charged. Your earlier booked change was taken off; book it again if you still want it."
        : "Couldn't change your plan, and nothing has been charged. Try again in a minute, and email admin@realcomply.com.au if it keeps happening.",
    };
  }

  // ── The app follows ───────────────────────────────────────────────────
  if (decision.now) {
    const { error } = await service
      .from("agencies")
      .update({ plan: decision.now.plan })
      .eq("id", agency.id)
      .eq("stripe_subscription_id", sub.id)
      .neq("status", "comped");
    if (error) {
      console.error("plan change: plan not written", agency.id, error.message);
      problems.push("The office's plan wasn't written in the app; the Stripe webhook should write it.");
    }
  }

  let licenseeRecorded = true;
  if (agentToOffice && decision.now) {
    const changeDay = formatAuDate(new Date().toISOString());
    const { error } = await service.rpc("apply_plan_change_licensee", {
      p_agency: agency.id,
      p_profile: profile.id,
      p_answer: answer,
      p_name: licenseeName,
      p_email: licenseeEmail,
      p_reason: `Moved from ${PLANS[sub.plan].name} to ${PLANS[toPlan].name} on ${changeDay}.`,
    });
    if (error) {
      licenseeRecorded = false;
      console.error("plan change: licensee answer not recorded", agency.id, error.message);
      problems.push(`The licensee answer wasn't recorded (${error.message}).`);
    } else if (answer === "someone_else") {
      const outcome = await sendLicenseeConfirmation(service, agency.id, {
        annexureWaiting: true,
        replyTo: profile.email ?? null,
      });
      if (outcome === "failed")
        problems.push("The confirm email to the licensee didn't send. They can be sent it again from Office profile.");
    }
  }

  // ── The record, and Adam ──────────────────────────────────────────────
  const changedBy = profile.full_name?.trim() || profile.email || "Someone in the office";
  const effectiveAt = decision.timing === "now" ? new Date().toISOString() : sub.periodEnd;
  const nextPaymentAt = sub.trialEnd ?? sub.periodEnd;
  const { data: row, error: rowError } = await service
    .from("plan_changes")
    .insert({
      agency_id: agency.id,
      changed_by: profile.id,
      changed_by_name: changedBy.slice(0, 200),
      from_plan: sub.plan,
      from_interval: sub.interval,
      to_plan: toPlan,
      to_interval: toInterval,
      takes_effect: decision.timing,
      effective_at: effectiveAt,
      next_payment_at: nextPaymentAt,
      amount_today_cents: amountToday,
      ongoing_cents: priceCents(toPlan, toInterval),
      stripe_invoice_id: invoiceId,
      stripe_schedule_id: scheduleId,
      licensee_answer: agentToOffice && licenseeRecorded ? answer : null,
      licensee_name: agentToOffice && answer === "someone_else" ? licenseeName : null,
      licensee_email: agentToOffice && answer === "someone_else" ? licenseeEmail : null,
      status: decision.timing === "now" ? "done" : "scheduled",
    })
    .select("id")
    .single();
  if (rowError) {
    console.error("plan change: record not written", agency.id, rowError.message);
    problems.push("The plan change record wasn't written.");
  }

  await sendPlanChangeAlert(
    planChangeEmail({
      officeName: agency.name,
      changedBy,
      fromPlan: sub.plan,
      fromInterval: sub.interval,
      toPlan,
      toInterval,
      timing: decision.timing,
      effectiveAt,
      amountTodayCents: amountToday,
      ongoingCents: priceCents(toPlan, toInterval),
      licensee: agentToOffice
        ? {
            answer: answer === "self" ? "self" : "someone_else",
            name: licenseeName || null,
            email: licenseeEmail || null,
          }
        : null,
      customer: sub.customer,
      livemode: sub.livemode,
      problem: problems.length ? problems.join(" ") : null,
      at: new Date().toISOString(),
    }),
  );

  revalidatePath("/dashboard", "layout");
  const id = (row as { id?: string } | null)?.id;
  redirect(id ? `/dashboard/billing?changed=${encodeURIComponent(id)}` : "/dashboard/billing?changed=1");
}

/** Keeps the plan they're on: the change booked for the next billing date is taken off. */
export async function keepCurrentPlan(_prev: PlanChangeState, _formData: FormData): Promise<PlanChangeState> {
  void _formData;
  const { supabase, profile, access } = await requireAuthContext();
  if (!(await mayChangePlan(supabase, access))) {
    return { error: "Only the person who pays for RealComply can change the plan." };
  }
  const ctx = await planChangeContext(supabase, profile);
  if (ctx.state !== "ready") return { error: ctx.message };
  const { agency, sub } = ctx;

  const service = createServiceClient();
  if (sub.scheduleId) {
    const booked = ctx.booked ?? (await bookedChange(sub.scheduleId).catch(() => null));
    try {
      await releaseSchedule(sub.scheduleId);
    } catch (e) {
      console.error("plan change: couldn't take the booked change off", agency.id, e instanceof Error ? e.message : e);
      return { error: "Couldn't take the change off just now. Try again in a minute." };
    }
    await sendPlanChangeAlert(
      keptPlanEmail({
        officeName: agency.name,
        keptBy: profile.full_name?.trim() || profile.email || "Someone in the office",
        plan: sub.plan,
        interval: sub.interval,
        cancelledPlan: booked?.plan ?? sub.plan,
        cancelledInterval: booked?.interval ?? sub.interval,
        at: new Date().toISOString(),
      }),
    );
  }
  await service
    .from("plan_changes")
    .update({ status: "kept_current", kept_at: new Date().toISOString() })
    .eq("agency_id", agency.id)
    .eq("status", "scheduled");

  revalidatePath("/dashboard/billing");
  redirect("/dashboard/billing?kept=1");
}
