import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { formatAuDate } from "@/lib/format-date";
import {
  auditDueOn,
  auditStageForMonth,
  daysUntil,
  lastCompletedMonth,
  monthLabel,
  previousAuditPeriodEnd,
  reminderStageForDay,
  reconciliationDueOn,
  type ReminderStage,
} from "@/lib/trust-account";
import type { Agency, Profile, SignoffDocument, SignoffSignature, TrustAudit } from "@/lib/types";

// Trust account reminders — the daily job.
//
// Adam, 25 Aug 2026: "on the first and the seventh of every month, the licensee
// should get an email reminding them that it needs to be signed off." The 18th
// was added on the same call: the deadline is 21 days after month end (reg
// cl 30(1)), so a warning three days out is the last one that can still change
// the outcome, and without it the product goes quiet exactly when it matters.
//
// WHAT FIRES WHEN.
//
//   1st  — the month just ended. Sent whether or not anything is uploaded:
//          this is the prompt to start, not a complaint.
//   7th  — only while the month is still unsigned.
//   18th — only while still unsigned, and says how long is left.
//
// A reminder about something already done is how people learn to ignore the
// sender, which is why the 7th and 18th check first and the 1st is the only
// unconditional one.
//
// NEVER TWICE. The guarantee lives in the unique index on
// (agency, kind, period, stage) in 0031_trust_account.sql, not here. This
// checks first and inserts second, so the index is a backstop against two
// overlapping runs rather than the primary path — same shape as
// licence-reminders, and written BEFORE the email goes out for the same
// reason: a reminder that silently sends twice is worse than one that
// occasionally fails to send, because the failure is visible and the
// duplicate just trains people to ignore it.

const FOOTER =
  "\n\n---\nRealComply provides diligence support to help you stay on top of compliance. " +
  "It doesn't prepare your reconciliation or lodge anything for you, and the licensee in charge " +
  "remains responsible for the agency's trust account records.\n" +
  "See the register any time at https://realcomply.com.au/dashboard/registers?tab=trust";

export type TrustReminderResult = {
  checked: number;
  sent: number;
  alreadySent: number;
  skippedNothingDue: number;
  failed: number;
};

async function alreadyRecorded(
  supabase: ReturnType<typeof createServiceClient>,
  agencyId: string,
  kind: "reconciliation" | "audit",
  period: string,
  stage: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("trust_reminders")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("kind", kind)
    .eq("period", period)
    .eq("stage", stage)
    .maybeSingle();
  return Boolean(data);
}

export async function runTrustReminders(today: Date = new Date()): Promise<TrustReminderResult> {
  const supabase = createServiceClient();
  const result: TrustReminderResult = {
    checked: 0,
    sent: 0,
    alreadySent: 0,
    skippedNothingDue: 0,
    failed: 0,
  };

  const dayOfMonth = today.getUTCDate();
  const stage = reminderStageForDay(dayOfMonth);
  const auditStage = dayOfMonth === 1 ? auditStageForMonth(today.getUTCMonth()) : null;

  // Most mornings this is both null and the job does nothing at all, which is
  // the intended shape — cheap to run daily, silent unless there is something
  // to say.
  if (!stage && !auditStage) return result;

  const { data: agencies } = await supabase.from("agencies").select("*");

  for (const agency of (agencies ?? []) as Agency[]) {
    result.checked += 1;

    const { data: profileRows } = await supabase.from("profiles").select("*").eq("agency_id", agency.id);
    const licensees = ((profileRows ?? []) as Profile[]).filter((p) => p.is_licensee_in_charge && p.email);
    if (licensees.length === 0) continue;
    const recipients = licensees.map((p) => p.email);

    // ── Monthly reconciliation ──
    if (stage) {
      const month = lastCompletedMonth(today);
      const due = reconciliationDueOn(month);
      const left = daysUntil(due, today);

      const signed = await isMonthSigned(supabase, agency.id, month);

      // The 1st is the prompt to start and goes regardless. The other two are
      // only worth sending while it is genuinely outstanding.
      const worthSending = stage === "day1" || !signed;

      if (!worthSending) {
        result.skippedNothingDue += 1;
      } else if (await alreadyRecorded(supabase, agency.id, "reconciliation", month, stage)) {
        result.alreadySent += 1;
      } else {
        const ok = await sendReconciliation(agency, recipients, month, due, left, stage, signed);
        if (ok) {
          await supabase.from("trust_reminders").insert({
            agency_id: agency.id,
            kind: "reconciliation",
            period: month,
            stage,
            recipients,
          });
          result.sent += 1;
        } else {
          result.failed += 1;
        }
      }
    }

    // ── Annual audit ──
    if (auditStage) {
      const period = previousAuditPeriodEnd(today);
      const due = auditDueOn(period);

      const { data: auditRow } = await supabase
        .from("trust_audits")
        .select("*")
        .eq("agency_id", agency.id)
        .eq("period_end", period)
        .maybeSingle();
      const audit = auditRow as TrustAudit | null;

      if (audit?.confirmed_at) {
        result.skippedNothingDue += 1;
      } else if (await alreadyRecorded(supabase, agency.id, "audit", period, auditStage)) {
        result.alreadySent += 1;
      } else {
        const ok = await sendAudit(agency, recipients, period, due, daysUntil(due, today));
        if (ok) {
          await supabase.from("trust_reminders").insert({
            agency_id: agency.id,
            kind: "audit",
            period,
            stage: auditStage,
            recipients,
          });
          result.sent += 1;
        } else {
          result.failed += 1;
        }
      }
    }
  }

  return result;
}

