import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email/send";
import { formatAuDateTimeShort, formatAuTimestamp } from "@/lib/format-date";

// AN OFFICE CANCELLED: TELL ADAM (brief, 3 Nov 2026).
//
// Was: when an office cancelled from the Stripe billing page, the webhook
// ended the office and nobody was told. Adam found three (Raine & Horne
// Queanbeyan, Jaden Digital, Pomona Property Group UAT) only by looking at the
// data, and never saw the reasons they typed into Stripe's cancel screen.
// Now: one short, plain email to Adam each time an office's subscription
// ends, with who, when, at what stage, and the reason they gave.
//
// Sent from the webhook (app/api/stripe/webhook/route.ts) only when that
// request is the one that moved the office to "canceled", so a message Stripe
// sends twice is told once. Never for a free (comped) office: Adam switching
// an office to free cancels its subscription in Stripe, and the webhook
// leaves a comped office alone before anything gets here.
//
// The words are built here with no network or database (cancellationEmail),
// so each line is tested (cancellation-alert.test.ts).

/** Where it goes (the brief). Not ADMIN_NOTIFICATION_EMAIL: the brief names the address. */
export const CANCELLATION_ALERT_TO = "admin@realcomply.com.au";

/** The parts of Stripe's subscription this email reads. Epoch seconds throughout. */
export type CancelledSubscription = {
  id: string;
  customer: string;
  livemode?: boolean;
  trial_end: number | null;
  /** When they cancelled. For a cancellation booked for the end of a paid month, when they asked. */
  canceled_at?: number | null;
  /** When the subscription actually ended. */
  ended_at?: number | null;
  cancellation_details?: {
    comment?: string | null;
    feedback?: string | null;
    reason?: string | null;
  } | null;
};

export type CancelledOffice = {
  name: string;
  plan: string | null;
  /** When the office signed up (agencies.created_at). */
  createdAt: string | null;
  licenseeName: string | null;
  licenseeEmail: string | null;
};

/**
 * Stripe's cancel screen offers a fixed list (its customer portal settings),
 * returned as these codes. Shown in the words the person picked from.
 */
const FEEDBACK: Record<string, string> = {
  too_expensive: "It's too expensive",
  missing_features: "I need more features",
  switched_service: "I found an alternative",
  unused: "I no longer need it",
  customer_service: "Customer service was less than expected",
  too_complex: "Ease of use was less than expected",
  low_quality: "Quality was less than expected",
  other: "Other reason",
};

/** How the subscription ended, when it wasn't the office asking. */
const ENDED_BY: Record<string, string> = {
  payment_failed: "Stripe ended it because a payment failed.",
  payment_disputed: "Stripe ended it because a payment was disputed.",
};

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** "During the free trial", "When the free trial ended" or "After the free trial, while paying". */
export function cancelledStage(sub: Pick<CancelledSubscription, "trial_end" | "canceled_at" | "ended_at">): string {
  const at = sub.canceled_at ?? sub.ended_at ?? null;
  if (sub.trial_end == null) return "No free trial, while paying";
  if (at == null) return "Not recorded";
  // A minute either side: Stripe ends a trial with no card at the trial's end.
  if (at < sub.trial_end - 60) return "During the free trial";
  if (at <= sub.trial_end + 60) return "When the free trial ended";
  return "After the free trial, while paying";
}

/** The customer in Stripe's dashboard, live or test. */
export function stripeCustomerLink(sub: Pick<CancelledSubscription, "customer" | "livemode">): string {
  return `https://dashboard.stripe.com/${sub.livemode === false ? "test/" : ""}customers/${encodeURIComponent(sub.customer)}`;
}

