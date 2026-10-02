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
  reconciliationProgress,
  reconciliationRecordsFor,
  reconciliationReminderFor,
  type ReconciliationDocRow,
  type ReconciliationProgress,
  type ReconciliationSignatureRow,
  type ReminderStage,
} from "@/lib/trust-account";
import type { Agency, Profile, TrustAccount, TrustAudit } from "@/lib/types";

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
//   1st  — the month just ended.
//   7th  — a week in.
//   18th — three days before the deadline, and says how long is left.
//
// Every stage, the 1st included, first reads the month as it stands right now
// through reconciliationProgress in lib/trust-account.ts — the same function
// the trust register uses to show a month as done — and then:
//
//   signed          — sends nothing and writes nothing.
//   filed, unsigned — a short "ready for your sign-off" to the licensee.
//   not filed       — the full reminder.
//
// The 1st used to go regardless, as "the prompt to start". On 1 Oct 2026 that
// sent Cass Property a September reminder for both accounts several hours
// after both had been uploaded and signed. A reminder about something already
// done is how people learn to ignore the sender.
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
  /** Emails that went out, of either kind. */
  sent: number;
  /** Of those, how many were the short "ready for your sign-off". */
  sentReadyForSignoff: number;
  alreadySent: number;
  /** Skipped because the work is done. Nothing is written for these. */
  skippedNothingDue: number;
  failed: number;
};

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Swappable for tests. Production passes nothing and gets the real thing. */
export type TrustReminderDeps = {
  supabase?: ServiceClient;
  send?: typeof sendEmail;
};

