import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import {
  renderEmailHtml,
  renderEmailText,
  type EmailDocument,
  type EmailSection,
} from "./layout";
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
import type {
  Agency, Profile, SignoffDocument, SignoffSignature, TrustAccount, TrustAudit,
} from "@/lib/types";

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
// PER ACCOUNT (Adam, 25 Aug 2026). An agency with a sales account and a
// property management account owes two reconciliations every month and gets
// two reminders — one naming each. Sending one for "the trust account" when
// there are two is worse than sending none, because it looks handled.
//
// NEVER TWICE. The guarantee lives in the unique index on
// (agency, account, kind, period, stage) in 0032_trust_accounts.sql, not here. This
// checks first and inserts second, so the index is a backstop against two
// overlapping runs rather than the primary path — same shape as
// licence-reminders, and written BEFORE the email goes out for the same
// reason: a reminder that silently sends twice is worse than one that
// occasionally fails to send, because the failure is visible and the
// duplicate just trains people to ignore it.

const TRUST_URL = "https://www.realcomply.com.au/dashboard/trust";

const TRUST_FOOTER = [
  "RealComply provides diligence support to help you stay on top of compliance. It doesn't prepare " +
    "your reconciliation or lodge anything for you, and the licensee in charge remains responsible " +
    "for the agency's trust account records.",
  `<a href="${TRUST_URL}" style="color:#8a9a93">See it any time</a>`,
];

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
  accountId: string,
  kind: "reconciliation" | "audit",
  period: string,
  stage: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("trust_reminders")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("trust_account_id", accountId)
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

    // A closed account owes nothing, so it is not chased.
    const { data: accountRows } = await supabase
      .from("trust_accounts")
      .select("*")
      .eq("agency_id", agency.id)
      .is("archived_at", null);
    const accounts = (accountRows ?? []) as TrustAccount[];

    for (const account of accounts) {
        // ── Monthly reconciliation ──
        if (stage) {
          const month = lastCompletedMonth(today);
          const due = reconciliationDueOn(month);
          const left = daysUntil(due, today);

          const signed = await isMonthSigned(supabase, account.id, month);

          // The 1st is the prompt to start and goes regardless. The other two are
          // only worth sending while it is genuinely outstanding.
          const worthSending = stage === "day1" || !signed;

          if (!worthSending) {
            result.skippedNothingDue += 1;
          } else if (await alreadyRecorded(supabase, agency.id, account.id, "reconciliation", month, stage)) {
            result.alreadySent += 1;
          } else {
            const ok = await sendReconciliation(agency, account, recipients, month, due, left, stage, signed);
            if (ok) {
              await supabase.from("trust_reminders").insert({
                agency_id: agency.id,
                trust_account_id: account.id,
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
          .eq("trust_account_id", account.id)
          .eq("period_end", period)
          .maybeSingle();
        const audit = auditRow as TrustAudit | null;

        if (audit?.confirmed_at) {
          result.skippedNothingDue += 1;
        } else if (await alreadyRecorded(supabase, agency.id, account.id, "audit", period, auditStage)) {
          result.alreadySent += 1;
        } else {
          const ok = await sendAudit(agency, account, recipients, period, due, daysUntil(due, today));
          if (ok) {
            await supabase.from("trust_reminders").insert({
              agency_id: agency.id,
              trust_account_id: account.id,
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
  }

  return result;
}

async function isMonthSigned(
  supabase: ReturnType<typeof createServiceClient>,
  accountId: string,
  month: string,
): Promise<boolean> {
  const { data: docs } = await supabase
    .from("signoff_documents")
    .select("id")
    .eq("trust_account_id", accountId)
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
  account: TrustAccount,
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
    ? `${account.name}: ${label} reconciliation is overdue`
    : stage === "day1"
      ? `${account.name}: ${label} reconciliation`
      : `${account.name}: ${label} reconciliation — ${daysLeft} days left`;

  const opening =
    stage === "day1"
      ? signed
        ? `${label} has ended. The reconciliation for ${account.name} is already signed — nothing to do.`
        : `${label} has ended, so the reconciliation for ${account.name} can be prepared and signed.`
      : late
        ? `The ${label} reconciliation for ${account.name} was due on ${formatAuDate(due)} and is not signed.`
        : `The ${label} reconciliation for ${account.name} is still unsigned. It is due on ${formatAuDate(due)} — ${daysLeft} ${daysLeft === 1 ? "day" : "days"} away.`;

  // Opening is a plain paragraph, not a lead. The title already carries the
  // month, and two bold lines stacked read as two competing headings.
  const sections: EmailSection[] = [{ kind: "paragraph", text: opening }];

  // Nothing outstanding, so the email says so and stops. A reminder that reads
  // identically whether or not the work is done trains people to ignore it.
  if (!(stage === "day1" && signed)) {
    sections.push({
      kind: "rows",
      rows: [
        {
          // Names the obligation rather than repeating the month, which the
          // title and the opening line have both already said.
          title: "Reconciliation statement and trial balance",
          sub: `Due ${formatAuDate(due)}`,
          detail:
            "Reg cl 27(5)(b) requires the reconciliation statement at the end of each named month, " +
            "and cl 30(1) the trial balance comparison within 21 days after the month ends.",
          // Overdue is a live problem. Anything still ahead is a prompt.
          tone: late ? "risk" : "attention",
        },
      ],
    });
    sections.push({
      kind: "note",
      text: "Your assistant can upload the report. The signature is yours.",
    });
    sections.push({ kind: "button", label: "Open the trust register", href: TRUST_URL });
  }

  const doc: EmailDocument = {
    preheader: late
      ? `${label} reconciliation is overdue.`
      : signed && stage === "day1"
        ? `${label} is already signed. Nothing to do.`
        : `Due ${formatAuDate(due)}.`,
    title: `${label} reconciliation`,
    meta: `${account.name} · ${agency.name}`,
    sections,
    footer: TRUST_FOOTER,
  };

  return sendEmail({
    to: recipients,
    subject,
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  });
}

function sendAudit(
  agency: Agency,
  account: TrustAccount,
  recipients: string[],
  periodEnd: string,
  due: string,
  daysLeft: number,
): Promise<boolean> {
  const late = daysLeft < 0;
  const subject = late
    ? `${account.name}: audit for the year ended ${formatAuDate(periodEnd)} is overdue`
    : `${account.name}: trust account audit due ${formatAuDate(due)}`;

  const doc: EmailDocument = {
    preheader: late
      ? `Audit for the year ended ${formatAuDate(periodEnd)} is overdue.`
      : `Due ${formatAuDate(due)}.`,
    title: "Trust account audit",
    meta: `${account.name} · ${agency.name}`,
    sections: [
      {
        kind: "paragraph",
        text: late
          ? `The audit for the year ended ${formatAuDate(periodEnd)} was due on ${formatAuDate(due)} and has not been confirmed in RealComply.`
          : `The audit for the year ended ${formatAuDate(periodEnd)} is due on ${formatAuDate(due)}, ${daysLeft} ${daysLeft === 1 ? "day" : "days"} away.`,
      },
      {
        kind: "rows",
        rows: [
          {
            title: "Independent audit and auditor's report",
            sub: `Year ended ${formatAuDate(periodEnd)} · due ${formatAuDate(due)}`,
            detail:
              "s111 requires the audit within 3 months of the end of the audit period, and s112 fixes " +
              "that period as the year ending 30 June. The auditor's report is kept for at least 3 years.",
            tone: late ? "risk" : "attention",
          },
        ],
      },
      {
        kind: "note",
        text: "Record the auditor, the report and your confirmation on the trust account register.",
      },
      { kind: "button", label: "Open the trust register", href: TRUST_URL },
    ],
    footer: TRUST_FOOTER,
  };

  return sendEmail({
    to: recipients,
    subject,
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  });
}