/** The email, word for word. */
export function cancellationEmail(office: CancelledOffice, sub: CancelledSubscription): { subject: string; text: string } {
  const name = office.name.trim() || "An office";
  const licensee =
    office.licenseeName && office.licenseeEmail
      ? `${office.licenseeName} (${office.licenseeEmail})`
      : (office.licenseeName ?? office.licenseeEmail ?? "Not recorded");

  const cancelledAt = sub.canceled_at ?? sub.ended_at ?? null;
  const endedAt = sub.ended_at ?? null;
  // A paid month booked to cancel ends later than it was cancelled.
  const endedLater = cancelledAt != null && endedAt != null && endedAt - cancelledAt > 3600;

  const feedback = sub.cancellation_details?.feedback?.trim() || null;
  const comment = sub.cancellation_details?.comment?.trim() || null;
  const endedBy = ENDED_BY[sub.cancellation_details?.reason ?? ""] ?? null;

  const lines = [
    `${name} has cancelled RealComply.`,
    "",
    `Office: ${name}`,
    `Licensee: ${licensee}`,
    `Plan: ${office.plan ?? "Not recorded"}`,
    `Signed up: ${office.createdAt ? formatAuTimestamp(office.createdAt) : "Not recorded"}`,
    `Cancelled: ${cancelledAt != null ? `${formatAuDateTimeShort(iso(cancelledAt))} (Sydney)` : "Not recorded"}`,
    endedLater ? `Access ended: ${formatAuDateTimeShort(iso(endedAt))} (Sydney)` : null,
    `Trial end: ${sub.trial_end != null ? formatAuTimestamp(iso(sub.trial_end)) : "No free trial"}`,
    `When: ${cancelledStage(sub)}`,
    endedBy,
    "",
    // The option they picked, then what they typed; "None given" when neither.
    `Reason they gave: ${feedback ? (FEEDBACK[feedback] ?? feedback) : comment ? `"${comment}"` : "None given"}`,
    feedback && comment ? `Their words: "${comment}"` : null,
    "",
    `In Stripe: ${stripeCustomerLink(sub)}`,
  ];
  return {
    subject: `Cancelled: ${name}`,
    text: lines.filter((l): l is string => l !== null).join("\n"),
  };
}

/**
 * Reads the office and emails Adam. True when it went. Never throws: a failed
 * email is logged, and the webhook still answers Stripe with 200, so the
 * office stays ended and Stripe doesn't send the message again.
 */
export async function sendCancellationAlert(
  supabase: SupabaseClient,
  agencyId: string,
  sub: CancelledSubscription,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("agencies")
      .select("name, plan, created_at, licensee_name, licensee_email")
      .eq("id", agencyId)
      .maybeSingle();
    if (error) throw new Error(`agencies read failed: ${error.message}`);
    const row = (data ?? {}) as {
      name?: string | null;
      plan?: string | null;
      created_at?: string | null;
      licensee_name?: string | null;
      licensee_email?: string | null;
    };

    // The licensee in charge's own login, where the office row doesn't name one.
    let licenseeName = row.licensee_name?.trim() || null;
    let licenseeEmail = row.licensee_email?.trim() || null;
    if (!licenseeName || !licenseeEmail) {
      const { data: lic } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("agency_id", agencyId)
        .eq("is_licensee_in_charge", true)
        .limit(1)
        .maybeSingle();
      const p = (lic ?? {}) as { full_name?: string | null; email?: string | null };
      licenseeName ??= p.full_name?.trim() || null;
      licenseeEmail ??= p.email?.trim() || null;
    }

    const email = cancellationEmail(
      {
        name: row.name ?? "",
        plan: row.plan ?? null,
        createdAt: row.created_at ?? null,
        licenseeName,
        licenseeEmail,
      },
      sub,
    );
    const sent = await sendEmail({ to: CANCELLATION_ALERT_TO, ...email });
    if (!sent) console.error("cancellation email to Adam not sent", agencyId, sub.id);
    return sent;
  } catch (e) {
    console.error("cancellation email to Adam failed", agencyId, sub.id, e instanceof Error ? e.message : e);
    return false;
  }
}
