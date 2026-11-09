import { sendEmail, type SendEmailInput } from "@/lib/email/send";
import { formatAuDate, formatAuDateTimeShort } from "@/lib/format-date";
import { PLANS, type Plan } from "@/lib/billing/entitlement";
import type { Interval } from "@/lib/billing/stripe";
import { intervalWord, money, type ChangeTiming } from "@/lib/billing/plan-change";
import { CANCELLATION_ALERT_TO } from "@/lib/email/cancellation-alert";

// A PLAN CHANGED: TELL ADAM (mockup note 6, Adam 6 Nov 2026: "Adam gets an
// email for every plan change"). One short, plain email each time someone
// changes their plan on Billing, or keeps their plan instead of a change
// booked for the next billing date: the office, from what, to what, when,
// what was charged today, and who did it. Same address as the cancellation
// email. The words are built here with no network (planChangeEmail), so each
// line is tested.

export type PlanChangeForEmail = {
  officeName: string;
  changedBy: string;
  fromPlan: Plan;
  fromInterval: Interval;
  toPlan: Plan;
  toInterval: Interval;
  timing: ChangeTiming;
  /** When it took or takes effect (ISO). */
  effectiveAt: string;
  amountTodayCents: number;
  ongoingCents: number;
  /** For an agent moving to an office plan. */
  licensee: { answer: "self" | "someone_else"; name: string | null; email: string | null } | null;
  customer: string;
  livemode: boolean;
  /** Something that went wrong after Stripe took the change, for Adam to put right. */
  problem?: string | null;
  at: string;
};

const planName = (plan: Plan, interval: Interval) => `${PLANS[plan].name}, ${intervalWord(interval)}`;

export function planChangeEmail(c: PlanChangeForEmail): { subject: string; text: string } {
  const name = c.officeName.trim() || "An office";
  const when =
    c.timing === "next_billing_date"
      ? `From ${formatAuDate(c.effectiveAt)} (the next billing date)`
      : c.timing === "now_then_next"
        ? `Now, and ${intervalWord(c.toInterval)} from ${formatAuDate(c.effectiveAt)}`
        : "Now";
  const licensee = c.licensee
    ? c.licensee.answer === "self"
      ? `Licensee in charge: ${c.changedBy} (said "I am")`
      : `Licensee in charge: ${c.licensee.name ?? "Not given"} (${c.licensee.email ?? "no email"}). Confirm email sent; ${c.changedBy} keeps the office side until they approve.`
    : null;
  const lines = [
    `${name} changed plan.`,
    "",
    `Office: ${name}`,
    `From: ${planName(c.fromPlan, c.fromInterval)}`,
    `To: ${planName(c.toPlan, c.toInterval)}`,
    `When: ${when}`,
    `Charged today: ${money(c.amountTodayCents)} (GST included)`,
    `New price: ${money(c.ongoingCents)} a ${c.toInterval === "annual" ? "year" : "month"}`,
    `Changed by: ${c.changedBy}, ${formatAuDateTimeShort(c.at)} (Sydney)`,
    licensee,
    c.problem ? "" : null,
    c.problem ? `To check: ${c.problem}` : null,
    "",
    `In Stripe: https://dashboard.stripe.com/${c.livemode ? "" : "test/"}customers/${encodeURIComponent(c.customer)}`,
  ];
  return {
    subject: `Plan change: ${name}, ${PLANS[c.fromPlan].name} to ${PLANS[c.toPlan].name}`,
    text: lines.filter((l): l is string => l !== null).join("\n"),
  };
}

export function keptPlanEmail(c: {
  officeName: string;
  keptBy: string;
  plan: Plan;
  interval: Interval;
  cancelledPlan: Plan;
  cancelledInterval: Interval;
  at: string;
}): { subject: string; text: string } {
  const name = c.officeName.trim() || "An office";
  return {
    subject: `Plan change cancelled: ${name} stays on ${PLANS[c.plan].name}`,
    text: [
      `${name} kept its plan.`,
      "",
      `Office: ${name}`,
      `Stays on: ${planName(c.plan, c.interval)}`,
      `Change taken off: ${planName(c.cancelledPlan, c.cancelledInterval)}`,
      `By: ${c.keptBy}, ${formatAuDateTimeShort(c.at)} (Sydney)`,
    ].join("\n"),
  };
}

/** Never throws: a failed email is logged, and the change already made stands. */
export async function sendPlanChangeAlert(
  email: { subject: string; text: string },
  send: (input: SendEmailInput) => Promise<boolean> = sendEmail,
): Promise<boolean> {
  try {
    const sent = await send({ to: CANCELLATION_ALERT_TO, ...email });
    if (!sent) console.error("plan change alert: not sent", email.subject);
    return sent;
  } catch (e) {
    console.error("plan change alert: failed", email.subject, e instanceof Error ? e.message : e);
    return false;
  }
}