async function isMonthSigned(
  supabase: ReturnType<typeof createServiceClient>,
  agencyId: string,
  month: string,
): Promise<boolean> {
  const { data: docs } = await supabase
    .from("signoff_documents")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("category", "trust_reconciliation")
    .eq("period_month", month);

  const ids = ((docs ?? []) as Pick<SignoffDocument, "id">[]).map((d) => d.id);
  if (ids.length === 0) return false;

  const { data: sigs } = await supabase
    .from("signoff_signatures")
    .select("id, signed_at")
    .in("document_id", ids)
    .not("signed_at", "is", null);

  return ((sigs ?? []) as Pick<SignoffSignature, "id">[]).length > 0;
}

function sendReconciliation(
  agency: Agency,
  recipients: string[],
  month: string,
  due: string,
  daysLeft: number,
  stage: ReminderStage,
  signed: boolean,
): Promise<boolean> {
  const label = monthLabel(month);
  const late = daysLeft < 0;

  const subject = late
    ? `${label} trust reconciliation is overdue`
    : stage === "day1"
      ? `${label} trust reconciliation`
      : `${label} trust reconciliation — ${daysLeft} days left`;

  const opening =
    stage === "day1"
      ? signed
        ? `${label} has ended. Your trust account reconciliation for the month is already signed — nothing to do.`
        : `${label} has ended, so the trust account reconciliation for the month can be prepared and signed.`
      : late
        ? `The ${label} trust account reconciliation was due on ${formatAuDate(due)} and is not signed.`
        : `The ${label} trust account reconciliation is still unsigned. It is due on ${formatAuDate(due)} — ${daysLeft} ${daysLeft === 1 ? "day" : "days"} away.`;

  const text =
    `${opening}\n\n` +
    "Reg cl 27(5)(b) requires the reconciliation statement to be prepared at the end of each named " +
    "month, and cl 30(1) requires the trial balance comparison within 21 days after the month ends.\n\n" +
    "Your assistant can upload the report; the signature is yours.\n" +
    `Agency: ${agency.name}` +
    FOOTER;

  return sendEmail({ to: recipients, subject, text });
}

function sendAudit(
  agency: Agency,
  recipients: string[],
  periodEnd: string,
  due: string,
  daysLeft: number,
): Promise<boolean> {
  const late = daysLeft < 0;
  const subject = late
    ? `Trust account audit for the year ended ${formatAuDate(periodEnd)} is overdue`
    : `Trust account audit due ${formatAuDate(due)}`;

  const text =
    (late
      ? `The trust account audit for the year ended ${formatAuDate(periodEnd)} was due on ${formatAuDate(due)} and has not been confirmed in RealComply.`
      : `The trust account audit for the year ended ${formatAuDate(periodEnd)} is due on ${formatAuDate(due)} — ${daysLeft} ${daysLeft === 1 ? "day" : "days"} away.`) +
    "\n\ns111 of the Property and Stock Agents Act 2002 (NSW) requires the audit within 3 months of the " +
    "end of the audit period, and s112 fixes that period as the year ending 30 June. The auditor's " +
    "report is kept for at least 3 years.\n\n" +
    "Record the auditor, the report and your confirmation on the Trust account register.\n" +
    `Agency: ${agency.name}` +
    FOOTER;

  return sendEmail({ to: recipients, subject, text });
}
