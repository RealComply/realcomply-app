import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import {
  DILIGENCE_LINE,
  renderEmailHtml,
  renderEmailText,
  type EmailDocument,
} from "./layout";
import { PLANS, annualPrice, type Plan } from "@/lib/billing/entitlement";
import type { Interval } from "@/lib/billing/stripe";

// The trial-ending reminder.
//
// THIS EMAIL IS A CONTRACTUAL PROMISE, not a courtesy. Terms v.4 cl 2.10(b):
//
//   "the Subscriber will be sent a reminder email 3 days before the expiry of
//    the trial period advising the date on which the first payment will be
//    taken and the amount of that payment."
//
// Three things in that sentence are requirements, and all three are the
// reason this file exists rather than Stripe's built-in reminder:
//
//   1. THREE DAYS. Stripe's own automatic trial-ending email goes out SEVEN
//      days before. Sending that instead would not be what the terms promise.
//      The customer.subscription.trial_will_end webhook fires at three days,
//      which is why it is the trigger.
//   2. THE DATE the first payment will be taken.
//   3. THE AMOUNT of it.
//
// So do not "simplify" this into a generic "your trial is ending" message.
// The date and the amount are the point, and dropping either puts RealComply
// in breach of its own terms for every subscriber who converts.
//
// TURN STRIPE'S OWN TRIAL EMAIL OFF (Billing → Subscriptions and emails).
// Leaving it on means two reminders with two different dates, one of which
// contradicts the terms.

const BILLING_URL = "https://www.realcomply.com.au/dashboard/billing";

export type TrialEndingInput = {
  agencyId: string;
  /** From the subscription's price lookup key — never guessed. */
  plan: Plan;
  interval: Interval;
  /** subscription.trial_end, already converted from Stripe's epoch seconds. */
  trialEnd: Date;
};

/** "$249" or "$2,490" — whole dollars, GST inclusive, as advertised. */
function amountFor(plan: Plan, interval: Interval): string {
  const dollars = interval === "annual" ? annualPrice(plan) : PLANS[plan].price;
  return `$${dollars.toLocaleString("en-AU")}`;
}

/**
 * "Thursday, 15 October 2026", in Sydney.
 *
 * The timezone is not cosmetic. trial_end is an instant; a trial ending at
 * 09:00 UTC is the following day in Sydney. Formatting in the server's zone
 * would tell an agency in Hornsby that it will be charged on a date one day
 * off from the date it is actually charged — which is exactly the promise
 * cl 2.10(b) makes.
 */
function chargeDate(when: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Australia/Sydney",
  }).format(when);
}

export async function sendTrialEndingEmail(input: TrialEndingInput): Promise<boolean> {
  const supabase = createServiceClient();

  const { data: agencyRow } = await supabase
    .from("agencies")
    .select("id, name, stripe_customer_id, status")
    .eq("id", input.agencyId)
    .maybeSingle();

  const agency = agencyRow as {
    id: string;
    name: string;
    stripe_customer_id: string | null;
    status: string;
  } | null;

  if (!agency) {
    console.error("trial-ending: no agency", input.agencyId);
    return false;
  }

  // A comped account has no card and will never be charged, so telling it a
  // payment is coming would be alarming and wrong.
  if (agency.status === "comped") return false;

  const to = await billingEmailFor(supabase, agency.id);
  if (!to) {
    console.error("trial-ending: no billing contact for agency", agency.id);
    return false;
  }

  const spec = PLANS[input.plan];
  const amount = amountFor(input.plan, input.interval);
  const date = chargeDate(input.trialEnd);
  const every = input.interval === "annual" ? "a year" : "a month";

  const doc: EmailDocument = {
    preheader: `Your first payment of ${amount} is on ${date}.`,
    title: "Your trial ends in three days",
    meta: agency.name,
    sections: [
      {
        kind: "paragraph",
        lead: true,
        text: `Your RealComply trial ends on ${date}, and your first payment will be taken that day.`,
      },
      {
        kind: "rows",
        rows: [
          {
            title: `${amount} on ${date}`,
            sub: `${spec.name} — billed ${every}`,
            detail: "Includes GST. Charged to the card you entered when you started the trial.",
            tone: "attention",
          },
        ],
      },
      {
        kind: "paragraph",
        text:
          "Nothing needs doing if you are staying — the payment happens on its own and your " +
          "records carry on as they are.",
      },
      {
        kind: "paragraph",
        text:
          "If you would rather not continue, cancel before that date and you will not be charged. " +
          "You can also change your plan or update your card from the same page.",
      },
      { kind: "button", label: "Manage your subscription", href: BILLING_URL },
    ],
    footer: [
      DILIGENCE_LINE,
      "RealComply Pty Ltd, ABN 61 700 934 792. Questions about billing: admin@realcomply.com.au",
    ],
  };

  return sendEmail({
    to,
    subject: `Your RealComply trial ends ${date} — first payment ${amount}`,
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  });
}

/**
 * Who gets it.
 *
 * The licensee in charge first — on an office plan they are the Subscriber and
 * the person who entered the card.
 *
 * ON AN INDIVIDUAL AGENT PLAN THERE IS NO LICENSEE IN CHARGE. The agent
 * subscribes personally and the licensee works for an agency that is not a
 * party to the contract at all. So the fallback is not defensive tidying, it
 * is the normal path for the highest-volume tier — and without it every
 * individual subscriber would silently miss a reminder the terms promise them.
 */
async function billingEmailFor(
  supabase: ReturnType<typeof createServiceClient>,
  agencyId: string,
): Promise<string | null> {
  const { data: licensee } = await supabase
    .from("profiles")
    .select("email")
    .eq("agency_id", agencyId)
    .eq("is_licensee_in_charge", true)
    .limit(1)
    .maybeSingle();

  const licenseeEmail = (licensee as { email?: string } | null)?.email;
  if (licenseeEmail) return licenseeEmail;

  const { data: anyone } = await supabase
    .from("profiles")
    .select("email")
    .eq("agency_id", agencyId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (anyone as { email?: string } | null)?.email ?? null;
}
