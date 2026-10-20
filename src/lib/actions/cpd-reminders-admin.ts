"use server";

import { requireProfile } from "@/lib/data/current-profile";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail, type SendEmailInput } from "@/lib/email/send";
import { renderEmailHtml, renderEmailText } from "@/lib/email/layout";
import { cpdTestMessage, runCpdReminders, type CpdTestVersion } from "@/lib/email/cpd-reminders";
import { CPD_REMINDER_DATES } from "@/lib/cpd-reminders";
import { currentCpdYear } from "@/lib/cpd-year";
import { isTestAddress } from "@/lib/early-access/rules";

// CPD reminders on the staff page (brief, 19 Oct 2026). Two things, both for
// RealComply staff only and both limited to Adam's test addresses:
//
//   1. A test email of either version, marked [Test], with example names.
//      Nothing is recorded.
//   2. The real job, run now for one made-up office as if it were one of the
//      four send dates. Every person in that office, current or archived, must
//      be on a getadamc3+ address, so it can never reach a real person. It
//      records its sends like the real job, so running the same date twice
//      shows nothing new the second time.

export type CpdAdminState = { error: string | null; notice?: string };

const notStaff = "Only RealComply staff can do that.";
const onlyTest = "Test copies only go to your test addresses (getadamc3+…@gmail.com).";

/** The four send dates of the reminder season for the current CPD year, YYYY-MM-DD. */
export async function cpdSendDatesThisYear(): Promise<string[]> {
  const endYear = Number(currentCpdYear().end.slice(0, 4));
  return CPD_REMINDER_DATES.map((d) => `${endYear}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`);
}

export async function sendTestCpdReminder(_prev: CpdAdminState, formData: FormData): Promise<CpdAdminState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) return { error: notStaff };

  const to = String(formData.get("email") ?? "").trim();
  if (!isTestAddress(to)) return { error: onlyTest };
  const version: CpdTestVersion = formData.get("version") === "summary" ? "summary" : "person";

  const { subject, doc } = cpdTestMessage(version, currentCpdYear().start);
  const ok = await sendEmail({ to, subject, text: renderEmailText(doc), html: renderEmailHtml(doc) });
  if (!ok) return { error: "The test didn't send. The email provider refused it; check the email settings." };
  return {
    error: null,
    notice: `Sent the ${version === "person" ? "person's reminder" : "licensee's summary"} to ${to}.`,
  };
}

export async function runCpdRemindersForMadeUpOffice(
  _prev: CpdAdminState,
  formData: FormData,
): Promise<CpdAdminState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) return { error: notStaff };

  const agencyId = String(formData.get("agency") ?? "");
  const sendDate = String(formData.get("date") ?? "");
  if (!(await cpdSendDatesThisYear()).includes(sendDate)) return { error: "Choose one of the four send dates." };

  const supabase = createServiceClient();
  const [{ data: people }, { data: agency }] = await Promise.all([
    supabase.from("profiles").select("email").eq("agency_id", agencyId),
    supabase.from("agencies").select("name").eq("id", agencyId).maybeSingle(),
  ]);
  const emails = ((people ?? []) as Array<{ email: string | null }>).map((p) => p.email ?? "");
  if (emails.length === 0 || !emails.every(isTestAddress)) {
    return { error: "Only a made-up office whose people are all on your test addresses can be used." };
  }

  // Midday in Sydney on the chosen date, whatever the season.
  const now = new Date(`${sendDate}T02:00:00Z`);
  const went: string[] = [];
  const result = await runCpdReminders(now, {
    supabase,
    agencyIds: [agencyId],
    send: async (input: SendEmailInput) => {
      // Belt and braces: never anything but a test address.
      const to = Array.isArray(input.to) ? input.to : [input.to];
      if (!to.every(isTestAddress)) return false;
      const ok = await sendEmail(input);
      went.push(`${to.join(", ")}: ${input.subject}${ok ? "" : " (failed)"}`);
      return ok;
    },
  });

  const lines = [
    `${(agency as { name: string } | null)?.name ?? "The office"}, as if it were ${sendDate}: ${result.sentPeople} reminder${result.sentPeople === 1 ? "" : "s"} and ` +
      `${result.sentSummaries} summar${result.sentSummaries === 1 ? "y" : "ies"} sent, ` +
      `${result.alreadySent} already sent for this date, ${result.done} ticked done.`,
    ...went,
  ];
  return { error: result.failed > 0 ? `${result.failed} didn't send.` : null, notice: lines.join("\n") };
}
