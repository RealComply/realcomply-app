import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import {
  DILIGENCE_LINE,
  renderEmailHtml,
  renderEmailText,
  type EmailDocument,
  type EmailSection,
} from "./layout";
import { PLANS, type Plan } from "@/lib/billing/entitlement";
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
  /**
   * What Stripe will actually charge, in cents — from its preview of the first
   * invoice, never from the price list. Checkout allows promotion codes, so
   * the list price can be the wrong figure.
   *
   * Null when Stripe would not preview that invoice (no default payment
   * method, for one). The reminder still goes, naming the date the plan
   * starts but no figure — a guessed amount is worse than none.
   */
  amountCents: number | null;
  /** subscription.trial_end, already converted from Stripe's epoch seconds. */
  trialEnd: Date;
};

/** "$249", "$2,490" or "$199.20" — cents shown only when there are some. */
function formatAmount(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
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

/**
 * What happened, so the webhook can tell a provider failure (nothing went out,
 * so a retry is safe and wanted) from an agency that should not get one.
 */
export type TrialEmailResult = "sent" | "skipped" | "send_failed";

export async function sendTrialEndingEmail(input: TrialEndingInput): Promise<TrialEmailResult> {
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
    return "skipped";
  }

  // A comped account has no card and will never be charged, so telling it a
  // payment is coming would be alarming and wrong.
  if (agency.status === "comped") return "skipped";

  const to = await billingEmailFor(supabase, agency.id);
  if (!to) {
    console.error("trial-ending: no billing contact for agency", agency.id);
    return "skipped";
  }

  const message = trialEndingMessage({ ...input, agencyName: agency.name });
  const sent = await sendEmail({ to, ...message });
  return sent ? "sent" : "send_failed";
}

/**
 * The email itself, apart from who it goes to — pure, so both versions of the
 * wording can be checked without a database or a mail provider.
 */
export function trialEndingMessage(
  input: Omit<TrialEndingInput, "agencyId"> & { agencyName: string },
): { subject: string; text: string; html: string } {
  const spec = PLANS[input.plan];
  const date = chargeDate(input.trialEnd);
  const every = input.interval === "annual" ? "a year" : "a month";
  const amount = input.amountCents === null ? null : formatAmount(input.amountCents);

  // Without the amount, the date is still stated and nothing is invented: the
  // billing page shows the figure and the payment method Stripe holds.
  const opening: EmailSection[] = amount
    ? [
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
      ]
    : [
        {
          kind: "paragraph",
          lead: true,
          text: `Your RealComply trial ends in three days, and your plan will start on ${date}.`,
        },
        {
          kind: "rows",
          rows: [
            {
              title: `Your plan will start on ${date}`,
              sub: `${spec.name} — billed ${every}`,
              detail: "Your billing page shows the amount and the payment method on file.",
              tone: "attention",
            },
          ],
        },
      ];

  const doc: EmailDocument = {
    preheader: amount
      ? `Your first payment of ${amount} is on ${date}.`
      : `Your plan will start on ${date}.`,
    title: "Your trial ends in three days",
    meta: input.agencyName,
    sections: [
      ...opening,
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

  return {
    subject: amount
      ? `Your RealComply trial ends ${date} — first payment ${amount}`
      : `Your RealComply trial is ending — your plan will start on ${date}`,
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  };
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
 *
 * Only people still at the agency (10 Oct 2026). Removing someone leaves
 * their licensee flag set, so after a handover the old licensee could come
 * back first and the cl 2.10(b) reminder went to someone who had left. In
 * created order, so the same person is chosen every time.
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
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const licenseeEmail = (licensee as { email?: string } | null)?.email;
  if (licenseeEmail) return licenseeEmail;

  const { data: anyone } = await supabase
    .from("profiles")
    .select("email")
    .eq("agency_id", agencyId)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (anyone as { email?: string } | null)?.email ?? null;
}
