import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { appBaseUrl } from "@/lib/site-url";
import { sydneyDate } from "@/lib/subscription-end/dates";
import { sgReviewDueFor } from "@/lib/data/sg-document";
import { daysUntil, reviewRecipients, reviewReminderDay, type ReviewPerson } from "@/lib/sg-document/annual-review";
import { buildSgReviewEmail } from "@/lib/email/sg-annual-review";

// The annual review reminders for the supervision guidelines, the daily job
// (Adam's mockup, screen 7; Master, 10 Nov 2026; 0126). Rules in
// lib/sg-document/annual-review.ts.
//
// Each morning, for each office with a live document: when its next review
// is due, and whether today has reached the 90, 60, 30, 14 or 7-day step.
// If so, the licensee in charge and every office manager get the reminder,
// quoting Fair Trading's 2.1.2.
//
// NEVER TWICE, the CPD and licence reminders' pattern: the row in
// sg_review_reminders is written BEFORE the email goes, and 0126's unique
// index on (office, person, review date, step) refuses a second. An email
// that didn't go has its row taken away again, so the next morning tries
// once more (the step is still the one reached), and the job tells Adam.
//
// "Reviewed, no changes needed", a quick amendment or a new version moves
// the review date 12 months on, so nothing more goes until the next year's
// 90-day step.

export type SgReviewReminderResult = {
  /** Sydney's date the job acted on. */
  today: string;
  /** Offices with a live document. */
  offices: number;
  sent: number;
  /** Already recorded for this step: not sent again. */
  alreadySent: number;
  failed: number;
};

/** Swappable for tests. */
export type SgReviewReminderDeps = {
  supabase?: ReturnType<typeof createServiceClient>;
  send?: typeof sendEmail;
  /** Only these offices. */
  agencyIds?: string[];
};

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function runSgReviewReminders(
  now: Date = new Date(),
  deps: SgReviewReminderDeps = {},
): Promise<SgReviewReminderResult> {
  const supabase = deps.supabase ?? createServiceClient();
  const send = deps.send ?? sendEmail;
  // The job runs at 22:10 UTC, already the next morning in Sydney.
  const today = sydneyDate(now);
  const result: SgReviewReminderResult = { today, offices: 0, sent: 0, alreadySent: 0, failed: 0 };

  const { data: agencyRows } = await supabase.from("agencies").select("id, name, plan, licensee_not_on_realcomply, ended_at");
  const agencies = ((agencyRows ?? []) as Row[])
    // An office whose subscription has ended is on its records page and is
    // deleted at day 14. Nothing more to it.
    .filter((a) => !a.ended_at)
    .filter((a) => !deps.agencyIds || deps.agencyIds.includes(str(a.id)));

  for (const agency of agencies) {
    const agencyId = str(agency.id);
    const due = await sgReviewDueFor(supabase, agencyId);
    if (!due) continue;
    result.offices += 1;
    const step = reviewReminderDay(due.dueOn, today);
    if (step === null) continue;

    const [{ data: people }, { data: managers }, { data: keeps }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email, is_licensee_in_charge, is_assistant, archived_at")
        .eq("agency_id", agencyId),
      supabase.from("office_managers").select("profile_id, approved_at, withdrawn_at").eq("agency_id", agencyId),
      supabase.from("office_access_until_licensee").select("profile_id, started_at").eq("agency_id", agencyId),
    ]);
    const recipients = reviewRecipients({
      plan: str(agency.plan) || null,
      licenseeNotOnRealcomply: agency.licensee_not_on_realcomply === true,
      people: (people ?? []) as ReviewPerson[],
      officeManagers: ((managers ?? []) as Row[]).map((m) => ({
        profileId: str(m.profile_id),
        approvedAt: str(m.approved_at) || null,
        withdrawnAt: str(m.withdrawn_at) || null,
      })),
      keepsAccess: ((keeps ?? []) as Row[]).map((k) => ({ profileId: str(k.profile_id), startedAt: str(k.started_at) })),
    });

    for (const person of recipients) {
      // Record first, send second (see the top of this file).
      const { data: claimed, error } = await supabase
        .from("sg_review_reminders")
        .insert({ agency_id: agencyId, profile_id: person.id, due_on: due.dueOn, days_before: step })
        .select("id")
        .single();
      if (error || !claimed) {
        // Already sent for this step (the unique index doing its job), or the
        // write failed. Either way, don't send.
        result.alreadySent += 1;
        continue;
      }
      const id = str((claimed as Row).id);
      const email = buildSgReviewEmail({
        recipientName: person.name,
        officeName: str(agency.name),
        dueOn: due.dueOn,
        days: daysUntil(due.dueOn, today),
        appUrl: appBaseUrl(),
      });
      const ok = await send({ to: person.email, ...email });
      if (ok) {
        await supabase.from("sg_review_reminders").update({ email_sent_at: new Date().toISOString() }).eq("id", id);
        result.sent += 1;
      } else {
        // Tomorrow tries again.
        await supabase.from("sg_review_reminders").delete().eq("id", id);
        result.failed += 1;
      }
    }
  }
  return result;
}