async function alreadyRecorded(
  supabase: ServiceClient,
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

export async function runTrustReminders(
  today: Date = new Date(),
  deps: TrustReminderDeps = {},
): Promise<TrustReminderResult> {
  const supabase = deps.supabase ?? createServiceClient();
  const send = deps.send ?? sendEmail;
  const result: TrustReminderResult = {
    checked: 0,
    sent: 0,
    sentReadyForSignoff: 0,
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
    // Someone who has left the office (archived) is no longer the licensee in
    // charge of anything, whatever their old flag says.
    const licensees = ((profileRows ?? []) as Profile[]).filter(
      (p) => p.is_licensee_in_charge && p.email && !p.archived_at,
    );
    if (licensees.length === 0) continue;
    const recipients = licensees.map((p) => p.email);

    // A closed account owes nothing, so it is not chased. Filtered in the
    // query and again here, so a change to one cannot quietly undo the other.
    const { data: accountRows } = await supabase
      .from("trust_accounts")
      .select("*")
      .eq("agency_id", agency.id)
      .is("archived_at", null);
    const accounts = ((accountRows ?? []) as TrustAccount[]).filter((a) => !a.archived_at);

    for (const account of accounts) {
      // ── Monthly reconciliation ──
      if (stage) {
        const month = lastCompletedMonth(today);
        const due = reconciliationDueOn(month);
        const left = daysUntil(due, today);

        // Read now, at send time, every stage.
        const progress = await currentReconciliationProgress(supabase, agency.id, account.id, month);
        const kind = progress ? reconciliationReminderFor(progress) : null;

        if (kind === null) {
          // Could not tell. Sending the wrong email is the bug this guards
          // against, so say nothing and let tomorrow's run or the log catch it.
          result.failed += 1;
        } else if (kind === "none") {
          result.skippedNothingDue += 1;
        } else if (await alreadyRecorded(supabase, agency.id, account.id, "reconciliation", month, stage)) {
          result.alreadySent += 1;
        } else {
          const ok =
            kind === "ready_for_signoff"
              ? await sendReadyForSignoff(send, agency, account, recipients, month, due, left)
              : await sendReconciliation(send, agency, account, recipients, month, due, left, stage);
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
            if (kind === "ready_for_signoff") result.sentReadyForSignoff += 1;
          } else {
            result.failed += 1;
          }
        }
      }

      // ── Annual audit ──
      if (auditStage) {
        const period = previousAuditPeriodEnd(today);
        const due = auditDueOn(period);

        // The audit record as it stands now — the same row and the same
        // confirmed_at test the trust register uses.
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
          const ok = await sendAudit(send, agency, account, recipients, period, due, daysUntil(due, today));
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

/**
 * Where one account's month stands right now, by the same rules the trust
 * register uses (reconciliationRecordsFor + reconciliationProgress). Null if
 * the database could not be read.
 */
export async function currentReconciliationProgress(
  supabase: ServiceClient,
  agencyId: string,
  accountId: string,
  month: string,
): Promise<ReconciliationProgress | null> {
  const { data: docs, error: docError } = await supabase
    .from("signoff_documents")
    .select("id, trust_account_id, period_month, created_at")
    .eq("agency_id", agencyId)
    .eq("trust_account_id", accountId)
    .eq("category", "trust_reconciliation")
    .eq("period_month", month);
  if (docError) return null;

  const docRows = (docs ?? []) as ReconciliationDocRow[];
  let sigRows: ReconciliationSignatureRow[] = [];
  if (docRows.length > 0) {
    const { data: sigs, error: sigError } = await supabase
      .from("signoff_signatures")
      .select("document_id, signed_at")
      .in("document_id", docRows.map((d) => d.id));
    if (sigError) return null;
    sigRows = (sigs ?? []) as ReconciliationSignatureRow[];
  }

  return reconciliationProgress(reconciliationRecordsFor(accountId, docRows, sigRows).get(month));
}

function sendReconciliation(
  send: typeof sendEmail,
  agency: Agency,
  account: TrustAccount,
  recipients: string[],
  month: string,
  due: string,
  daysLeft: number,
  stage: ReminderStage,
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
      ? `${label} has ended, so the reconciliation for ${account.name} can be prepared and signed.`
      : late
        ? `The ${label} reconciliation for ${account.name} was due on ${formatAuDate(due)} and is not signed.`
        : `The ${label} reconciliation for ${account.name} is still unsigned. It is due on ${formatAuDate(due)} — ${daysLeft} ${daysLeft === 1 ? "day" : "days"} away.`;

  // Opening is a plain paragraph, not a lead. The title already carries the
  // month, and two bold lines stacked read as two competing headings.
  const sections: EmailSection[] = [
    { kind: "paragraph", text: opening },
    {
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
    },
    { kind: "note", text: "Your assistant can upload the report. The signature is yours." },
    { kind: "button", label: "Open the trust register", href: TRUST_URL },
  ];

  const doc: EmailDocument = {
    preheader: late ? `${label} reconciliation is overdue.` : `Due ${formatAuDate(due)}.`,
    title: `${label} reconciliation`,
    meta: `${account.name} · ${agency.name}`,
    sections,
    footer: TRUST_FOOTER,
  };

  return send({
    to: recipients,
    subject,
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  });
}

// Uploaded, waiting on the licensee. Short on purpose: the only thing left is
// the signature, so it says that and nothing about uploading.
function sendReadyForSignoff(
  send: typeof sendEmail,
  agency: Agency,
  account: TrustAccount,
  recipients: string[],
  month: string,
  due: string,
  daysLeft: number,
): Promise<boolean> {
  const label = monthLabel(month);
  const late = daysLeft < 0;

  const doc: EmailDocument = {
    preheader: `${label} is uploaded and waiting on your signature.`,
    title: `${label} reconciliation`,
    meta: `${account.name} · ${agency.name}`,
    sections: [
      {
        kind: "paragraph",
        text: late
          ? `The ${label} reconciliation for ${account.name} is uploaded and ready for your sign-off. It was due on ${formatAuDate(due)}.`
          : `The ${label} reconciliation for ${account.name} is uploaded and ready for your sign-off. It is due on ${formatAuDate(due)}.`,
      },
      { kind: "button", label: "Review and sign", href: TRUST_URL },
    ],
    footer: TRUST_FOOTER,
  };

  return send({
    to: recipients,
    subject: `${account.name}: ${label} reconciliation is ready for your sign-off`,
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  });
}

function sendAudit(
  send: typeof sendEmail,
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

  return send({
    to: recipients,
    subject,
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  });
}
